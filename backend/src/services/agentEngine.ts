import OpenAI from 'openai';
import { Pool } from 'pg';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'not-configured' });

interface MensagemEntrada {
  instancia: string;
  messageId: string;
  telefone: string;         // ex: "5511999999999"
  pushName: string;         // nome do WhatsApp
  texto: string;            // conteúdo da mensagem
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

// Gera embedding via OpenAI para busca RAG
async function gerarEmbedding(texto: string): Promise<number[]> {
  const resp = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: texto.slice(0, 8000),
  });
  return resp.data[0].embedding;
}

// Busca semântica nos documentos do usuário
async function buscaRAG(pool: Pool, userId: string, pergunta: string, limite = 4): Promise<string[]> {
  try {
    const embedding = await gerarEmbedding(pergunta);
    const r = await pool.query(
      `SELECT content, metadata->>'tipo' as tipo
       FROM documents
       WHERE user_id = $1
       ORDER BY embedding <-> $2::vector
       LIMIT $3`,
      [userId, JSON.stringify(embedding), limite]
    );
    return r.rows.map(row => row.content);
  } catch {
    return [];
  }
}

// Carrega histórico da conversa (últimas 12 mensagens)
async function carregarHistorico(pool: Pool, sessionId: string): Promise<OpenAI.Chat.ChatCompletionMessageParam[]> {
  const r = await pool.query(
    `SELECT message FROM n8n_chat_histories
     WHERE session_id = $1
     ORDER BY created_at DESC
     LIMIT 12`,
    [sessionId]
  );
  // Retorna em ordem cronológica (mais antiga primeiro)
  return r.rows
    .reverse()
    .map(row => {
      const msg = typeof row.message === 'string' ? JSON.parse(row.message) : row.message;
      return msg as OpenAI.Chat.ChatCompletionMessageParam;
    })
    .filter(msg => msg.role && msg.content);
}

// Salva mensagem no histórico
async function salvarMensagem(
  pool: Pool,
  sessionId: string,
  userId: string,
  instancia: string,
  role: 'user' | 'assistant',
  content: string
) {
  await pool.query(
    `INSERT INTO n8n_chat_histories (session_id, message, user_id, instancia)
     VALUES ($1, $2, $3, $4)`,
    [sessionId, JSON.stringify({ role, content }), userId, instancia]
  );
}

// Envia mensagem via Evolution API
async function enviarResposta(
  serverUrl: string,
  apiKey: string,
  instancia: string,
  telefone: string,
  texto: string
): Promise<void> {
  const base = serverUrl.replace(/\/$/, '');
  const resp = await fetch(`${base}/message/sendText/${instancia}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: apiKey,
    },
    body: JSON.stringify({
      number: telefone,
      text: texto,
      delay: 1200,
    }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Evolution API error: ${resp.status} — ${err}`);
  }
}

// Localiza ou cria contato no CRM
async function upsertContato(pool: Pool, userId: string, telefone: string, nome: string): Promise<{ id: string; opt_out: boolean }> {
  // Tenta encontrar pelo telefone
  const existente = await pool.query(
    `SELECT id, opt_out FROM contatos WHERE user_id = $1 AND telefone ILIKE $2 LIMIT 1`,
    [userId, `%${telefone.slice(-11)}`]
  );
  if (existente.rows.length) return existente.rows[0];

  // Cria novo contato
  const novo = await pool.query(
    `INSERT INTO contatos (user_id, nome, telefone, origem, status)
     VALUES ($1, $2, $3, 'WhatsApp', 'novo') RETURNING id, opt_out`,
    [userId, nome || telefone, telefone]
  );
  return novo.rows[0];
}

// ── MOTOR PRINCIPAL ─────────────────────────────────────────

export async function processarMensagem(pool: Pool, entrada: MensagemEntrada): Promise<void> {
  console.log(`[AGT] Processando: instancia=${entrada.instancia} tel=${entrada.telefone}`);

  // 1. Encontrar agente pelo nome da instância (cada instância pertence a um único user)
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

  // 2. Verificar opt_out do contato
  const contato = await upsertContato(pool, agente.user_id, entrada.telefone, entrada.pushName);
  if (contato.opt_out) {
    console.log(`[AGT] Contato ${entrada.telefone} com opt_out=true — ignorando`);
    return;
  }

  // 3. Carregar prompt ativo do agente
  const promptRes = await pool.query(
    `SELECT conteudo FROM agent_prompts WHERE user_id = $1 AND ativo = true LIMIT 1`,
    [agente.user_id]
  );
  const systemPrompt = promptRes.rows[0]?.conteudo ||
    `Você é um assistente comercial prestativo. Atenda os clientes com educação e objetividade.`;

  // 4. Carregar conhecimento base (personalidade, negócio, FAQ)
  const conhecimentoRes = await pool.query(
    `SELECT tipo, campo, conteudo FROM conhecimento
     WHERE user_id = $1
     ORDER BY tipo, created_at ASC
     LIMIT 30`,
    [agente.user_id]
  );
  const conhecimentoTexto = conhecimentoRes.rows.length
    ? '\n\n--- BASE DE CONHECIMENTO ---\n' +
      conhecimentoRes.rows.map(k => `[${k.tipo}${k.campo ? ' / ' + k.campo : ''}]\n${k.conteudo}`).join('\n\n')
    : '';

  // 5. Busca RAG nos documentos vetoriais
  const ragResultados = await buscaRAG(pool, agente.user_id, entrada.texto);
  const ragTexto = ragResultados.length
    ? '\n\n--- INFORMAÇÕES RELEVANTES (RAG) ---\n' + ragResultados.join('\n\n---\n')
    : '';

  // 6. Montar system prompt completo
  const systemCompleto = systemPrompt + conhecimentoTexto + ragTexto;

  // 7. Carregar histórico da sessão
  const sessionId = entrada.telefone;
  const historico = await carregarHistorico(pool, sessionId);

  // 8. Chamar OpenAI
  const mensagens: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemCompleto },
    ...historico,
    { role: 'user', content: entrada.texto },
  ];

  const completion = await openai.chat.completions.create({
    model: (agente.modelo as any) || 'gpt-4o-mini',
    messages: mensagens,
    temperature: agente.temperatura ?? 0.7,
    max_tokens: agente.max_tokens ?? 1000,
  });

  const resposta = completion.choices[0]?.message?.content;
  if (!resposta) throw new Error('OpenAI não retornou resposta');

  // 9. Salvar conversa no histórico
  await salvarMensagem(pool, sessionId, agente.user_id, entrada.instancia, 'user', entrada.texto);
  await salvarMensagem(pool, sessionId, agente.user_id, entrada.instancia, 'assistant', resposta);

  // 10. Enviar resposta via Evolution API
  await enviarResposta(
    agente.evolution_server_url,
    agente.evolution_api_key,
    agente.evolution_instancia || entrada.instancia,
    entrada.telefone,
    resposta
  );

  console.log(`[AGT] Resposta enviada para ${entrada.telefone}: ${resposta.slice(0, 80)}...`);
}
