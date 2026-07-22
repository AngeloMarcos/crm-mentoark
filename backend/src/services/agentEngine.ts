/**
 * agentEngine.ts — Motor de resposta automática da IA para mensagens do WhatsApp.
 *
 * Chamado por webhook.ts (via processarComDebounce, 3s de debounce por telefone) após uma
 * mensagem recebida ser atribuída a um userId. Resolve o agente (tabela agentes) e a config de
 * IA (agent_configs: prompt, modelo, provider), monta o histórico (n8n_chat_histories), chama o
 * provider (OpenAI/Claude/Gemini), faz parsing nativo da resposta (quebra em até 2
 * mensagens, detecta sinal de pausa) e envia via Evolution API (enviarResposta). Mantém os Sets
 * globais botMessageIds/botSentTexts que webhook.ts usa para não confundir a própria resposta
 * do bot com uma intervenção humana (ver [WEBHOOK_ANTILOOP] em webhook.ts).
 */
import OpenAI from 'openai';
import { Pool } from 'pg';
import { MCP_TOOLS, executarFerramenta } from './mcp/tools';
import { criarProvider, OpenAIProvider, AIMessage } from './providers/index';
import { evolutionFetch, sanitizeEvolutionUrl, withAiFallback } from '../utils/resilientFetch';
import { withTenantContext } from '../db';
import { log } from '../logger';

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
      log.warn('ENGINE', 'Whisper erro', { status: resp.status, body: await resp.text().catch(() => '') });
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
  ).catch(err => log.error('ENGINE INSERT n8n_chat_histories', 'Falha ao inserir histórico', { err: err?.message, stack: err?.stack }));
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
    log.warn('ENGINE START', 'Telefone inválido, abortando', {
      telefoneOriginal: entrada.telefone,
      telefoneDigitos,
      quantidadeDigitos: telefoneDigitos.length,
    });
    return;
  }
  entrada = { ...entrada, telefone: telefoneDigitos };

  // ── Lock de concorrência: evita duas respostas simultâneas ao mesmo número ──
  const lockKey = `${entrada.instancia}:${telefoneDigitos}`;
  if (atendimentosAtivos.has(lockKey)) {
    log.info('ENGINE', 'Concorrência detectada — reagendando após 4s', { telefone: telefoneDigitos });
    setTimeout(() => processarMensagem(pool, entrada).catch(() => {}), 4000);
    return;
  }
  atendimentosAtivos.add(lockKey);

  try {
  log.info('ENGINE START', 'Nova mensagem recebida', {
    instancia: entrada.instancia,
    telefone: entrada.telefone,
    tipo: entrada.tipo,
    userId: entrada.userId || 'N/A',
  });

  // [AUDITORIA] FIX APLICADO (2026-07-21): a query original buscava por `evolution_instancia`
  // sozinho, usando `user_id` só como critério de ORDER BY (desempate) — se o usuário correto
  // não tivesse um agente com esse nome de instância, ela silenciosamente retornava o agente
  // de OUTRO usuário que por acaso usou o mesmo nome (evolution_instancia só é único por
  // usuário, não globalmente). Isso permitia a IA responder um cliente usando a persona/chave
  // de API de outra empresa. Corrigido: com userId conhecido (sempre o caso agora que
  // webhook.ts nunca mais chama processarComDebounce sem userId resolvido — ver
  // diagnosticos/AUDITORIA_LOG.md), a busca exige user_id exato. Só cai para "qualquer
  // agente com esse nome de instância" no caso residual de userId não vir preenchido.
  let agenteRows: any[];
  if (entrada.userId) {
    const r1 = await pool.query(
      `SELECT * FROM agentes
       WHERE LOWER(evolution_instancia) = LOWER($1) AND user_id = $2 AND ativo = true
       ORDER BY updated_at DESC
       LIMIT 1`,
      [entrada.instancia, entrada.userId]
    );
    agenteRows = r1.rows;
  } else {
    log.warn('ENGINE', 'userId ausente ao buscar agente — usando fallback global por instancia (risco de colisão entre tenants)', { instancia: entrada.instancia });
    const r1 = await pool.query(
      `SELECT * FROM agentes
       WHERE LOWER(evolution_instancia) = LOWER($1) AND ativo = true
       ORDER BY updated_at DESC
       LIMIT 1`,
      [entrada.instancia]
    );
    agenteRows = r1.rows;
  }

  if (!agenteRows.length && entrada.userId) {
    const r2 = await pool.query(
      `SELECT * FROM agentes
       WHERE user_id = $1 AND ativo = true
       ORDER BY updated_at DESC LIMIT 1`,
      [entrada.userId]
    );
    agenteRows = r2.rows;
    if (agenteRows.length) {
      log.info('ENGINE', 'Agente via userId fallback', { nomeAgente: agenteRows[0].nome });
    }
  }

  if (!agenteRows.length) {
    log.warn('ENGINE', 'Nenhum agente encontrado', { instancia: entrada.instancia, userId: entrada.userId });
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
    log.info('ENGINE', 'Contato com opt_out=true — ignorando', { telefone: entrada.telefone });
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
    log.info('ENGINE', 'IA pausada', {
      telefone: entrada.telefone,
      atendimentoIa: pausaRes.rows[0]?.atendimento_ia,
      atendentePausouIa: pausaRes.rows[0]?.atendente_pausou_ia,
    });
    return;
  }

  // 4. Criar provider ANTES de resolver mídia (a apiKey é necessária para Whisper/Vision)
  const providerInfo = await criarProvider(pool, userIdFinal, agente.provider_id ?? null);
  if (!providerInfo) {
    log.warn('ENGINE', 'Nenhum ai_provider encontrado. Configure em Integrações > Configuração de IA.', { userId: userIdFinal });
  }
  const envKey = process.env.OPENAI_API_KEY || '';
  if (!providerInfo && !envKey) {
    log.error('ENGINE', 'ATENÇÃO: sem provider no banco E OPENAI_API_KEY vazio — a IA não conseguirá responder!');
  }
  // apiKey descritografada do banco (usada por Whisper, Vision e Parser)
  const openaiApiKey = (providerInfo?.providerSlug === 'openai' ? providerInfo?.apiKey : null)
    || envKey;

  // 5. Resolver mídia (usa apiKey do provider para Whisper/Vision)
  let textoFinal = entrada.texto;
  if (entrada.tipo === 'audio' && entrada.midiaUrl) {
    textoFinal = await transcreverAudio(entrada.midiaUrl, openaiApiKey);
    if (!textoFinal) { log.warn('ENGINE', 'Falha na transcrição'); return; }
    log.info('ENGINE', 'Áudio transcrito', { textoTranscrito: textoFinal.slice(0, 60) });
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
  // [AUDITORIA] LÓGICA: só url e api_key vêm de agent_configs — evolution_instancia continua
  // vindo exclusivamente de `agentes` (linha ~253 acima). É uma terceira variação de como este
  // módulo trata agent_configs vs. agentes/integracoes_config — ver o achado mais completo sobre
  // essa inconsistência entre tabelas em backend/src/routes/whatsapp.ts (getEvolutionConfig).
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

  // 8. Finalizar configuração do provider
  const provider = providerInfo?.provider ?? new OpenAIProvider(envKey);
  const modelo = providerInfo?.modelo || agentConfig?.modelo_llm || agente.modelo || 'gpt-4.1';
  const providerSlug = providerInfo?.providerSlug || 'openai';
  log.info('ENGINE', 'Provider selecionado', {
    provider: providerInfo ? providerSlug + '/' + modelo : 'FALLBACK env',
    userId: userIdFinal,
    apiKeyPresente: !!openaiApiKey,
  });

  // 8. Loop agêntico — máximo 5 iterações
  const MAX_ITER = 5;
  let respostaFinal = '';
  let tokensEntrada = 0;
  let tokensSaida = 0;
  let pausaAtivada = false;

  for (let iter = 0; iter < MAX_ITER; iter++) {
    // ── [RASTREIO IA] Log pré-chamada ────────────────────────────────────────
    log.info('RASTREIO IA', 'Enviando para OpenAI', {
      telefone: entrada.telefone,
      provider: providerSlug + '/' + modelo,
      iter,
      histLen: mensagens.length,
      apiKey: openaiApiKey ? `OK (${openaiApiKey.slice(0, 8)}...)` : 'VAZIA ← PROBLEMA',
      systemPrompt: systemPrompt.slice(0, 150).replace(/\n/g, ' '),
      mensagemUsuario: textoFinal?.slice(0, 200),
    });

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
      log.error('RASTREIO IA - ERRO', 'Chamada OpenAI falhou', {
        telefone: entrada.telefone,
        provider: providerSlug + '/' + modelo,
        statusHttp: err?.status ?? err?.statusCode ?? 'N/A',
        codigo: err?.code ?? 'N/A',
        err: err?.message,
        stack: err?.stack,
      });
      throw err; // propaga para o caller registrar e liberar o lock
    }

    if (!resp) {
      log.error('RASTREIO IA - ERRO', 'Provider retornou null (401/429)', {
        telefone: entrada.telefone,
        provider: providerSlug + '/' + modelo,
        diagnostico: 'verifique OPENAI_API_KEY no .env do servidor',
      });
      return;
    }

    // ── [RASTREIO IA] Log pós-resposta ───────────────────────────────────────
    log.info('RASTREIO IA', 'Resposta OpenAI recebida', {
      telefone: entrada.telefone,
      tokensIn: resp.inputTokens,
      tokensOut: resp.outputTokens,
      toolCalls: resp.toolCalls.length,
      resposta: resp.text?.slice(0, 120),
    });

    tokensEntrada += resp.inputTokens;
    tokensSaida += resp.outputTokens;
    if (resp.text) respostaFinal = resp.text;

    // Sem tool_calls → resposta final
    if (!resp.toolCalls.length) break;

    // Executar ferramentas e adicionar resultados
    const toolResults: AIMessage[] = [];
    for (const tc of resp.toolCalls) {
      log.info('ENGINE', 'Executando tool', { nome: tc.name, input: JSON.stringify(tc.input).slice(0, 80) });
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
    log.warn('ENGINE', 'Sem resposta após loop agêntico');
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
  // [AUDITORIA] FIX APLICADO (2026-07-21): INSERT agora roda dentro de withTenantContext
  // (db.ts) — propaga app.user_id pro Postgres via SET LOCAL, necessário pro piloto de RLS
  // em whatsapp_messages (só homologação por enquanto, ver diagnosticos/AUDITORIA_LOG.md).
  // Sem isso, esse INSERT falharia o WITH CHECK da policy em qualquer ambiente com RLS ativo.
  if (respostaFinal) {
    await withTenantContext({ userId: userIdFinal, isAdmin: false }, client => client.query(
      `INSERT INTO whatsapp_messages
         (user_id, instance_name, remote_jid, message_id, from_me,
          message_type, content, status, timestamp_wa, push_name)
       VALUES ($1,$2,$3,$4,true,'text',$5,'sent',to_timestamp($6), $7)
       ON CONFLICT (message_id, instance_name) DO NOTHING`,
      [userIdFinal, agente.evolution_instancia || entrada.instancia,
       `${entrada.telefone}@s.whatsapp.net`,
       // [AUDITORIA] LÓGICA: prefixo "resp_" é o sinal que webhook.ts usa (checagem
       // messageId.startsWith('resp_')) para reconhecer que esta mensagem veio do próprio bot e
       // não deve disparar a lógica de "atendente assumiu, pausar IA" — acoplamento implícito
       // entre os dois arquivos, sem constante compartilhada.
       `resp_${entrada.messageId}`,
       respostaFinal,
       Math.floor(Date.now() / 1000),
       nomeAgente]
    )).catch(err => log.error('ENGINE INSERT whatsapp_messages', 'Falha ao inserir whatsapp_messages', { err: err?.message, stack: err?.stack }));
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
    ).catch(err => log.error('ENGINE INSERT ai_uso_diario', 'Falha ao registrar uso de tokens', { err: err?.message, stack: err?.stack }));
  }

  // 13. Enviar mensagens (replica o Loop do n8n: 3s entre cada parte)
  if (!pausaAtivada && parserMessages.length) {
    // Correção 1 — Validar telefone antes de enviar
    const telefoneDigitos = entrada.telefone.replace(/\D/g, '');
    if (telefoneDigitos.length < 10 || telefoneDigitos.length > 13) {
      log.warn('ENGINE', 'Telefone inválido, abortando envio', { telefone: entrada.telefone });
      return;
    }
    const numerosProibidos = ['5511999900001', '5511999900002', '5511999900003'];
    if (numerosProibidos.some(n => entrada.telefone.includes(n))) {
      log.warn('ENGINE', 'Número de teste detectado, abortando', { telefone: entrada.telefone });
      return;
    }

    // Correção 2 — Verificar que o agente tem Evolution configurado
    if (!agente.evolution_server_url || !agente.evolution_api_key) {
      log.error('ENGINE', 'Agente sem Evolution configurado — não enviando resposta');
      log.error('ENGINE', 'Configure evolution_server_url e evolution_api_key no agente');
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
    log.info('ENGINE', 'Pausa ativada', { telefone: entrada.telefone });
    await pool.query(
      `UPDATE dados_cliente SET atendimento_ia = 'pause', pausa_timestamp = NOW()
       WHERE user_id = $1 AND telefone ILIKE $2`,
      [userIdFinal, `%${entrada.telefone.slice(-11)}`]
    ).catch(err => log.error('ENGINE UPDATE dados_cliente pause', 'Falha ao atualizar dados_cliente', { err: err?.message, stack: err?.stack }));

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
      }).catch(err => log.warn('ENGINE', 'Falha ao criar card Kanban', { err: err?.message, stack: err?.stack }));
    }
  }

  log.info('ENGINE', 'Processamento concluído', {
    telefone: entrada.telefone,
    provider: `${providerSlug}/${modelo}`,
    quantidadeMensagens: parserMessages.length,
    pausa: pausaAtivada,
  });

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
      log.error('ENGINE', 'Erro', { err: err?.message, stack: err?.stack })
    );
  }, DEBOUNCE_MS);
}

export { processarMensagem };
