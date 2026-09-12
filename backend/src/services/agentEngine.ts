/**
 * agentEngine.ts — Motor de resposta automática da IA para mensagens do WhatsApp.
 *
 * Chamado por webhook.ts (via processarComDebounce, 3s de debounce por telefone) após uma
 * mensagem recebida ser atribuída a um userId. Resolve o agente e toda a config de IA (prompt,
 * modelo, provider, MCP tools habilitadas) numa única fonte — tabela `agentes` (unificação Sprint
 * 1, ver diagnosticos/SPRINT_UNIFICAR_CONFIGURACAO_AGENTE_IA.md; `agent_configs` existe fisicamente
 * mas não é mais lida/escrita por este arquivo), monta o histórico (n8n_chat_histories), chama o
 * provider (OpenAI/Claude/Gemini), faz parsing nativo da resposta (quebra em até 2
 * mensagens, detecta sinal de pausa) e envia via Evolution API (enviarResposta ou, quando
 * configurado por agente e a mensagem recebida foi um áudio, enviarRespostaVoz — TTS via
 * ElevenLabs, com fallback automático pro texto em qualquer falha). Mantém os Sets
 * globais botMessageIds/botSentTexts que webhook.ts usa para não confundir a própria resposta
 * do bot com uma intervenção humana (ver [WEBHOOK_ANTILOOP] em webhook.ts).
 */
import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { MCP_TOOLS, executarFerramenta } from './mcp/tools';
import { criarProvider, OpenAIProvider, AIMessage } from './providers/index';
import { evolutionFetch, sanitizeEvolutionUrl, withAiFallback } from '../utils/resilientFetch';
import { sintetizarVoz } from '../utils/elevenlabs';
import { baixarMidiaDecriptografada } from '../utils/whatsappMediaStorage';
import { transcreverAudio } from '../utils/transcribe';
import { registrarUsoIA, estimarCustoUsd, estimarCustoWhisperUsd } from '../utils/aiCusto';
import { analisarImagem } from '../utils/vision';
import { withTenantContext } from '../db';
import { log } from '../logger';

const UPLOADS_DIR = process.env.UPLOADS_DIR || '/app/uploads';
const API_BASE_URL = process.env.API_BASE_URL || 'https://api.mentoark.com.br';

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

// [AUDITORIA] BUG (Sprint duplicação Whisper/Vision, 2026-08-06): este arquivo tinha suas
// PRÓPRIAS cópias locais de transcreverAudio()/analisarImagem() (removidas aqui), que recebiam
// `entrada.midiaUrl` — a URL crua do CDN do WhatsApp, sempre CRIPTOGRAFADA (ver cabeçalho de
// whatsappMediaStorage.ts) — e tentavam mandar essa URL direto pro Whisper/Vision, SEM
// decriptografar primeiro. Isso rodava em paralelo ao que webhook.ts já faz corretamente
// (decripta via Evolution ANTES de chamar Whisper/Vision, grava o resultado em `entrada.texto`
// como `[Áudio Transcrito: "..."]` / `[Mídia - Imagem: "..."]`) — ou seja, toda mensagem de
// áudio/imagem gerava DUAS chamadas independentes à OpenAI. Confirmado com teste real (áudio e
// imagem genuínos do WhatsApp, ambiente homolog, 2026-08-06, replicando exatamente a lógica que
// existia aqui): baixar a URL crua retorna bytes cifrados (não bate a assinatura de nenhum
// formato de áudio/imagem válido — nem "OggS", nem JPEG) — Whisper rejeita com HTTP 400
// "Invalid file format", Vision rejeita com HTTP 400 "invalid_image_url". Pra ÁUDIO isso não
// era só uma chamada duplicada e desperdiçada: a função local retornava `null`, e o call site
// tinha `if (!transcrito) { ...; return; }` — ou seja, a IA NUNCA respondia à mensagem de
// áudio, mesmo o webhook.ts já tendo transcrito com sucesso segundos antes. Bug funcional real
// de perda de resposta, não só de custo. Pra IMAGEM o efeito era mais brando (o catch engolia o
// erro e caía no fallback `caption || '[imagem]'`), mas ainda assim descartava a descrição real
// já gerada pelo webhook.ts e respondia com base numa legenda genérica ou vazia.
// [AUDITORIA] FIX APLICADO: removidas as cópias locais. O passo 5 abaixo agora usa
// `entrada.texto` diretamente quando webhook.ts já processou a mídia (prefixo reconhecível) —
// zero chamada nova a Whisper/Vision no caso normal. Só cai no fallback (mesmas funções
// compartilhadas de webhook.ts: `utils/transcribe.ts`/`utils/vision.ts`, chamadas aqui só
// depois de decriptografar via `baixarMidiaDecriptografada()` — nunca mais um fetch cru na URL
// cifrada) quando webhook.ts não processou por algum motivo (ex: `OPENAI_API_KEY` global vazio
// no momento do webhook mas o tenant tem provider OpenAI próprio configurado, usado só aqui;
// decrypt falhou transitoriamente na Evolution; etc.) — mantendo as duas implementações
// unificadas numa só (decidido não manter uma segunda cópia local só pra fallback: o ganho de
// isolamento não compensa o risco de as duas divergirem de novo no futuro).
async function buscarConfigEvolutionFallback(pool: Pool, userId: string): Promise<{ url: string; apiKey: string } | null> {
  try {
    // [AUDITORIA] LÓGICA (Sprint 1 unificação, ver agentEngine.ts topo): fonte repontada de
    // `agent_configs` pra `agentes`. Um tenant pode ter mais de uma linha em `agentes` — prioriza
    // a mais recentemente atualizada com credenciais preenchidas, mesmo critério de desempate já
    // usado pra resolver `agente` lá em cima (`ORDER BY updated_at DESC`).
    const r = await pool.query(
      `SELECT evolution_server_url AS url, evolution_api_key AS api_key
       FROM agentes
       WHERE user_id = $1 AND ativo = true
         AND evolution_server_url IS NOT NULL AND evolution_api_key IS NOT NULL
       ORDER BY updated_at DESC LIMIT 1`,
      [userId],
    );
    const row = r.rows[0];
    if (!row?.url || !row?.api_key) return null;
    return { url: row.url, apiKey: row.api_key };
  } catch (err: any) {
    log.warn('ENGINE', 'buscarConfigEvolutionFallback falhou', { err: err?.message });
    return null;
  }
}

// [AUDITORIA] LÓGICA (Sprint Diagnóstico "ainda gastando token no disparo", 2026-08-07 — item 1
// de SPRINT_VISTORIA_COMPLETA_GASTO_IA.md): `ai_uso_diario` tem coluna `custo_usd` e dashboard
// pronto (`GET /api/ai/uso/resumo`), mas o único INSERT que escrevia na tabela (aqui embaixo)
// nunca preenchia esse campo — o dashboard sempre mostrou $0, mesmo com gasto real.
// [AUDITORIA] FIX APLICADO (Sprint Vistoria de Gasto de IA, 2026-08-14): tabela de preço +
// `estimarCustoUsd` extraídos pra `utils/aiCusto.ts` (módulo compartilhado) — Vision, Whisper e
// embeddings (RAG) pagavam de verdade e nunca apareciam nesse dashboard, mesma causa raiz que
// deixou o desperdício de mídia de grupo invisível até o saldo da OpenAI zerar (ver webhook.ts).
// Preço mantido em um único lugar em vez de duplicado por call-site novo.

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
// [AUDITORIA] LÓGICA (Sprint Nome Real de Leads de Grupo, cont., 2026-08-27 — pedido explícito
// do usuário, depois de confirmado que `fetchProfile`/`group/participants` têm cobertura
// dependente da reputação do número: "ainda não estamos conseguindo baixar o nome do lead"):
// `nome`/`nome_verificado` agora voltam junto do upsert — usados por quem chama pra decidir se
// injeta a instrução "pergunte o nome" no prompt (ver `systemPrompt` mais abaixo). Via mais
// confiável que as automáticas: não depende de configuração de privacidade de ninguém, só do
// lead responder pelo menos uma mensagem.
async function upsertContato(
  pool: Pool, userId: string, telefone: string, nome: string
): Promise<{ id: string; opt_out: boolean; nome: string; nome_verificado: boolean | null }> {
  const ex = await pool.query(
    `SELECT id, opt_out, nome, nome_verificado FROM contatos WHERE user_id = $1 AND telefone ILIKE $2 LIMIT 1`,
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
     RETURNING id, opt_out, nome, nome_verificado`,
    [userId, nome || telefone, telefone]
  );
  if (novo.rows.length) return novo.rows[0];

  // Conflito concorrente: outra chamada (ex: upsert antecipado do webhook.ts) venceu a
  // corrida e criou o contato entre o SELECT e o INSERT acima — busca o registro já existente.
  const pos = await pool.query(
    `SELECT id, opt_out, nome, nome_verificado FROM contatos WHERE user_id = $1 AND telefone ILIKE $2 LIMIT 1`,
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

  // [AUDITORIA] LÓGICA (Sprint 0 do plano em diagnosticos/PLANO_MOTOR_MULTIAGENTE_ECONOMIA_TOKEN.md):
  // scaffolding da flag de segurança pro motor multi-agente — só lê e loga por enquanto, não
  // muda comportamento nenhum. Não existe ainda nenhum motor novo pra rotear quando `true`
  // (Sprints 1+ do plano, ainda não implementadas) — todo mundo (flag `true` ou `false`) segue
  // pelo caminho único de sempre logo abaixo. Ponto de extensão pronto pra quando existir de
  // fato algo diferente pra fazer aqui.
  const multiAgentFlagRes = await pool.query(
    `SELECT multi_agent_enabled FROM users WHERE id = $1`,
    [userIdFinal]
  ).catch(() => ({ rows: [] as any[] }));
  if (multiAgentFlagRes.rows[0]?.multi_agent_enabled) {
    log.info('ENGINE', 'multi_agent_enabled=true pra esta conta, mas o motor novo ainda não existe — seguindo pelo caminho único atual', { userId: userIdFinal });
  }

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
  // [AUDITORIA] FIX APLICADO (Sprint duplicação Whisper/Vision, 2026-08-06 — ver comentário
  // completo acima de buscarConfigEvolutionFallback()): webhook.ts já decriptografa e
  // transcreve/analisa a mídia ANTES de chamar processarComDebounce, gravando o resultado em
  // `entrada.texto` com um prefixo reconhecível. O debounce (bufferMensagens) preserva esse
  // texto — mesmo numa rajada mista com uma mensagem de texto puro no meio, o prefixo continua
  // presente em algum ponto da string unida por `.join(' ')`. Detectando esse prefixo evitamos
  // a segunda chamada (redundante e, no caso de áudio, quebrada — ver comentário acima) e usamos
  // o texto já pronto diretamente. Só decripta e chama Whisper/Vision de novo aqui (via
  // baixarMidiaDecriptografada() + as MESMAS funções de utils/transcribe.ts e utils/vision.ts
  // usadas por webhook.ts, nunca mais um fetch cru na URL cifrada) quando o prefixo não está
  // presente — sinal de que webhook.ts não processou essa mídia (ex: OPENAI_API_KEY global
  // vazio no momento do webhook, decrypt falhou transitoriamente, etc.).
  let textoFinal = entrada.texto;
  const audioJaProcessado = entrada.tipo === 'audio' && !!entrada.texto?.includes('[Áudio Transcrito: "');
  const imagemJaProcessada = entrada.tipo === 'image' && !!entrada.texto?.includes('[Mídia - Imagem: "');

  // [AUDITORIA] FIX APLICADO (Sprint Modalidades Opcionais, 2026-08-23 — pedido explícito do
  // usuário: manter a funcionalidade, só torná-la opcional): `agente.modalidade_audio`/
  // `modalidade_imagem` já vêm carregados no `SELECT *` de `agente` lá em cima — `?? true`
  // preserva o comportamento atual (sempre ligado) pra linha nunca configurada. Mesmo gate agora
  // aplicado em webhook.ts (bloco principal); aqui cobre só o fallback local (webhook.ts não
  // processou a mídia por algum motivo).
  const modalidadeAudioHabilitada = agente.modalidade_audio ?? true;
  const modalidadeImagemHabilitada = agente.modalidade_imagem ?? true;

  if (entrada.tipo === 'audio' && entrada.midiaUrl && !audioJaProcessado && modalidadeAudioHabilitada) {
    const evo = await buscarConfigEvolutionFallback(pool, userIdFinal);
    const midiaDecriptografada = evo
      ? await baixarMidiaDecriptografada({
          evoUrl: evo.url, apiKey: evo.apiKey, instancia: entrada.instancia,
          messageId: entrada.messageId, remoteJid: `${entrada.telefone}@s.whatsapp.net`, fromMe: false,
        })
      : null;
    const resultadoTranscricao = midiaDecriptografada
      ? await transcreverAudio(midiaDecriptografada.buffer, midiaDecriptografada.mimetype || 'audio/ogg', openaiApiKey)
      : null;
    if (!resultadoTranscricao) { log.warn('ENGINE', 'Falha na transcrição (fallback local — webhook.ts não processou este áudio)'); return; }
    // [AUDITORIA] FIX APLICADO (Sprint Vistoria de Gasto de IA, 2026-08-14): este fallback local
    // também paga Whisper de verdade — nunca gravava custo_usd, mesmo achado do bloco principal
    // em webhook.ts.
    await registrarUsoIA(pool, {
      userId: userIdFinal, providerSlug: 'openai', modelo: 'whisper-1',
      tokensEntrada: 0, tokensSaida: 0,
      custoUsd: estimarCustoWhisperUsd(resultadoTranscricao.duracaoSegundos),
    });
    // [AUDITORIA] FIX APLICADO (2026-07-29, preservado): concatena em vez de sobrescrever, pra
    // não descartar uma mensagem de texto puro que o debounce mesclou na mesma rajada.
    textoFinal = entrada.texto ? `${entrada.texto}\n${resultadoTranscricao.texto}` : resultadoTranscricao.texto;
    log.info('ENGINE', 'Áudio transcrito via fallback local (webhook.ts não havia processado)', { textoTranscrito: textoFinal.slice(0, 60) });
  } else if (entrada.tipo === 'image' && entrada.midiaUrl && !imagemJaProcessada && modalidadeImagemHabilitada) {
    const evo = await buscarConfigEvolutionFallback(pool, userIdFinal);
    const midiaDecriptografada = evo
      ? await baixarMidiaDecriptografada({
          evoUrl: evo.url, apiKey: evo.apiKey, instancia: entrada.instancia,
          messageId: entrada.messageId, remoteJid: `${entrada.telefone}@s.whatsapp.net`, fromMe: false,
        })
      : null;
    const resultadoVisao = midiaDecriptografada
      ? await analisarImagem(midiaDecriptografada.buffer, midiaDecriptografada.mimetype || 'image/jpeg', openaiApiKey)
      : null;
    if (resultadoVisao) {
      // [AUDITORIA] FIX APLICADO (Sprint Vistoria de Gasto de IA, 2026-08-14): mesmo fix do
      // bloco de áudio acima — este fallback local também paga Vision de verdade.
      await registrarUsoIA(pool, {
        userId: userIdFinal, providerSlug: 'openai', modelo: 'gpt-4o-mini',
        tokensEntrada: resultadoVisao.tokensEntrada, tokensSaida: resultadoVisao.tokensSaida,
        custoUsd: estimarCustoUsd('gpt-4o-mini', resultadoVisao.tokensEntrada, resultadoVisao.tokensSaida),
      });
    }
    textoFinal = resultadoVisao?.descricao || entrada.texto || '[imagem]';
    log.info('ENGINE', 'Imagem analisada via fallback local (webhook.ts não havia processado)');
  }
  if (!textoFinal) return;

  // 6. Configuração unificada — fonte única: agentes (Sprint 1 do plano em
  // diagnosticos/PLANO_MOTOR_MULTIAGENTE_ECONOMIA_TOKEN.md, spec completa em
  // diagnosticos/SPRINT_UNIFICAR_CONFIGURACAO_AGENTE_IA.md). `agente` já foi carregado com
  // `SELECT *` lá em cima (linha ~506) — os campos que antes vinham de uma segunda query em
  // `agent_configs` (prompt_sistema, sinal_pausa, saudacao_inicial, etc.) agora vivem na mesma
  // linha. `agent_configs` deixa de ser lida/escrita a partir desta sprint — a tabela continua
  // existindo fisicamente (não foi apagada), só não é mais consultada por nenhum código.

  // [AUDITORIA] BUG (achado 2026-07-28, reportado pelo usuário — cliente novo com IA
  // respondendo e usando o prompt configurado pra OUTRO cliente já existente): antes, sem
  // `agent_configs.prompt_sistema` nem `agent_prompts` real, o motor caía num prompt genérico
  // hardcoded ("Você é um assistente prestativo.") e RESPONDIA mesmo assim — violando a regra
  // "a IA não pode responder sem antes estar configurada". [AUDITORIA] FIX APLICADO (preservado
  // na unificação): prompt do sistema só é considerado "real" com conteúdo genuíno vindo de
  // `agentes.prompt_sistema`/`agent_prompts` — sem isso, a IA NÃO responde (mesmo comportamento
  // de "agente não encontrado" já usado linhas acima), em vez de silenciosamente assumir uma
  // persona genérica que não é a do cliente. Esse guard-rail é o motivo pelo qual a migração de
  // dados desta sprint NUNCA cria automaticamente uma linha `agentes` com prompt vazio pra uma
  // conta que tinha prompt real em `agent_configs` — ver script de migração e AUDITORIA_LOG.md.
  // Prompt do sistema: usa agentes.prompt_sistema como fonte principal.
  // Fallback para agent_prompts apenas para compatibilidade com contas ainda não migradas.
  let systemPromptBase: string | null = null;
  if (agente.prompt_sistema) {
    systemPromptBase = agente.prompt_sistema;
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

  const nomeAgente = agente.nome || 'Assistente';
  const sinalPausa = agente.sinal_pausa || '251213';

  // MCP tools habilitadas por agente (Aba Motor, Agentes.tsx) — `agente.mcp_tools` é
  // TEXT[] | null. null/ausente = todas habilitadas (comportamento anterior, sem regressão pra
  // quem nunca mexeu nessa aba); array (mesmo vazio) = filtro explícito pelos ids salvos.
  const mcpToolsHabilitadas = agente.mcp_tools == null
    ? MCP_TOOLS
    : MCP_TOOLS.filter(t => (agente.mcp_tools as string[]).includes(t.name));

  // [AUDITORIA] LÓGICA (Sprint Nome Real de Leads de Grupo, cont., 2026-08-27 — pedido explícito
  // do usuário, confirmado antes de implementar: "sim, implementar" pra TODAS as contas, não só
  // leads de grupo): instrução genérica, injetada pelo motor — não depende do operador editar o
  // próprio `prompt_sistema` customizado pra funcionar em nenhuma conta. Só entra quando (1) a
  // ferramenta `criar_ou_atualizar_contato` está de fato habilitada pra este agente (senão a IA
  // tentaria chamar uma tool que não existe pra ela) e (2) o contato ainda não tem nome real
  // conhecido — `nome_verificado !== true` E `nome` ainda é literalmente o telefone (mesmo sinal
  // já usado em `Disparos.tsx`/`substituirPlaceholders`; evita perguntar de novo pra quem já tem
  // nome curado no CRM mas nunca passou pela cadeia nova, `nome_verificado` ainda NULL). Fica
  // como orientação de tom ("num momento natural", "sem parecer formulário") de propósito — o
  // objetivo é continuar a conversa, não virar uma pergunta robótica logo de cara.
  const nomeAindaEhPlaceholder = contato.nome === entrada.telefone || contato.nome.replace(/\D/g, '') === entrada.telefone.replace(/\D/g, '').slice(-11);
  const devePedirNome = nomeAindaEhPlaceholder && contato.nome_verificado !== true
    && mcpToolsHabilitadas.some(t => t.name === 'criar_ou_atualizar_contato');
  // [AUDITORIA] LÓGICA: esta instrução é reavaliada a CADA mensagem recebida (mesma conta,
  // mesmo contato) até `nome_verificado` virar `true` — sem o aviso explícito de não repetir, o
  // risco real é a IA perguntar o nome de novo a cada turno enquanto a pessoa não responde com o
  // nome especificamente (ex: só respondeu a pergunta de negócio e ignorou a pergunta do nome),
  // o que seria pior que nunca ter perguntado. O histórico (`historico`, mensagens anteriores já
  // enviadas ao modelo) é a única forma da IA saber que já perguntou — instrução aponta isso
  // explicitamente em vez de confiar que o modelo vai inferir sozinho.
  const instrucaoNome = devePedirNome
    ? `\n\nVocê ainda não sabe o nome verdadeiro desta pessoa (o CRM só tem o número de telefone). ` +
      `Em algum momento natural da conversa — sem parecer formulário nem interromper o assunto — pergunte o nome dela, ` +
      `UMA ÚNICA VEZ. Confira o histórico da conversa: se você já perguntou o nome antes e ela não respondeu ainda, ` +
      `NÃO pergunte de novo — só volte a perguntar se um bom tempo depois surgir uma deixa natural. ` +
      `Assim que ela responder com o nome, chame a ferramenta criar_ou_atualizar_contato com o nome (mesmo telefone, campo nome preenchido).`
    : '';

  const systemPrompt = systemPromptBase +
    `\n\nData/hora atual: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` +
    instrucaoNome;

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
  const modelo = providerInfo?.modelo || agente.modelo || 'gpt-4o-mini';
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
        () => provider.complete(mensagens, systemPrompt, mcpToolsHabilitadas, {
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
      // Defesa em profundidade: a tool já não é oferecida no `provider.complete()` acima quando
      // desabilitada em `agente.mcp_tools`, então isto só dispara se o modelo tentar chamar algo
      // fora da lista oferecida (ex: nome reaproveitado de uma mensagem antiga do histórico).
      if (!mcpToolsHabilitadas.some(t => t.name === tc.name)) {
        log.warn('ENGINE', 'Tool chamada pelo modelo mas desabilitada pra este agente — ignorando', { nome: tc.name, userId: userIdFinal });
        toolResults.push({ role: 'user', content: `[Resultado de ${tc.name}]: ferramenta não disponível.` });
        continue;
      }
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
    // (agentes.resposta_voz_habilitada + voice_id) e só é tentada quando a
    // mensagem RECEBIDA do cliente foi um áudio (espelha o canal — critério simples e seguro
    // sugerido pelo usuário). Fora dessas condições, comportamento 100% idêntico ao anterior
    // (texto em pedaços, sem nenhuma mudança pra tenants sem a flag ativada).
    const deveResponderEmVoz =
      agente.resposta_voz_habilitada === true &&
      !!agente.voice_id &&
      entrada.tipo === 'audio';

    let vozEnviada = false;
    if (deveResponderEmVoz) {
      const resultado = await enviarRespostaVoz(
        pool, userIdFinal,
        agente.evolution_server_url, agente.evolution_api_key,
        agente.evolution_instancia || entrada.instancia,
        entrada.telefone, respostaFinal, agente.voice_id,
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
    await registrarUsoIA(pool, {
      userId: userIdFinal, providerSlug, modelo, tokensEntrada, tokensSaida,
      custoUsd: estimarCustoUsd(modelo, tokensEntrada, tokensSaida),
    });
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
