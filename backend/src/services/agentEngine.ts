/**
 * agentEngine.ts — Motor de resposta automática da IA para mensagens do WhatsApp.
 *
 * Chamado por webhook.ts (via processarComDebounce, 3s de debounce por telefone) após uma
 * mensagem recebida ser atribuída a um userId. Resolve o agente (tabela agentes) e a config de
 * IA (agent_configs: prompt, modelo, provider), monta o histórico (n8n_chat_histories), chama o
 * provider (OpenAI/Claude/Gemini), faz parsing nativo da resposta (quebra em até 2
 * mensagens, detecta sinal de pausa) e envia via Evolution API (enviarResposta ou, quando
 * configurado por agente e a mensagem recebida foi um áudio, enviarRespostaVoz — TTS via
 * ElevenLabs, com fallback automático pro texto em qualquer falha). Mantém os Sets
 * globais botMessageIds/botSentTexts que webhook.ts usa para não confundir a própria resposta
 * do bot com uma intervenção humana (ver [WEBHOOK_ANTILOOP] em webhook.ts).
 */
import OpenAI from 'openai';
import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { MCP_TOOLS, executarFerramenta } from './mcp/tools';
import { criarProvider, OpenAIProvider, AIMessage } from './providers/index';
import { evolutionFetch, sanitizeEvolutionUrl, withAiFallback } from '../utils/resilientFetch';
import { sintetizarVoz } from '../utils/elevenlabs';
import { withTenantContext } from '../db';
import { log } from '../logger';

const UPLOADS_DIR = process.env.UPLOADS_DIR || '/app/uploads';
const API_BASE_URL = process.env.API_BASE_URL || 'https://api.mentoark.com.br';

// Cliente global — usado como fallback; substituído pela chave do banco sempre que possível
// [AUDITORIA] LÓGICA (correção de segurança pós-incidente 2026-07-28/31 — loop bot-a-bot que
// esgotou o crédito): o SDK `openai` tem retry automático embutido (default maxRetries=2, 3
// tentativas totais em 429/5xx) nunca desabilitado neste código. Durante um esgotamento real de
// crédito (429 sustentado), isso faz cada chamada tentar de novo 2x contra a mesma parede,
// amplificando tráfego exatamente no pior momento. `maxRetries: 1` (não 0) mantém uma
// retentativa para falha transitória legítima (timeout de rede, 5xx pontual) sem multiplicar por
// 3 o tráfego/custo potencial de cada chamada.
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '', maxRetries: 1 });

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
// [AUDITORIA] BUG (auditoria 2026-07-29 — rajada mista de texto+mídia dentro da janela de
// debounce): campo `entrada` era sobrescrito incondicionalmente a cada mensagem nova
// (`existente.entrada = entrada`), guardando sempre os metadados só da ÚLTIMA mensagem da
// rajada. Cenário concreto: cliente manda um áudio e, menos de 3s depois, manda um texto (ou
// vice-versa) — `mensagens: string[]` só acumula `entrada.texto`, que vem vazio pra mensagens de
// mídia; e o `tipo`/`midiaUrl` de quem veio primeiro se perdia porque a segunda mensagem
// sobrescrevia `entrada` por completo. Resultado: uma das duas mensagens do cliente desaparecia
// silenciosamente — nem virava texto no histórico, nem áudio transcrito, nem imagem analisada.
// [AUDITORIA] FIX APLICADO: `entradaBase` (renomeado de `entrada`) só é substituída quando a
// mensagem nova É a portadora de mídia real (`tipo !== 'text' && midiaUrl`) — texto puro nunca
// mais apaga o áudio/imagem já capturado na rajada. Ver `processarComDebounce` abaixo e o ajuste
// correspondente no passo 5 (resolução de mídia) de `processarMensagem`, que agora funde o texto
// puro mesclado com a transcrição/legenda em vez de descartá-lo.
const bufferMensagens = new Map<string, {
  timeout: ReturnType<typeof setTimeout>;
  mensagens: string[];
  entradaBase: MensagemEntrada;
}>();

// ── Lock de concorrência — impede duas respostas simultâneas ao mesmo número ─
const atendimentosAtivos = new Set<string>();

// ── Circuit breaker anti-loop entre agentes (Sprint segurança 2026-08-04) ────────────────
// [AUDITORIA] LÓGICA: incidente real de 2026-07-28 — duas IAs de contas diferentes ficaram 54min
// respondendo uma à outra (67 mensagens, ~160k tokens, ver diagnosticos/AUDITORIA_LOG.md) porque
// o antiloop já existente (botSentTexts/botMessageIds, abaixo) só protege o bot de ecoar A
// PRÓPRIA mensagem DENTRO DA MESMA conta — não existe nada que detecte duas IAs presas
// respondendo uma à outra entre CONTAS diferentes (cada uma vê a mensagem da outra como uma
// mensagem legítima de cliente). Este freio é agnóstico à causa raiz (loop bot-a-bot, integração
// externa com bug, ou qualquer outro cenário que gere volume anômalo) — só mede quantas
// mensagens o BOT ENVIOU pro mesmo contato numa janela curta, sem tentar diagnosticar o motivo.
// Chave sempre `userId:telefone` — nunca cruza contas (mesmo número pode estourar o limite numa
// conta e continuar normal em outra).
const LOOP_BREAKER_LIMITE = 6;              // mensagens enviadas pelo bot ao mesmo contato...
const LOOP_BREAKER_JANELA_MS = 3 * 60_000;  // ...dentro desta janela → considera loop, não conversa humana normal
const enviosPorContato = new Map<string, number[]>(); // chave `${userId}:${telefone}` → timestamps (ms) de cada envio

// Registra um envio real do bot para o contato — chamado a partir de enviarResposta()/
// enviarRespostaVoz(), nunca a partir do recebimento de mensagem (o freio mede o que o BOT
// manda, não o que o contato manda, senão um cliente digitando rápido acionaria o freio à toa).
function registrarEnvioBot(userId: string, telefone: string): void {
  const chave = `${userId}:${telefone}`;
  const agora = Date.now();
  const timestamps = (enviosPorContato.get(chave) || []).filter(t => agora - t < LOOP_BREAKER_JANELA_MS);
  timestamps.push(agora);
  enviosPorContato.set(chave, timestamps);
}

// Quantos envios do bot pro mesmo contato ainda estão dentro da janela — chamado ANTES de
// processar uma nova mensagem recebida (não depende de gerar resposta pra economizar a chamada
// de LLM quando o freio já deveria ter disparado).
function enviosRecentesAoContato(userId: string, telefone: string): number {
  const chave = `${userId}:${telefone}`;
  const agora = Date.now();
  const timestamps = (enviosPorContato.get(chave) || []).filter(t => agora - t < LOOP_BREAKER_JANELA_MS);
  enviosPorContato.set(chave, timestamps); // limpa expirados também na leitura, evita crescimento sem limite
  return timestamps.length;
}

// Pausa automática por circuit breaker — mesmo mecanismo já usado por pausarPorFalhaLLM (ver
// abaixo), mas SEM o webhook de card no Kanban de propósito (pedido explícito do usuário: "sem
// notificação externa nesta sprint" — só log de alerta interno).
async function pausarPorLoopDetectado(
  pool: Pool, userId: string, telefone: string, quantidade: number,
): Promise<void> {
  const telefoneSuffix = `%${telefone.slice(-11)}`;
  try {
    await pool.query(
      `UPDATE contatos SET atendente_pausou_ia = true, updated_at = NOW()
       WHERE user_id = $1 AND telefone ILIKE $2`,
      [userId, telefoneSuffix]
    );
    await pool.query(
      `UPDATE dados_cliente SET atendimento_ia = 'pause', pausa_timestamp = NOW()
       WHERE user_id = $1 AND telefone ILIKE $2`,
      [userId, telefoneSuffix]
    );
    await pool.query(
      `INSERT INTO ia_pausa_log (user_id, telefone, acao, observacao)
       VALUES ($1, $2, 'pause', $3)`,
      [userId, telefone,
        `Pausa automática — circuit breaker anti-loop: ${quantidade} mensagens enviadas ao mesmo contato em menos de ${LOOP_BREAKER_JANELA_MS / 60_000}min (limite: ${LOOP_BREAKER_LIMITE}).`.slice(0, 500)],
    );
  } catch (errDb: any) {
    log.error('LOOP_BREAKER', 'Falha ao registrar pausa automática por loop detectado', { err: errDb?.message, stack: errDb?.stack });
  }
  log.error('LOOP_BREAKER', 'Circuit breaker acionado — excesso de mensagens enviadas ao mesmo contato numa janela curta, pausando automaticamente', {
    userId, telefone, quantidade, limite: LOOP_BREAKER_LIMITE, janelaMs: LOOP_BREAKER_JANELA_MS,
  });
}

// ── Cria cliente OpenAI com chave do provider (fallback para env) ─────────────
function criarClienteOpenAI(apiKey?: string): OpenAI {
  const key = apiKey || process.env.OPENAI_API_KEY || '';
  return key ? new OpenAI({ apiKey: key, maxRetries: 1 }) : openai;
}

// [AUDITORIA] BUG (Cenário E desta auditoria — timeouts em chamadas externas do motor de IA,
// 2026-07-23): as duas chamadas fetch abaixo (download do áudio + Whisper) rodavam sem
// AbortController/timeout — mesma classe de bug já corrigida em webhook.ts (achado B da
// revisão externa: fetch nativo do Node não tem timeout padrão). Se o servidor de mídia
// (Evolution/WhatsApp CDN) ou a API da OpenAI travarem/ficarem lentos, esta chamada síncrona
// dentro de processarMensagem() ficava pendurada indefinidamente, seguravel o lock
// `atendimentosAtivos` daquele telefone por tempo indeterminado (nenhuma outra mensagem do
// mesmo contato seria processada enquanto isso). Não prende conexão de banco (nenhum client
// do pool fica aberto durante estas chamadas — pool.query() de antes já liberou a conexão),
// mas prende o processamento daquele chat e o worker do event loop.
// [AUDITORIA] FIX APLICADO: AbortController com timeout em ambas — 15s pro download do áudio
// (arquivo de voz costuma ser pequeno, mas a rede pode ser lenta), 30s pro Whisper (serviço
// de transcrição, mais lento por natureza que uma chamada de API comum).
async function transcreverAudio(url: string, apiKey?: string): Promise<string | null> {
  try {
    const downloadController = new AbortController();
    const downloadTimer = setTimeout(() => downloadController.abort(), 15_000);
    let r: globalThis.Response;
    try {
      r = await fetch(url, { signal: downloadController.signal });
    } finally {
      clearTimeout(downloadTimer);
    }
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    const blob = new Blob([buf], { type: 'audio/ogg' });
    const form = new FormData();
    form.append('file', blob, 'audio.ogg');
    form.append('model', 'whisper-1');
    form.append('language', 'pt');
    const key = apiKey || process.env.OPENAI_API_KEY || '';
    const whisperController = new AbortController();
    const whisperTimer = setTimeout(() => whisperController.abort(), 30_000);
    let resp: globalThis.Response;
    try {
      resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body: form,
        signal: whisperController.signal,
      });
    } finally {
      clearTimeout(whisperTimer);
    }
    if (!resp.ok) {
      log.warn('ENGINE', 'Whisper erro', { status: resp.status, body: await resp.text().catch(() => '') });
      return null;
    }
    return ((await resp.json()) as any).text || null;
  } catch (err: any) {
    log.warn('ENGINE', 'transcreverAudio falhou (timeout ou erro de rede)', { err: err?.message });
    return null;
  }
}

// [AUDITORIA] LÓGICA (Cenário E): esta chamada usa o SDK oficial `openai`, não fetch cru — o
// SDK já aplica um timeout padrão próprio (documentado como 10 minutos, configurável via
// `timeout` no client) mesmo sem passarmos nada explícito aqui, diferente das duas chamadas
// fetch cruas de transcreverAudio() (corrigidas acima). 10min ainda é bastante tempo para um
// travamento acidental prender o lock `atendimentosAtivos` do contato — vale revisar se
// compensa apertar esse timeout explicitamente numa próxima sessão, mas não é o mesmo tipo de
// lacuna (ausência total de timeout) encontrado nas chamadas fetch cruas.
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

// [AUDITORIA] LÓGICA (Sprint 7, 2026-07-23 — verificação de vazamento de memória nos Sets
// de antiloop, pedida pelo usuário): conferido TODO write-site de botMessageIds/botSentTexts
// no backend (só existem dois: enviarResposta() logo abaixo, e o envio de campanha em
// disparoProcessor.ts) — em ambos, cada `.add()` já vem acompanhado de um `setTimeout` que
// remove a mesma chave depois de um TTL fixo. Não há vazamento de memória real: nenhuma
// entrada fica presa nesses Sets indefinidamente. TTL alinhado nesta sessão de 120s (2min)
// pra `BOT_ECHO_TTL_MS` = 5min — ainda folgado sobre o tempo real do eco do webhook (poucos
// segundos), só reduz a chance teórica de um retry/reenvio tardio da Evolution escapar da
// proteção antiloop por a chave já ter expirado.
export const BOT_ECHO_TTL_MS = 5 * 60_000;

// ── IDs e textos de mensagens enviadas pelo bot (previne auto-pausa da IA) ───
export const botMessageIds = new Set<string>();
export const botSentTexts  = new Set<string>();

// ── Envio via Evolution API ───────────────────────────────────────────────────
async function enviarResposta(
  userId: string, serverUrl: string, apiKey: string,
  instancia: string, telefone: string, texto: string
): Promise<void> {
  // [AUDITORIA] LÓGICA: registra o envio para o circuit breaker anti-loop (ver
  // enviosPorContato/registrarEnvioBot, declarados acima) mesmo em IA_TEST_MODE — a chamada de
  // LLM que gerou este texto já aconteceu e já custou, o freio precisa contar isso também pra se
  // proteger mesmo se IA_TEST_MODE for deixado ligado por engano em produção.
  registrarEnvioBot(userId, telefone);

  // [AUDITORIA] LÓGICA: sandbox de teste — com IA_TEST_MODE=true, a resposta é gerada
  // normalmente pelo motor mas nunca chega a sair para o WhatsApp de verdade (nem passa pelo
  // bookkeeping antiloop abaixo, que só faz sentido quando há um envio real). Permite testar o
  // motor de IA ponta a ponta sem risco de mensagem real sendo entregue a um contato.
  if (process.env.IA_TEST_MODE === 'true') {
    log.info('IA_SANDBOX', 'Mensagem gerada de teste (envio real suprimido)', {
      telefone, instancia, responseText: texto, ok: true,
    });
    return;
  }

  const base = sanitizeEvolutionUrl(serverUrl);

  // Registra o conteúdo ANTES de enviar para evitar condição de corrida no antiloop
  const textKey = `${telefone}:${texto}`;
  const textKeyTrimmed = `${telefone}:${texto.trim()}`;
  botSentTexts.add(textKey);
  botSentTexts.add(textKeyTrimmed);
  setTimeout(() => { botSentTexts.delete(textKey); botSentTexts.delete(textKeyTrimmed); }, BOT_ECHO_TTL_MS);

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
    setTimeout(() => botMessageIds.delete(msgId), BOT_ECHO_TTL_MS);
  }
}

// [AUDITORIA] LÓGICA (Sprint TTS): tenta sintetizar a resposta em voz (ElevenLabs) e enviar via
// Evolution (mesmo endpoint/payload já usado em disparoProcessor.ts para mídia de áudio:
// sendWhatsAppAudio + {number, audio: <url>}). Falha em qualquer etapa (sem API key, sem
// voice_id, ElevenLabs fora do ar, Evolution recusando) retorna false e NUNCA lança — o
// chamador (processarMensagem) trata false como "cai pro texto normal", conforme exigido.
// Retorna a URL do áudio gerado (pra registrar em whatsapp_messages) quando dá certo.
async function enviarRespostaVoz(
  pool: Pool, userId: string,
  serverUrl: string, apiKey: string,
  instancia: string, telefone: string,
  texto: string, voiceId: string,
): Promise<{ ok: true; audioUrl: string } | { ok: false }> {
  try {
    const elevenApiKeyRes = await pool.query(
      `SELECT api_key FROM integracoes_config
       WHERE user_id = $1 AND tipo = 'elevenlabs' AND status = 'conectado'
       LIMIT 1`,
      [userId]
    );
    const elevenApiKey = elevenApiKeyRes.rows[0]?.api_key;
    if (!elevenApiKey) {
      log.warn('ENGINE VOZ', 'Integração ElevenLabs não configurada — caindo pro texto', { userId });
      return { ok: false };
    }

    const buffer = await sintetizarVoz(texto, elevenApiKey, voiceId);
    if (!buffer) return { ok: false }; // já logado dentro de sintetizarVoz

    // [AUDITORIA] LÓGICA: registra pro circuit breaker anti-loop (ver enviosPorContato acima) só
    // depois de confirmar que a voz foi sintetizada — antes disso (sem ElevenLabs configurado,
    // por exemplo) o caminho cai pro texto normal via enviarResposta(), que registra por conta
    // própria; registrar aqui também nesse caso contaria o mesmo turno duas vezes.
    registrarEnvioBot(userId, telefone);

    if (process.env.IA_TEST_MODE === 'true') {
      log.info('IA_SANDBOX', 'Áudio de teste gerado (envio real suprimido)', {
        telefone, instancia, bytes: buffer.length,
      });
      return { ok: true, audioUrl: 'sandbox://ia-test-mode' };
    }

    if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    const filename = `tts_${uuidv4()}.mp3`;
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);
    const audioUrl = `${API_BASE_URL}/uploads/${filename}`;

    const base = sanitizeEvolutionUrl(serverUrl);
    const r = await evolutionFetch(`${base}/message/sendWhatsAppAudio/${instancia}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: apiKey },
      body: JSON.stringify({ number: telefone, audio: audioUrl }),
    });
    if (!r.ok) {
      log.warn('ENGINE VOZ', 'Evolution recusou o envio de áudio — caindo pro texto', {
        status: r.status, body: await r.text().catch(() => ''),
      });
      return { ok: false };
    }

    const data = await r.json().catch(() => ({})) as any;
    const msgId: string | undefined = data?.key?.id;
    if (msgId) {
      botMessageIds.add(msgId);
      setTimeout(() => botMessageIds.delete(msgId), BOT_ECHO_TTL_MS);
    }
    return { ok: true, audioUrl };
  } catch (err: any) {
    log.warn('ENGINE VOZ', 'Falha inesperada no envio de voz — caindo pro texto', { err: err?.message });
    return { ok: false };
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

  // [AUDITORIA] LÓGICA: idx_contatos_user_tel_unique é um índice único PARCIAL
  // (UNIQUE (user_id, telefone) WHERE telefone IS NOT NULL) — o ON CONFLICT abaixo repete o
  // mesmo predicado WHERE de propósito, senão o Postgres recusa o INSERT com "no unique or
  // exclusion constraint matching the ON CONFLICT specification" em toda tentativa de criar
  // contato novo (mesmo detalhe já corrigido hoje na trigger de sincronização da Inbox).
  const novo = await pool.query(
    `INSERT INTO contatos (user_id, nome, telefone, origem, status)
     VALUES ($1, $2, $3, 'WhatsApp', 'novo')
     ON CONFLICT (user_id, telefone) WHERE telefone IS NOT NULL DO NOTHING
     RETURNING id, opt_out`,
    [userId, nome || telefone, telefone]
  );
  if (novo.rows.length) return novo.rows[0];

  // Conflito concorrente: outra chamada (ex: upsert antecipado do webhook.ts) venceu a
  // corrida e criou o contato entre o SELECT e o INSERT acima — busca o registro já existente.
  const pos = await pool.query(
    `SELECT id, opt_out FROM contatos WHERE user_id = $1 AND telefone ILIKE $2 LIMIT 1`,
    [userId, `%${telefone.slice(-11)}`]
  );
  return pos.rows[0];
}

// [AUDITORIA] BUG CRÍTICO (auditoria 2026-07-29 — falha de LLM deixava o cliente no vácuo):
// antes, quando `provider.complete()` falhava (401/429 tratados por `withAiFallback` → `resp`
// vem `null`; qualquer outro erro — rede, 5xx, timeout — não é tratado por `withAiFallback` e
// escapa como exceção) o motor só logava o erro e retornava (ou relançava a exceção, que a
// própria `processarComDebounce` só loga de novo) — NADA pausava a IA pro contato, NADA
// avisava um atendente. O cliente ficava esperando uma resposta que nunca viria, sem que
// ninguém do lado humano soubesse que a IA quebrou pra aquele número. [AUDITORIA] FIX
// APLICADO: nos dois pontos de falha (ver `processarMensagem`, loop agêntico), chama esta
// função — marca `contatos.atendente_pausou_ia=true` E `dados_cliente.atendimento_ia='pause'`
// (mesmos 2 campos que `pausaRes` já verifica no início do motor pra decidir se a IA deve
// responder), registra em `ia_pausa_log` (mesma tabela de auditoria já usada pelo endpoint
// manual de pausa em `routes/contatos.ts`) e dispara o mesmo webhook de card no Kanban já usado
// pela pausa "normal" (seção 14 de `processarMensagem`), com prioridade alta e título
// diferenciado, pra um atendente ver que precisa assumir. Pausa fica sem `pausa_duracao_min`
// de propósito — não deve reativar sozinha depois de N minutos como a pausa "IA decidiu
// encerrar" normal, porque o motivo aqui é uma falha real (chave sem crédito, rate limit, erro
// de rede) que só um humano deve resolver e reativar manualmente.
async function pausarPorFalhaLLM(
  pool: Pool, userId: string, entrada: MensagemEntrada, motivo: string,
): Promise<void> {
  const telefoneSuffix = `%${entrada.telefone.slice(-11)}`;
  try {
    await pool.query(
      `UPDATE contatos SET atendente_pausou_ia = true, updated_at = NOW()
       WHERE user_id = $1 AND telefone ILIKE $2`,
      [userId, telefoneSuffix]
    );
    await pool.query(
      `UPDATE dados_cliente SET atendimento_ia = 'pause', pausa_timestamp = NOW()
       WHERE user_id = $1 AND telefone ILIKE $2`,
      [userId, telefoneSuffix]
    );
    await pool.query(
      `INSERT INTO ia_pausa_log (user_id, telefone, acao, observacao)
       VALUES ($1, $2, 'pause', $3)`,
      [userId, entrada.telefone, `Pausa automática — falha na chamada à LLM: ${motivo}`.slice(0, 500)]
    );
  } catch (errDb: any) {
    log.error('ENGINE', 'Falha ao registrar pausa automática por erro de LLM', { err: errDb?.message, stack: errDb?.stack });
  }

  const backendUrl = process.env.BACKEND_URL || 'https://api.mentoark.com.br';
  const kanbanSecret = process.env.N8N_WEBHOOK_SECRET || 'mentoark-kanban-secret-2025';
  fetch(`${backendUrl}/api/kanban/webhook/n8n`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-webhook-secret': kanbanSecret },
    body: JSON.stringify({
      user_id: userId,
      titulo: `⚠️ IA falhou: ${entrada.pushName} (${entrada.telefone})`,
      resumo: `A IA não conseguiu responder este contato (falha na chamada à LLM) e foi pausada automaticamente. Motivo técnico: ${motivo}`.slice(0, 800),
      contato_nome: entrada.pushName,
      contato_telefone: entrada.telefone,
      remote_jid: `${entrada.telefone}@s.whatsapp.net`,
      instance_name: entrada.instancia,
      prioridade: 'alta',
    }),
  }).catch(err => log.warn('ENGINE', 'Falha ao criar card Kanban de falha de LLM', { err: err?.message, stack: err?.stack }));

  log.error('ENGINE', 'IA pausada automaticamente por falha na LLM — aguardando atendente humano', {
    telefone: entrada.telefone, userId, motivo,
  });
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

  // 3.5. Circuit breaker anti-loop — checado ANTES de chamar a LLM de propósito (ver comentário
  // completo na declaração de enviosPorContato/LOOP_BREAKER_LIMITE acima): se o limite já foi
  // ultrapassado por envios anteriores, nem vale a pena gastar mais uma chamada de LLM só para
  // descartar a resposta depois — pausa e sai imediatamente.
  const enviosRecentes = enviosRecentesAoContato(userIdFinal, entrada.telefone);
  if (enviosRecentes > LOOP_BREAKER_LIMITE) {
    await pausarPorLoopDetectado(pool, userIdFinal, entrada.telefone, enviosRecentes);
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
    const transcrito = await transcreverAudio(entrada.midiaUrl, openaiApiKey);
    if (!transcrito) { log.warn('ENGINE', 'Falha na transcrição'); return; }
    // [AUDITORIA] FIX APLICADO (2026-07-29): antes, `textoFinal = transcrito` descartava
    // `entrada.texto` incondicionalmente — inofensivo pra um áudio isolado (normalmente vem sem
    // texto), mas destruía silenciosamente uma mensagem de texto puro que o debounce mesclou
    // aqui na mesma rajada (ex: cliente manda um áudio e, <3s depois, um texto — ver fix em
    // `processarComDebounce`/`bufferMensagens` acima). Agora concatena em vez de sobrescrever.
    textoFinal = entrada.texto ? `${entrada.texto}\n${transcrito}` : transcrito;
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
            mensagem_encaminhamento, mensagem_encerramento,
            resposta_voz_habilitada, resposta_voz_id
     FROM agent_configs
     WHERE user_id = $1 AND ativo = true
     LIMIT 1`,
    [userIdFinal]
  );

  const agentConfig = configRes.rows[0] ?? null;

  // [AUDITORIA] BUG (achado 2026-07-28, reportado pelo usuário — cliente novo com IA
  // respondendo e usando o prompt configurado pra OUTRO cliente já existente): antes, sem
  // `agent_configs.prompt_sistema` nem `agent_prompts` real, o motor caía num prompt genérico
  // hardcoded ("Você é um assistente prestativo.") e RESPONDIA mesmo assim — violando a regra
  // "a IA não pode responder sem antes estar configurada". Isso, somado a `agent_configs`
  // nascendo `ativo=true` por padrão em pelo menos 3 pontos do sistema (agent-config.ts,
  // integracoes.ts, evolutionReconciliation.ts — todos corrigidos na mesma sessão) e ao bug
  // separado de roteamento em `ConfigAgenteIA.tsx`/`agent-config.ts` (rota `/api/agent_configs`
  // usada pelo frontend nunca existiu — `/api/agent-config`, singular/hífen, é a rota real —
  // fazendo a tela de configuração falhar silenciosamente ao carregar/salvar, então o operador
  // nunca via se a config realmente tinha sido salva pro cliente certo), formava exatamente o
  // cenário reportado. [AUDITORIA] FIX APLICADO: prompt do sistema só é considerado "real" com
  // conteúdo genuíno vindo de `agent_configs`/`agent_prompts` — sem isso, a IA NÃO responde
  // (mesmo comportamento de "agente não encontrado" já usado linhas acima), em vez de
  // silenciosamente assumir uma persona genérica que não é a do cliente.
  // Prompt do sistema: usa agent_configs.prompt_sistema como fonte principal.
  // Fallback para agent_prompts apenas para compatibilidade com contas antigas sem migração.
  let systemPromptBase: string | null = null;
  if (agentConfig?.prompt_sistema) {
    systemPromptBase = agentConfig.prompt_sistema;
  } else {
    const legacyRes = await pool.query(
      `SELECT conteudo FROM agent_prompts WHERE user_id = $1 AND ativo = true LIMIT 1`,
      [userIdFinal]
    );
    systemPromptBase = legacyRes.rows[0]?.conteudo || null;
  }
  if (!systemPromptBase) {
    log.warn('ENGINE', 'Agente sem prompt configurado — IA não vai responder', { userId: userIdFinal, instancia: entrada.instancia });
    return;
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

  // [AUDITORIA] LÓGICA (Sprint 7, 2026-07-23 — verificação de ordem do histórico enviado à
  // LLM, pedida pelo usuário): `ORDER BY created_at DESC` abaixo busca as 20 mais recentes
  // (mais eficiente pro índice/LIMIT do que ASC + paginação reversa), mas o resultado sai
  // mais-novo-primeiro — na linha seguinte (`histRes.rows.reverse()`) já é invertido pra
  // mais-antigo-primeiro ANTES de virar `historico`/`mensagens` (o array de fato mandado pro
  // provider de IA, ver `provider.complete(mensagens, ...)` mais abaixo). Conferido: não há
  // nenhum caminho neste arquivo que use `histRes.rows` sem passar por esse `.reverse()`
  // primeiro. Ordem já está correta — nenhuma mudança necessária.
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
  const modelo = providerInfo?.modelo || agentConfig?.modelo_llm || agente.modelo || 'gpt-4o-mini';
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
      // [AUDITORIA] FIX APLICADO (2026-07-29): antes só relançava (`throw err`) — o único
      // efeito prático era `processarComDebounce` logar o mesmo erro de novo antes de o
      // `finally` de `processarMensagem` liberar o lock. Cliente ficava sem resposta e sem
      // ninguém do lado humano ser avisado. Ver `pausarPorFalhaLLM` (declarada acima).
      await pausarPorFalhaLLM(pool, userIdFinal, entrada, err?.message || 'erro desconhecido na chamada à LLM');
      return;
    }

    if (!resp) {
      log.error('RASTREIO IA - ERRO', 'Provider retornou null (401/429)', {
        telefone: entrada.telefone,
        provider: providerSlug + '/' + modelo,
        diagnostico: 'verifique OPENAI_API_KEY no .env do servidor',
      });
      // [AUDITORIA] FIX APLICADO (2026-07-29): `withAiFallback` devolve `null` aqui
      // especificamente pra 401 (chave inválida) e 429 (sem créditos/rate limit) — os dois
      // cenários citados explicitamente na auditoria ("chave de API sem saldo, limite de
      // requisições excedido"). Antes só retornava em silêncio; ver `pausarPorFalhaLLM`.
      await pausarPorFalhaLLM(pool, userIdFinal, entrada, 'Provider retornou null — chave inválida (401) ou sem créditos/rate limit (429)');
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
      const resultado = await executarFerramenta(pool, userIdFinal, tc.name, tc.input, {
        telefone: entrada.telefone,
        contatoId: contato.id,
        nomeContato: entrada.pushName || null,
      });

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

  // 11. Enviar mensagens (replica o Loop do n8n: 3s entre cada parte). Movido pra antes do
  // registro em whatsapp_messages (abaixo) para que esse registro reflita corretamente se a
  // resposta saiu como texto ou voz — ver `tipoEnviado`/`mediaUrlEnviada`.
  let tipoEnviado: 'text' | 'audio' = 'text';
  let mediaUrlEnviada: string | null = null;

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

    // [AUDITORIA] LÓGICA (Sprint TTS): resposta em voz é opt-in por agente
    // (agent_configs.resposta_voz_habilitada + resposta_voz_id) e só é tentada quando a
    // mensagem RECEBIDA do cliente foi um áudio (espelha o canal — critério simples e seguro
    // sugerido pelo usuário). Fora dessas condições, comportamento 100% idêntico ao anterior
    // (texto em pedaços, sem nenhuma mudança pra tenants sem a flag ativada).
    const deveResponderEmVoz =
      agentConfig?.resposta_voz_habilitada === true &&
      !!agentConfig?.resposta_voz_id &&
      entrada.tipo === 'audio';

    let vozEnviada = false;
    if (deveResponderEmVoz) {
      const resultado = await enviarRespostaVoz(
        pool, userIdFinal,
        agente.evolution_server_url, agente.evolution_api_key,
        agente.evolution_instancia || entrada.instancia,
        entrada.telefone, respostaFinal, agentConfig.resposta_voz_id,
      );
      if (resultado.ok) {
        vozEnviada = true;
        tipoEnviado = 'audio';
        mediaUrlEnviada = resultado.audioUrl;
      } else {
        log.warn('ENGINE VOZ', 'Falha ao responder em voz — caindo pro texto normal', { telefone: entrada.telefone });
      }
    }

    // Fallback obrigatório: texto normal quando voz não foi tentada ou falhou por qualquer motivo.
    if (!vozEnviada) {
      for (let i = 0; i < parserMessages.length; i++) {
        if (i > 0) await new Promise(r => setTimeout(r, 3000));
        const textoFormatado = `*${nomeAgente}*\n${parserMessages[i]}`;
        await enviarResposta(
          userIdFinal,
          agente.evolution_server_url,
          agente.evolution_api_key,
          agente.evolution_instancia || entrada.instancia,
          entrada.telefone,
          textoFormatado
        );
      }
    }
  }

  // 12. Persistir em whatsapp_messages para o painel de chat
  // [AUDITORIA] FIX APLICADO (2026-07-21): INSERT agora roda dentro de withTenantContext
  // (db.ts) — propaga app.user_id pro Postgres via SET LOCAL, necessário pro piloto de RLS
  // em whatsapp_messages (só homologação por enquanto, ver diagnosticos/AUDITORIA_LOG.md).
  // Sem isso, esse INSERT falharia o WITH CHECK da policy em qualquer ambiente com RLS ativo.
  if (respostaFinal) {
    await withTenantContext({ userId: userIdFinal, isAdmin: false }, client => client.query(
      `INSERT INTO whatsapp_messages
         (user_id, instance_name, remote_jid, message_id, from_me,
          message_type, content, media_url, media_mimetype, status, timestamp_wa, push_name)
       VALUES ($1,$2,$3,$4,true,$5,$6,$7,$8,'sent',to_timestamp($9), $10)
       ON CONFLICT (message_id, instance_name) DO NOTHING`,
      [userIdFinal, agente.evolution_instancia || entrada.instancia,
       `${entrada.telefone}@s.whatsapp.net`,
       // [AUDITORIA] LÓGICA: prefixo "resp_" é o sinal que webhook.ts usa (checagem
       // messageId.startsWith('resp_')) para reconhecer que esta mensagem veio do próprio bot e
       // não deve disparar a lógica de "atendente assumiu, pausar IA" — acoplamento implícito
       // entre os dois arquivos, sem constante compartilhada.
       `resp_${entrada.messageId}`,
       tipoEnviado,
       respostaFinal,
       mediaUrlEnviada,
       tipoEnviado === 'audio' ? 'audio/mpeg' : null,
       Math.floor(Date.now() / 1000),
       nomeAgente]
    )).catch(err => log.error('ENGINE INSERT whatsapp_messages', 'Falha ao inserir whatsapp_messages', { err: err?.message, stack: err?.stack }));
  }

  // 13. Registrar uso de tokens
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

// [AUDITORIA] LÓGICA (Cenário E desta auditoria — race condition de completions sob rajada de
// mensagens, 2026-07-23): verificado o caso concreto pedido — 5 mensagens do mesmo contato,
// 1 em 1 segundo. Duas camadas independentes de proteção, ambas ativas:
//   1. Debounce de verdade (não throttle): cada mensagem nova pro mesmo `chave`
//      (instancia:telefone) cancela o timeout anterior (`clearTimeout`) e agenda um novo de
//      3s — com gaps de 1s entre as 5 mensagens (bem abaixo dos 3s), o timer nunca dispara
//      até a ÚLTIMA mensagem, e só então processarMensagem() roda UMA vez com o texto das 5
//      mensagens concatenado. Nenhuma chamada à API da IA é feita por mensagem individual
//      nesse cenário.
//   2. Lock de concorrência (`atendimentosAtivos`, ver processarMensagem() acima) como
//      segunda linha de defesa — se, por qualquer motivo (ex: gap > 3s fazendo dois disparos
//      de debounce próximos, ou uma reentrada via o próprio reagendamento do lock), duas
//      chamadas a processarMensagem() para o MESMO telefone coincidirem, a segunda encontra o
//      lock ocupado e se REAGENDA (setTimeout 4s), nunca chama a IA em paralelo com a
//      primeira. Lock liberado em `finally`, então mesmo erro/exceção na primeira chamada não
//      deixa o lock preso pra sempre.
// Veredito: sim, o mecanismo evita eficazmente chamadas paralelas à IA pro mesmo chat nesse
// cenário e em cenários adjacentes (gaps maiores, erros durante o processamento).
// ── Debounce — agrupa mensagens picotadas do mesmo contato ───────────────────
export async function processarComDebounce(pool: Pool, entrada: MensagemEntrada): Promise<void> {
  const chave = `${entrada.instancia}:${entrada.telefone}`;
  const DEBOUNCE_MS = 3000;

  const existente = bufferMensagens.get(chave);
  if (existente) {
    clearTimeout(existente.timeout);
    if (entrada.texto) existente.mensagens.push(entrada.texto);
    // Só troca a entrada-base (tipo/midiaUrl) quando a mensagem nova É a portadora de mídia
    // real — texto puro chegando depois de um áudio/imagem na mesma rajada NUNCA mais apaga a
    // mídia já capturada (ver comentário completo na declaração de `bufferMensagens` acima).
    // Duas mensagens de mídia na mesma rajada (ex: dois áudios em sequência) continuam sendo
    // uma limitação residual conhecida — a mais recente vence, a anterior é descartada; caso
    // não coberto por este fix (raro: exigiria processar múltiplas mídias em série).
    if (entrada.tipo !== 'text' && entrada.midiaUrl) {
      existente.entradaBase = entrada;
    }
  } else {
    bufferMensagens.set(chave, {
      timeout: null as any,
      mensagens: entrada.texto ? [entrada.texto] : [],
      entradaBase: entrada,
    });
  }

  const buf = bufferMensagens.get(chave)!;
  buf.timeout = setTimeout(async () => {
    bufferMensagens.delete(chave);
    const entradaFinal = { ...buf.entradaBase };
    if (buf.mensagens.length) entradaFinal.texto = buf.mensagens.join(' ');
    await processarMensagem(pool, entradaFinal).catch(err =>
      log.error('ENGINE', 'Erro', { err: err?.message, stack: err?.stack })
    );
  }, DEBOUNCE_MS);
}

export { processarMensagem };
