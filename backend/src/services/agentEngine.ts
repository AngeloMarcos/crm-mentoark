import OpenAI from 'openai';
import { Pool } from 'pg';
import { MCP_TOOLS, executarFerramenta } from './mcp/tools';
import { criarProvider, OpenAIProvider, AIMessage } from './providers/index';

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

// ── IDs de mensagens enviadas pelo bot (previne auto-pausa da IA) ────────────
export const botMessageIds = new Set<string>();

// ── Envio via Evolution API ───────────────────────────────────────────────────
async function enviarResposta(
  serverUrl: string, apiKey: string,
  instancia: string, telefone: string, texto: string
): Promise<void> {
  const base = serverUrl.replace(/\/$/, '');
  const r = await fetch(`${base}/message/sendText/${instancia}`, {
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
async function salvarHistorico(
  pool: Pool, sessionId: string, userId: string,
  instancia: string, role: 'user' | 'assistant', content: string
): Promise<void> {
  const type = role === 'user' ? 'human' : 'ai';
  await pool.query(
    `INSERT INTO n8n_chat_histories (session_id, message, user_id, instancia)
     VALUES ($1, $2, $3, $4)`,
    [sessionId, JSON.stringify({ type, content, additional_kwargs: {}, response_metadata: {} }), userId, instancia]
  ).catch(err => console.error('[ENGINE INSERT n8n_chat_histories]:', err.message));
}

// ── Parser de resposta (replica o Parser Chain do n8n) ─────────────────────────
const PARSER_SYSTEM_PROMPT = `# PARSE CHAIN — WHATSAPP

## Objetivo
Processar a resposta em 3 passos: detectar pausa, limpar o texto e formatar para WhatsApp.

## PASSO 1 — DETECTAR PAUSA
- Se contiver "251213" → "pausar": true
- Caso contrário → "pausar": false

## PASSO 2 — LIMPEZA
- Remova "251213" completamente do texto
- Remova linhas em branco após a remoção

## PASSO 3 — FORMATAR
- Máximo 2 mensagens, nunca cortar frases no meio
- Preservar emojis e texto original
- Converter **negrito** → *negrito* (formato WhatsApp)

## Formato de Saída OBRIGATÓRIO
Retorne APENAS JSON válido:
{"messages": ["mensagem1"], "pausar": false, "status": "ok"}

- messages: array com 1 ou 2 strings (nunca vazio)
- pausar: true se havia 251213, false se não
- status: sempre "ok"`;

async function parsearResposta(
  texto: string, provider: { complete: Function }, modelo: string
): Promise<{ messages: string[]; pausar: boolean }> {
  try {
    const resp = await provider.complete(
      [{ role: 'user', content: `Mensagem para formatar no WhatsApp:\n${texto}` }],
      PARSER_SYSTEM_PROMPT,
      [], // sem tools
      { model: modelo, temperature: 0, maxTokens: 1024 }
    );
    const content = resp?.text || '';
    // Tenta extrair JSON da resposta (pode vir com markdown ```json ... ```)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    return {
      messages: Array.isArray(parsed.messages) && parsed.messages.length ? parsed.messages : [texto],
      pausar: parsed.pausar === true,
    };
  } catch (err) {
    console.warn('[ENGINE] Parser fallback:', (err as Error).message);
    const pausar = texto.includes('251213');
    const limpo = texto.replace('251213', '').replace(/\n{3,}/g, '\n\n').trim();
    return { messages: [limpo], pausar };
  }
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
  // Correção 5 — higienizar e validar telefone antes de qualquer operação
  const telefoneDigitos = entrada.telefone.replace(/\D/g, '');
  if (telefoneDigitos.length < 10 || telefoneDigitos.length > 13) {
    console.warn(`[ENGINE START] Telefone inválido, abortando: "${entrada.telefone}" → "${telefoneDigitos}" (${telefoneDigitos.length} dígitos)`);
    return;
  }
  entrada = { ...entrada, telefone: telefoneDigitos };

  console.log(`[ENGINE START] instancia="${entrada.instancia}" telefone="${entrada.telefone}" tipo="${entrada.tipo}" userId="${entrada.userId || 'N/A'}"`);

  // 1. Buscar agente pela instância com fallback por userId
  const r1 = await pool.query(
    `SELECT * FROM agentes
     WHERE LOWER(evolution_instancia) = LOWER($1) AND ativo = true
     LIMIT 1`,
    [entrada.instancia]
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

  // 3. Verificar pausa de atendimento humano
  const pausaRes = await pool.query(
    `SELECT atendimento_ia FROM dados_cliente
     WHERE user_id = $1 AND telefone ILIKE $2 LIMIT 1`,
    [userIdFinal, `%${entrada.telefone.slice(-11)}`]
  ).catch(() => ({ rows: [] as any[] }));
  if (pausaRes.rows[0]?.atendimento_ia === 'pause') {
    console.log(`[ENGINE] IA pausada para ${entrada.telefone}`);
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

  // 6. System prompt — busca agent_configs primeiro, fallback para agent_prompts
  const configRes = await pool.query(
    `SELECT prompt_sistema, nome_agente, sinal_pausa, palavra_reativar,
            modelo_llm, saudacao_inicial, bloco_qualificacao,
            mensagem_encaminhamento, mensagem_encerramento
     FROM agent_configs
     WHERE user_id = $1 AND ativo = true
     LIMIT 1`,
    [userIdFinal]
  );

  let systemPromptBase = 'Você é um assistente prestativo.';
  if (configRes.rows.length && configRes.rows[0].prompt_sistema) {
    systemPromptBase = configRes.rows[0].prompt_sistema;
  } else {
    const promptRes = await pool.query(
      `SELECT conteudo FROM agent_prompts WHERE user_id = $1 AND ativo = true LIMIT 1`,
      [userIdFinal]
    );
    if (promptRes.rows[0]?.conteudo) systemPromptBase = promptRes.rows[0].conteudo;
  }

  const agentConfig = configRes.rows[0] || null;
  const nomeAgente = agentConfig?.nome_agente || agente.nome || 'Assistente';
  const sinalPausa = agentConfig?.sinal_pausa || '251213';

  const systemPrompt = systemPromptBase +
    `\n\nData/hora atual: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`;

  // 7. Histórico (com filtro por user_id para multi-tenant correto)
  const histRes = await pool.query(
    `SELECT message FROM n8n_chat_histories
     WHERE session_id = $1 AND user_id = $2
     ORDER BY created_at DESC LIMIT 20`,
    [entrada.telefone, userIdFinal]
  );
  const historico: AIMessage[] = histRes.rows.reverse().flatMap((r: any) => {
    const m = typeof r.message === 'string' ? JSON.parse(r.message) : r.message;
    const content = (m.content || m.text || '').trim();
    if (!content) return [];
    const role: 'user' | 'assistant' =
      m.role === 'user' || m.type === 'human' ? 'user' :
      m.role === 'assistant' || m.type === 'ai' ? 'assistant' : 'user';
    return [{ role, content } as AIMessage];
  });

  const mensagens: AIMessage[] = [
    ...historico,
    { role: 'user', content: textoFinal },
  ];

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
    console.log(`[ENGINE LLM CALL] iter=${iter} | modelo=${modelo} | histLen=${mensagens.length} | telefone=${entrada.telefone}`);
    const resp = await provider.complete(mensagens, systemPrompt, MCP_TOOLS, {
      model: modelo,
      temperature: Number(agente.temperatura) || 0.7,
      maxTokens: agente.max_tokens || 1024,
    });

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

  // 9. Parser de resposta — replica o Parser Chain do n8n
  //    (split em 1-2 mensagens + detecção de 251213 / sinalPausa)
  // Usa o mesmo provider autenticado para o parser (sem 401)
  let parserMessages: string[] = [respostaFinal];
  let parserPausou = false;

  if (respostaFinal) {
    if (sinalPausa !== '251213' && respostaFinal.includes(sinalPausa)) {
      parserPausou = true;
      respostaFinal = respostaFinal.replace(sinalPausa, '').trim();
    }
    const parsed = await parsearResposta(respostaFinal, provider, modelo);
    parserMessages = parsed.messages;
    if (parsed.pausar) parserPausou = true;
    if (parserPausou) pausaAtivada = true;
    // Usa o texto limpo (sem 251213) para salvar no histórico
    respostaFinal = parserMessages.join('\n\n');
  }

  // 10. Persistir histórico (formato n8n Langchain)
  await salvarHistorico(pool, entrada.telefone, userIdFinal, entrada.instancia, 'user', textoFinal);
  if (respostaFinal) {
    await salvarHistorico(pool, entrada.telefone, userIdFinal, entrada.instancia, 'assistant', respostaFinal);
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
        [entrada.telefone, userIdFinal]
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
