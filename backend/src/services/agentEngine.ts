import OpenAI from 'openai';
import { Pool } from 'pg';
import { MCP_TOOLS, executarFerramenta } from './mcp/tools';
import { criarProvider, OpenAIProvider, AIMessage } from './providers/index';
import { evolutionFetch, sanitizeEvolutionUrl, withAiFallback } from '../utils/resilientFetch';

// Cliente global — usado como fallback; substituído pela chave do banco sempre que possível
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });

export interface MensagemEntrada {
  instancia: string;
  messageId: string;
  telefone: string;
  pushName: string;
  texto: string | null;
  tipo: string;
  midiaUrl?: string;
  timestamp: number;
  userId?: string;
}

// ── Buffer de mensagens picotadas ────────────────────────────────────────────
const bufferMensagens = new Map<string, {
  timeout: ReturnType<typeof setTimeout>;
  mensagens: string[];
  entrada: MensagemEntrada;
}>();

// ── Lock de concorrência — impede duas respostas simultâneas ao mesmo número ─
const atendimentosAtivos = new Set<string>();

// ── Cria cliente OpenAI com chave do provider (fallback para env) ─────────────
function criarClienteOpenAI(apiKey?: string): OpenAI {
  const key = apiKey || process.env.OPENAI_API_KEY || '';
  return key ? new OpenAI({ apiKey: key }) : openai;
}

// ── Transcrição de áudio via Whisper ─────────────────────────────────────────
async function transcreverAudio(url: string, apiKey?: string): Promise<string | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    const blob = new Blob([buf], { type: 'audio/ogg' });
    const form = new FormData();
    form.append('file', blob, 'audio.ogg');
    form.append('model', 'whisper-1');
    form.append('language', 'pt');
    const key = apiKey || process.env.OPENAI_API_KEY || '';
    const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (!resp.ok) {
      console.warn('[ENGINE] Whisper erro:', resp.status, await resp.text().catch(() => ''));
      return null;
    }
    return ((await resp.json()) as any).text || null;
  } catch {
    return null;
  }
}

// ── Análise de imagem via GPT-4o-mini Vision ─────────────────────────────────
async function analisarImagem(url: string, caption?: string, apiKey?: string): Promise<string> {
  try {
    const client = criarClienteOpenAI(apiKey);
    const r = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url } },
          {
            type: 'text',
            text: caption
              ? `Imagem com legenda: "${caption}". Descreva em 1-2 frases.`
              : 'Descreva esta imagem brevemente.',
          },
        ],
      }],
      max_tokens: 200,
    });
    return r.choices[0]?.message?.content || caption || '[imagem]';
  } catch {
    return caption || '[imagem]';
  }
}

// ── Divide resposta em até 2 partes para simular digitação humana ─────────────
function dividirMensagem(texto: string): string[] {
  const partes = texto.split(/\n\n+/).filter(p => p.trim());
  if (partes.length <= 1) return [texto];
  if (partes.length > 2) return [partes.slice(0, -1).join('\n\n'), partes[partes.length - 1]];
  return partes;
}

// ── IDs e textos de mensagens enviadas pelo bot (previne auto-pausa da IA) ───
export const botMessageIds = new Set<string>();
export const botSentTexts  = new Set<string>();

// ── Envio via Evolution API ───────────────────────────────────────────────────
async function enviarResposta(
  serverUrl: string, apiKey: string,
  instancia: string, telefone: string, texto: string
): Promise<void> {
  const base = sanitizeEvolutionUrl(serverUrl);

  // Registra o conteúdo ANTES de enviar para evitar condição de corrida no antiloop
  const textKey = `${telefone}:${texto}`;
  const textKeyTrimmed = `${telefone}:${texto.trim()}`;
  botSentTexts.add(textKey);
  botSentTexts.add(textKeyTrimmed);
  setTimeout(() => { botSentTexts.delete(textKey); botSentTexts.delete(textKeyTrimmed); }, 120_000);

  const r = await evolutionFetch(`${base}/message/sendText/${instancia}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: apiKey },
    body: JSON.stringify({ number: telefone, text: texto, delay: 1200 }),
  });
  if (!r.ok) throw new Error(`Evolution: ${r.status} ${await r.text()}`);
  // Registra o ID real do WhatsApp para o webhook não pausar a IA
  const data = await r.json().catch(() => ({})) as any;
  const msgId: string | undefined = data?.key?.id;
  if (msgId) {
    botMessageIds.add(msgId);
    setTimeout(() => botMessageIds.delete(msgId), 120_000);
  }
}

// ── Persistência de histórico (formato Langchain — compatível com n8n) ─────────
// Popula também as colunas de auditoria: contato_telefone, papel, conteudo, tokens_consumidos.
async function salvarHistorico(
  pool: Pool, sessionId: string, userId: string,
  instancia: string, role: 'user' | 'assistant', content: string,
  tokensConsumidos?: number,
): Promise<void> {
  const type = role === 'user' ? 'human' : 'ai';
  await pool.query(
    `INSERT INTO n8n_chat_histories
       (session_id, message, user_id, instancia,
        contato_telefone, papel, conteudo, tokens_consumidos)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      sessionId,
      JSON.stringify({ type, content, additional_kwargs: {}, response_metadata: {} }),
      userId,
      instancia,
      sessionId.slice(0, 30),          // contato_telefone (= telefone/session_id)
      role,                             // papel: 'user' | 'assistant'
      content.slice(0, 10000),          // conteudo: texto puro (limite seguro)
      tokensConsumidos ?? null,         // tokens_consumidos: só preenchido na resposta
    ],
  ).catch(err => console.error('[ENGINE INSERT n8n_chat_histories]:', err.message));
}

// ── Parser nativo — sem segunda chamada à API (zero custo, zero latência) ──────
// A IA deve usar [QUEBRA] no prompt para indicar onde dividir mensagens.
// Também detecta o sinal de pausa 251213 no texto.
function parsearRespostaNativo(texto: string, sinalPausa: string): { messages: string[]; pausar: boolean } {
  const SEPARADOR = '[QUEBRA]';
  const pausar = texto.includes('251213') || (sinalPausa !== '251213' && texto.includes(sinalPausa));
  const limpo = texto
    .replace(/251213/g, '')
    .replace(sinalPausa !== '251213' ? sinalPausa : '', '')
    .replace(/\*\*(.*?)\*\*/g, '*$1*') // **negrito** → *negrito* (WhatsApp)
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const partes = limpo.split(SEPARADOR).map(p => p.trim()).filter(Boolean);
  // Máximo 2 partes; se não usou [QUEBRA], tenta dividir em parágrafos naturais
  if (partes.length >= 2) return { messages: partes.slice(0, 2), pausar };
  const paragrafos = limpo.split(/\n\n+/).filter(p => p.trim());
  if (paragrafos.length >= 2) return { messages: [paragrafos.slice(0,-1).join('\n\n'), paragrafos[paragrafos.length-1]], pausar };
  return { messages: [limpo], pausar };
}

// ── Upsert de contato ─────────────────────────────────────────────────────────
async function upsertContato(
  pool: Pool, userId: string, telefone: string, nome: string
): Promise<{ id: string; opt_out: boolean }> {
  const ex = await pool.query(
    `SELECT id, opt_out FROM contatos WHERE user_id = $1 AND telefone ILIKE $2 LIMIT 1`,
    [userId, `%${telefone.slice(-11)}`]
  );
  if (ex.rows.length) return ex.rows[0];

  const novo = await pool.query(
    `INSERT INTO contatos (user_id, nome, telefone, origem, status)
     VALUES ($1, $2, $3, 'WhatsApp', 'novo') RETURNING id, opt_out`,
    [userId, nome || telefone, telefone]
  );
  return novo.rows[0];
}

// ── MOTOR PRINCIPAL ───────────────────────────────────────────────────────────
async function processarMensagem(pool: Pool, entrada: MensagemEntrada): Promise<void> {
  // Higienizar e validar telefone antes de qualquer operação
  const telefoneDigitos = entrada.telefone.replace(/\D/g, '');
  if (telefoneDigitos.length < 10 || telefoneDigitos.length > 13) {
    console.warn(`[ENGINE START] Telefone inválido, abortando: "${entrada.telefone}" → "${telefoneDigitos}" (${telefoneDigitos.length} dígitos)`);
    return;
  }
  entrada = { ...entrada, telefone: telefoneDigitos };

  // ── Lock de concorrência: evita duas respostas simultâneas ao mesmo número ──
  const lockKey = `${entrada.instancia}:${telefoneDigitos}`;
  if (atendimentosAtivos.has(lockKey)) {
    console.log(`[ENGINE] Concorrência detectada para ${telefoneDigitos} — reagendando após 4s`);
    setTimeout(() => processarMensagem(pool, entrada).catch(() => {}), 4000);
    return;
  }
  atendimentosAtivos.add(lockKey);

  try {
  console.log(`[ENGINE START] instancia="${entrada.instancia}" telefone="${entrada.telefone}" tipo="${entrada.tipo}" userId="${entrada.userId || 'N/A'}"`);

  // 1. Buscar agente — prioriza o agente do usuário correto, depois qualquer um da instância
  const r1 = await pool.query(
    `SELECT * FROM agentes
     WHERE LOWER(evolution_instancia) = LOWER($1) AND ativo = true
     ORDER BY CASE WHEN user_id = $2 THEN 0 ELSE 1 END, updated_at DESC
     LIMIT 1`,
    [entrada.instancia, entrada.userId || '']
  );
  let agenteRows = r1.rows;

  if (!agenteRows.length && entrada.userId) {
    const r2 = await pool.query(
      `SELECT * FROM agentes
       WHERE user_id = $1 AND ativo = true
       ORDER BY updated_at DESC LIMIT 1`,
      [entrada.userId]
    );
    agenteRows = r2.rows;
    if (agenteRows.length) {
      console.log(`[ENGINE] Agente via userId fallback: ${agenteRows[0].nome}`);
    }
  }

  if (!agenteRows.length) {
    console.warn(`[ENGINE] Nenhum agente. instancia="${entrada.instancia}" userId="${entrada.userId}"`);
    return;
  }

  const agente = { ...agenteRows[0] };
  if (!agente.evolution_server_url)
    agente.evolution_server_url = process.env.EVOLUTION_API_URL || 'https://disparo.mentoark.com.br';
  if (!agente.evolution_api_key)
    agente.evolution_api_key = process.env.EVOLUTION_API_KEY || '';
  if (!agente.evolution_instancia)
    agente.evolution_instancia = entrada.instancia;

  const userIdFinal = agente.user_id || entrada.userId!;

  // 2. Verificar opt-out
  const contato = await upsertContato(pool, userIdFinal, entrada.telefone, entrada.pushName);
  if (contato.opt_out) {
    console.log(`[ENGINE] Contato ${entrada.telefone} com opt_out=true — ignorando`);
    return;
  }

  // 3. Verificar pausa de atendimento humano (dados_cliente E contatos)
  const pausaRes = await pool.query(
    `SELECT d.atendimento_ia, c.atendente_pausou_ia
     FROM contatos c
     LEFT JOIN dados_cliente d
       ON d.user_id = c.user_id AND d.telefone ILIKE '%' || RIGHT(c.telefone, 11)
     WHERE c.user_id = $1 AND c.telefone ILIKE $2
     LIMIT 1`,
    [userIdFinal, `%${entrada.telefone.slice(-11)}`]
  ).catch(() => ({ rows: [] as any[] }));
  if (
    pausaRes.rows[0]?.atendimento_ia === 'pause' ||
    pausaRes.rows[0]?.atendente_pausou_ia === true
  ) {
    console.log(`[ENGINE] IA pausada para ${entrada.telefone} (atendimento_ia=${pausaRes.rows[0]?.atendimento_ia} / atendente_pausou_ia=${pausaRes.rows[0]?.atendente_pausou_ia})`);
    return;
  }

  // 4. Criar provider ANTES de resolver mídia (a apiKey é necessária para Whisper/Vision)
  const providerInfo = await criarProvider(pool, userIdFinal, agente.provider_id ?? null);
  if (!providerInfo) {
    console.warn(`[ENGINE] Nenhum ai_provider encontrado para user_id=${userIdFinal}. Configure em Integrações > Configuração de IA.`);
  }
  const envKey = process.env.OPENAI_API_KEY || '';
  if (!providerInfo && !envKey) {
    console.error(`[ENGINE] ATENÇÃO: sem provider no banco E OPENAI_API_KEY vazio — a IA não conseguirá responder!`);
  }
  // apiKey descritografada do banco (usada por Whisper, Vision e Parser)
  const openaiApiKey = (providerInfo?.providerSlug === 'openai' ? providerInfo?.apiKey : null)
    || envKey;

  // 5. Resolver mídia (usa apiKey do provider para Whisper/Vision)
  let textoFinal = entrada.texto;
  if (entrada.tipo === 'audio' && entrada.midiaUrl) {
    textoFinal = await transcreverAudio(entrada.midiaUrl, openaiApiKey);
    if (!textoFinal) { console.warn('[ENGINE] Falha na transcrição'); return; }
    console.log(`[ENGINE] Áudio transcrito: "${textoFinal.slice(0, 60)}"`);
  } else if (entrada.tipo === 'image' && entrada.midiaUrl) {
    textoFinal = await analisarImagem(entrada.midiaUrl, entrada.texto || undefined, openaiApiKey);
  }
  if (!textoFinal) return;

  // 6. Configuração unificada — fonte única: agent_configs (por user_id)
  const configRes = await pool.query(
    `SELECT prompt_sistema, nome_agente, sinal_pausa, palavra_reativar,
            modelo_llm, evolution_server_url, evolution_api_key,
            operation_mode, distribution_mode,
            saudacao_inicial, bloco_qualificacao,
            mensagem_encaminhamento, mensagem_encerramento
     FROM agent_configs
     WHERE user_id = $1 AND ativo = true
     LIMIT 1`,
    [userIdFinal]
  );

  const agentConfig = configRes.rows[0] ?? null;

  // Prompt do sistema: usa agent_configs.prompt_sistema como fonte principal.
  // Fallback para agent_prompts apenas para compatibilidade com contas antigas sem migração.
  let systemPromptBase: string;
  if (agentConfig?.prompt_sistema) {
    systemPromptBase = agentConfig.prompt_sistema;
  } else {
    const legacyRes = await pool.query(
      `SELECT conteudo FROM agent_prompts WHERE user_id = $1 AND ativo = true LIMIT 1`,
      [userIdFinal]
    );
    systemPromptBase = legacyRes.rows[0]?.conteudo ?? 'Você é um assistente prestativo.';
  }

  const nomeAgente = agentConfig?.nome_agente || agente.nome || 'Assistente';
  const sinalPausa = agentConfig?.sinal_pausa || '251213';

  // Override de Evolution a partir do agent_configs (tem precedência sobre o agente)
  if (agentConfig?.evolution_server_url) agente.evolution_server_url = agentConfig.evolution_server_url;
  if (agentConfig?.evolution_api_key)    agente.evolution_api_key    = agentConfig.evolution_api_key;

  const systemPrompt = systemPromptBase +
    `\n\nData/hora atual: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`;

  // 7. Histórico — session_id sempre com dígitos puros (sem @s.whatsapp.net)
  const histSessionId = entrada.telefone.replace(/\D/g, '');
  const histRes = await pool.query(
    `SELECT message FROM n8n_chat_histories
     WHERE session_id = $1 AND user_id = $2
     ORDER BY created_at DESC LIMIT 20`,
    [histSessionId, userIdFinal]
  );
  const historico: AIMessage[] = histRes.rows.reverse().flatMap((r: any) => {
    try {
      const m = typeof r.message === 'string' ? JSON.parse(r.message) : r.message;
      const content = (m.content || m.text || '').trim();
      if (!content) return [];
      // Mapeamento estrito: qualquer indicador de IA → 'assistant', resto → 'user'
      const rawRole = String(m.role || m.type || '').toLowerCase();
      const isAssistant = rawRole === 'assistant' || rawRole === 'ai'
        || rawRole === 'bot' || rawRole === 'system';
      const role: 'user' | 'assistant' = isAssistant ? 'assistant' : 'user';
      // Ignorar mensagens de sistema puras que não devem ir ao modelo
      if (rawRole === 'system') return [];
      return [{ role, content } as AIMessage];
    } catch {
      return []; // JSON inválido — descartar sem travar
    }
  });

  const mensagens: AIMessage[] = [
    ...historico,
    { role: 'user', content: textoFinal },
  ];

  // sessionId sempre com dígitos puros (sem @s.whatsapp.net)
  const sessionId = entrada.telefone.replace(/\D/g, '');

  // 8. Finalizar configuração do provider
  const provider = providerInfo?.provider ?? new OpenAIProvider(envKey);
  const modelo = providerInfo?.modelo || agentConfig?.modelo_llm || agente.modelo || 'gpt-4.1';
  const providerSlug = providerInfo?.providerSlug || 'openai';
  console.log(`[ENGINE] Provider: ${providerInfo ? providerSlug + '/' + modelo : 'FALLBACK env'} | user=${userIdFinal} | apiKey: ${openaiApiKey ? 'OK' : 'VAZIA'}`);

  // 8. Loop agêntico — máximo 5 iterações
  const MAX_ITER = 5;
  let respostaFinal = '';
  let tokensEntrada = 0;
  let tokensSaida = 0;
  let pausaAtivada = false;

  for (let iter = 0; iter < MAX_ITER; iter++) {
    // ── [RASTREIO IA] Log pré-chamada ────────────────────────────────────────
    console.log(
      '[RASTREIO IA] Enviando para OpenAI',
      '| Telefone:', entrada.telefone,
      '| Provider:', providerSlug + '/' + modelo,
      '| Iter:', iter,
      '| HistLen:', mensagens.length,
      '| ApiKey:', openaiApiKey ? `OK (${openaiApiKey.slice(0, 8)}...)` : 'VAZIA ← PROBLEMA',
      '| System Prompt:', systemPrompt.slice(0, 150).replace(/\n/g, ' '),
      '| Mensagem do Usuário:', textoFinal?.slice(0, 200),
    );

    let resp: Awaited<ReturnType<typeof provider.complete>> | null = null;
    try {
      resp = await withAiFallback(
        () => provider.complete(mensagens, systemPrompt, MCP_TOOLS, {
          model: modelo,
          temperature: Number(agente.temperatura) || 0.7,
          maxTokens: agente.max_tokens || 1024,
        }),
        null,
        `ENGINE provider.complete (${modelo})`,
      );
    } catch (err: any) {
      console.error(
        '[RASTREIO IA - ERRO] Chamada OpenAI falhou',
        '| Telefone:', entrada.telefone,
        '| Provider:', providerSlug + '/' + modelo,
        '| Status HTTP:', err?.status ?? err?.statusCode ?? 'N/A',
        '| Código:', err?.code ?? 'N/A',
        '| Mensagem:', err?.message,
      );
      throw err; // propaga para o caller registrar e liberar o lock
    }

    if (!resp) {
      console.error(
        '[RASTREIO IA - ERRO] Provider retornou null (401/429)',
        '| Telefone:', entrada.telefone,
        '| Provider:', providerSlug + '/' + modelo,
        '| Diagnóstico: verifique OPENAI_API_KEY no .env do servidor',
      );
      return;
    }

    // ── [RASTREIO IA] Log pós-resposta ───────────────────────────────────────
    console.log(
      '[RASTREIO IA] Resposta OpenAI recebida',
      '| Telefone:', entrada.telefone,
      '| TokensIn:', resp.inputTokens,
      '| TokensOut:', resp.outputTokens,
      '| ToolCalls:', resp.toolCalls.length,
      '| Resposta:', resp.text?.slice(0, 120),
    );

    tokensEntrada += resp.inputTokens;
    tokensSaida += resp.outputTokens;
    if (resp.text) respostaFinal = resp.text;

    // Sem tool_calls → resposta final
    if (!resp.toolCalls.length) break;

    // Executar ferramentas e adicionar resultados
    const toolResults: AIMessage[] = [];
    for (const tc of resp.toolCalls) {
      console.log(`[ENGINE] Tool: ${tc.name}(${JSON.stringify(tc.input).slice(0, 80)})`);
      const resultado = await executarFerramenta(pool, userIdFinal, tc.name, tc.input);

      if (resultado.startsWith('PAUSA_ATIVADA:')) {
        pausaAtivada = true;
        break;
      }

      toolResults.push({
        role: 'user',
        content: `[Resultado de ${tc.name}]: ${resultado}`,
      });
    }

    if (pausaAtivada) break;

    mensagens.push({ role: 'assistant', content: respostaFinal || '[usando ferramentas]' });
    mensagens.push(...toolResults);
  }

  if (!respostaFinal && !pausaAtivada) {
    console.warn('[ENGINE] Sem resposta após loop agêntico');
    return;
  }

  // 9. Parser nativo — sem segunda chamada de API (zero custo, zero latência extra)
  let parserMessages: string[] = [respostaFinal];
  let parserPausou = false;

  if (respostaFinal) {
    const parsed = parsearRespostaNativo(respostaFinal, sinalPausa);
    parserMessages = parsed.messages;
    parserPausou = parsed.pausar;
    if (parserPausou) pausaAtivada = true;
    respostaFinal = parserMessages.join('\n\n');
  }

  // 10. Persistir histórico — session_id sempre dígitos puros
  // Passa tokens_consumidos somente na linha do assistente (custo real da chamada)
  await salvarHistorico(pool, histSessionId, userIdFinal, entrada.instancia, 'user', textoFinal);
  if (respostaFinal) {
    await salvarHistorico(
      pool, histSessionId, userIdFinal, entrada.instancia, 'assistant', respostaFinal,
      tokensEntrada + tokensSaida || undefined,
    );
  }

  // 11. Persistir em whatsapp_messages para o painel de chat
  if (respostaFinal) {
    await pool.query(
      `INSERT INTO whatsapp_messages
         (user_id, instance_name, remote_jid, message_id, from_me,
          message_type, content, status, timestamp_wa)
       VALUES ($1,$2,$3,$4,true,'text',$5,'sent',to_timestamp($6))
       ON CONFLICT (message_id, instance_name) DO NOTHING`,
      [userIdFinal, entrada.instancia,
       `${entrada.telefone}@s.whatsapp.net`,
       `resp_${entrada.messageId}`,
       respostaFinal,
       Math.floor(Date.now() / 1000)]
    ).catch(err => console.error('[ENGINE INSERT whatsapp_messages]:', err.message));
  }

  // 12. Registrar uso de tokens
  if (tokensEntrada || tokensSaida) {
    await pool.query(
      `INSERT INTO ai_uso_diario
         (user_id, data, provider_slug, modelo, total_mensagens, tokens_entrada, tokens_saida)
       VALUES ($1, CURRENT_DATE, $2, $3, 1, $4, $5)
       ON CONFLICT (user_id, data, provider_slug, modelo) DO UPDATE
       SET total_mensagens = ai_uso_diario.total_mensagens + 1,
           tokens_entrada  = ai_uso_diario.tokens_entrada  + $4,
           tokens_saida    = ai_uso_diario.tokens_saida    + $5,
           updated_at = now()`,
      [userIdFinal, providerSlug, modelo, tokensEntrada, tokensSaida]
    ).catch(err => console.error('[ENGINE INSERT ai_uso_diario]:', err.message));
  }

  // 13. Enviar mensagens (replica o Loop do n8n: 3s entre cada parte)
  if (!pausaAtivada && parserMessages.length) {
    // Correção 1 — Validar telefone antes de enviar
    const telefoneDigitos = entrada.telefone.replace(/\D/g, '');
    if (telefoneDigitos.length < 10 || telefoneDigitos.length > 13) {
      console.warn(`[ENGINE] Telefone inválido, abortando envio: ${entrada.telefone}`);
      return;
    }
    const numerosProibidos = ['5511999900001', '5511999900002', '5511999900003'];
    if (numerosProibidos.some(n => entrada.telefone.includes(n))) {
      console.warn(`[ENGINE] Número de teste detectado, abortando: ${entrada.telefone}`);
      return;
    }

    // Correção 2 — Verificar que o agente tem Evolution configurado
    if (!agente.evolution_server_url || !agente.evolution_api_key) {
      console.error(`[ENGINE] Agente sem Evolution configurado — não enviando resposta`);
      console.error(`[ENGINE] Configure evolution_server_url e evolution_api_key no agente`);
      return;
    }

    for (let i = 0; i < parserMessages.length; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, 3000));
      const textoFormatado = `*${nomeAgente}*\n${parserMessages[i]}`;
      await enviarResposta(
        agente.evolution_server_url,
        agente.evolution_api_key,
        agente.evolution_instancia || entrada.instancia,
        entrada.telefone,
        textoFormatado
      );
    }
  }

  // 14. Ações de pausa
  if (pausaAtivada) {
    console.log(`[ENGINE] Pausa ativada para ${entrada.telefone}`);
    await pool.query(
      `UPDATE dados_cliente SET atendimento_ia = 'pause', pausa_timestamp = NOW()
       WHERE user_id = $1 AND telefone ILIKE $2`,
      [userIdFinal, `%${entrada.telefone.slice(-11)}`]
    ).catch(err => console.error('[ENGINE UPDATE dados_cliente pause]:', err.message));

    if (respostaFinal) {
      const historicoRes = await pool.query(
        `SELECT message FROM n8n_chat_histories
         WHERE session_id = $1 AND user_id = $2
         ORDER BY created_at DESC LIMIT 10`,
        [histSessionId, userIdFinal]
      ).catch(() => ({ rows: [] as any[] }));

      const resumo = historicoRes.rows
        .reverse()
        .map((r: any) => {
          const m = typeof r.message === 'string' ? JSON.parse(r.message) : r.message;
          const role = m.type === 'human' || m.role === 'user' ? 'Cliente' : 'IA';
          return `${role}: ${String(m.content).slice(0, 200)}`;
        })
        .join('\n');

      const backendUrl = process.env.BACKEND_URL || 'https://api.mentoark.com.br';
      const kanbanSecret = process.env.N8N_WEBHOOK_SECRET || 'mentoark-kanban-secret-2025';
      fetch(`${backendUrl}/api/kanban/webhook/n8n`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-webhook-secret': kanbanSecret },
        body: JSON.stringify({
          user_id: userIdFinal,
          titulo: `Lead: ${entrada.pushName} (${entrada.telefone})`,
          resumo: resumo.slice(0, 800) || 'Conversa finalizada pela IA',
          contato_nome: entrada.pushName,
          contato_telefone: entrada.telefone,
          remote_jid: `${entrada.telefone}@s.whatsapp.net`,
          instance_name: entrada.instancia,
          prioridade: 'alta',
        }),
      }).catch(err => console.warn('[ENGINE] Falha ao criar card Kanban:', err.message));
    }
  }

  console.log(`[ENGINE] ✓ ${entrada.telefone} | ${providerSlug}/${modelo} | msgs: ${parserMessages.length} | pausa: ${pausaAtivada}`);

  } finally {
    // Liberar lock independente de sucesso ou erro
    atendimentosAtivos.delete(lockKey);
  }
}

// ── Debounce — agrupa mensagens picotadas do mesmo contato ───────────────────
export async function processarComDebounce(pool: Pool, entrada: MensagemEntrada): Promise<void> {
  const chave = `${entrada.instancia}:${entrada.telefone}`;
  const DEBOUNCE_MS = 3000;

  const existente = bufferMensagens.get(chave);
  if (existente) {
    clearTimeout(existente.timeout);
    if (entrada.texto) existente.mensagens.push(entrada.texto);
    existente.entrada = entrada;
  } else {
    bufferMensagens.set(chave, {
      timeout: null as any,
      mensagens: entrada.texto ? [entrada.texto] : [],
      entrada,
    });
  }

  const buf = bufferMensagens.get(chave)!;
  buf.timeout = setTimeout(async () => {
    bufferMensagens.delete(chave);
    const entradaFinal = { ...buf.entrada };
    if (buf.mensagens.length > 1) entradaFinal.texto = buf.mensagens.join(' ');
    await processarMensagem(pool, entradaFinal).catch(err =>
      console.error('[ENGINE] Erro:', err)
    );
  }, DEBOUNCE_MS);
}

export { processarMensagem };
