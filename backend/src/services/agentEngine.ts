import OpenAI from 'openai';
import { Pool } from 'pg';
import { MCP_TOOLS, executarFerramenta } from './mcp/tools';
import { criarProvider, OpenAIProvider, AIMessage } from './providers/index';

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
}

// ── Buffer de mensagens picotadas ────────────────────────────────────────────
const bufferMensagens = new Map<string, {
  timeout: ReturnType<typeof setTimeout>;
  mensagens: string[];
  entrada: MensagemEntrada;
}>();

// ── Transcrição de áudio via Whisper ─────────────────────────────────────────
async function transcreverAudio(url: string): Promise<string | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    const blob = new Blob([buf], { type: 'audio/ogg' });
    const form = new FormData();
    form.append('file', blob, 'audio.ogg');
    form.append('model', 'whisper-1');
    form.append('language', 'pt');
    const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
    });
    if (!resp.ok) return null;
    return ((await resp.json()) as any).text || null;
  } catch {
    return null;
  }
}

// ── Análise de imagem via GPT-4o-mini Vision ─────────────────────────────────
async function analisarImagem(url: string, caption?: string): Promise<string> {
  try {
    const r = await openai.chat.completions.create({
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
}

// ── Persistência de histórico ─────────────────────────────────────────────────
async function salvarHistorico(
  pool: Pool, sessionId: string, userId: string,
  instancia: string, role: 'user' | 'assistant', content: string
): Promise<void> {
  await pool.query(
    `INSERT INTO n8n_chat_histories (session_id, message, user_id, instancia)
     VALUES ($1, $2, $3, $4)`,
    [sessionId, JSON.stringify({ role, content }), userId, instancia]
  );
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
  console.log(`[ENGINE] ${entrada.instancia} ← ${entrada.telefone} (${entrada.tipo})`);

  // 1. Buscar agente pela instância
  const agenteRes = await pool.query(
    `SELECT * FROM agentes WHERE evolution_instancia = $1 AND ativo = true LIMIT 1`,
    [entrada.instancia]
  );
  if (!agenteRes.rows.length) {
    console.warn(`[ENGINE] Instância não mapeada: ${entrada.instancia}`);
    return;
  }
  const agente = agenteRes.rows[0];

  // 2. Verificar opt-out
  const contato = await upsertContato(pool, agente.user_id, entrada.telefone, entrada.pushName);
  if (contato.opt_out) {
    console.log(`[ENGINE] Contato ${entrada.telefone} com opt_out=true — ignorando`);
    return;
  }

  // 3. Verificar pausa de atendimento humano
  const pausaRes = await pool.query(
    `SELECT atendimento_ia FROM dados_cliente
     WHERE user_id = $1 AND telefone ILIKE $2 LIMIT 1`,
    [agente.user_id, `%${entrada.telefone.slice(-11)}`]
  ).catch(() => ({ rows: [] as any[] }));
  if (pausaRes.rows[0]?.atendimento_ia === 'pause') {
    console.log(`[ENGINE] IA pausada para ${entrada.telefone}`);
    return;
  }

  // 4. Resolver mídia
  let textoFinal = entrada.texto;
  if (entrada.tipo === 'audio' && entrada.midiaUrl) {
    textoFinal = await transcreverAudio(entrada.midiaUrl);
    if (!textoFinal) { console.warn('[ENGINE] Falha na transcrição'); return; }
    console.log(`[ENGINE] Áudio transcrito: "${textoFinal.slice(0, 60)}"`);
  } else if (entrada.tipo === 'image' && entrada.midiaUrl) {
    textoFinal = await analisarImagem(entrada.midiaUrl, entrada.texto || undefined);
  }
  if (!textoFinal) return;

  // 5. System prompt
  const promptRes = await pool.query(
    `SELECT conteudo FROM agent_prompts WHERE user_id = $1 AND ativo = true LIMIT 1`,
    [agente.user_id]
  );
  const systemPrompt =
    (promptRes.rows[0]?.conteudo || 'Você é um assistente prestativo.') +
    `\n\nData/hora atual: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`;

  // 6. Histórico (com filtro por user_id para multi-tenant correto)
  const histRes = await pool.query(
    `SELECT message FROM n8n_chat_histories
     WHERE session_id = $1 AND user_id = $2
     ORDER BY created_at DESC LIMIT 20`,
    [entrada.telefone, agente.user_id]
  );
  const historico: AIMessage[] = histRes.rows.reverse().map((r: any) => {
    const m = typeof r.message === 'string' ? JSON.parse(r.message) : r.message;
    return { role: m.role, content: m.content } as AIMessage;
  });

  const mensagens: AIMessage[] = [
    ...historico,
    { role: 'user', content: textoFinal },
  ];

  // 7. Criar provider (do banco ou fallback OpenAI)
  const providerInfo = await criarProvider(pool, agente.user_id, agente.provider_id);
  const provider = providerInfo?.provider ?? new OpenAIProvider(process.env.OPENAI_API_KEY || '');
  const modelo = providerInfo?.modelo || agente.modelo || 'gpt-4o-mini';
  const providerSlug = providerInfo?.providerSlug || 'openai';

  // 8. Loop agêntico — máximo 5 iterações
  const MAX_ITER = 5;
  let respostaFinal = '';
  let tokensEntrada = 0;
  let tokensSaida = 0;
  let pausaAtivada = false;

  for (let iter = 0; iter < MAX_ITER; iter++) {
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
      const resultado = await executarFerramenta(pool, agente.user_id, tc.name, tc.input);

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

  // 9. Detectar sinal legado de pausa no texto (251213)
  const SINAL = '251213';
  if (respostaFinal.includes(SINAL)) {
    pausaAtivada = true;
    respostaFinal = respostaFinal.replace(SINAL, '').replace(/\n{3,}/g, '\n\n').trim();
  }

  // 10. Persistir histórico
  await salvarHistorico(pool, entrada.telefone, agente.user_id, entrada.instancia, 'user', textoFinal);
  if (respostaFinal) {
    await salvarHistorico(pool, entrada.telefone, agente.user_id, entrada.instancia, 'assistant', respostaFinal);
  }

  // 11. Persistir em whatsapp_messages para o painel de chat
  if (respostaFinal) {
    await pool.query(
      `INSERT INTO whatsapp_messages
         (id, user_id, instancia, session_id, remote_jid, from_me, push_name, tipo, conteudo, status, timestamp_unix)
       VALUES ($1, $2, $3, $4, $5, true, 'IA', 'text', $6, 'sent', $7)
       ON CONFLICT (id) DO NOTHING`,
      [
        `resp_${entrada.messageId}`,
        agente.user_id,
        entrada.instancia,
        entrada.telefone,
        `${entrada.telefone}@s.whatsapp.net`,
        respostaFinal,
        Math.floor(Date.now() / 1000),
      ]
    ).catch(err => console.warn('[ENGINE] Falha ao salvar em whatsapp_messages:', err.message));
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
      [agente.user_id, providerSlug, modelo, tokensEntrada, tokensSaida]
    ).catch(() => {});
  }

  // 13. Enviar resposta (se não pausou)
  if (!pausaAtivada && respostaFinal) {
    const partes = dividirMensagem(respostaFinal);
    for (let i = 0; i < partes.length; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, 3000));
      await enviarResposta(
        agente.evolution_server_url,
        agente.evolution_api_key,
        agente.evolution_instancia || entrada.instancia,
        entrada.telefone,
        partes[i]
      );
    }
  }

  // 14. Ações de pausa
  if (pausaAtivada) {
    console.log(`[ENGINE] Pausa ativada para ${entrada.telefone}`);
    await pool.query(
      `UPDATE dados_cliente SET atendimento_ia = 'pause', pausa_timestamp = NOW()
       WHERE user_id = $1 AND telefone ILIKE $2`,
      [agente.user_id, `%${entrada.telefone.slice(-11)}`]
    ).catch(() => {});

    // Criar card Kanban via sinal legado (quando pausa veio do texto 251213)
    if (respostaFinal) {
      const historicoRes = await pool.query(
        `SELECT message FROM n8n_chat_histories
         WHERE session_id = $1 AND user_id = $2
         ORDER BY created_at DESC LIMIT 10`,
        [entrada.telefone, agente.user_id]
      ).catch(() => ({ rows: [] as any[] }));

      const resumo = historicoRes.rows
        .reverse()
        .map((r: any) => {
          const m = typeof r.message === 'string' ? JSON.parse(r.message) : r.message;
          return `${m.role === 'user' ? 'Cliente' : 'IA'}: ${String(m.content).slice(0, 200)}`;
        })
        .join('\n');

      const backendUrl = process.env.BACKEND_URL || 'https://api.mentoark.com.br';
      const kanbanSecret = process.env.N8N_WEBHOOK_SECRET || 'mentoark-kanban-secret-2025';
      fetch(`${backendUrl}/api/kanban/webhook/n8n`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-webhook-secret': kanbanSecret },
        body: JSON.stringify({
          user_id: agente.user_id,
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

  console.log(`[ENGINE] ✓ ${entrada.telefone} | ${providerSlug}/${modelo} | tokens: ${tokensEntrada}+${tokensSaida} | pausa: ${pausaAtivada}`);
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
