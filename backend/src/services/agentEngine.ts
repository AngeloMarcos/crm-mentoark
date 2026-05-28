/**
 * agentEngine.ts — Motor de IA nativo do CRM Mentoark
 *
 * Responsabilidade:
 *   Processar mensagens recebidas via WhatsApp (Evolution API) sem depender do n8n.
 *   O fluxo completo é: recebe mensagem → processa mídia → verifica pausa →
 *   busca contexto (RAG) → chama OpenAI → detecta sinal de pausa → envia resposta.
 *
 * Integra:
 *   - OpenAI (GPT-4o-mini para texto/visão, Whisper para áudio)
 *   - Evolution API (envio de mensagens WhatsApp)
 *   - PostgreSQL (histórico, prompt, conhecimento, dados_cliente)
 */

import OpenAI from 'openai';
import { Pool } from 'pg';

// Cliente OpenAI configurado via variável de ambiente
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'not-configured' });

/**
 * MensagemEntrada — estrutura normalizada de uma mensagem recebida via webhook.
 *
 * O webhook.ts extrai esses campos do payload raw da Evolution API antes de
 * passar para cá, separando texto de mídia para facilitar o processamento.
 */
export interface MensagemEntrada {
  instancia: string;      // Nome da instância WhatsApp (ex: "crm_65aba552")
  messageId: string;      // ID único gerado pelo WhatsApp / Evolution API
  telefone: string;       // Número no formato 5511999999999 (sem @s.whatsapp.net)
  pushName: string;       // Nome exibido no WhatsApp do contato
  texto: string | null;   // Conteúdo textual (null quando só há mídia sem legenda)
  tipo: string;           // 'text' | 'audio' | 'image' | 'video' | 'document'
  midiaUrl?: string;      // URL pública da mídia servida pela Evolution API
  midiaBase64?: string;   // Alternativa em base64 (não utilizada atualmente)
  timestamp: number;      // Unix timestamp da mensagem original
}

/** Campos do agente lidos do banco (tabela agentes) */
interface AgenteConfig {
  user_id: string;
  nome: string;
  evolution_instancia: string;
  evolution_api_key: string;
  evolution_server_url: string;
  modelo: string;           // ex: "gpt-4o-mini"
  temperatura: number;      // 0.0–2.0, controla criatividade da resposta
  max_tokens: number;       // Limite de tokens na resposta gerada
  ativo: boolean;
}

// ── Buffer de debounce para mensagens picotadas ────────────────────────────────
/**
 * Usuários frequentemente enviam o mesmo pensamento em múltiplas mensagens
 * curtas em sequência ("oi" → "queria saber" → "o preço do imóvel").
 *
 * Este Map evita que cada fragmento dispare uma chamada separada à OpenAI.
 * A chave é "instancia:telefone"; o valor acumula textos até o timer disparar.
 */
const bufferMensagens = new Map<string, {
  timeout: ReturnType<typeof setTimeout>;
  textos: string[];      // Fragmentos acumulados enquanto o timer está ativo
  entrada: MensagemEntrada; // Última entrada recebida (usada para metadados de mídia)
}>();

// ── Funções de processamento de mídia ─────────────────────────────────────────

/**
 * Transcreve um arquivo de áudio OGG (formato padrão do WhatsApp) usando
 * o modelo Whisper-1 da OpenAI.
 *
 * Por que baixar e re-enviar? A Evolution API serve o áudio em uma URL com
 * autenticação via header (apikey), que o endpoint da OpenAI não suporta
 * diretamente — por isso fazemos proxy do buffer em memória.
 */
async function transcreverAudio(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;

    const buffer = await resp.arrayBuffer();
    const blob = new Blob([buffer], { type: 'audio/ogg' });

    // FormData é necessário porque a API Whisper espera multipart/form-data
    const form = new FormData();
    form.append('file', blob, 'audio.ogg');
    form.append('model', 'whisper-1');
    form.append('language', 'pt'); // Forçar português melhora a precisão

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

/**
 * Usa o GPT-4o-mini (com suporte a visão) para descrever uma imagem enviada
 * pelo cliente. A descrição é inserida no histórico como mensagem do usuário,
 * permitindo que o agente responda ao contexto visual.
 *
 * @param caption Legenda enviada junto com a imagem (opcional)
 */
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
    // Em caso de falha na visão, usar a legenda original como fallback
    return caption || '[imagem enviada]';
  }
}

/**
 * Divide uma resposta longa em até 2 partes, quebrando em parágrafos duplos.
 *
 * Por que 2 partes? Enviar múltiplas mensagens curtas simula comportamento
 * humano no WhatsApp, reduz a sensação de "mural de texto" e aumenta o
 * engajamento. Mais de 2 partes seria excessivo e poderia parecer spam.
 */
function dividirMensagem(texto: string): string[] {
  const partes = texto.split(/\n\n+/).filter(p => p.trim().length > 0);
  if (partes.length <= 1) return [texto.trim()];
  if (partes.length > 2) {
    // Agrupar tudo exceto o último parágrafo no primeiro bloco
    return [partes.slice(0, -1).join('\n\n'), partes[partes.length - 1]];
  }
  return partes;
}

// ── Funções auxiliares de banco de dados ──────────────────────────────────────

/**
 * Gera embedding vetorial do texto para busca semântica (RAG).
 * Usamos text-embedding-3-small: barato, rápido e suficientemente preciso
 * para base de conhecimento de pequenas/médias empresas.
 */
async function gerarEmbedding(texto: string): Promise<number[]> {
  const resp = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: texto.slice(0, 8000), // Limite do modelo
  });
  return resp.data[0].embedding;
}

/**
 * Busca Retrieval-Augmented Generation (RAG): encontra os trechos mais
 * relevantes da base de conhecimento do usuário usando distância de vetor
 * (pgvector com operador <->).
 *
 * Os resultados são injetados no system prompt antes de chamar a OpenAI,
 * permitindo respostas baseadas em documentos específicos do cliente
 * (catálogos, políticas, scripts de vendas, etc.).
 */
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
    return []; // RAG é melhor-esforço: nunca bloqueia o atendimento
  }
}

/**
 * Carrega as últimas 12 mensagens da conversa (histórico de sessão).
 *
 * Por que 12? É o equilíbrio entre contexto suficiente para continuidade
 * e custo de tokens. Conversas longas são comprimidas implicitamente pelo
 * LIMIT — as mais antigas são descartadas (janela deslizante).
 *
 * O session_id é o telefone do contato, garantindo um histórico por número.
 */
async function carregarHistorico(pool: Pool, sessionId: string): Promise<OpenAI.Chat.ChatCompletionMessageParam[]> {
  const r = await pool.query(
    `SELECT message FROM n8n_chat_histories WHERE session_id = $1
     ORDER BY created_at DESC LIMIT 12`,
    [sessionId]
  );
  // Reverter para ordem cronológica (DESC → ASC) antes de enviar à OpenAI
  return r.rows
    .reverse()
    .map(row => {
      const msg = typeof row.message === 'string' ? JSON.parse(row.message) : row.message;
      return msg as OpenAI.Chat.ChatCompletionMessageParam;
    })
    .filter(msg => msg.role && msg.content); // Filtrar entradas inválidas
}

/** Persiste uma mensagem no histórico da sessão (n8n_chat_histories) */
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

/**
 * Envia uma mensagem de texto via Evolution API.
 *
 * O delay de 1200ms simula tempo de digitação, tornando o bot mais natural.
 * A Evolution API envia o indicador "digitando..." automaticamente durante
 * esse período.
 */
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

/**
 * Localiza o contato no CRM pelo telefone ou cria um novo registro.
 *
 * Usamos ILIKE com slice(-11) para tolerar variações no formato
 * (ex: 55119... vs 119...). O contato criado recebe status 'novo'
 * para aparecer na fila de atendimento do painel.
 */
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

// ── MOTOR PRINCIPAL ────────────────────────────────────────────────────────────

/**
 * processarMensagem — núcleo do atendimento automático.
 *
 * Fluxo completo:
 *  1. Resolve mídia (áudio → transcrição, imagem → descrição)
 *  2. Localiza o agente configurado para a instância
 *  3. Verifica opt-out e pausa de atendimento humano
 *  4. Monta o system prompt (prompt + conhecimento + RAG)
 *  5. Carrega histórico da conversa
 *  6. Chama OpenAI Chat Completions
 *  7. Detecta sinal de pausa "251213" na resposta
 *  8. Persiste mensagens no histórico e em whatsapp_messages
 *  9. Divide e envia as mensagens com delay entre partes
 * 10. Se 251213 detectado: pausa IA, cria card no Kanban
 */
export async function processarMensagem(pool: Pool, entrada: MensagemEntrada): Promise<void> {
  console.log(`[AGT] Processando: instancia=${entrada.instancia} tel=${entrada.telefone} tipo=${entrada.tipo}`);

  // ── Passo 1: Resolução de mídia ───────────────────────────────────────────
  let textoFinal = entrada.texto;

  // Áudio: transcrever com Whisper antes de qualquer outra etapa
  if (entrada.tipo === 'audio' && entrada.midiaUrl && !textoFinal) {
    console.log(`[AGT] Transcrevendo áudio de ${entrada.telefone}...`);
    textoFinal = await transcreverAudio(entrada.midiaUrl);
    if (textoFinal) {
      console.log(`[AGT] Transcrição: "${textoFinal.slice(0, 80)}..."`);
    } else {
      // Sem transcrição não há contexto — ignorar silenciosamente
      console.warn('[AGT] Não foi possível transcrever o áudio — ignorando');
      return;
    }
  }

  // Imagem: gerar descrição textual para incluir no histórico
  if (entrada.tipo === 'image' && entrada.midiaUrl) {
    textoFinal = await analisarImagem(entrada.midiaUrl, entrada.texto || undefined);
  }

  if (!textoFinal) {
    // Sticker, vídeo sem legenda, etc. — não há conteúdo para processar
    console.log('[AGT] Mensagem sem texto após processamento de mídia — ignorando');
    return;
  }

  // ── Passo 2: Localizar agente ─────────────────────────────────────────────
  // Cada instância WhatsApp é mapeada para um agente no painel de Agentes IA
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

  // ── Passo 3: Verificações de bloqueio ─────────────────────────────────────

  // Opt-out: contatos que pediram para sair da lista não são atendidos
  const contato = await upsertContato(pool, agente.user_id, entrada.telefone, entrada.pushName);
  if (contato.opt_out) {
    console.log(`[AGT] Contato ${entrada.telefone} com opt_out=true — ignorando`);
    return;
  }

  // Pausa: atendente humano assumiu a conversa — bot fica em silêncio
  // O campo atendimento_ia = 'pause' é setado quando:
  //   a) O sinal 251213 aparece na resposta da IA (fim de conversa automático)
  //   b) O atendente envia uma mensagem manualmente (fromMe=true no webhook)
  const pausaRes = await pool.query(
    `SELECT atendimento_ia FROM dados_cliente
     WHERE user_id = $1 AND telefone ILIKE $2 LIMIT 1`,
    [agente.user_id, `%${entrada.telefone.slice(-11)}`]
  ).catch(() => ({ rows: [] as any[] }));
  if (pausaRes.rows[0]?.atendimento_ia === 'pause') {
    console.log(`[AGT] IA pausada para ${entrada.telefone} — atendimento humano ativo`);
    return;
  }

  // ── Passo 4: Montar system prompt completo ────────────────────────────────

  // Prompt base configurado no painel "Agentes IA" → aba Prompt
  const promptRes = await pool.query(
    `SELECT conteudo FROM agent_prompts WHERE user_id = $1 AND ativo = true LIMIT 1`,
    [agente.user_id]
  );
  const systemPrompt = promptRes.rows[0]?.conteudo ||
    'Você é um assistente comercial prestativo. Atenda os clientes com educação e objetividade.';

  // Base de conhecimento: personalidade, scripts, FAQ, objeções
  const conhecimentoRes = await pool.query(
    `SELECT tipo, campo, conteudo FROM conhecimento WHERE user_id = $1
     ORDER BY tipo, created_at ASC LIMIT 30`,
    [agente.user_id]
  );
  const conhecimentoTexto = conhecimentoRes.rows.length
    ? '\n\n--- BASE DE CONHECIMENTO ---\n' +
      conhecimentoRes.rows.map(k => `[${k.tipo}${k.campo ? ' / ' + k.campo : ''}]\n${k.conteudo}`).join('\n\n')
    : '';

  // RAG: documentos vetoriais (catálogos, contratos, políticas)
  const ragResultados = await buscaRAG(pool, agente.user_id, textoFinal);
  const ragTexto = ragResultados.length
    ? '\n\n--- INFORMAÇÕES RELEVANTES (RAG) ---\n' + ragResultados.join('\n\n---\n')
    : '';

  const systemCompleto = systemPrompt + conhecimentoTexto + ragTexto;

  // ── Passo 5: Histórico da sessão ──────────────────────────────────────────
  const sessionId = entrada.telefone; // Um histórico por número de telefone
  const historico = await carregarHistorico(pool, sessionId);

  // ── Passo 6: Chamada à OpenAI ─────────────────────────────────────────────
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

  // ── Passo 7: Detectar sinal de pausa ──────────────────────────────────────
  // A IA inclui "251213" na resposta quando avalia que a conversa chegou ao
  // ponto de qualificação e deve ser transferida para um humano.
  // Esse código é configurado no system prompt do agente.
  // Exemplo de instrução no prompt:
  //   "Quando o cliente estiver qualificado, inclua '251213' no final da resposta."
  const SINAL_PAUSA = '251213';
  const deveEPausar = resposta.includes(SINAL_PAUSA);

  // Remover o código do texto antes de enviar ao cliente
  const respostaLimpa = resposta
    .replace(SINAL_PAUSA, '')
    .replace(/\n{3,}/g, '\n\n') // Colapsar linhas em branco extras
    .trim();

  // ── Passo 8: Persistir mensagens ──────────────────────────────────────────
  await salvarMensagem(pool, sessionId, agente.user_id, entrada.instancia, 'user', textoFinal);
  await salvarMensagem(pool, sessionId, agente.user_id, entrada.instancia, 'assistant', respostaLimpa);

  // Salvar também em whatsapp_messages (schema EN canônico) para o painel
  await pool.query(
    `INSERT INTO whatsapp_messages
       (user_id, instance_name, remote_jid, message_id, from_me, message_type, content, status, timestamp_wa)
     VALUES ($1, $2, $3, $4, true, 'text', $5, 'sent', to_timestamp($6))
     ON CONFLICT (message_id, instance_name) DO NOTHING`,
    [
      agente.user_id,
      entrada.instancia,
      `${entrada.telefone}@s.whatsapp.net`,
      `resp_${entrada.messageId}`, // Prefixo 'resp_' identifica mensagens do bot no webhook
      respostaLimpa,
      Math.floor(Date.now() / 1000),
    ]
  ).catch(err => console.warn('[AGT] Falha ao salvar em whatsapp_messages:', err.message));

  // ── Passo 9: Enviar resposta (dividida em até 2 partes) ───────────────────
  const partes = dividirMensagem(respostaLimpa);
  for (let i = 0; i < partes.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 3000)); // 3s entre partes
    await enviarResposta(
      agente.evolution_server_url,
      agente.evolution_api_key,
      agente.evolution_instancia || entrada.instancia,
      entrada.telefone,
      partes[i]
    );
  }
  console.log(`[AGT] Resposta enviada para ${entrada.telefone}: "${respostaLimpa.slice(0, 80)}..."`);

  // ── Passo 10: Ações de pausa automática ───────────────────────────────────
  if (deveEPausar) {
    console.log(`[AGT] Pausa acionada para ${entrada.telefone}`);

    // Marcar contato como em atendimento humano
    await pool.query(
      `UPDATE dados_cliente SET atendimento_ia = 'pause'
       WHERE user_id = $1 AND telefone ILIKE $2`,
      [agente.user_id, `%${entrada.telefone.slice(-11)}`]
    ).catch(() => {});

    // Buscar últimas 10 mensagens para montar o resumo do card Kanban
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

    // Criar card no Kanban (coluna Backlog) via endpoint interno
    // O fetch é fire-and-forget (não bloqueia o envio da resposta)
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
        prioridade: 'alta', // Lead qualificado → prioridade alta
      }),
    }).catch(err => console.warn('[AGT] Falha ao criar card Kanban:', err.message));
  }
}

// ── DEBOUNCE — agrupa mensagens picotadas ──────────────────────────────────────

/**
 * processarComDebounce — ponto de entrada público para o webhook.ts.
 *
 * Aguarda 3 segundos após a última mensagem do mesmo contato antes de
 * processar. Se novas mensagens chegarem durante o timer:
 *   - O timer é reiniciado
 *   - O texto é acumulado em `textos[]`
 *
 * No processamento final, todos os fragmentos são concatenados com espaço,
 * formando uma mensagem única coerente para a OpenAI.
 *
 * Exemplo:
 *   "oi"           → timer 3s
 *   "queria saber" → reset timer, acumula
 *   "o preço"      → reset timer, acumula
 *   (silêncio 3s)  → processa "oi queria saber o preço"
 */
export async function processarComDebounce(pool: Pool, entrada: MensagemEntrada): Promise<void> {
  const chave = `${entrada.instancia}:${entrada.telefone}`;
  const DEBOUNCE_MS = 3000; // 3 segundos de janela de espera

  const existente = bufferMensagens.get(chave);
  if (existente) {
    // Cancelar timer anterior e acumular texto
    clearTimeout(existente.timeout);
    if (entrada.texto) existente.textos.push(entrada.texto);
    existente.entrada = entrada; // Atualiza metadados com a mensagem mais recente
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

    // Montar entrada final com textos concatenados
    const entradaFinal: MensagemEntrada = { ...buf.entrada };
    if (buf.textos.length > 1) {
      entradaFinal.texto = buf.textos.join(' ');
    }

    await processarMensagem(pool, entradaFinal).catch(err => {
      console.error('[AGT] Erro ao processar mensagem agrupada:', err);
    });
  }, DEBOUNCE_MS);
}
