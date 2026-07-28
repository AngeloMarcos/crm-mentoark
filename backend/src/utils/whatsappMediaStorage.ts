/**
 * whatsappMediaStorage.ts — decriptografa e persiste mídia recebida do WhatsApp.
 *
 * [AUDITORIA] LÓGICA: o `media_url` que a Evolution manda no webhook (imageMessage.url,
 * audioMessage.url, etc.) é a URL crua do CDN do WhatsApp (mmg.whatsapp.net/.../*.enc) —
 * sempre CRIPTOGRAFADA. Baixar direto (como o proxy /api/whatsapp/media fazia até agora)
 * traz bytes cifrados, não o arquivo real — por isso áudio não tocava, imagem não abria,
 * figurinha não renderizava (ver diagnosticos/AUDITORIA_LOG.md, achado do caso Stefano).
 * A Evolution tem acesso às chaves da sessão e sabe decriptografar server-side via
 * POST /chat/getBase64FromMediaMessage/:instance — testado manualmente com áudio real antes
 * de implementar isto (base64 retornado começava com o header válido "OggS").
 *
 * Armazenamento: diretório PRIVADO, fora de UPLOADS_DIR (que é servido publicamente sem
 * autenticação via express.static em index.ts — mídia de WhatsApp de cliente real não pode
 * cair lá). Servido de volta só através da rota autenticada /api/whatsapp/media, que confere
 * ownership antes de entregar o arquivo (ver whatsapp.ts).
 */
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { log } from '../logger';

const WHATSAPP_MEDIA_DIR = process.env.WHATSAPP_MEDIA_DIR || '/app/wa-media';
const MAX_MEDIA_BYTES = 50 * 1024 * 1024; // 50MB — mesmo teto já usado pra payload JSON (ver index.ts)
const DECRYPT_TIMEOUT_MS = 20000; // base64 de vídeo pode ser grande, decrypt na Evolution não é instantâneo

const EXT_POR_MIME: Record<string, string> = {
  'audio/ogg': 'oga',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'application/pdf': 'pdf',
};

// [AUDITORIA] LÓGICA: exportada (achado 2026-07-28) pra ser reaproveitada por
// `POST /api/whatsapp/upload-media` (whatsapp.ts) — mesma necessidade de resolver uma extensão
// de arquivo válida a partir de nome/mimetype/categoria, sem duplicar a lógica.
export function extensaoParaArquivo(fileName: string | undefined, mimetype: string | undefined, tipo: string): string {
  if (fileName && fileName.includes('.')) {
    const ext = fileName.split('.').pop();
    if (ext && /^[a-zA-Z0-9]{1,8}$/.test(ext)) return ext.toLowerCase();
  }
  const mimeBase = (mimetype || '').split(';')[0].trim().toLowerCase();
  if (EXT_POR_MIME[mimeBase]) return EXT_POR_MIME[mimeBase];
  const porTipo: Record<string, string> = { audio: 'oga', image: 'jpg', video: 'mp4', document: 'bin', sticker: 'webp' };
  return porTipo[tipo] || 'bin';
}

export interface SalvarMidiaOpts {
  evoUrl: string;
  apiKey: string;
  instancia: string;
  messageId: string;
  remoteJid: string;
  fromMe: boolean;
  userId: string;
  tipo: string;
  mimetypeHint?: string;
  fileNameHint?: string;
}

export interface BaixarMidiaOpts {
  evoUrl: string;
  apiKey: string;
  instancia: string;
  messageId: string;
  remoteJid: string;
  fromMe: boolean;
}

export interface MidiaDecriptografada {
  buffer: Buffer;
  mimetype?: string;
  fileName?: string;
}

/**
 * Decriptografa a mídia de uma mensagem via Evolution (`POST /chat/getBase64FromMediaMessage`)
 * e devolve os bytes reais em memória — sem tocar disco. Extraído de `salvarMidiaWhatsapp()`
 * (que usa esta função e depois persiste em arquivo) para ser reaproveitado por qualquer
 * consumidor que só precise dos bytes (ex: transcrição de áudio via Whisper, que nunca deveria
 * receber a URL crua/criptografada — ver cabeçalho do arquivo). Retorna `null` em qualquer
 * falha, mesma filosofia de fallback do resto deste arquivo.
 */
export async function baixarMidiaDecriptografada(opts: BaixarMidiaOpts): Promise<MidiaDecriptografada | null> {
  const { evoUrl, apiKey, instancia, messageId, remoteJid, fromMe } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DECRYPT_TIMEOUT_MS);
  try {
    const base = evoUrl.replace(/\/$/, '');
    const res = await fetch(`${base}/chat/getBase64FromMediaMessage/${instancia}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: apiKey },
      body: JSON.stringify({
        message: { key: { id: messageId, remoteJid, fromMe } },
        convertToMp4: false,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      log.warn('WA_MEDIA', 'Evolution recusou decrypt', { messageId, status: res.status });
      return null;
    }
    const data: any = await res.json().catch(() => null);
    const base64: string | undefined = data?.base64;
    if (!base64) {
      log.warn('WA_MEDIA', 'Evolution não retornou base64', { messageId });
      return null;
    }
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_MEDIA_BYTES) {
      log.warn('WA_MEDIA', 'Mídia vazia ou acima do limite', { messageId, bytes: buffer.byteLength });
      return null;
    }
    return { buffer, mimetype: data?.mimetype, fileName: data?.fileName };
  } catch (err: any) {
    log.warn('WA_MEDIA', 'Falha ao decriptografar mídia', { messageId, err: err?.message });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Decriptografa a mídia da mensagem via Evolution e salva em disco local privado.
 * Retorna a URL local (`local://...`, servida via /api/whatsapp/media) em caso de sucesso,
 * ou `null` em qualquer falha — chamador deve manter a `media_url` original (Evolution crua)
 * como fallback, nunca travar o fluxo de recebimento da mensagem por causa disso.
 */
export async function salvarMidiaWhatsapp(opts: SalvarMidiaOpts): Promise<string | null> {
  const { evoUrl, apiKey, instancia, messageId, remoteJid, fromMe, userId, tipo, mimetypeHint, fileNameHint } = opts;
  const decriptografada = await baixarMidiaDecriptografada({ evoUrl, apiKey, instancia, messageId, remoteJid, fromMe });
  if (!decriptografada) return null;

  try {
    const { buffer, mimetype, fileName: fileNameRemoto } = decriptografada;
    const ext = extensaoParaArquivo(fileNameRemoto || fileNameHint, mimetype || mimetypeHint, tipo);
    const dir = path.join(WHATSAPP_MEDIA_DIR, userId);
    await fs.mkdir(dir, { recursive: true });
    // messageId já é único por instância (constraint em whatsapp_messages) — nome de arquivo seguro,
    // sem depender de nada vindo do payload externo (fileName da Evolution não vira parte do path).
    const fileName = `${messageId}.${ext}`;
    await fs.writeFile(path.join(dir, fileName), buffer);

    log.info('WA_MEDIA', 'Mídia decriptografada e salva', { messageId, bytes: buffer.byteLength, ext });
    return `local://${userId}/${fileName}`;
  } catch (err: any) {
    log.warn('WA_MEDIA', 'Falha ao salvar mídia em disco', { messageId, err: err?.message });
    return null;
  }
}

/** Resolve o caminho absoluto em disco a partir de uma `media_url` no formato `local://userId/arquivo`. */
export function resolverCaminhoLocal(mediaUrl: string): { userId: string; caminho: string } | null {
  if (!mediaUrl.startsWith('local://')) return null;
  const resto = mediaUrl.slice('local://'.length);
  const barra = resto.indexOf('/');
  if (barra < 1) return null;
  const userId = resto.slice(0, barra);
  const fileName = resto.slice(barra + 1);
  // fileName é sempre `${messageId}.${ext}` gerado por nós (nunca por dado externo) — mesmo assim,
  // barra defensiva contra path traversal caso o valor armazenado seja adulterado por algum motivo.
  if (!fileName || fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) return null;
  return { userId, caminho: path.join(WHATSAPP_MEDIA_DIR, userId, fileName) };
}

// ── Fotos de perfil ──────────────────────────────────────────────────────────
// [AUDITORIA] LÓGICA (2026-07-23): mesma causa raiz da mídia de mensagem — a URL de foto de
// perfil que a Evolution devolve (fetchProfilePictureUrl) é a URL crua do CDN do WhatsApp
// (pps.whatsapp.net/...), com prazo de expiração (parâmetro `oe=` na própria URL). Guardar só
// a URL fazia as fotos "sumirem" silenciosamente semanas depois, sem nada re-buscar ou
// persistir os bytes de verdade (ver diagnosticos/AUDITORIA_LOG.md). Diferente da mídia de
// mensagem, essa URL NÃO é criptografada (.jpg puro, não .enc) — não precisa do endpoint de
// decrypt da Evolution, só um fetch HTTP direto.
const PROFILE_PIC_MAX_BYTES = 5 * 1024 * 1024; // fotos de perfil são pequenas; teto bem folgado

export async function salvarFotoPerfilLocal(picUrl: string, userId: string, telefoneDigits: string): Promise<string | null> {
  try {
    const res = await fetch(picUrl);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > PROFILE_PIC_MAX_BYTES) return null;

    const dir = path.join(WHATSAPP_MEDIA_DIR, 'profile-pics', userId);
    await fs.mkdir(dir, { recursive: true });
    const fileName = `${telefoneDigits}.jpg`;
    await fs.writeFile(path.join(dir, fileName), buf);
    return `local-pic://${userId}/${fileName}`;
  } catch (err: any) {
    log.warn('WA_MEDIA', 'Falha ao salvar foto de perfil', { telefoneDigits, err: err?.message });
    return null;
  }
}

// [AUDITORIA] BUG (achado 2026-07-28 — "quase todos os grupos aparecem como número, fotos de
// grupo nunca aparecem"): NENHUM lugar do sistema jamais buscava o nome/subject real de um
// grupo — `webhook.ts` usa `payload.data?.pushName` tanto pra contato individual quanto pra
// grupo, mas esse campo é sempre o pushName de quem MANDOU a mensagem (uma pessoa), nunca o
// nome do grupo; pra grupo, cai no fallback `senderPhone` (o telefone de quem mandou, não o
// grupo). Confirmado também que os 3 lugares que tocam nisso excluem grupo explicitamente:
// upsert de contato em `webhook.ts` (`if (!isGroup) {...}`, 2x), o JOIN da query
// `GET /conversas` (`AND NOT r.is_group`), e o botão "Sincronizar fotos de perfil"
// (`remote_jid NOT LIKE '%@g.us'`). Resultado: `whatsapp.ts` (`GET /conversas`) sempre
// sintetiza `Grupo ${últimos dígitos do JID}` como nome, e nunca tem foto — não é uma falha
// intermitente, é comportamento garantido pra 100% dos grupos, sempre. [AUDITORIA] FIX
// APLICADO: esta função busca nome (`subject`) e foto (`pictureUrl`) reais via
// `GET /group/findGroupInfos` (Evolution API v2 — confirmado documentação oficial e
// evolution-api#2124 no GitHub, que também documenta que uma minoria de grupos pode voltar
// sem subject/foto mesmo assim — tratado como falha suave abaixo, cai no fallback "Grupo
// XXXX" já existente, sem regressão). Usada tanto no webhook (achado orgânico a cada
// mensagem nova de grupo) quanto no botão de sincronização manual (backfill de grupos já
// existentes, sem precisar esperar mensagem nova).
export async function buscarInfoGrupo(
  evoUrl: string, apiKey: string, instancia: string, groupJid: string,
): Promise<{ subject: string | null; pictureUrl: string | null }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const url = `${evoUrl.replace(/\/$/, '')}/group/findGroupInfos/${instancia}?groupJid=${encodeURIComponent(groupJid)}`;
      const r = await fetch(url, { headers: { apikey: apiKey }, signal: controller.signal });
      if (!r.ok) return { subject: null, pictureUrl: null };
      const d: any = await r.json().catch(() => ({}));
      return {
        subject: (typeof d?.subject === 'string' && d.subject.trim()) ? d.subject.trim() : null,
        pictureUrl: d?.pictureUrl || null,
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (err: any) {
    log.warn('WA_GROUP', 'Falha ao buscar info do grupo', { groupJid, err: err?.message });
    return { subject: null, pictureUrl: null };
  }
}

/** Resolve o caminho absoluto em disco a partir de um marcador `local-pic://userId/arquivo`. */
export function resolverCaminhoLocalFoto(url: string): { userId: string; caminho: string } | null {
  if (!url.startsWith('local-pic://')) return null;
  const resto = url.slice('local-pic://'.length);
  const barra = resto.indexOf('/');
  if (barra < 1) return null;
  const userId = resto.slice(0, barra);
  const fileName = resto.slice(barra + 1);
  if (!fileName || fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) return null;
  return { userId, caminho: path.join(WHATSAPP_MEDIA_DIR, 'profile-pics', userId, fileName) };
}

// ── Mídia de SAÍDA (envio manual e campanhas) — persistência de link instável ────────────────
// [AUDITORIA] LÓGICA (Sprint 6, 2026-07-23): diferente da mídia de ENTRADA (funções acima,
// que sempre vêm da própria Evolution/WhatsApp), a mídia de SAÍDA passada em `mediaUrl` pro
// POST /send (whatsapp.ts) e pra `disparos.url_midia` (disparoProcessor.ts, campanhas em
// lote) pode ser qualquer URL externa — link de upload provisório, URL assinada com
// expiração, CDN de terceiro instável. Uma campanha que roda por vários dias reenvia o MESMO
// `url_midia` centenas de vezes; se o link original expirar no meio do caminho, todo envio
// subsequente falha silenciosamente (mídia não chega, só o Evolution retorna erro por
// mensagem). `garantirMidiaEstavel()` baixa esse link UMA VEZ e persiste em `UPLOADS_DIR`
// (público, já servido via `/uploads` em index.ts — mesmo storage já usado por
// catalogo.ts/galeria.ts/elevenlabs.ts, não um diretório novo), devolvendo uma URL própria e
// estável (`${API_BASE_URL}/uploads/...`) que nunca expira por conta própria. Idempotente na
// prática: se a URL já é do nosso próprio domínio/`/uploads/`, retorna sem re-baixar.
const UPLOADS_DIR = process.env.UPLOADS_DIR || '/app/uploads';
const API_BASE_URL = process.env.API_BASE_URL || 'https://api.mentoark.com.br';
// Mesmo teto de 5MB do POST /send (Sprint 6, item 2 — antiban/anti-OOM) — evita que este
// helper baixe (e segure em memória via arrayBuffer) um arquivo gigante só para descobrir
// depois que ele nunca deveria ter sido enviado.
export const MAX_OUTBOUND_MEDIA_BYTES = 5 * 1024 * 1024;
const DOWNLOAD_EXTERNO_TIMEOUT_MS = 15000;

const EXT_POR_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'audio/ogg': 'oga', 'audio/mpeg': 'mp3',
  'application/pdf': 'pdf',
};

function isUrlJaEstavel(url: string): boolean {
  try {
    const u = new URL(url);
    const apiHost = new URL(API_BASE_URL).hostname;
    return u.hostname === apiHost && u.pathname.startsWith('/uploads/');
  } catch {
    return false;
  }
}

/**
 * Garante que uma URL de mídia de SAÍDA seja estável (nosso próprio domínio, sem expiração).
 * Se já for `${API_BASE_URL}/uploads/...`, devolve sem mudar. Se for `http(s)://` externa,
 * baixa uma vez e persiste em UPLOADS_DIR, devolvendo a nova URL pública. Em qualquer falha
 * (download, tamanho acima do teto, URL não-http) devolve a URL ORIGINAL inalterada — nunca
 * bloqueia o envio por conta deste mecanismo, só deixa de blindar contra expiração futura
 * nesse caso específico (mesma filosofia de fallback de salvarMidiaWhatsapp()/
 * salvarFotoPerfilLocal() acima: mídia de saída não pode travar por causa de cache).
 */
export async function garantirMidiaEstavel(mediaUrl: string | null | undefined): Promise<string | null> {
  if (!mediaUrl) return mediaUrl ?? null;
  if (!/^https?:\/\//i.test(mediaUrl)) return mediaUrl; // data:, base64 cru, etc. — nada a cachear
  if (isUrlJaEstavel(mediaUrl)) return mediaUrl;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_EXTERNO_TIMEOUT_MS);
  try {
    const res = await fetch(mediaUrl, { signal: controller.signal });
    if (!res.ok) {
      log.warn('WA_MEDIA_OUT', 'Download da mídia de saída falhou — mantendo URL original', { status: res.status, mediaUrl: mediaUrl.slice(0, 100) });
      return mediaUrl;
    }
    const contentLengthHeader = res.headers.get('content-length');
    if (contentLengthHeader && Number(contentLengthHeader) > MAX_OUTBOUND_MEDIA_BYTES) {
      log.warn('WA_MEDIA_OUT', 'Mídia de saída acima do teto de 5MB (Content-Length) — não cacheada', { mediaUrl: mediaUrl.slice(0, 100) });
      return mediaUrl;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > MAX_OUTBOUND_MEDIA_BYTES) {
      log.warn('WA_MEDIA_OUT', 'Mídia de saída vazia ou acima do teto de 5MB (bytes reais) — não cacheada', { mediaUrl: mediaUrl.slice(0, 100), bytes: buf.byteLength });
      return mediaUrl;
    }

    const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const extPorPath = path.extname(new URL(mediaUrl).pathname).replace('.', '').toLowerCase();
    const ext = EXT_POR_CONTENT_TYPE[contentType] || (/^[a-z0-9]{1,8}$/.test(extPorPath) ? extPorPath : 'bin');

    await fs.mkdir(UPLOADS_DIR, { recursive: true });
    const fileName = `${crypto.randomUUID()}.${ext}`;
    await fs.writeFile(path.join(UPLOADS_DIR, fileName), buf);

    const urlEstavel = `${API_BASE_URL}/uploads/${fileName}`;
    log.info('WA_MEDIA_OUT', 'Mídia de saída persistida localmente — URL estável gerada', {
      origem: mediaUrl.slice(0, 100), urlEstavel, bytes: buf.byteLength,
    });
    return urlEstavel;
  } catch (err: any) {
    log.warn('WA_MEDIA_OUT', 'Falha ao cachear mídia de saída — mantendo URL original', { err: err?.message, mediaUrl: mediaUrl.slice(0, 100) });
    return mediaUrl;
  } finally {
    clearTimeout(timer);
  }
}
