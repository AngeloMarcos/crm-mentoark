import OpenAI from 'openai';
import { Pool } from 'pg';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'not-configured' });

export interface MensagemEntrada {
  instancia: string;
  messageId: string;
  telefone: string;       // ex: "5511999999999"
  pushName: string;       // nome do WhatsApp
  texto: string | null;   // null quando for áudio/imagem sem legenda
  tipo: string;           // 'text' | 'audio' | 'image' | 'video' | 'document'
  midiaUrl?: string;      // URL pública da mídia (Evolution já serve)
  midiaBase64?: string;   // Base64 da mídia
  timestamp: number;
}

interface AgenteConfig {
  user_id: string;
  nome: string;
  evolution_instancia: string;
  evolution_api_key: string;
  evolution_server_url: string;
  modelo: string;
  temperatura: number;
  max_tokens: number;
  ativo: boolean;
}

// Buffer de mensagens picotadas: chave → { timeout, textos[], última entrada }
const bufferMensagens = new Map<string, {
  timeout: ReturnType<typeof setTimeout>;
  textos: string[];
  entrada: MensagemEntrada;
}>();

// ── Transcrição de áudio via Whisper ───────────────────────

async function transcreverAudio(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const buffer = await resp.arrayBuffer();
    const blob = new Blob([buffer], { type: 'audio/ogg' });

    const form = new FormData();
    form.append('file', blob, 'audio.ogg');
    form.append('model', 'whisper-1');
    form.append('language', 'pt');

    const transcResp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
    });
    if (!transcResp.ok) return null;
    const data: any = await transcResp.json();
    return data.text || null;
  } catch (err: any) {
    console.warn('[AGT] Falha na transcrição de áudio:', err.message);
    return null;
  }
}

// ── Análise de imagem via GPT-4o vision ───────────────────

async function analisarImagem(url: string, caption?: string): Promise<string> {
  try {
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url } },
          {
            type: 'text',
            text: caption
              ? `O cliente enviou esta imagem com a legenda: "${caption}". Descreva brevemente o que vê e inclua a legenda no contexto.`
              : 'Descreva brevemente o que há nesta imagem em 1-2 frases.',
          },
        ],
      }],
      max_tokens: 200,
    });
    return resp.choices[0]?.message?.content || '[imagem enviada]';
  } catch {
    return caption || '[imagem enviada]';
  }
}

// ── Divisão inteligente da resposta em até 2 partes ───────

function dividirMensagem(texto: string): string[] {
  const partes = texto.split(/\n\n+/).filter(p => p.trim().length > 0);
  if (partes.length <= 1) return [texto.trim()];
  if (partes.length > 2) {
    return [partes.slice(0, -1).join('\n\n'), partes[partes.length - 1]];
  }
  return partes;
}

// ── Helpers de DB ──────────────────────────────────────────

async function gerarEmbedding(texto: string): Promise<number[]> {
  const resp = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: texto.slice(0, 8000),
  });
  return resp.data[0].embedding;
}

async function buscaRAG(pool: Pool, userId: string, pergunta: string, limite = 4): Promise<string[]> {
  try {
    const embedding = await gerarEmbedding(pergunta);
    const r = await pool.query(
      `SELECT content FROM documents WHERE user_id = $1
       ORDER BY embedding <-> $2::vector LIMIT $3`,
      [userId, JSON.stringify(embedding), limite]
    );
    return r.rows.map(row => row.content);
  } catch {
    return [];
  }
}

async function carregarHistorico(pool: Pool, sessionId: string): Promise<OpenAI.Chat.ChatCompletionMessageParam[]> {
  const r = await pool.query(
    `SELECT message FROM n8n_chat_histories WHERE session_id = $1
     ORDER BY created_at DESC LIMIT 12`,
    [sessionId]
  );
  return r.rows
    .reverse()
    .map(row => {
      const msg = typeof row.message === 'string' ? JSON.parse(row.message) : row.message;
      return msg as OpenAI.Chat.ChatCompletionMessageParam;
    })
    .filter(msg => msg.role && msg.content);
}

async function salvarMensagem(
  pool: Pool, sessionId: string, userId: string,
  instancia: string, role: 'user' | 'assistant', content: string
) {
  await pool.query(
    `INSERT INTO n8n_chat_histories (session_id, message, user_id, instancia)
     VALUES ($1, $2, $3, $4)`,
    [sessionId, JSON.stringify({ role, content }), userId, instancia]
  );
}

async function enviarResposta(
  serverUrl: string, apiKey: string,
  instancia: string, telefone: string, texto: string
): Promise<void> {
  const base = serverUrl.replace(/\/$/, '');
  const resp = await fetch(`${base}/message/sendText/${instancia}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: apiKey },
    body: JSON.stringify({ number: telefone, text: texto, delay: 1200 }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Evolution API error: ${resp.status} — ${err}`);
  }
}

async function upsertContato(pool: Pool, userId: string, telefone: string, nome: string): Promise<{ id: string; opt_out: boolean }> {
  const existente = await pool.query(
    `SELECT id, opt_out FROM contatos WHERE user_id = $1 AND telefone ILIKE $2 LIMIT 1`,
    [userId, `%${telefone.slice(-11)}`]
  );
  if (existente.rows.length) return existente.rows[0];

  const novo = await pool.query(
    `INSERT INTO contatos (user_id, nome, telefone, origem, status)
     VALUES ($1, $2, $3, 'WhatsApp', 'novo') RETURNING id, opt_out`,
    [userId, nome || telefone, telefone]
  );
  return novo.rows[0];
}

// ── MOTOR PRINCIPAL ─────────────────────────────────────────

export async function processarMensagem(pool: Pool, entrada: MensagemEntrada): Promise<void> {
  console.log(`[AGT] Processando: instancia=${entrada.instancia} tel=${entrada.telefone} tipo=${entrada.tipo}`);

  // 1. Resolver mídia antes de qualquer outra lógica
  let textoFinal = entrada.texto;

  if (entrada.tipo === 'audio' && entrada.midiaUrl && !textoFinal) {
    console.log(`[AGT] Transcrevendo áudio de ${entrada.telefone}...`);
    textoFinal = await transcreverAudio(entrada.midiaUrl);
    if (textoFinal) {
      console.log(`[AGT] Transcrição: "${textoFinal.slice(0, 80)}..."`);
    } else {
      console.warn('[AGT] Não foi possível transcrever o áudio — ignorando');
      return;
    }
  }

  if (entrada.tipo === 'image' && entrada.midiaUrl) {
    textoFinal = await analisarImagem(entrada.midiaUrl, entrada.texto || undefined);
  }

  if (!textoFinal) {
    console.log('[AGT] Mensagem sem texto após processamento de mídia — ignorando');
    return;
  }

  // 2. Encontrar agente
  const agenteRes = await pool.query(
    `SELECT * FROM agentes
     WHERE evolution_instancia = $1 AND ativo = true AND user_id IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`,
    [entrada.instancia]
  );
  if (!agenteRes.rows.length) {
    console.warn(`[AGT] Instância não mapeada: ${entrada.instancia}`);
    return;
  }
  const agente: AgenteConfig = agenteRes.rows[0];

  // 3. Verificar opt_out
  const contato = await upsertContato(pool, agente.user_id, entrada.telefone, entrada.pushName);
  if (contato.opt_out) {
    console.log(`[AGT] Contato ${entrada.telefone} com opt_out=true — ignorando`);
    return;
  }

  // 4. Verificar pausa de IA
  const pausaRes = await pool.query(
    `SELECT atendimento_ia FROM dados_cliente
     WHERE user_id = $1 AND telefone ILIKE $2 LIMIT 1`,
    [agente.user_id, `%${entrada.telefone.slice(-11)}`]
  ).catch(() => ({ rows: [] as any[] }));
  if (pausaRes.rows[0]?.atendimento_ia === 'pause') {
    console.log(`[AGT] IA pausada para ${entrada.telefone} — atendimento humano ativo`);
    return;
  }

  // 5. Carregar prompts e conhecimento
  const promptRes = await pool.query(
    `SELECT conteudo FROM agent_prompts WHERE user_id = $1 AND ativo = true LIMIT 1`,
    [agente.user_id]
  );
  const systemPrompt = promptRes.rows[0]?.conteudo ||
    'Você é um assistente comercial prestativo. Atenda os clientes com educação e objetividade.';

  const conhecimentoRes = await pool.query(
    `SELECT tipo, campo, conteudo FROM conhecimento WHERE user_id = $1
     ORDER BY tipo, created_at ASC LIMIT 30`,
    [agente.user_id]
  );
  const conhecimentoTexto = conhecimentoRes.rows.length
    ? '\n\n--- BASE DE CONHECIMENTO ---\n' +
      conhecimentoRes.rows.map(k => `[${k.tipo}${k.campo ? ' / ' + k.campo : ''}]\n${k.conteudo}`).join('\n\n')
    : '';

  // 6. Busca RAG
  const ragResultados = await buscaRAG(pool, agente.user_id, textoFinal);
  const ragTexto = ragResultados.length
    ? '\n\n--- INFORMAÇÕES RELEVANTES (RAG) ---\n' + ragResultados.join('\n\n---\n')
    : '';

  const systemCompleto = systemPrompt + conhecimentoTexto + ragTexto;

  // 7. Histórico
  const sessionId = entrada.telefone;
  const historico = await carregarHistorico(pool, sessionId);

  // 8. Chamar OpenAI
  const mensagens: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemCompleto },
    ...historico,
    { role: 'user', content: textoFinal },
  ];

  const completion = await openai.chat.completions.create({
    model: (agente.modelo as any) || 'gpt-4o-mini',
    messages: mensagens,
    temperature: agente.temperatura ?? 0.7,
    max_tokens: agente.max_tokens ?? 1000,
  });

  const resposta = completion.choices[0]?.message?.content;
  if (!resposta) throw new Error('OpenAI não retornou resposta');

  // 9. Detectar sinal de pausa (251213) e limpar resposta
  const SINAL_PAUSA = '251213';
  const deveEPausar = resposta.includes(SINAL_PAUSA);
  const respostaLimpa = resposta.replace(SINAL_PAUSA, '').replace(/\n{3,}/g, '\n\n').trim();

  // 10. Salvar conversa
  await salvarMensagem(pool, sessionId, agente.user_id, entrada.instancia, 'user', textoFinal);
  await salvarMensagem(pool, sessionId, agente.user_id, entrada.instancia, 'assistant', respostaLimpa);

  // 10b. Salvar resposta em whatsapp_messages (schema novo EN)
  await pool.query(
    `INSERT INTO whatsapp_messages
       (user_id, instance_name, remote_jid, message_id, from_me, message_type, content, status, timestamp_wa)
     VALUES ($1, $2, $3, $4, true, 'text', $5, 'sent', to_timestamp($6))
     ON CONFLICT (message_id, instance_name) DO NOTHING`,
    [
      agente.user_id,
      entrada.instancia,
      `${entrada.telefone}@s.whatsapp.net`,
      `resp_${entrada.messageId}`,
      respostaLimpa,
      Math.floor(Date.now() / 1000),
    ]
  ).catch(err => console.warn('[AGT] Falha ao salvar em whatsapp_messages:', err.message));

  // 11. Dividir e enviar mensagens com delay
  const partes = dividirMensagem(respostaLimpa);
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

  console.log(`[AGT] Resposta enviada para ${entrada.telefone}: "${respostaLimpa.slice(0, 80)}..."`);

  // 12. Ações de pausa automática
  if (deveEPausar) {
    console.log(`[AGT] Pausa acionada para ${entrada.telefone}`);

    await pool.query(
      `UPDATE dados_cliente SET atendimento_ia = 'pause'
       WHERE user_id = $1 AND telefone ILIKE $2`,
      [agente.user_id, `%${entrada.telefone.slice(-11)}`]
    ).catch(() => {});

    // Buscar histórico para o card Kanban
    const historicoRes = await pool.query(
      `SELECT message FROM n8n_chat_histories
       WHERE session_id = $1 AND user_id = $2
       ORDER BY created_at DESC LIMIT 10`,
      [sessionId, agente.user_id]
    ).catch(() => ({ rows: [] as any[] }));

    const resumoConversa = historicoRes.rows
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
        resumo: resumoConversa.slice(0, 800) || 'Conversa finalizada pela IA',
        contato_nome: entrada.pushName,
        contato_telefone: entrada.telefone,
        remote_jid: `${entrada.telefone}@s.whatsapp.net`,
        instance_name: entrada.instancia,
        conversa_id: sessionId,
        prioridade: 'alta',
      }),
    }).catch(err => console.warn('[AGT] Falha ao criar card Kanban:', err.message));
  }
}

// ── DEBOUNCE — agrupa mensagens picotadas ──────────────────

export async function processarComDebounce(pool: Pool, entrada: MensagemEntrada): Promise<void> {
  const chave = `${entrada.instancia}:${entrada.telefone}`;
  const DEBOUNCE_MS = 3000;

  const existente = bufferMensagens.get(chave);
  if (existente) {
    clearTimeout(existente.timeout);
    if (entrada.texto) existente.textos.push(entrada.texto);
    existente.entrada = entrada;
  } else {
    bufferMensagens.set(chave, {
      timeout: null as any,
      textos: entrada.texto ? [entrada.texto] : [],
      entrada,
    });
  }

  const buf = bufferMensagens.get(chave)!;
  buf.timeout = setTimeout(async () => {
    bufferMensagens.delete(chave);
    const entradaFinal: MensagemEntrada = { ...buf.entrada };
    if (buf.textos.length > 1) {
      entradaFinal.texto = buf.textos.join(' ');
    }
    await processarMensagem(pool, entradaFinal).catch(err => {
      console.error('[AGT] Erro ao processar mensagem agrupada:', err);
    });
  }, DEBOUNCE_MS);
}
