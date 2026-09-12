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
import sharp from 'sharp';
import { Pool } from 'pg';
import { log } from '../logger';
import { withTenantContext } from '../db';

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
export interface ParticipanteGrupo {
  telefone: string;
  admin: 'admin' | 'superadmin' | null;
}

// [AUDITORIA] LÓGICA (Sprint Nome Real de Leads de Grupo, 2026-08-26 — pedido explícito do
// usuário: "preciso que ache uma forma de captar o nome ou pelo menos a tag do whatsapp"):
// `findGroupInfos` (usado por `buscarInfoGrupo` acima) nunca devolveu nome de participante —
// só `{ phoneNumber, admin }`. Testado ao vivo contra produção (leitura, grupo real, 4 grupos
// distintos, ~38 participantes) um segundo endpoint da Evolution API v2, não usado antes neste
// projeto: `GET /group/participants/{instance}?groupJid=X`. Confirmado que devolve um campo
// `name` a mais por participante (junto de `phoneNumber`/`admin`/`imgUrl`) — MAS cobertura real
// medida é baixa (11%-21% dos participantes, majoritariamente admins; membro comum quase sempre
// vem com `name: null`). Não substitui `findGroupInfos` (que devolve metadado do GRUPO em si —
// subject/pictureUrl/desc/size/creation, ausente na resposta deste endpoint, só
// `{ participants: [...] }`) — é uma chamada adicional, 1x por grupo (não por participante,
// então não escala mal em grupo grande), usada só para enriquecer nome quando disponível.
export interface ParticipanteComNome {
  telefone: string;
  nomeWhatsapp: string | null;
}

/**
 * Busca o `name` (quando a Evolution tiver resolvido) de cada participante de um grupo via
 * `GET /group/participants`. Falha suave: qualquer erro (endpoint ausente nesta versão da
 * Evolution, instância desconectada, timeout) devolve mapa vazio — nunca derruba o fluxo de
 * quem chama (importação/exportação já funcionam sem isso, esta é só uma camada extra).
 */
export async function buscarNomesParticipantesGrupo(
  evoUrl: string, apiKey: string, instancia: string, groupJid: string,
): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const url = `${evoUrl.replace(/\/$/, '')}/group/participants/${instancia}?groupJid=${encodeURIComponent(groupJid)}`;
      const r = await fetch(url, { headers: { apikey: apiKey }, signal: controller.signal });
      if (!r.ok) {
        log.warn('WA_GROUP_NOMES', 'Evolution retornou erro em group/participants', { instancia, groupJid, status: r.status });
        return mapa;
      }
      const d: any = await r.json().catch(() => ({}));
      const participantes: any[] = Array.isArray(d?.participants) ? d.participants : [];
      for (const p of participantes) {
        const nome = typeof p?.name === 'string' ? p.name.trim() : '';
        const telefone = typeof p?.phoneNumber === 'string' ? p.phoneNumber.split('@')[0].replace(/\D/g, '') : '';
        if (nome && telefone) mapa.set(telefone, nome);
      }
      return mapa;
    } finally {
      clearTimeout(timer);
    }
  } catch (err: any) {
    log.warn('WA_GROUP_NOMES', 'Falha ao buscar nomes de participantes (não crítico)', { groupJid, err: err?.message });
    return mapa;
  }
}

// [AUDITORIA] LÓGICA (Sprint Nome Real de Leads de Grupo, cont., 2026-08-26 — pedido explícito
// do usuário: "vamos ver a melhor forma de resolver isso"): `POST /chat/fetchProfile` já existia
// na Evolution (usado só por `sincronizarFotoPerfil`, whatsapp.ts, pra foto — nunca pro nome).
// Testado ao vivo contra produção pra este fim específico: 22/28 participantes reais (~78-79%)
// devolveram `name` preenchido, muito acima de `buscarNomesParticipantesGrupo` (~11-21%). Custo:
// 1 chamada HTTP por TELEFONE (não por grupo) — quem chama esta função é responsável pelo
// espaçamento entre chamadas (ver `resolverNomesEmBackground`, routes/whatsapp.ts, que usa o
// mesmo delay anti-ban do perfil "Rápido" dos Disparos); esta função não faz retry nem fila,
// só a chamada individual com timeout curto.
export async function buscarNomeViaFetchProfile(
  evoUrl: string, apiKey: string, instancia: string, telefone: string,
): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const url = `${evoUrl.replace(/\/$/, '')}/chat/fetchProfile/${instancia}`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { apikey: apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: telefone }),
        signal: controller.signal,
      });
      if (!r.ok) return null;
      const d: any = await r.json().catch(() => ({}));
      const nome = typeof d?.name === 'string' ? d.name.trim() : '';
      return nome || null;
    } finally {
      clearTimeout(timer);
    }
  } catch (err: any) {
    log.warn('WA_FETCH_PROFILE', 'Falha ao buscar perfil individual (não crítico)', { telefone, err: err?.message });
    return null;
  }
}

export interface InfoGrupo {
  subject: string | null;
  pictureUrl: string | null;
  // [AUDITORIA] LÓGICA (achado 2026-08-04 — pedido de importar contatos de grupo): a mesma
  // resposta de `findGroupInfos` já trazia `desc`/`size`/`creation`/`participants` e tudo isso
  // era descartado — só `subject`/`pictureUrl` chegavam a ser lidos. Nenhuma chamada nova à
  // Evolution, só aproveitar o que já vinha.
  desc: string | null;
  size: number | null;
  creation: number | null; // unix timestamp (segundos), como a Evolution devolve
  participantes: ParticipanteGrupo[];
  // [AUDITORIA] LÓGICA (achado real do usuário, 2026-08-27 — "tentei importar um grupo e não
  // consegui"): a mensagem genérica de falha ("Evolution não retornou participantes") não
  // distinguia "instância perdeu acesso a ESTE grupo" (bem comum — alguém removeu o número do
  // grupo, `Error: forbidden` da Evolution) de qualquer outro erro. Motivo real fica aqui,
  // opcional (null quando a chamada funcionou), pra quem chama montar uma mensagem que diz o
  // porquê em vez de só "não deu certo".
  erro: 'sem_acesso' | 'outro' | null;
}

export async function buscarInfoGrupo(
  evoUrl: string, apiKey: string, instancia: string, groupJid: string,
): Promise<InfoGrupo> {
  const vazio: InfoGrupo = { subject: null, pictureUrl: null, desc: null, size: null, creation: null, participantes: [], erro: null };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const url = `${evoUrl.replace(/\/$/, '')}/group/findGroupInfos/${instancia}?groupJid=${encodeURIComponent(groupJid)}`;
      const r = await fetch(url, { headers: { apikey: apiKey }, signal: controller.signal });
      // [AUDITORIA] BUG (achado real, `SPRINT_GRUPOS_IMPORTACAO_FALHANDO_E_LINK_PREVIEW.md`):
      // resposta não-ok da Evolution era engolida em silêncio (retornava objeto vazio sem log
      // nenhum) — o sintoma pro usuário virava "Evolution não retornou nada sobre grupos", sem
      // nenhuma pista de POR QUE (instância errada pro grupo? instância desconectada? grupo
      // realmente não existe?). [AUDITORIA] FIX APLICADO: loga status + corpo da resposta antes
      // de devolver vazio — próxima vez que isso acontecer, dá pra diagnosticar sem reabrir
      // investigação do zero.
      if (!r.ok) {
        const corpoErro = await r.text().catch(() => '');
        log.warn('WA_GROUP_INFO', 'Evolution retornou erro ao buscar info do grupo', { instancia, groupJid, status: r.status, corpoErro: corpoErro.slice(0, 300) });
        // [AUDITORIA] LÓGICA: `Error: forbidden` no corpo é o padrão já confirmado (real, ao vivo)
        // pra "esta instância não é mais membro deste grupo" — não é erro de rede nem bug, é
        // estado real do WhatsApp (alguém removeu o número do grupo). Reconectar/logar de novo
        // não resolve; só voltar a ser adicionado ao grupo por quem administra ele.
        return { ...vazio, erro: corpoErro.includes('forbidden') ? 'sem_acesso' : 'outro' };
      }
      const d: any = await r.json().catch(() => ({}));
      // [AUDITORIA] LÓGICA (corrigido após teste real em homolog, 2026-08-04): cada participante
      // vem como `{ id, phoneNumber?, admin }` — `id` é sempre um `@lid` (Linked ID interno da
      // Evolution/WhatsApp), NUNCA um telefone de verdade. `phoneNumber` é o número real
      // (`@s.whatsapp.net`), mas só vem preenchido quando o WhatsApp já resolveu aquele lid pra
      // um contato conhecido — em grupos com "Linked ID"/privacidade ativa, a MAIORIA dos
      // participantes não tem `phoneNumber` nenhum (confirmado num grupo real de teste: de 79
      // participantes, só o admin tinha `phoneNumber` — os outros 78 só tinham `id`/lid). A
      // primeira versão desta função caía pros dígitos do `id` quando `phoneNumber` faltava —
      // ERRADO: isso importava o lid como se fosse telefone (número que não existe de verdade,
      // não dá pra mandar mensagem nenhuma pra ele). [AUDITORIA] FIX APLICADO: só inclui
      // participante que tenha `phoneNumber` genuíno — sem fallback pro `id`. Reduz quantos
      // participantes ficam disponíveis pra importar em grupos com essa privacidade ativa, mas
      // importar um "telefone" que na verdade é um lid seria pior (contato fantasma,
      // inutilizável, poluindo a base). `admin` vem `null` (membro comum), `"admin"` ou
      // `"superadmin"`.
      const participantes: ParticipanteGrupo[] = Array.isArray(d?.participants)
        ? d.participants
            .filter((p: any) => typeof p?.phoneNumber === 'string' && p.phoneNumber)
            .map((p: any) => ({
              telefone: p.phoneNumber.split('@')[0].replace(/\D/g, ''),
              admin: (p?.admin === 'admin' || p?.admin === 'superadmin') ? p.admin : null,
            }))
            .filter((p: ParticipanteGrupo) => p.telefone.length >= 8)
        : [];
      return {
        subject: (typeof d?.subject === 'string' && d.subject.trim()) ? d.subject.trim() : null,
        pictureUrl: d?.pictureUrl || null,
        desc: (typeof d?.desc === 'string' && d.desc.trim()) ? d.desc.trim() : null,
        size: typeof d?.size === 'number' ? d.size : (participantes.length || null),
        creation: typeof d?.creation === 'number' ? d.creation : null,
        participantes,
        erro: null,
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (err: any) {
    log.warn('WA_GROUP', 'Falha ao buscar info do grupo', { groupJid, err: err?.message });
    return vazio;
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
// Subdiretório exclusivo de `gerarVariacaoImagem()` (ver comentário completo lá) — separado do
// resto de `UPLOADS_DIR` de propósito, pra `limparVariantesExpiradas()` poder varrer por idade
// sem risco nenhum de apagar mídia estável/real (nada mais escreve aqui).
const VARIANTES_DIR = path.join(UPLOADS_DIR, 'variantes');
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

// [AUDITORIA] LÓGICA (Sprint Variação de Imagem, 2026-08-25, pedido do usuário — anti-
// fingerprint): campanha de imagem mandava o MESMO arquivo (mesmo hash) pra todo destinatário —
// `disparoProcessor.ts` cacheia `garantirMidiaEstavel()` uma vez por campanha inteira (ver
// comentário acima) e reaproveita a URL pra todo mundo, de propósito (evita rebaixar o link
// externo centenas de vezes). Sinal de spam real que a Meta/WhatsApp pode usar pra bloquear em
// campanhas grandes. Duas abordagens possíveis: regenerar a imagem de verdade via IA (caro, lento
// — cada chamada custaria segundos + tokens, empilhado em cima do delay anti-ban já existente
// entre mensagens) ou uma perturbação leve que só muda o HASH do arquivo sem mudar o que o
// destinatário vê (instantâneo, sem custo de API). Implementado a segunda — a primeira fica
// documentada como evolução futura, não implementada agora (decisão de custo/latência, não
// técnica). `sharp` (já padrão de mercado em Node pra isso, leve, binário nativo pré-compilado —
// funciona tanto no build local quanto dentro do container Alpine via `npm ci`, testado).

/**
 * Gera uma variação de imagem com hash diferente do original mas visualmente idêntica (perturbação
 * de brilho/saturação em <1%, imperceptível ao olho humano) — usada POR MENSAGEM em campanhas de
 * imagem com "Variar imagem a cada envio" ligado (StepMessage/Disparos.tsx), ao contrário de
 * `garantirMidiaEstavel()` que roda uma vez por campanha. Nunca lança e nunca bloqueia o envio:
 * qualquer falha (arquivo não encontrado, formato não suportado pelo sharp, timeout) devolve a
 * URL ORIGINAL inalterada — mesma filosofia de fallback de todo o resto deste arquivo.
 */
export async function gerarVariacaoImagem(urlEstavel: string): Promise<string> {
  try {
    const url = new URL(urlEstavel);
    if (url.hostname !== new URL(API_BASE_URL).hostname || !url.pathname.startsWith('/uploads/')) {
      return urlEstavel; // não é um arquivo nosso (ainda não passou por garantirMidiaEstavel) — nada a variar
    }
    const fileName = path.basename(url.pathname);
    const ext = path.extname(fileName).replace('.', '').toLowerCase();
    if (!['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return urlEstavel; // gif/outros — sharp reencodaria e poderia perder animação

    const buf = await fs.readFile(path.join(UPLOADS_DIR, fileName));
    const hashOriginal = crypto.createHash('sha256').update(buf).digest('hex');

    // [AUDITORIA] BUG CORRIGIDO (achado em teste real desta sprint, ANTES de deployar — não só
    // teórico): a 1ª versão desta função só variava `brightness` em ±1%. Testado com uma imagem
    // de cor sólida (caso real de banner/fundo liso, comum em peça de campanha) — o
    // reencode JPEG arredondava a perturbação de volta pro EXATO mesmo byte a byte em 2 de 5
    // tentativas (quantização absorve variação pequena demais numa imagem sem textura),
    // derrotando o propósito inteiro (hash igual ao anterior). [AUDITORIA] FIX APLICADO: 2 eixos
    // de perturbação combinados (brilho ±3% + qualidade de reencode aleatória, que já é
    // suficiente pra imagem real com textura/gradiente) + um retry com verificação de hash real
    // (compara byte a byte contra o original, nunca confia que "deveria" ter mudado) — se ainda
    // colidir depois de 3 tentativas com perturbação crescente, força uma composição de 1 pixel
    // de opacidade baixíssima num canto aleatório (garante mudança de byte determinística,
    // imperceptível em qualquer imagem de tamanho normal de campanha).
    let variado: Buffer = buf;
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      const forca = 0.03 + tentativa * 0.03; // 3%, 6%, 9% — cresce se as tentativas anteriores colidirem
      const brilho = 1 + (Math.random() * 2 - 1) * forca;
      let pipeline = sharp(buf).modulate({ brightness: brilho });
      if (ext === 'png') {
        pipeline = pipeline.png({ compressionLevel: Math.floor(Math.random() * 9) }); // lossless — não muda pixel, só bytes
      } else if (ext === 'webp') {
        pipeline = pipeline.webp({ quality: 85 + Math.floor(Math.random() * 13) });
      } else {
        pipeline = pipeline.jpeg({ quality: 85 + Math.floor(Math.random() * 13) });
      }
      variado = await pipeline.toBuffer();
      const hashVariado = crypto.createHash('sha256').update(variado).digest('hex');
      if (hashVariado !== hashOriginal) break;
      log.warn('WA_MEDIA_OUT', 'Variação de imagem colidiu com o hash original — tentando de novo com perturbação maior', { tentativa, urlEstavel: urlEstavel.slice(0, 100) });
    }
    // Último recurso determinístico: composita 1 pixel de opacidade baixíssima num canto
    // aleatório — muda o byte final garantido, mesmo pro pior caso (imagem de cor 100% sólida
    // onde nenhuma reamostragem de qualidade produz diferença).
    if (crypto.createHash('sha256').update(variado).digest('hex') === hashOriginal) {
      const meta = await sharp(buf).metadata();
      const x = Math.floor(Math.random() * Math.max(1, (meta.width || 10) - 1));
      const y = Math.floor(Math.random() * Math.max(1, (meta.height || 10) - 1));
      const pixel = await sharp({ create: { width: 1, height: 1, channels: 4, background: { r: Math.floor(Math.random() * 255), g: Math.floor(Math.random() * 255), b: Math.floor(Math.random() * 255), alpha: 0.02 } } }).png().toBuffer();
      variado = await sharp(buf).composite([{ input: pixel, left: x, top: y }]).toFormat(ext === 'jpg' ? 'jpeg' : (ext as any)).toBuffer();
    }

    // [AUDITORIA] BUG CORRIGIDO (achado 2026-09-04, revisão pós-Sprint Grupos/Template): esta
    // função grava um arquivo NOVO por MENSAGEM (não por campanha) quando `variar_imagem` está
    // ligado — uma campanha de milhares de destinatários acumula milhares de arquivos aqui, e
    // NENHUM lugar do projeto os apaga depois (a limpeza existente, `limparMidiaExpirada` acima,
    // só cobre mídia RECEBIDA, rastreada em `whatsapp_messages.media_url`; variação de saída
    // nunca vira linha de banco nenhuma, então não tinha como aquele mecanismo pegar isso). Numa
    // VPS que já teve incidente de disco cheio derrubando o Postgres compartilhado (mesmo disco),
    // isso era um vazamento de disco silencioso e sem teto. [AUDITORIA] FIX APLICADO: variações
    // agora gravam num subdiretório PRÓPRIO (`VARIANTES_DIR`, dentro do mesmo `UPLOADS_DIR`
    // público — a URL continua servida por `express.static`, só muda o caminho) usado
    // EXCLUSIVAMENTE por esta função; `limparVariantesExpiradas()` (abaixo, agendada em cron.ts)
    // varre esse diretório por idade de arquivo — seguro por construção, sem precisar de tabela
    // nova: nada mais escreve nele, e o arquivo é descartável assim que a Evolution já buscou a
    // URL pra entregar a mensagem (janela de retenção generosa cobre qualquer retry lento).
    const novoNome = `${crypto.randomUUID()}.${ext}`;
    await fs.mkdir(VARIANTES_DIR, { recursive: true });
    await fs.writeFile(path.join(VARIANTES_DIR, novoNome), variado);
    return `${API_BASE_URL}/uploads/variantes/${novoNome}`;
  } catch (err: any) {
    log.warn('WA_MEDIA_OUT', 'Falha ao gerar variação de imagem — mantendo arquivo original', { err: err?.message, urlEstavel: urlEstavel.slice(0, 100) });
    return urlEstavel;
  }
}

// ── Retenção/limpeza de mídia recebida ────────────────────────────────────────
// [AUDITORIA] BUG (achado real, Sprint Limpeza de Disco, 2026-08-23): `salvarMidiaWhatsapp()`
// acima grava em disco (`WHATSAPP_MEDIA_DIR/userId/messageId.ext`) mas NUNCA existiu nenhuma
// rotina que apagasse esses arquivos depois — todo áudio/imagem/vídeo recebido desde sempre
// fica em disco pra sempre. Confirmado com dado real da VPS: 17.543 arquivos, 9GB, 1 mês de
// tráfego (23/07 a 23/08) — crescendo ~9GB/mês sem limite, na mesma VPS que já teve 2 incidentes
// de disco cheio derrubando o Postgres compartilhado (ver AUDITORIA_LOG.md). Não é o mesmo bug
// do desperdício de token em mídia de grupo (webhook.ts, 2026-08-14) — aquele fix impede a
// OpenAI de ser chamada, mas o arquivo em si continua sendo baixado e salvo de qualquer forma
// (a mensagem precisa do arquivo pra aparecer no chat, com ou sem IA processando).
// [AUDITORIA] FIX APLICADO: retenção configurável (dias), rodada pelo cron semanal de LGPD já
// existente (`cron.ts`) — encontra mensagens com `media_url` local mais velhas que N dias,
// apaga o arquivo do disco e limpa `media_url`/`media_mimetype` no banco (a MENSAGEM em si
// nunca é apagada, só o anexo — mesmo espírito do soft-delete já usado em `whatsapp_messages`).
// Frontend já degrada bem pra isso: áudio sem `media_url` mostra um rótulo "Áudio" no lugar do
// player; imagem/vídeo/documento sem `media_url` simplesmente não renderizam o bloco de mídia
// (nenhum dos dois quebra a tela). `profile-pics/` fica de fora de propósito — é uma foto por
// CONTATO (sobrescrita a cada refresh, não uma por mensagem), não cresce sem limite do mesmo
// jeito e cache dela é pequeno/útil manter.
export interface ResultadoLimpezaMidia {
  arquivosRemovidos: number;
  bytesLiberados: number;
  mensagensAtualizadas: number;
}

export async function limparMidiaExpirada(pool: Pool, diasRetencao: number): Promise<ResultadoLimpezaMidia> {
  // Lote por rodada — evita segurar uma transação/lock gigante numa base com backlog grande
  // (primeira rodada real desta feature tem ~17k arquivos acumulados). Rodadas seguintes
  // (semanais) processam só o incremento da semana, bem abaixo do lote.
  const LOTE = 5000;

  // [AUDITORIA] LÓGICA: withTenantContext({isAdmin:true}) — mesmo motivo já documentado no
  // expurgo de whatsapp_messages do cron semanal (piloto de RLS só em homolog): sem bypass, a
  // query cross-tenant (job de sistema, não uma requisição de usuário) ficaria invisível pro
  // RLS lá, mesmo as linhas existindo de verdade.
  const candidatos = await withTenantContext({ isAdmin: true }, client => client.query(
    `SELECT id, media_url FROM whatsapp_messages
     WHERE media_url LIKE 'local://%'
       AND created_at < NOW() - ($1 || ' days')::interval
     LIMIT $2`,
    [diasRetencao, LOTE]
  )).catch((err: any) => {
    log.error('WA_MEDIA', 'Falha ao buscar mídia expirada para limpeza', { err: err?.message });
    return { rows: [] as any[] };
  });

  let arquivosRemovidos = 0;
  let bytesLiberados = 0;
  const idsParaLimpar: string[] = [];

  for (const row of candidatos.rows) {
    const resolvido = resolverCaminhoLocal(row.media_url);
    if (!resolvido) continue;
    try {
      const stat = await fs.stat(resolvido.caminho);
      await fs.unlink(resolvido.caminho);
      arquivosRemovidos++;
      bytesLiberados += stat.size;
      idsParaLimpar.push(row.id);
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        // Arquivo já não existe (removido manualmente, ou rodada anterior falhou no meio do
        // caminho) — ainda assim limpa a referência no banco, ela já está morta de qualquer forma.
        idsParaLimpar.push(row.id);
      } else {
        log.warn('WA_MEDIA', 'Falha ao remover arquivo de mídia expirada — mantendo referência no banco', { id: row.id, err: err?.message });
      }
    }
  }

  if (idsParaLimpar.length) {
    await withTenantContext({ isAdmin: true }, client => client.query(
      `UPDATE whatsapp_messages SET media_url = NULL, media_mimetype = NULL, updated_at = NOW()
       WHERE id = ANY($1::uuid[])`,
      [idsParaLimpar]
    )).catch((err: any) => log.error('WA_MEDIA', 'Falha ao limpar media_url expirado no banco', { err: err?.message }));
  }

  return { arquivosRemovidos, bytesLiberados, mensagensAtualizadas: idsParaLimpar.length };
}

// [AUDITORIA] LÓGICA (Sprint Grupos/Template, 2026-09-04 — ver comentário completo em
// `gerarVariacaoImagem()`): limpeza puramente por sistema de arquivos, sem tabela/query no banco
// — `VARIANTES_DIR` só recebe arquivo de uma função (`gerarVariacaoImagem`), então varrer por
// idade de modificação (`mtime`) é seguro por construção, diferente de `limparMidiaExpirada`
// acima (que precisa da referência em `whatsapp_messages` porque `UPLOADS_DIR` tem mídia real
// misturada). Retenção default bem mais curta que a de mídia recebida (30 dias): o arquivo é
// descartável assim que a Evolution buscou a URL pra entregar a mensagem, então algumas horas já
// é folga generosa.
export async function limparVariantesExpiradas(horasRetencao: number): Promise<{ arquivosRemovidos: number; bytesLiberados: number }> {
  let arquivosRemovidos = 0;
  let bytesLiberados = 0;
  let nomes: string[];
  try {
    nomes = await fs.readdir(VARIANTES_DIR);
  } catch (err: any) {
    if (err?.code === 'ENOENT') return { arquivosRemovidos: 0, bytesLiberados: 0 }; // diretório nunca criado — nenhuma variação gerada ainda
    log.error('WA_MEDIA_OUT', 'Falha ao listar VARIANTES_DIR para limpeza', { err: err?.message });
    return { arquivosRemovidos: 0, bytesLiberados: 0 };
  }

  const limiteMs = Date.now() - horasRetencao * 60 * 60 * 1000;
  for (const nome of nomes) {
    const caminho = path.join(VARIANTES_DIR, nome);
    try {
      const stat = await fs.stat(caminho);
      if (stat.mtimeMs > limiteMs) continue; // ainda dentro da janela de retenção
      await fs.unlink(caminho);
      arquivosRemovidos++;
      bytesLiberados += stat.size;
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        log.warn('WA_MEDIA_OUT', 'Falha ao remover variação de imagem expirada', { nome, err: err?.message });
      }
    }
  }
  return { arquivosRemovidos, bytesLiberados };
}
