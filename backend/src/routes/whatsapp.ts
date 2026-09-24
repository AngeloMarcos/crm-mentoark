/**
 * whatsapp.ts — Todas as rotas REST de WhatsApp usadas pelo frontend (montadas em /api/whatsapp).
 *
 * Cobre: listar/ler conversas e mensagens, enviar texto/mídia, pausar/reativar IA por contato,
 * conectar/desconectar instância na Evolution API (com QR code), sincronizar histórico, buscar
 * fotos de perfil, e registrar o webhook da instância na Evolution (registrarWebhook/webhookInner).
 * getEvolutionConfig()/saveEvolutionConfig() são a fonte de verdade da config Evolution (url,
 * api_key, instancia) usada por toda ação de saída — ver [AUDITORIA] BUG logo abaixo sobre a
 * relação dessas funções com a tabela `agentes` (config unificada, Sprint 1 — ver
 * diagnosticos/SPRINT_UNIFICAR_CONFIGURACAO_AGENTE_IA.md).
 */
import { Router, Response } from 'express';
import { Pool } from 'pg';
import fs from 'fs/promises';
import path from 'path';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { AuthRequest } from '../middleware';
import { evolutionFetch, sanitizeEvolutionUrl } from '../utils/resilientFetch';
import { resolverCaminhoLocal, salvarFotoPerfilLocal, resolverCaminhoLocalFoto, garantirMidiaEstavel, MAX_OUTBOUND_MEDIA_BYTES, extensaoParaArquivo, buscarInfoGrupo, buscarNomesParticipantesGrupo, buscarNomeViaFetchProfile } from '../utils/whatsappMediaStorage';
import { buscarPreviewLink } from '../utils/linkPreview';
import { fetchInstancesFromServer } from '../services/evolutionReconciliation';
import { verificarLoopDeLogout, verificarLoopDeLogoutTenant } from '../services/logoutCircuitBreaker';
import { log } from '../logger';
import { normalizarTelefone as normalizarTel } from '../utils/telefone';
import { resolverNome as resolverNomeLimpo } from '../utils/nomes';

// [AUDITORIA] LÓGICA: mesmo diretório/rota estática (`/uploads`, montado em index.ts) e mesmo
// padrão multer já usados por catalogo.ts/galeria.ts — reaproveitado abaixo pelo upload de
// mídia de saída do composer do chat (ver [AUDITORIA] BUG em `/upload-media`).
const UPLOADS_DIR = process.env.UPLOADS_DIR || '/app/uploads';
const API_BASE_URL = process.env.API_BASE_URL || 'https://api.mentoark.com.br';
const uploadMediaSaida = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_OUTBOUND_MEDIA_BYTES },
});

const DEFAULT_EVO_URL = process.env.EVOLUTION_API_URL || 'https://disparo.mentoark.com.br';
const DEFAULT_EVO_KEY = process.env.EVOLUTION_API_KEY || 'mentoark2025evolutionkey';

const WEBHOOK_URL = (() => {
  const base = process.env.EVOLUTION_WEBHOOK_URL || 'https://api.mentoark.com.br/webhook/evolution';
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET;
  if (!secret) return base;
  return `${base}${base.includes('?') ? '&' : '?'}key=${secret}`;
})();
const WEBHOOK_EVENTS = ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'MESSAGES_DELETE', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'];

// [AUDITORIA] FIX APLICADO (2026-07-22): rotas que casam por `split_part(remote_jid,'@',1)`
// recebiam o :phone da URL sempre passado por `.replace(/\D/g, '')` — isso stripa o hífen de
// JIDs de grupo no formato antigo (`123456789-1600000000@g.us`), corrompendo a chave e fazendo
// a busca não achar nenhuma linha mesmo com as mensagens do grupo já salvas no banco. Grupo
// aparecia certinho na lista (GET /conversas não filtra @g.us), mas abrir a conversa vinha
// vazio. Preserva o hífen quando presente (indício de JID de grupo); número normal continua
// sendo só dígitos como antes.
function normalizarPhoneParam(raw: string): string {
  return raw.includes('-') ? raw.replace(/[^\d-]/g, '') : raw.replace(/\D/g, '');
}

function webhookInner(enabled = true) {
  return {
    enabled,
    url: WEBHOOK_URL,
    webhookByEvents: false,
    webhookBase64: false,
    events: WEBHOOK_EVENTS,
  };
}

async function registrarWebhook(base: string, apiKey: string, instancia: string, enabled = true): Promise<void> {
  const cleanBase = sanitizeEvolutionUrl(base);
  try {
    const res = await evolutionFetch(`${cleanBase}/webhook/set/${instancia}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: apiKey },
      body: JSON.stringify({ webhook: webhookInner(enabled) }),
    });
    const body = await res.json().catch(() => ({}));
    const actualEnabled = (body as any)?.webhook?.enabled ?? (body as any)?.enabled;
    log.info('WHATSAPP', 'webhook atualizado', { action: enabled ? 'registrado' : 'removido', instancia, actualEnabled });
  } catch (err) {
    log.warn('WHATSAPP', 'Falha ao gerenciar webhook', { instancia, err: (err as Error).message });
  }
}

function normalizeQr(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const b64 = raw.replace(/^data:image\/\w+;base64,/, '');
  return `data:image/png;base64,${b64}`;
}

// [AUDITORIA] BUG (SSRF — GET /media): o branch http(s) desta rota fazia `fetch(mediaUrl)`
// com a URL vinda crua de `?url=` sem NENHUMA validação de host — só checava o prefixo
// `http(s)://`. Qualquer usuário autenticado podia passar `?url=http://localhost:5432`,
// `http://<container-interno-na-rede-proxy>:porta`, ou qualquer IP/porta interna da VPS
// (pgadmin, portainer, containers de outros clientes na mesma rede Docker) e o servidor
// fazia a requisição por ele, devolvendo o corpo da resposta (e, pior, anexando
// `cfg.api_key` — a API key admin da Evolution — no header de toda chamada, mesmo pra hosts
// que não são a Evolution). Confirmado: nada no fluxo restringe o host, só o schema.
// [AUDITORIA] FIX APLICADO: allowlist de host — só permite domínios do CDN do WhatsApp
// (`*.whatsapp.net`, onde mídia/foto de perfil realmente residem) ou o host configurado da
// própria Evolution API. Qualquer outro host é rejeitado com 400 antes do fetch. Mudança
// isolada nesta rota, não afeta os branches `local://`/`local-pic://` (já seguros, servem do
// disco com checagem de ownership) nem nenhum outro fluxo.
function isMediaHostAllowed(mediaUrl: string, evoBaseUrl: string): boolean {
  try {
    const u = new URL(mediaUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    if (host === 'whatsapp.net' || host.endsWith('.whatsapp.net')) return true;
    // [AUDITORIA] FIX APLICADO (2026-09-10): o próprio host de `/uploads` (mídia de SAÍDA salva
    // por `POST /upload-media`) também é permitido — sem isso, todo áudio/mídia enviado pelo chat
    // (URL `${API_BASE_URL}/uploads/...`) era bloqueado pelo proxy com 400, e o player mostrava
    // "Áudio indisponível". Continua sendo uma allowlist estrita (não abre pra host arbitrário).
    try {
      const apiHost = new URL(API_BASE_URL).hostname.toLowerCase();
      if (host === apiHost) return true;
    } catch { /* API_BASE_URL malformada — ignora */ }
    const evoHost = new URL(evoBaseUrl).hostname.toLowerCase();
    return host === evoHost;
  } catch {
    return false;
  }
}

// [AUDITORIA] FIX APLICADO: erros da Evolution API vêm no formato
// {"status":403,"error":"Forbidden","response":{"message":["This name \"x\" is already in use."]}}
// (message é um ARRAY dentro de "response", não uma string em body.message). O código de
// /connect checava `created?.message?.includes(...)`, que é sempre undefined nesse formato —
// a detecção de "instância já existe" nunca disparava, e um simples reconectar de uma
// instância já criada retornava 403 cru em vez de cair no fluxo de reconexão/QR code.
function extractEvolutionErrorMessage(body: any): string {
  const raw = body?.response?.message ?? body?.message ?? '';
  return Array.isArray(raw) ? raw.join(' ') : String(raw || '');
}

export default function whatsappRouter(pool: Pool): Router {
  const connectingUsers = new Set<string>();
  const router = Router();

  // [AUDITORIA] LÓGICA: Resolve o ID do administrador da conta (Tenant ID) a partir do ID do
  // usuário logado. Utiliza a coluna users.owner_id como fonte canônica de verdade para
  // isolamento/compartilhamento de dados de equipe (admin é dono de si mesmo).
  async function resolveOwnerId(userId: string): Promise<string> {
    try {
      const r = await pool.query(
        `SELECT COALESCE(owner_id, id)::text AS tenant_id FROM users WHERE id = $1 LIMIT 1`,
        [userId]
      );
      return r.rows[0]?.tenant_id || userId;
    } catch {
      return userId;
    }
  }

  // [AUDITORIA] FIX APLICADO: getEvolutionConfig lia url/api_key de integracoes_config
  // (editável por qualquer usuário via tela "Conectores") — isso já causou o mesmo servidor
  // de teste externo (fierceparrot-evolution.cloudfy.live) voltar a ser gravado por engano
  // mais de uma vez, quebrando a criação de instância. URL/API Key da Evolution agora vêm
  // sempre do .env do servidor (única instância própria, compartilhada por todos os
  // usuários) — só o nome da instância (o "número"/chip) continua por usuário.
  async function getEvolutionConfig(userId: string): Promise<{
    url: string; api_key: string; instancia: string; agenteId: string | null; isGlobal: boolean; stableInstancia: string;
  }> {
    // Sprint 1: instância resolvida pelo Tenant (dono da conta), não pelo usuário logado —
    // agentes de uma equipe passam a apontar para a mesma instância criada pelo Administrador.
    const tenantId = await resolveOwnerId(userId);
    const stableInstancia = `crm_${tenantId.replace(/-/g, '').slice(0, 12)}`;
    return {
      url: DEFAULT_EVO_URL,
      api_key: DEFAULT_EVO_KEY,
      instancia: stableInstancia,
      agenteId: null,
      isGlobal: true,
      stableInstancia,
    };
  }

  // [AUDITORIA] LÓGICA (Sprint 1 — multi-instância, 2026-07-23): até aqui, um tenant só
  // conseguia ter UMA instância Evolution — getEvolutionConfig() sempre devolvia o mesmo nome
  // determinístico, e POST /connect tratava "instância já existe/aberta" como "já está
  // conectado", sem meio de pedir explicitamente uma segunda. O objetivo real do produto é
  // juntar vários números de WhatsApp numa central só — as tabelas (integracoes_config,
  // agentes) já suportam múltiplas linhas por tenant, faltava só o mecanismo de nomear/criar
  // a instância extra. instanciasConhecidas() lista o que o tenant já tem registrado;
  // proximaInstanciaLivre() escolhe o próximo nome livre (crm_<prefixo>, depois _2, _3...) —
  // a instância "padrão" (sem sufixo) nunca muda de nome, preservando 100% de compatibilidade
  // com tenants que só têm uma linha hoje.
  async function instanciasConhecidas(tenantId: string): Promise<Set<string>> {
    const r = await pool.query(
      `SELECT instancia FROM integracoes_config WHERE user_id = $1 AND tipo = 'evolution' AND instancia IS NOT NULL`,
      [tenantId]
    );
    return new Set(r.rows.map((row: any) => row.instancia as string));
  }

  async function proximaInstanciaLivre(baseInstancia: string, conhecidas: Set<string>): Promise<string> {
    if (!conhecidas.has(baseInstancia)) return baseInstancia; // primeira conexão do tenant
    let n = 2;
    while (conhecidas.has(`${baseInstancia}_${n}`)) n++;
    return `${baseInstancia}_${n}`;
  }

  // [AUDITORIA] LÓGICA (Sprint 2 — multi-instância, 2026-07-23): /connect, /poll-qr e
  // /disconnect só sabiam operar na instância "padrão" do tenant (via getEvolutionConfig) —
  // com mais de uma instância por tenant (Sprint 1), reconectar/desconectar um CARD específico
  // do painel (InstanceManagementPanel.tsx) sempre acabava mexendo na instância errada (a
  // padrão, não a que o usuário clicou). Helper único: só aceita a instância pedida se ela
  // realmente pertence ao tenant (evita um usuário forjar o nome de instância de outro tenant
  // no body/query — mesma classe de checagem já usada em /send e /evo/status).
  async function resolverInstanciaExplicita(
    tenantId: string, instanciaSolicitada: string | undefined,
    cfg: { instancia: string; stableInstancia: string }
  ): Promise<void> {
    if (!instanciaSolicitada || instanciaSolicitada === cfg.instancia) return;
    const conhecidas = await instanciasConhecidas(tenantId);
    if (conhecidas.has(instanciaSolicitada)) {
      cfg.instancia = instanciaSolicitada;
      cfg.stableInstancia = instanciaSolicitada;
    } else {
      log.warn('WHATSAPP', 'Instância solicitada não pertence ao tenant — ignorando', { tenantId, instanciaSolicitada });
    }
  }

  // [AUDITORIA] BUG (achado 2026-08-07, a pedido do usuário — "não consigo ver o número
  // conectado na aba Instâncias"): as 3 rotas que tentavam expor `phoneNumber` (GET /evo/status,
  // POST /status, POST /connect) todas liam `data?.instance?.profileName || instance?.number ||
  // instance?.owner` da resposta de `GET /instance/connectionState/:instance` — mas essa rota da
  // Evolution devolve só `{ instance: { instanceName, state } }`, sem NENHUM desses campos
  // (confirmado com chamada real em produção). `phoneNumber` sempre voltava vazio; o frontend só
  // não mostrava nada (nem erro), então passou despercebido até o usuário reparar visualmente.
  // [AUDITORIA] FIX APLICADO: quem realmente devolve o número é `GET /instance/fetchInstances`
  // (aceita `?instanceName=` e filtra no servidor, confirmado com chamada real) — cada item tem
  // `ownerJid` ("55...@s.whatsapp.net", a fonte mais confiável), `profileName` e `number` (este
  // último às vezes null mesmo com a instância aberta, confirmado em produção). Helper único,
  // usado pelas 3 rotas — chamada extra e best-effort (falha aqui nunca deve derrubar o status/
  // connect/send, que já funcionavam sem o número).
  async function buscarPhoneNumberInstancia(base: string, apiKey: string, instancia: string): Promise<string> {
    try {
      const r = await evolutionFetch(`${base}/instance/fetchInstances?instanceName=${encodeURIComponent(instancia)}`, {
        headers: { apikey: apiKey },
      });
      if (!r.ok) return '';
      const data: any = await r.json().catch(() => null);
      const info = Array.isArray(data) ? data[0] : null;
      if (!info) return '';
      if (info.ownerJid) return String(info.ownerJid).split('@')[0];
      return info.number || info.profileName || '';
    } catch {
      return '';
    }
  }

  async function saveEvolutionConfig(
    userId: string, agenteId: string | null,
    url: string, api_key: string, instancia: string
  ) {
    // Multi-instância: não apaga outras linhas tipo='evolution' do usuário — um usuário pode
    // ter mais de um número conectado simultaneamente, cada um com sua própria linha/instancia.
    const upd = await pool.query(
      `UPDATE integracoes_config SET url=$2, api_key=$3, status='conectado', updated_at=NOW()
       WHERE user_id=$1 AND tipo='evolution' AND instancia=$4`,
      [userId, url, api_key, instancia]
    );
    if (!upd.rowCount) {
      await pool.query(
        `INSERT INTO integracoes_config (user_id, tipo, nome, url, api_key, instancia, status, updated_at)
         VALUES ($1, 'evolution', 'WhatsApp', $2, $3, $4, 'conectado', NOW())`,
        [userId, url, api_key, instancia]
      );
    }

    if (agenteId) {
      // [AUDITORIA] FIX APLICADO (Sprint Score Real, 2026-08-09): `evolution_conectado_em`
      // preenchido só na PRIMEIRA vez (COALESCE — nunca sobrescreve uma data já gravada) — usado
      // como "maturidade real" no cálculo de score (`instanceScore.ts`), em vez do
      // `Math.random()` que existia antes. Reconectar um número já conhecido não deve resetar a
      // idade da conta pro cálculo de saúde.
      await pool.query(
        `UPDATE agentes SET evolution_server_url=$1, evolution_api_key=$2, evolution_instancia=$3,
                             evolution_conectado_em = COALESCE(evolution_conectado_em, NOW()), updated_at=NOW()
         WHERE id=$4 AND user_id=$5`,
        [url, api_key, instancia, agenteId, userId]
      );
    } else {
      // [AUDITORIA] FIX APLICADO (Sprint 1 — multi-instância, 2026-07-23): esse UPDATE
      // filtrava só por `user_id=$4 AND ativo=true`, sem checar qual instância — ao conectar
      // um SEGUNDO número, ele reescrevia o `evolution_instancia` da linha da PRIMEIRA
      // instância pra apontar pra segunda, quebrando o roteamento (agentes) da primeira sem
      // avisar ninguém. Agora só atualiza uma linha já vinculada a ESSA instância específica;
      // instância nova (ainda sem linha em agentes) cai no INSERT abaixo, criando uma linha
      // própria em vez de roubar a de outro chip.
      const updAg = await pool.query(
        `UPDATE agentes SET evolution_server_url=$1, evolution_api_key=$2,
                             evolution_conectado_em = COALESCE(evolution_conectado_em, NOW()), updated_at=NOW()
         WHERE user_id=$4 AND evolution_instancia=$3 AND ativo=true`,
        [url, api_key, instancia, userId]
      );
      // [AUDITORIA] FIX APLICADO: um usuário sem nenhum "agente" (nem ativo) conseguia conectar o
      // WhatsApp normalmente (funciona de ponta a ponta, mensagens chegam via webhook), mas o
      // painel "Instâncias" (InstanceManagementPanel.tsx) só lista linhas de `agentes` com
      // evolution_instancia preenchida — sem nenhuma linha pra atualizar, a conexão ficava
      // invisível pro usuário/admin, mesmo funcionando de verdade. Agente de IA deve ser
      // opcional: cria uma linha mínima só pra segurar a instância (ativo_motor=false, sem IA
      // respondendo) se não existir nenhuma pra sincronizar.
      if (!updAg.rowCount) {
        await pool.query(
          `INSERT INTO agentes (user_id, nome, evolution_server_url, evolution_api_key, evolution_instancia, ativo_motor, evolution_conectado_em)
           VALUES ($1, 'Conexão WhatsApp', $2, $3, $4, false, NOW())`,
          [userId, url, api_key, instancia]
        );
      }
    }
  }

  async function buscarFotoEvo(base: string, apiKey: string, instancia: string, phone: string): Promise<string | null> {
    try {
      const r = await evolutionFetch(`${base}/chat/fetchProfilePictureUrl/${instancia}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: apiKey },
        body: JSON.stringify({ number: phone }),
      });
      if (r.ok) {
        const d: any = await r.json().catch(() => ({}));
        const url = d?.profilePictureUrl || d?.url || d?.picture || null;
        if (url) return url;
      }
    } catch {}
    try {
      const r = await evolutionFetch(`${base}/fetchProfilePicture/${instancia}?number=${phone}`, {
        headers: { apikey: apiKey },
      });
      if (r.ok) {
        const d: any = await r.json().catch(() => ({}));
        return d?.profilePictureUrl || d?.url || d?.picture || null;
      }
    } catch {}
    return null;
  }

  async function salvarFotoContato(userId: string, phone: string, picUrl: string, pushName?: string | null): Promise<void> {
    // [AUDITORIA] FIX APLICADO (2026-07-23): antes gravava a URL crua da Evolution direto —
    // ela expira (parâmetro `oe=` na própria URL, mesmo problema já corrigido pra mídia de
    // mensagem, ver whatsappMediaStorage.ts) e nada nunca re-buscava, então fotos "somem"
    // silenciosamente semanas depois. Baixa e salva os bytes localmente; só cai pra URL crua
    // se o download falhar (nunca perde a foto por causa disso, só fica sujeito à expiração
    // de novo nesse caso raro).
    const localUrl = await salvarFotoPerfilLocal(picUrl, userId, phone);
    const valorFinal = localUrl || picUrl;
    const suffix = `%${phone.slice(-11)}`;
    await pool.query(
      `UPDATE contatos SET foto_perfil = $1, profile_pic_url = $1${pushName ? ', push_name = COALESCE($4, push_name)' : ''}
       WHERE user_id = $2 AND telefone ILIKE $3`,
      pushName ? [valorFinal, userId, suffix, pushName] : [valorFinal, userId, suffix]
    ).catch(() => {});
  }

  router.get('/profile-pic/:phone', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const phone = decodeURIComponent(req.params.phone).replace(/\D/g, '');
      if (!phone) return res.status(400).json({ message: 'phone inválido' });

      const row = await pool.query(
        `SELECT nome, push_name, foto_perfil, profile_pic_url FROM contatos
         WHERE user_id = $1 AND telefone ILIKE $2 LIMIT 1`,
        [userId, `%${phone.slice(-11)}`]
      );
      const c = row.rows[0];
      const existingPic = c?.foto_perfil || c?.profile_pic_url;
      const pushName = c?.push_name || c?.nome || null;

      if (existingPic) {
        return res.json({ foto_perfil: existingPic, push_name: pushName });
      }

      const cfg = await getEvolutionConfig(userId);
      const base = cfg.url.replace(/\/$/, '');
      const picUrl = await buscarFotoEvo(base, cfg.api_key, cfg.instancia, phone);

      if (picUrl) await salvarFotoContato(userId, phone, picUrl, pushName);

      return res.json({ foto_perfil: picUrl, push_name: pushName });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  router.post('/sync-profiles', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      // [AUDITORIA] FIX APLICADO (2026-07-21): req.getDb() -- piloto de RLS em
      // whatsapp_messages (só homologação, ver diagnosticos/AUDITORIA_LOG.md).
      const db = await req.getDb!();
      const phonesRes = await db.query(
        `SELECT DISTINCT split_part(remote_jid, '@', 1) AS phone
         FROM whatsapp_messages
         WHERE user_id = $1 AND remote_jid NOT LIKE '%@g.us' AND deleted_at IS NULL
         LIMIT 200`,
        [userId]
      );

      const cfg = await getEvolutionConfig(userId);
      const base = cfg.url.replace(/\/$/, '');

      let sincronizados = 0;
      for (const row of phonesRes.rows) {
        const phone = row.phone;
        try {
          const picUrl = await buscarFotoEvo(base, cfg.api_key, cfg.instancia, phone);
          if (picUrl) {
            await salvarFotoContato(userId, phone, picUrl);
            sincronizados++;
          }
        } catch {}
        await new Promise(r => setTimeout(r, 150));
      }

      // [AUDITORIA] BUG (achado 2026-07-28 — "quase todos os grupos aparecem como número, sem
      // foto"): este endpoint (botão "Sincronizar fotos de perfil") excluía grupos
      // explicitamente (`remote_jid NOT LIKE '%@g.us'` acima) — mesmo achado do webhook (ver
      // buscarInfoGrupo() em whatsappMediaStorage.ts). [AUDITORIA] FIX APLICADO: backfill de
      // grupos já existentes aqui, pra não depender de esperar uma mensagem nova em cada grupo
      // (ver também o fix orgânico em webhook.ts, que cobre grupos novos/mensagens futuras).
      const gruposRes = await db.query(
        `SELECT DISTINCT remote_jid
         FROM whatsapp_messages
         WHERE user_id = $1 AND remote_jid LIKE '%@g.us' AND deleted_at IS NULL
         LIMIT 100`,
        [userId]
      );
      let gruposSincronizados = 0;
      for (const row of gruposRes.rows) {
        const groupJid: string = row.remote_jid;
        const groupId = groupJid.split('@')[0];
        try {
          const { subject, pictureUrl } = await buscarInfoGrupo(base, cfg.api_key, cfg.instancia, groupJid);
          if (subject || pictureUrl) {
            const localUrl = pictureUrl ? await salvarFotoPerfilLocal(pictureUrl, userId, groupId) : null;
            // [AUDITORIA] BUG (achado 2026-07-29, mesmo padrão do fix em webhook.ts): `ON
            // CONFLICT (user_id, telefone)` sem repetir o `WHERE telefone IS NOT NULL` do índice
            // parcial `idx_contatos_user_tel_unique` (migrations.ts) faz o Postgres rejeitar todo
            // INSERT — confirmado em produção, 0 grupos gravados apesar do botão reportar
            // "sincronizados". [AUDITORIA] FIX APLICADO: `WHERE` adicionado; `gruposSincronizados`
            // só incrementa quando o INSERT de fato retorna (antes contava tentativas, não
            // sucessos — o `.catch(() => {})` escondia falhas tanto do log quanto da contagem).
            const upsertResult = await pool.query(
              `INSERT INTO contatos (user_id, nome, telefone, origem, status, ultima_mensagem_em)
               VALUES ($1, $2, $3, 'WhatsApp', 'novo', NOW())
               ON CONFLICT (user_id, telefone) WHERE telefone IS NOT NULL DO UPDATE
                 SET nome = CASE WHEN $2 IS NOT NULL AND $2 <> contatos.telefone THEN $2 ELSE contatos.nome END,
                     profile_pic_url = COALESCE($4, contatos.profile_pic_url),
                     foto_perfil = COALESCE($4, contatos.foto_perfil),
                     ultima_mensagem_em = NOW()`,
              [userId, subject || groupId, groupId, localUrl || pictureUrl]
            ).catch(err => {
              log.warn('WHATSAPP sync-profiles', 'Falha ao salvar info do grupo', { groupId, err: err?.message });
              return null;
            });
            if (upsertResult) gruposSincronizados++;
          }
        } catch {}
        await new Promise(r => setTimeout(r, 150));
      }

      return res.json({
        sincronizados: sincronizados + gruposSincronizados,
        total: phonesRes.rows.length + gruposRes.rows.length,
      });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // [AUDITORIA] LÓGICA (Sprint Importar Contatos de Grupo, 2026-08-04; repontado pra `agentes`
  // na Sprint 1 unificação, 2026-08-07): resolve a config Evolution REAL do agente ativo do
  // tenant — não usa `getEvolutionConfig()` acima de propósito. Aquele helper devolve sempre a
  // instância "padrão" sem sufixo (`crm_<prefixo>`), mas o suporte a multi-instância (Sprint 1,
  // comentário em `getEvolutionConfig` acima) permite que a instância REALMENTE conectada de um
  // tenant seja uma secundária (`crm_<prefixo>_2`, `_3`...) — confirmado em homolog:
  // `getEvolutionConfig()` apontaria pra `crm_435ee4720fc3` (instância padrão, não
  // necessariamente a conectada), enquanto o agente ativo de verdade usa `crm_435ee4720fc3_2`.
  // Ações de grupo (que dependem de uma sessão WhatsApp real e conectada) usam a mesma fonte que
  // `grupoTarefaEngine.ts`/`webhook.ts` já usam pra esse fim.
  // [AUDITORIA] BUG (achado real, `SPRINT_GRUPOS_IMPORTACAO_FALHANDO_E_LINK_PREVIEW.md`, aberta
  // desde 2026-08-09, nunca corrigida — usuário reportou "Importar para CRM" falhando com
  // "Evolution não retornou nada sobre grupos"): esta função sempre pegava QUALQUER instância
  // ativa do tenant mais recentemente atualizada, nunca necessariamente a instância que é
  // membro do grupo que o usuário está tentando consultar/importar. Uma conta com 2+ instâncias
  // reais (comum — confirmado em várias contas nesta sessão) pega a instância errada e a
  // Evolution genuinamente não acha o grupo (não é bug de permissão nem de IA — confirmado que
  // este caminho inteiro nunca chama nenhum provider de IA). [AUDITORIA] FIX APLICADO:
  // `instanciaSolicitada` opcional — o frontend já sabe qual instância originou aquela conversa
  // de grupo (`activeChat.source`, mesmo campo já usado em outros envios) e agora manda
  // explicitamente; só cai no fallback "mais recente" se não vier nada (não quebra nenhum
  // chamador antigo que não mande o parâmetro).
  async function resolverConfigGrupoAtivo(userId: string, instanciaSolicitada?: string): Promise<{ url: string; api_key: string; instancia: string } | null> {
    const tenantId = await resolveOwnerId(userId);
    if (instanciaSolicitada) {
      const cfgExata = await pool.query(
        `SELECT evolution_server_url AS url, evolution_api_key AS api_key, evolution_instancia AS instancia
         FROM agentes WHERE user_id = $1 AND ativo = true AND LOWER(evolution_instancia) = LOWER($2)
           AND evolution_server_url IS NOT NULL AND evolution_api_key IS NOT NULL
         LIMIT 1`,
        [tenantId, instanciaSolicitada]
      );
      const exata = cfgExata.rows[0];
      if (exata?.url && exata?.api_key && exata?.instancia) {
        return { url: exata.url, api_key: exata.api_key, instancia: exata.instancia };
      }
      log.warn('WHATSAPP', 'Instância solicitada pra grupo não encontrada/sem credenciais — caindo no fallback', { tenantId, instanciaSolicitada });
    }
    const cfgRes = await pool.query(
      `SELECT evolution_server_url AS url, evolution_api_key AS api_key, evolution_instancia AS instancia
       FROM agentes WHERE user_id = $1 AND ativo = true
         AND evolution_instancia IS NOT NULL AND evolution_server_url IS NOT NULL AND evolution_api_key IS NOT NULL
       ORDER BY updated_at DESC LIMIT 1`,
      [tenantId]
    );
    const cfg = cfgRes.rows[0];
    if (!cfg?.url || !cfg?.api_key || !cfg?.instancia) return null;
    return { url: cfg.url, api_key: cfg.api_key, instancia: cfg.instancia };
  }

  // [AUDITORIA] LÓGICA (Sprint Nome Real de Leads de Grupo, 2026-08-26 — pedido explícito do
  // usuário: "o mais importante além do número é o nome... preciso captar o nome ou pelo menos
  // a tag do whatsapp que está registrado"): a Evolution nunca devolveu nome de participante de
  // grupo pelo endpoint já usado (`findGroupInfos`) — nome sempre nascia igual ao telefone
  // (enganoso num CSV/Excel exportado pra fora do sistema). Cadeia de resolução testada ao vivo
  // contra produção antes de implementar (leitura, 4 grupos reais, ~38 participantes — ver
  // `AUDITORIA_LOG.md`/`STATUS.md` pro resultado completo), por ordem de confiabilidade/custo,
  // parando na primeira que resolver:
  //   1. Contato já existe no CRM com nome real (mesmo telefone, `nome IS NOT NULL AND nome <>
  //      telefone`) — zero custo, zero chamada externa.
  //   2. `push_name` de uma conversa INDIVIDUAL (1:1, não de grupo) já registrada em
  //      `whatsapp_messages` pra esse telefone — também zero chamada externa. Medido 0% de
  //      cobertura adicional na amostra de teste (grupos de prospecção sem sobreposição com
  //      conversa 1:1), mas mantido porque é gratuito e não é 0% em todo cenário (contato de
  //      grupo que depois vira conversa direta, por exemplo).
  //   3. `buscarNomesParticipantesGrupo()` (`group/participants`, ver whatsappMediaStorage.ts) —
  //      cobertura real medida 11%-21% (majoritariamente admin), 1 chamada por GRUPO (não por
  //      participante, não escala mal). Passado como mapa já resolvido pelo chamador (evita
  //      buscar 2x quando esta função roda em loop pra cada participante do mesmo grupo).
  //   4. Sem nome resolvido → `null`. NUNCA usar o telefone como nome aqui (decisão deliberada:
  //      quem chama decide o fallback de exibição, esta função só devolve nome real ou nada).
  // `POST /chat/fetchProfile` (1 chamada HTTP por participante) foi deliberadamente deixado de
  // fora da cadeia automática — já documentado como não confiável em
  // `SPRINT_NOME_REAL_CONTATOS_GRUPO.md` e caro demais pra grupo grande (233 participantes no
  // caso real já testado "Poá negócios").
  async function resolverNomeParticipante(
    tenantId: string, telefone: string, nomesDoGrupo: Map<string, string>,
  ): Promise<string | null> {
    // [AUDITORIA] BUG (achado em revisão própria, antes de deployar): a 1ª versão checava
    // `nomesDoGrupo` (camada 3, mais barata — já em memória) antes do contato existente (camada
    // 1) só por conveniência de implementação, invertendo a ordem de confiabilidade documentada
    // acima. Sem efeito em `/importar-contatos` (participante que chega aqui já foi filtrado como
    // NÃO sendo contato existente antes de chamar esta função), mas em `/participantes`
    // (export — roda pra TODOS os participantes, inclusive quem já é contato curado no CRM) um
    // admin com nome de exibição de grupo diferente do nome real já salvo no CRM tinha o nome
    // curado silenciosamente substituído pelo nome do WhatsApp. Corrigido: contato existente
    // sempre vence.
    const r = await pool.query(
      `SELECT nome, push_name FROM contatos WHERE user_id = $1 AND telefone ILIKE $2 LIMIT 1`,
      [tenantId, `%${telefone.slice(-11)}`]
    );
    const contato = r.rows[0];
    if (contato?.nome && contato.nome.replace(/\D/g, '') !== telefone.slice(-11) && contato.nome.trim().length > 0) {
      return contato.nome;
    }

    // [AUDITORIA] LÓGICA (Sprint Nome Real de Leads de Grupo, cont., 2026-08-26): cache de
    // resolução via `fetchProfile` (ver `resolverNomesEmBackground` abaixo) — camada explícita e
    // recente, mais confiável que push_name de conversa ou nome de exibição do grupo, então
    // checada antes das duas. Populada só sob ação deliberada do operador (nunca automática),
    // mas uma vez resolvida vale pra qualquer export/import futuro do mesmo telefone.
    const rCache = await pool.query(
      `SELECT nome FROM whatsapp_nomes_resolvidos WHERE user_id = $1 AND telefone = $2 LIMIT 1`,
      [tenantId, telefone]
    );
    const nomeCache = rCache.rows[0]?.nome as string | undefined;
    if (nomeCache && nomeCache.trim()) return nomeCache.trim();

    const rMsg = await pool.query(
      `SELECT push_name FROM whatsapp_messages
       WHERE user_id = $1 AND remote_jid ILIKE $2 AND remote_jid NOT LIKE '%@g.us' AND push_name IS NOT NULL
       ORDER BY timestamp_wa DESC NULLS LAST LIMIT 1`,
      [tenantId, `%${telefone.slice(-11)}@%`]
    );
    const pushName = rMsg.rows[0]?.push_name as string | undefined;
    if (pushName && pushName.trim()) return pushName.trim();

    const doGrupo = nomesDoGrupo.get(telefone);
    if (doGrupo) return doGrupo;

    return null;
  }

  // [AUDITORIA] LÓGICA (achado real do usuário, 2026-08-27 — "tentei importar um grupo e não
  // consegui"): mensagem única, reaproveitada pelas 3 rotas que dependem de `buscarInfoGrupo`
  // (participantes/importar-contatos/resolver-nomes) — antes cada uma tinha sua própria versão
  // genérica de "não retornou participantes", sem dizer POR QUE. `info.erro` (ver
  // whatsappMediaStorage.ts) agora distingue "instância não é mais membro deste grupo"
  // (`sem_acesso`, confirmado ao vivo — `Error: forbidden` da Evolution) de qualquer outra falha.
  function mensagemFalhaGrupo(info: { erro: 'sem_acesso' | 'outro' | null; size: number | null }, groupJid: string): string {
    if (info.erro === 'sem_acesso') {
      return 'Este número/instância não é mais membro deste grupo no WhatsApp (alguém removeu, ou o número saiu) — não é possível ler os participantes até ser adicionado de novo ao grupo.';
    }
    if (info.erro === 'outro') {
      return 'A Evolution retornou erro ao consultar este grupo — pode ser instância desconectada, ou o grupo não existir mais. Veja os logs do servidor para o detalhe técnico.';
    }
    return (info.size ?? 0) > 0
      ? `O grupo tem ${info.size} participantes, mas nenhum teve o telefone resolvido pela Evolution (privacidade "Linked ID" ativa) — nada foi feito.`
      : 'A Evolution não retornou participantes para este grupo — nada foi feito.';
  }

  // [AUDITORIA] LÓGICA (Sprint Nome Real de Leads de Grupo, cont., 2026-08-26): job em memória
  // (não persistido — processo único nesta VPS, mesmo pressuposto de outras rotinas em memória
  // do projeto) rastreando "resolução via fetchProfile em andamento" por grupo, pra: (1) impedir
  // clique duplo iniciar 2 jobs concorrentes batendo na Evolution ao mesmo tempo (justamente o
  // tipo de rajada que o delay anti-ban existe pra evitar), (2) o frontend poder perguntar
  // "ainda tá rodando?" sem precisar de tabela nova só pra status — progresso real (quantos já
  // resolveram) é sempre recalculado direto de `whatsapp_nomes_resolvidos`, nunca guardado aqui.
  // [AUDITORIA] LÓGICA: `telefones` guardado no job (não só o total) pra `/status` contar
  // progresso só DESTE grupo — sem isso, um usuário resolvendo 2 grupos ao mesmo tempo (jobs
  // concorrentes em grupos diferentes, permitido) contaminaria a contagem de um com resoluções
  // do outro (mesmo `tenantId`, `resolvido_em` não distingue grupo de origem).
  const jobsResolucaoNome = new Map<string, { rodando: boolean; total: number; iniciadoEm: number; telefones: string[] }>();

  // [AUDITORIA] LÓGICA: delay entre chamadas ao `fetchProfile` reaproveita literalmente a faixa
  // do perfil "Rápido" já usado e já validado pelo motor de Disparos (`disparoProcessor.ts`,
  // `FAIXAS_DELAY_MS.fast = [5000, 15000]`) — decisão deliberada de não inventar um número novo
  // pra pausa anti-ban; é o mesmo risco de padrão de automação, mesmo remédio.
  const DELAY_FETCH_PROFILE_MS: [number, number] = [5000, 15000];
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  // [AUDITORIA] LÓGICA: roda em background (chamador não aguarda) — percorre os participantes
  // AINDA sem nome resolvido pela cadeia gratuita (evita gastar chamada em quem já tem nome via
  // contato existente/push_name/group-participants), chama `fetchProfile` um de cada vez com
  // delay anti-ban entre cada, grava no cache (`whatsapp_nomes_resolvidos`) e, se o telefone já
  // for um contato existente sem nome verificado, atualiza `contatos` também — assim um grupo
  // já importado sem nome ganha nome sem precisar reimportar.
  async function resolverNomesEmBackground(
    tenantId: string, groupJid: string, cfg: { url: string; api_key: string; instancia: string },
    participantes: { telefone: string }[], nomesDoGrupo: Map<string, string>,
  ) {
    const chave = `${tenantId}:${groupJid}`;
    let resolvidos = 0;
    let tentados = 0;
    try {
      for (const p of participantes) {
        const jaTemNome = await resolverNomeParticipante(tenantId, p.telefone, nomesDoGrupo);
        if (jaTemNome) continue; // não gasta fetchProfile em quem a cadeia gratuita já resolveu

        tentados++;
        const nome = await buscarNomeViaFetchProfile(cfg.url, cfg.api_key, cfg.instancia, p.telefone);
        if (nome) {
          resolvidos++;
          await pool.query(
            `INSERT INTO whatsapp_nomes_resolvidos (user_id, telefone, nome)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id, telefone) DO UPDATE SET nome = EXCLUDED.nome, resolvido_em = now()`,
            [tenantId, p.telefone, nome]
          );
          // Contato já existente sem nome verificado ganha o nome agora, sem precisar reimportar.
          await pool.query(
            `UPDATE contatos SET nome = $1, nome_verificado = true
             WHERE user_id = $2 AND telefone ILIKE $3 AND (nome_verificado IS DISTINCT FROM true)`,
            [nome, tenantId, `%${p.telefone.slice(-11)}`]
          ).catch(() => {});
        }

        // Delay anti-ban entre cada chamada — inclusive depois da última (custo pequeno, evita
        // qualquer padrão "rajada seguida de silêncio total" que também pode chamar atenção).
        const [min, max] = DELAY_FETCH_PROFILE_MS;
        await sleep(Math.floor(Math.random() * (max - min) + min));
      }
    } catch (err: any) {
      log.error('WA_RESOLVER_NOMES', 'Erro no job de resolução de nomes', { groupJid, err: err?.message, stack: err?.stack });
    } finally {
      log.info('WA_RESOLVER_NOMES', 'Job de resolução de nomes concluído', { groupJid, tentados, resolvidos, totalParticipantes: participantes.length });
      const job = jobsResolucaoNome.get(chave);
      if (job) job.rodando = false;
    }
  }

  // POST /api/whatsapp/grupos/:groupJid/resolver-nomes — inicia (não bloqueia a resposta) a
  // resolução via fetchProfile pra quem ainda não tem nome. Ação explícita e separada do
  // export/import — nunca automática, por causa do custo/risco de rajada já documentado acima.
  router.post('/grupos/:groupJid/resolver-nomes', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const tenantId = await resolveOwnerId(userId);
      const groupJid = req.params.groupJid.endsWith('@g.us') ? req.params.groupJid : `${req.params.groupJid}@g.us`;
      const chave = `${tenantId}:${groupJid}`;

      const jobAtual = jobsResolucaoNome.get(chave);
      if (jobAtual?.rodando) {
        return res.status(409).json({ message: 'Já existe uma resolução de nomes em andamento para este grupo.', total: jobAtual.total });
      }

      const cfg = await resolverConfigGrupoAtivo(userId, req.body?.instancia as string | undefined);
      if (!cfg) return res.status(409).json({ message: 'Nenhuma instância WhatsApp ativa configurada para esta conta.' });

      const info = await buscarInfoGrupo(cfg.url, cfg.api_key, cfg.instancia, groupJid);
      if (!info.participantes.length) {
        return res.status(502).json({ message: mensagemFalhaGrupo(info, groupJid) });
      }
      const nomesDoGrupo = await buscarNomesParticipantesGrupo(cfg.url, cfg.api_key, cfg.instancia, groupJid);

      jobsResolucaoNome.set(chave, {
        rodando: true,
        total: info.participantes.length,
        iniciadoEm: Date.now(),
        telefones: info.participantes.map((p) => p.telefone),
      });
      // Fire-and-forget deliberado — resposta volta na hora, job roda em background (pode levar
      // minutos a dezenas de minutos num grupo grande, de propósito, pelo delay anti-ban).
      resolverNomesEmBackground(tenantId, groupJid, cfg, info.participantes, nomesDoGrupo);

      return res.json({
        iniciado: true,
        totalParticipantes: info.participantes.length,
        estimativaSegundosMax: info.participantes.length * (DELAY_FETCH_PROFILE_MS[1] / 1000),
      });
    } catch (err: any) {
      log.error('WA_RESOLVER_NOMES', 'Erro ao iniciar resolução de nomes', { err: err?.message, stack: err?.stack });
      return res.status(500).json({ message: err.message });
    }
  });

  // GET /api/whatsapp/grupos/:groupJid/resolver-nomes/status — progresso real (recalculado do
  // cache, nunca de um contador em memória) + se o job ainda está rodando.
  router.get('/grupos/:groupJid/resolver-nomes/status', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const tenantId = await resolveOwnerId(userId);
      const groupJid = req.params.groupJid.endsWith('@g.us') ? req.params.groupJid : `${req.params.groupJid}@g.us`;
      const chave = `${tenantId}:${groupJid}`;
      const job = jobsResolucaoNome.get(chave);
      if (!job) return res.json({ emAndamento: false, total: 0, resolvidos: 0 });

      const r = await pool.query(
        `SELECT COUNT(*) AS n FROM whatsapp_nomes_resolvidos
         WHERE user_id = $1 AND resolvido_em >= to_timestamp($2 / 1000.0) AND telefone = ANY($3::text[])`,
        [tenantId, job.iniciadoEm, job.telefones]
      );
      return res.json({
        emAndamento: job.rodando,
        total: job.total,
        resolvidos: parseInt(r.rows[0]?.n ?? '0', 10),
      });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // GET /api/whatsapp/grupos/:groupJid/participantes — lista crua dos participantes (telefone +
  // admin + nome resolvido, quando possível), sem tocar no banco. [AUDITORIA] LÓGICA (Sprint
  // Exportar Leads de Grupo, 2026-08-23, pedido explícito do usuário: "quero que baixe em csv ou
  // excel e dê pra importar pra fora do sistema"): até aqui só existia POST /importar-contatos,
  // que sempre GRAVA no CRM (contatos + lista nova) — não tinha como pegar a lista crua sem
  // criar registro nenhum. Rota somente leitura, mesmo dado que a importação já busca
  // (`buscarInfoGrupo`, sempre fresco na Evolution, nunca cacheado), só que devolvido pro
  // frontend em vez de virar INSERT — o CSV/Excel é montado no cliente (mesmo padrão de
  // exportação já usado em `Leads.tsx`), sem gerar arquivo nem gravar nada no servidor.
  // [AUDITORIA] LÓGICA (Sprint Nome Real de Leads de Grupo, 2026-08-26): resolve nome pela
  // cadeia de `resolverNomeParticipante()` (ver comentário completo lá) — não grava nada no
  // banco, só enriquece a resposta.
  router.get('/grupos/:groupJid/participantes', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const tenantId = await resolveOwnerId(userId);
      const groupJid = req.params.groupJid.endsWith('@g.us') ? req.params.groupJid : `${req.params.groupJid}@g.us`;
      const cfg = await resolverConfigGrupoAtivo(userId, req.query.instancia as string | undefined);
      if (!cfg) return res.status(409).json({ message: 'Nenhuma instância WhatsApp ativa configurada para esta conta.' });

      const info = await buscarInfoGrupo(cfg.url, cfg.api_key, cfg.instancia, groupJid);
      const nomesDoGrupo = await buscarNomesParticipantesGrupo(cfg.url, cfg.api_key, cfg.instancia, groupJid);
      const totalNoGrupo = info.size ?? info.participantes.length;
      const semNumeroResolvido = Math.max(0, totalNoGrupo - info.participantes.length);
      const participantes = await Promise.all(info.participantes.map(async p => {
        const nome = await resolverNomeParticipante(tenantId, p.telefone, nomesDoGrupo);
        return { telefone: p.telefone, admin: !!p.admin, nome, nomeVerificado: !!nome };
      }));
      return res.json({
        grupoNome: info.subject || groupJid,
        totalNoGrupo,
        semNumeroResolvido,
        participantes,
        mensagemErro: participantes.length === 0 ? mensagemFalhaGrupo(info, groupJid) : null,
      });
    } catch (err: any) {
      log.error('WA_GROUP_EXPORT', 'Erro ao buscar participantes do grupo para exportação', { err: err?.message, stack: err?.stack });
      return res.status(500).json({ message: err.message });
    }
  });

  // GET /api/whatsapp/grupos/:groupJid/info — info fresca do grupo direto na Evolution (nunca
  // cacheada) pro painel de detalhes: descrição, quantidade de participantes, data de criação —
  // tudo que `buscarInfoGrupo()` já buscava e ficava descartado. Não expõe a lista de
  // participantes aqui (só o resumo) — a lista completa sai em GET /participantes (exportação) e
  // no POST de importação abaixo.
  router.get('/grupos/:groupJid/info', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      // [AUDITORIA] BUG (achado 2026-08-06, print do usuário — "groupJid inválido"): o
      // `session_id` que GET /conversas devolve (usado pelo frontend como `activeChatId`) vem de
      // `split_part(m.remote_jid,'@',1)` — SEMPRE sem sufixo, inclusive pra grupo (`is_group` é
      // computado à parte, a partir do `remote_jid` completo, mas descartado do `phone`/
      // `session_id` resultante). Ou seja: toda chamada real do frontend pra esta rota chegava
      // com o groupJid SEM `@g.us`, rejeitada por este `endsWith` — 100% dos grupos, sempre, não
      // era um caso raro. [AUDITORIA] FIX APLICADO: normaliza (acrescenta `@g.us` se ausente) em
      // vez de rejeitar — rota só é chamada pelo frontend quando `chat.is_group` já é true, então
      // não há ambiguidade real sobre a intenção; pior caso de um id não-grupo chegar aqui por
      // engano é a Evolution devolver erro de "grupo não encontrado", não um risco de segurança.
      const groupJid = req.params.groupJid.endsWith('@g.us') ? req.params.groupJid : `${req.params.groupJid}@g.us`;
      const cfg = await resolverConfigGrupoAtivo(userId, req.query.instancia as string | undefined);
      if (!cfg) return res.status(409).json({ message: 'Nenhuma instância WhatsApp ativa configurada para esta conta.' });

      const info = await buscarInfoGrupo(cfg.url, cfg.api_key, cfg.instancia, groupJid);
      return res.json({
        subject: info.subject,
        pictureUrl: info.pictureUrl,
        desc: info.desc,
        size: info.size,
        creation: info.creation,
        totalParticipantes: info.participantes.length,
        // [AUDITORIA] LÓGICA (achado real do usuário, 2026-08-27): exposto pro frontend poder
        // mostrar "sem acesso a este grupo" em vez de só ficar com os campos vazios sem
        // explicação nenhuma — ver `mensagemFalhaGrupo()` acima pro texto usado nas outras rotas.
        erro: info.erro,
      });
    } catch (err: any) {
      log.error('WA_GROUP_INFO', 'Erro ao buscar info do grupo', { err: err?.message, stack: err?.stack });
      return res.status(500).json({ message: err.message });
    }
  });

  // POST /api/whatsapp/grupos/entrar — Sprint Grupos Entrar/Sair, 2026-09-06, pedido explícito do
  // usuário. [AUDITORIA] LÓGICA: endpoints confirmados lendo o código-fonte real da Evolution
  // rodando em produção (`whatsapp.baileys.service.js` dentro do container `evolution`, não
  // documentação de terceiro) — `GET /group/acceptInviteCode/:instance?inviteCode=` (aceita só o
  // CÓDIGO do convite, não a URL inteira; `groupAcceptInvite(e.inviteCode)` do Baileys por baixo)
  // e devolve `{accepted, groupJid}`. Aceita tanto a URL colada (`https://chat.whatsapp.com/XXX`)
  // quanto o código bruto, pra não depender do operador saber que precisa extrair só o código.
  router.post('/grupos/entrar', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const bruto = String(req.body?.link || '').trim();
      if (!bruto) return res.status(400).json({ message: 'Cole o link de convite do grupo.' });

      const match = bruto.match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/i);
      const inviteCode = (match ? match[1] : bruto).replace(/[^A-Za-z0-9]/g, '');
      if (!inviteCode) return res.status(400).json({ message: 'Não foi possível reconhecer um código de convite válido nesse link.' });

      const cfg = await resolverConfigGrupoAtivo(userId, req.body?.instancia as string | undefined);
      if (!cfg) return res.status(409).json({ message: 'Nenhuma instância WhatsApp ativa configurada para esta conta.' });

      const base = sanitizeEvolutionUrl(cfg.url);
      const r = await evolutionFetch(`${base}/group/acceptInviteCode/${cfg.instancia}?inviteCode=${encodeURIComponent(inviteCode)}`, {
        headers: { apikey: cfg.api_key },
      });
      if (!r.ok) {
        const corpoErro = await r.text().catch(() => '');
        log.warn('WA_GROUP_JOIN', 'Evolution recusou entrar no grupo', { status: r.status, corpoErro: corpoErro.slice(0, 300) });
        return res.status(409).json({ message: 'Não foi possível entrar no grupo — o link pode estar expirado, revogado, ou o grupo não aceita mais esse convite.' });
      }
      const data: any = await r.json().catch(() => ({}));
      const groupJid: string | null = data?.groupJid || null;

      // Busca nome/foto reais pra devolver já prontos (mesma fonte que GET /grupos/:jid/info usa)
      // e grava em `contatos` — sem isso, o grupo só ganharia nome/foto reais na PRÓXIMA vez que
      // alguém mandasse mensagem nele (fix orgânico já existente em webhook.ts); entrar deliberado
      // merece feedback imediato, não depender de esperar uma mensagem alheia.
      let nome: string | null = null;
      let foto: string | null = null;
      if (groupJid) {
        const info = await buscarInfoGrupo(cfg.url, cfg.api_key, cfg.instancia, groupJid);
        nome = info.subject;
        foto = info.pictureUrl;
        if (nome) {
          const grupoId = groupJid.split('@')[0];
          // [AUDITORIA] LÓGICA: `idx_contatos_user_tel_unique` é um índice único PARCIAL (`WHERE
          // telefone IS NOT NULL`, migrations.ts) — o `ON CONFLICT` só casa com ele repetindo a
          // mesma condição aqui, senão o Postgres recusa a query em runtime ("no unique or
          // exclusion constraint matching").
          await pool.query(
            `INSERT INTO contatos (user_id, telefone, nome, profile_pic_url, origem)
             VALUES ($1, $2, $3, $4, 'Grupo WhatsApp')
             ON CONFLICT (user_id, telefone) WHERE telefone IS NOT NULL DO UPDATE
               SET nome = EXCLUDED.nome, profile_pic_url = COALESCE(EXCLUDED.profile_pic_url, contatos.profile_pic_url), updated_at = NOW()`,
            [userId, grupoId, nome, foto]
          ).catch(err => log.warn('WA_GROUP_JOIN', 'Falha ao gravar nome/foto do grupo em contatos', { err: err?.message }));
        }
      }

      return res.json({ entrou: true, groupJid, nome, foto });
    } catch (err: any) {
      log.error('WA_GROUP_JOIN', 'Erro ao entrar no grupo', { err: err?.message, stack: err?.stack });
      return res.status(500).json({ message: err.message });
    }
  });

  // DELETE /api/whatsapp/grupos/:groupJid/sair — Sprint Grupos Entrar/Sair, 2026-09-06.
  // [AUDITORIA] LÓGICA: `DELETE /group/leaveGroup/:instance?groupJid=` confirmado no código-fonte
  // da Evolution (`groupLeave()` do Baileys por baixo) — sai de verdade do grupo no WhatsApp, a
  // conversa/histórico local NÃO é apagado (operador continua vendo o que já foi trocado, só não
  // recebe mensagens novas dali — mesmo espírito de "sair de uma conversa" no WhatsApp real, que
  // não apaga o histórico de quem saiu).
  router.delete('/grupos/:groupJid/sair', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const groupJid = req.params.groupJid.endsWith('@g.us') ? req.params.groupJid : `${req.params.groupJid}@g.us`;
      const cfg = await resolverConfigGrupoAtivo(userId, req.query.instancia as string | undefined);
      if (!cfg) return res.status(409).json({ message: 'Nenhuma instância WhatsApp ativa configurada para esta conta.' });

      const base = sanitizeEvolutionUrl(cfg.url);
      const r = await evolutionFetch(`${base}/group/leaveGroup/${cfg.instancia}?groupJid=${encodeURIComponent(groupJid)}`, {
        method: 'DELETE',
        headers: { apikey: cfg.api_key },
      });
      if (!r.ok) {
        const corpoErro = await r.text().catch(() => '');
        log.warn('WA_GROUP_LEAVE', 'Evolution recusou sair do grupo', { status: r.status, corpoErro: corpoErro.slice(0, 300) });
        return res.status(409).json({ message: 'Não foi possível sair do grupo — a instância pode já não ser membro, ou estar desconectada.' });
      }
      return res.json({ saiu: true, groupJid });
    } catch (err: any) {
      log.error('WA_GROUP_LEAVE', 'Erro ao sair do grupo', { err: err?.message, stack: err?.stack });
      return res.status(500).json({ message: err.message });
    }
  });

  // GET /api/whatsapp/link-preview?url= — Sprint Grupos — melhorias WhatsApp, 2026-09-06, pedido
  // explícito do usuário. [AUDITORIA] LÓGICA: sem `?instancia`/dono nenhum a validar aqui de
  // propósito — só precisa do JWT válido (já garantido pelo middleware global) pra evitar abrir
  // esta busca pra fora da aplicação; o preview em si (metadado Open Graph de uma URL pública) não
  // é dado de tenant nenhum, por isso o cache em `link_previews_cache` é global entre contas (ver
  // comentário completo na migration). Proteção real de SSRF vive em `buscarPreviewLink()`
  // (utils/linkPreview.ts) — nunca lança, sempre devolve `erro` no corpo pro frontend cair pro
  // texto cru sem quebrar o chat.
  router.get('/link-preview', async (req: AuthRequest, res: Response) => {
    try {
      const url = String(req.query.url || '').trim();
      if (!url) return res.status(400).json({ message: 'Parâmetro url é obrigatório.' });
      const preview = await buscarPreviewLink(pool, url);
      return res.json(preview);
    } catch (err: any) {
      log.error('LINK_PREVIEW', 'Erro inesperado ao buscar preview', { err: err?.message, stack: err?.stack });
      return res.status(500).json({ message: err.message });
    }
  });

  // POST /api/whatsapp/grupos/:groupJid/importar-contatos — importa os participantes reais do
  // grupo (sempre buscados frescos, nunca cacheados — cada chamada bate na Evolution de novo) como
  // contatos novos. [AUDITORIA] LÓGICA: contato que já existe (mesmo telefone, mesmo user_id)
  // NUNCA é sobrescrito — nem nome, nem qualquer outro campo, nem `lista_id` (se já pertence a
  // outra lista, permanece lá; a lista nova desta importação só recebe quem é genuinamente novo).
  // É dado de terceiro sem relação comercial direta (participante de grupo, não lead orgânico nem
  // importação intencional do operador), então `origem = 'Grupo WhatsApp'` (valor novo, distinto
  // de 'WhatsApp'/'Importado (Disparos)') marca a procedência — usado por StepContacts/
  // Disparos.tsx pra excluir esses contatos por padrão da opção "Todas as listas" (ver fix em
  // Disparos.tsx), sem impedir que o operador inclua explicitamente via tag/lista/estágio manual,
  // que já exige ação deliberada. [AUDITORIA] ATUALIZADO (Sprint Nome Real de Leads de Grupo,
  // 2026-08-26): nome agora passa pela cadeia de `resolverNomeParticipante()` antes de cair no
  // fallback antigo (nome = telefone, mesma convenção de `upsertContato()`/importação CSV quando
  // não há nome disponível) — `nome_verificado` grava explicitamente qual dos dois casos foi.
  // [AUDITORIA] FIX APLICADO (achado do usuário, 2026-08-06 — "não consigo encontrar eles nas
  // lista do CRM"): a importação nunca setava `lista_id`, então os contatos ficavam órfãos de
  // qualquer lista — apareciam em Leads/contatos, mas invisíveis na aba "Por Lista" de Disparos.
  // Agora cria (só se houver pelo menos 1 contato genuinamente novo — não cria lista vazia à toa,
  // mesmo espírito da sprint de "limpar listas vazias") uma lista nova por importação, nome no
  // mesmo padrão já usado pela importação de CSV/XLSX em Disparos.tsx
  // (`Importação ${arquivo} ${data}`): `Importação Grupo ${nomeDoGrupo} ${data}`.
  router.post('/grupos/:groupJid/importar-contatos', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const tenantId = await resolveOwnerId(userId);
      // [AUDITORIA] BUG/FIX APLICADO (mesmo achado do GET /grupos/:groupJid/info acima, ver
      // comentário completo lá — session_id de GET /conversas nunca tem @g.us, nem pra grupo).
      const groupJid = req.params.groupJid.endsWith('@g.us') ? req.params.groupJid : `${req.params.groupJid}@g.us`;
      const cfg = await resolverConfigGrupoAtivo(userId, req.body?.instancia as string | undefined);
      if (!cfg) return res.status(409).json({ message: 'Nenhuma instância WhatsApp ativa configurada para esta conta.' });

      const info = await buscarInfoGrupo(cfg.url, cfg.api_key, cfg.instancia, groupJid);
      const nomesDoGrupo = await buscarNomesParticipantesGrupo(cfg.url, cfg.api_key, cfg.instancia, groupJid);
      // [AUDITORIA] LÓGICA (achado do teste real em homolog, 2026-08-04): `info.participantes`
      // já vem filtrado só pra quem tem `phoneNumber` resolvido (ver buscarInfoGrupo) — pode ser
      // bem menor que `info.size` (total real do grupo) em grupos com "Linked ID"/privacidade
      // ativa. `semNumeroResolvido` comunica essa diferença pro operador em vez de deixar
      // parecer que a importação "perdeu" gente sem explicação.
      const totalNoGrupo = info.size ?? info.participantes.length;
      const semNumeroResolvido = Math.max(0, totalNoGrupo - info.participantes.length);
      if (!info.participantes.length) {
        return res.status(502).json({ message: mensagemFalhaGrupo(info, groupJid) });
      }

      let novos = 0;
      let jaExistiam = 0;
      let descartados = 0;
      let nomesResolvidos = 0;
      let listaId: string | null = null;
      let listaNome: string | null = null;
      // [AUDITORIA] LÓGICA (Higienização, Fase 1): antes, participante que já existia na conta era
      // ignorado (`jaExistiam++; continue`) — o contato ficava só na lista antiga e a lista nova
      // do grupo nascia incompleta. Agora: normaliza (descarta inválido), resolve TODOS os
      // existentes numa consulta só (antes: 1 consulta por participante, com ILIKE sem índice) e
      // VINCULA quem já existe à lista nova (N:N, `contato_listas`) sem alterar nenhum dado dele.
      let vinculados = 0;
      const garantirLista = async () => {
        if (listaId) return;
        const agora = new Date();
        const dataFormatada = `${String(agora.getDate()).padStart(2, '0')}/${String(agora.getMonth() + 1).padStart(2, '0')}/${agora.getFullYear()}`;
        listaNome = `Importação Grupo ${info.subject || groupJid} ${dataFormatada}`;
        const listaRes = await pool.query(
          `INSERT INTO listas (user_id, nome) VALUES ($1, $2) RETURNING id`,
          [tenantId, listaNome]
        );
        listaId = listaRes.rows[0].id;
      };

      const candidatosGrupo: { p: (typeof info.participantes)[number]; n: ReturnType<typeof normalizarTel> }[] = [];
      for (const p of info.participantes) {
        const n = normalizarTel(p.telefone);
        if (n.tipo === 'invalido') { descartados++; continue; }
        candidatosGrupo.push({ p, n });
      }

      const idPorSufixo = new Map<string, string>();
      if (candidatosGrupo.length) {
        const sufixos = candidatosGrupo.map(c => (c.n.normalizado as string).slice(-11));
        const existentesRes = await pool.query(
          `SELECT id, telefone, telefone_normalizado FROM contatos
           WHERE user_id = $1 AND telefone IS NOT NULL
             AND (RIGHT(regexp_replace(telefone, '\\D', '', 'g'), 11) = ANY($2::text[])
                  OR RIGHT(telefone_normalizado, 11) = ANY($2::text[]))`,
          [tenantId, sufixos]
        );
        for (const e of existentesRes.rows) {
          idPorSufixo.set(String(e.telefone).replace(/\D/g, '').slice(-11), e.id);
          if (e.telefone_normalizado) idPorSufixo.set(String(e.telefone_normalizado).slice(-11), e.id);
        }
      }

      const idsParaVincular: string[] = [];
      const novosGrupo: typeof candidatosGrupo = [];
      for (const c of candidatosGrupo) {
        const existenteId = idPorSufixo.get((c.n.normalizado as string).slice(-11));
        if (existenteId) { jaExistiam++; idsParaVincular.push(existenteId); } else novosGrupo.push(c);
      }

      if (idsParaVincular.length || novosGrupo.length) await garantirLista();
      if (idsParaVincular.length && listaId) {
        const v = await pool.query(
          `INSERT INTO contato_listas (contato_id, lista_id, user_id, origem)
           SELECT unnest($1::uuid[]), $2::uuid, $3::uuid, 'grupo'
           ON CONFLICT (contato_id, lista_id) DO NOTHING
           RETURNING contato_id`,
          [Array.from(new Set(idsParaVincular)), listaId, tenantId]
        );
        vinculados = v.rowCount ?? 0;
      }

      for (const c of novosGrupo) {
        const p = c.p;

        // [AUDITORIA] LÓGICA: lista criada só na primeira vez que há de fato um contato novo pra
        // inserir (lazy) — grupo onde todo mundo já existia como contato não sobra com uma lista
        // vazia à toa. `data-fns`/`toLocaleDateString` evitados de propósito (dependem de dados
        // ICU que nem sempre estão presentes numa imagem Node enxuta) — formatação manual dd/mm/aaaa.
        await garantirLista();

        // [AUDITORIA] LÓGICA (Sprint Nome Real de Leads de Grupo, 2026-08-26): antes disso, nome
        // nascia sempre igual ao telefone (Evolution não devolvia nome nenhum). Agora tenta a
        // cadeia de resolução primeiro — `contatos` já foi checado acima (linha ~697), então a
        // 1ª camada da cadeia é sempre um no-op aqui (participante novo por definição não é
        // contato existente); as camadas que importam de fato neste ponto são push_name de
        // conversa individual e o nome vindo de `group/participants`. Sem fonte nenhuma, cai no
        // telefone (comportamento antigo, preservado como último recurso) — mas agora
        // `nome_verificado` deixa explícito pro resto do sistema (export, Disparos) que esse
        // "nome" não é confiável.
        const nomeResolvido = await resolverNomeParticipante(tenantId, p.telefone, nomesDoGrupo);
        const notas = p.admin ? `Admin do grupo "${info.subject || groupJid}"` : '';
        const nomeLimpo = resolverNomeLimpo(nomeResolvido, null, p.telefone);
        const inserted = await pool.query(
          `INSERT INTO contatos (user_id, nome, telefone, origem, status, notas, lista_id, nome_verificado,
                                 telefone_original, telefone_normalizado, tipo_telefone, primeiro_nome, nome_confiavel, whatsapp_status)
           VALUES ($1, $2, $3, 'Grupo WhatsApp', 'novo', $4, $5, $6, $3, $7, $8, $9, $10, $11)
           ON CONFLICT (user_id, telefone) WHERE telefone IS NOT NULL DO NOTHING
           RETURNING id`,
          [tenantId, nomeResolvido || p.telefone, p.telefone, notas, listaId, !!nomeResolvido,
           c.n.normalizado, c.n.tipo, nomeLimpo.primeiroNome, nomeLimpo.confiavel, c.n.tipo === 'fixo' ? 'sem_whatsapp' : 'pendente']
        ).catch(err => {
          log.warn('WA_GROUP_IMPORT', 'Falha ao inserir participante', { telefone: p.telefone, err: err?.message });
          return { rows: [] as any[] };
        });
        if (inserted.rows.length) { novos++; if (nomeResolvido) nomesResolvidos++; } else jaExistiam++; // corrida com outro insert concorrente — trata como "já existia"
      }

      log.info('WA_GROUP_IMPORT', 'Importação de contatos de grupo concluída', {
        userId: tenantId, groupJid, novos, jaExistiam, vinculados, descartados, semNumeroResolvido, totalNoGrupo, listaId, listaNome, nomesResolvidos,
      });

      return res.json({
        novos, jaExistiam, vinculados, descartados, semNumeroResolvido, nomesResolvidos,
        totalParticipantes: info.participantes.length,
        totalNoGrupo,
        grupoNome: info.subject,
        listaId,
        listaNome,
      });
    } catch (err: any) {
      log.error('WA_GROUP_IMPORT', 'Erro ao importar contatos do grupo', { err: err?.message, stack: err?.stack });
      return res.status(500).json({ message: err.message });
    }
  });

  router.get('/conversas', async (req: AuthRequest, res: Response) => {
    log.info('WHATSAPP', 'request recebida', { method: req.method, path: req.path, userId: req.userId, query: req.query });
    try {
      const userId = req.userId!;
      const showArchived = req.query.archived === 'true';
      // Filtros aplicados ANTES do LIMIT 300 (antes eram só no navegador, sobre a lista já
      // cortada — um filtro podia parecer vazio mesmo com dados no banco).
      const apenasGrupos = req.query.grupos === 'true';
      const numeroFiltro = typeof req.query.numero === 'string' && req.query.numero.trim() ? req.query.numero.trim() : null;
      const tenantId = await resolveOwnerId(userId); // Carrega o ID do dono da conta
      // [AUDITORIA] FIX APLICADO (2026-07-21): setDbUserId(tenantId) -- a query abaixo filtra
      // por tenantId (dono da equipe), não pelo userId bruto; RLS precisa ver o mesmo id.
      // Piloto em whatsapp_messages, só homologação (ver diagnosticos/AUDITORIA_LOG.md).
      await req.setDbUserId!(tenantId);
      const db = await req.getDb!();

      const r = await db.query(
        `WITH ranked AS (
           SELECT
             split_part(m.remote_jid,'@',1) AS phone,
             m.instance_name,
             m.content,
             m.from_me,
             m.created_at,
             m.message_id,
             m.remote_jid LIKE '%@g.us' AS is_group,
             m.push_name AS last_sender,
             COUNT(*) OVER (PARTITION BY split_part(m.remote_jid,'@',1)) AS total,
             ROW_NUMBER() OVER (
               PARTITION BY split_part(m.remote_jid,'@',1)
               ORDER BY m.created_at DESC
             ) AS rn
           FROM whatsapp_messages m
           WHERE m.user_id = $1 AND m.deleted_at IS NULL
         ),
         contato_unico AS (
           SELECT DISTINCT ON (RIGHT(telefone, 11))
             RIGHT(telefone, 11) AS sufixo,
             COALESCE(push_name, nome) AS push_name,
             COALESCE(nome, push_name) AS nome_contato,
             COALESCE(profile_pic_url) AS profile_pic_url,
             is_pinned,
             is_archived,
             muted_until
           FROM contatos
           WHERE user_id = $1 AND telefone IS NOT NULL
           ORDER BY RIGHT(telefone, 11), updated_at DESC NULLS LAST
         ),
         -- [AUDITORIA] BUG (achado 2026-07-28, "quase todos os grupos aparecem como numero, sem
         -- foto"): este JOIN sempre excluiu grupos (AND NOT r.is_group) e nunca existiu
         -- caminho nenhum que buscasse nome/foto reais de grupo (ver buscarInfoGrupo em
         -- whatsappMediaStorage.ts para o achado completo) - resultado: nome sintetizado
         -- (Grupo XXXX) e foto nula pra 100% dos grupos, sempre, nao uma falha intermitente.
         -- [AUDITORIA] FIX APLICADO: CTE separada com match EXATO de telefone (JID de grupo e
         -- um ID arbitrario longo, nao um telefone BR - o sufixo de 11 digitos usado acima pra
         -- contato pessoal criaria risco real de colisao entre grupos diferentes).
         grupo_unico AS (
           SELECT telefone AS grupo_id, nome AS nome_grupo, profile_pic_url AS grupo_pic
           FROM contatos
           WHERE user_id = $1 AND telefone IS NOT NULL
         )
         SELECT
           r.phone AS session_id,
           r.instance_name AS instancia,
           -- [AUDITORIA] LÓGICA (Sprint Grupos Somem com Instância Duplicada, 2026-09-04):
           -- instancia acima é só o instance_name cru da última mensagem — não sobrevive a
           -- reconexão sob um nome novo pro mesmo número (ver comentário completo na migration de
           -- whatsapp_instance_numeros). numero aqui é a identidade estável (resolvida pelo
           -- ledger, populado pelo cron de reconciliação a cada 15min); cai pro próprio
           -- instance_name quando o ledger ainda não tem esse registro (instância nunca vista
           -- pela reconciliação, ou dado histórico anterior a esta sprint) — nunca fica nulo, pra
           -- não quebrar o filtro por número no frontend.
           COALESCE(win.numero, r.instance_name) AS numero,
           r.created_at AS ultima_atividade,
           r.total::int AS total,
           r.content AS ultima_mensagem,
           r.is_group,
           r.last_sender,
           CASE WHEN r.from_me THEN 'assistant' ELSE 'user' END AS ultimo_role,
           cu.push_name,
           cu.nome_contato,
           cu.profile_pic_url,
           gu.nome_grupo,
           gu.grupo_pic,
           COALESCE(cu.is_pinned, false) AS is_pinned,
           COALESCE(cu.is_archived, false) AS is_archived,
           cu.muted_until
         FROM ranked r
         LEFT JOIN contato_unico cu ON cu.sufixo = RIGHT(r.phone, 11) AND NOT r.is_group
         LEFT JOIN grupo_unico gu ON gu.grupo_id = r.phone AND r.is_group
         LEFT JOIN whatsapp_instance_numeros win ON win.instance_name = r.instance_name
         WHERE r.rn = 1
           AND COALESCE(cu.is_archived, false) = $2
           AND ($3::boolean IS NOT TRUE OR r.is_group)
           AND ($4::text IS NULL OR COALESCE(win.numero, r.instance_name) = $4::text)
         -- [AUDITORIA] BUG (achado 2026-09-18 — "já tá conectado mas não aparece os grupos",
         -- mesma investigação do ledger instância-número): cu.is_pinned só existe pra contato
         -- individual (o LEFT JOIN de contato_unico exige NOT r.is_group) — pra TODO grupo esse
         -- campo é sempre NULL. DESC NULLS LAST manda todo NULL pro fim da ordenação INTEIRA,
         -- depois de QUALQUER conversa individual não-nula (mesmo as com is_pinned=false,
         -- antigas) — não só depois das fixadas. Com mais de 300 conversas individuais nesta
         -- conta, isso empurra 100 por cento dos grupos pra fora do LIMIT sempre, não importa
         -- quão recente a última mensagem do grupo seja. [AUDITORIA] FIX APLICADO: COALESCE com
         -- false antes do DESC — grupo passa a competir por posição na mesma escala 0/1 que
         -- conversa individual não fixada, ordenado por recência de verdade dali pra baixo, como
         -- já era o comportamento pretendido (só fixados no topo).
         ORDER BY COALESCE(cu.is_pinned, false) DESC, r.created_at DESC
         LIMIT 300`,
        [tenantId, showArchived, apenasGrupos, numeroFiltro]
      );

      const conversas = r.rows.map(row => {
        const isGroup = row.is_group;
        // [AUDITORIA] FIX APLICADO: nome/foto reais de grupo (quando já sincronizados via
        // buscarInfoGrupo, webhook.ts) têm prioridade; "Grupo XXXX" e foto nula continuam como
        // fallback pros grupos ainda não sincronizados (nenhuma mensagem nova desde o fix, ou
        // a minoria de grupos que a Evolution não devolve subject/foto — ver comentário em
        // buscarInfoGrupo).
        const nomeFormatado = isGroup
          ? (row.nome_grupo || `Grupo ${row.session_id.split('-')[0]?.slice(-4) ?? row.session_id.slice(-8)}`)
          : (row.nome_contato || row.push_name || row.session_id.replace(/^55/, '').replace(/(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3'));
        return {
          session_id: row.session_id,
          instancia: row.instancia,
          numero: row.numero,
          is_group: isGroup,
          nome: nomeFormatado,
          push_name: isGroup ? (row.last_sender || null) : (row.push_name || null),
          profile_pic_url: (isGroup ? row.grupo_pic : row.profile_pic_url) || null,
          ultima_atividade: row.ultima_atividade,
          ultima_mensagem: row.ultima_mensagem || '',
          ultimo_role: row.ultimo_role,
          total: Number(row.total),
          is_pinned: row.is_pinned || false,
          is_archived: row.is_archived || false,
          muted_until: row.muted_until || null,
          mensagens: [],
        };
      });

      return res.json(conversas);
    } catch (err: any) {
      log.error('WHATSAPP conversas', 'Erro ao buscar conversas', { err: err?.message, stack: err?.stack });
      return res.status(500).json({ message: err.message });
    }
  });

  router.get('/conversas/:phone', async (req: AuthRequest, res: Response) => {
    log.info('WHATSAPP', 'request recebida', { method: req.method, path: req.path, userId: req.userId, params: req.params });
    try {
      const userId = req.userId!;
      const phone = normalizarPhoneParam(decodeURIComponent(req.params.phone));
      if (!phone || phone.length < 8) return res.status(400).json({ message: 'Telefone inválido' });

      const limit = Math.min(Number(req.query.limit) || 100, 500);
      // Cursor de paginação pra "carregar mensagens mais antigas": timestamp da mensagem mais
      // antiga já carregada no front. Sem isso (e sem `before`), a busca sempre pega as mais
      // RECENTES `limit` mensagens — ver [AUDITORIA] BUG abaixo sobre o comportamento antigo.
      const beforeRaw = req.query.before ? new Date(String(req.query.before)) : null;
      const before = beforeRaw && !isNaN(beforeRaw.getTime()) ? beforeRaw.toISOString() : null;
      const tenantId = await resolveOwnerId(userId);
      // [AUDITORIA] FIX APLICADO (2026-07-21): piloto de RLS em whatsapp_messages, só
      // homologação (ver diagnosticos/AUDITORIA_LOG.md).
      await req.setDbUserId!(tenantId);
      const db = await req.getDb!();

      // [AUDITORIA] BUG (achado no rastreio de "não consigo subir mensagens antigas",
      // 2026-07-26): esta query ordenava ASC e aplicava LIMIT/OFFSET direto no resultado
      // ascendente — com offset=0 (o front nunca mandava offset) isso sempre retornava as
      // `limit` mensagens MAIS ANTIGAS da conversa, não as mais recentes. Numa conversa com mais
      // de `limit` mensagens, o usuário nunca via as mensagens novas, e não havia como buscar as
      // que ficaram de fora. [AUDITORIA] FIX APLICADO: busca as `limit` mais recentes (ou mais
      // recentes anteriores a `before`, pro scroll-up carregar mais antigas) via ORDER BY DESC,
      // depois reverte pra ordem cronológica (ASC) antes de responder — mantém o formato de
      // resposta que o front já espera.
      const r = await db.query(
        `SELECT
           m.id, m.message_id, m.from_me, m.message_type, m.content,
           m.media_url, m.media_mimetype, m.status, m.push_name,
           m.timestamp_wa, m.created_at, m.is_read, m.fixada,
           COALESCE(s.status, m.status) AS delivery_status,
           u.display_name AS sender_name
         FROM whatsapp_messages m
         LEFT JOIN whatsapp_message_status s
           ON s.message_id = m.message_id AND s.instance_name = m.instance_name
         LEFT JOIN users u ON u.id = m.sent_by_user_id
         WHERE split_part(m.remote_jid, '@', 1) = $1
           AND m.user_id = $2
           AND m.deleted_at IS NULL
           AND ($4::timestamptz IS NULL OR COALESCE(m.timestamp_wa, m.created_at) < $4::timestamptz)
         ORDER BY COALESCE(m.timestamp_wa, m.created_at) DESC
         LIMIT $3`,
        [phone, tenantId, limit, before]
      );

      const mensagens = r.rows.reverse().map(row => ({
        id: row.id,
        message_id: row.message_id,
        role: row.from_me ? 'assistant' : 'user',
        content: row.content || '',
        push_name: row.push_name || null,
        tipo: row.message_type,
        midia_url: row.media_url,
        midia_mime: row.media_mimetype,
        midia_nome: null,
        status: row.delivery_status || row.status,
        is_read: row.is_read ?? false,
        sender_name: row.sender_name || null,
        created_at: row.created_at,
        timestamp_wa: row.timestamp_wa,
        fixada: row.fixada || false,
      }));

      return res.json(mensagens);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  router.get('/status/:phone', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const phone = normalizarPhoneParam(decodeURIComponent(req.params.phone));
      const tenantId = await resolveOwnerId(userId);
      // [AUDITORIA] FIX APLICADO (2026-07-21): piloto de RLS em whatsapp_messages, só
      // homologação (ver diagnosticos/AUDITORIA_LOG.md).
      await req.setDbUserId!(tenantId);
      const db = await req.getDb!();
      const r = await db.query(
        `SELECT m.message_id, COALESCE(s.status, m.status) AS status, m.created_at
         FROM whatsapp_messages m
         LEFT JOIN whatsapp_message_status s
           ON s.message_id = m.message_id AND s.instance_name = m.instance_name
         WHERE split_part(m.remote_jid, '@', 1) = $1 AND m.user_id = $2 AND m.from_me = true AND m.deleted_at IS NULL
         ORDER BY m.created_at DESC LIMIT 50`,
        [phone, tenantId]
      );
      return res.json(r.rows);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  router.get('/ia-status/:phone', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const phone = decodeURIComponent(req.params.phone).replace(/\D/g, '');
      const tenantId = await resolveOwnerId(userId);
      const r = await pool.query(
        `SELECT atendente_pausou_ia, nome, push_name
         FROM contatos
         WHERE user_id = $1 AND telefone ILIKE $2
         LIMIT 1`,
        [tenantId, `%${phone.slice(-11)}`]
      );
      const pausada = r.rows.length > 0 ? (r.rows[0].atendente_pausou_ia === true) : false;
      return res.json({ pausada, contato: r.rows[0] || null });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  router.post('/ia-toggle', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const { phone, pausar } = req.body as { phone: string; pausar: boolean };
      if (!phone) return res.status(400).json({ message: 'phone obrigatório' });
      const phoneClean = phone.replace(/\D/g, '');
      const suffix = `%${phoneClean.slice(-11)}`;
      const tenantId = await resolveOwnerId(userId);

      const upd = await pool.query(
        `UPDATE contatos SET atendente_pausou_ia = $1
         WHERE user_id = $2 AND telefone ILIKE $3`,
        [pausar, tenantId, suffix]
      );

      if (!upd.rowCount) {
        await pool.query(
          `INSERT INTO contatos (user_id, nome, telefone, origem, status, atendente_pausou_ia)
           VALUES ($1, $2, $3, 'WhatsApp', 'novo', $4)`,
          [tenantId, phoneClean, phoneClean, pausar]
        ).catch(() => {});
      }

      await pool.query(
        `UPDATE dados_cliente SET atendimento_ia = $1
         WHERE user_id = $2 AND telefone ILIKE $3`,
        [pausar ? 'pause' : 'ativo', tenantId, suffix]
      ).catch(() => {});

      return res.json({ ok: true, pausada: pausar });
    } catch (err: any) {
      log.error('IA-TOGGLE', 'Erro', { err: err?.message, stack: err?.stack });
      return res.status(500).json({ message: err.message });
    }
  });

  router.patch('/contato/:phone', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const phone = decodeURIComponent(req.params.phone).replace(/\D/g, '');
      const { nome } = req.body as { nome: string };
      if (!nome?.trim()) return res.status(400).json({ message: 'nome é obrigatório' });
      const tenantId = await resolveOwnerId(userId);

      const r = await pool.query(
        `UPDATE contatos SET nome = $1
         WHERE user_id = $2 AND telefone ILIKE $3
         RETURNING id, nome, telefone, push_name, profile_pic_url`,
        [nome.trim(), tenantId, `%${phone.slice(-11)}`]
      );

      if (!r.rowCount) {
        const ins = await pool.query(
          `INSERT INTO contatos (user_id, nome, telefone, origem, status, atendente_pausou_ia)
           VALUES ($1, $2, $3, 'WhatsApp', 'novo', false)
           RETURNING id, nome, telefone, push_name, profile_pic_url`,
          [tenantId, nome.trim(), phone]
        );
        return res.json(ins.rows[0]);
      }
      return res.json(r.rows[0]);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  router.get('/logs-ia', async (req: AuthRequest, res: Response) => {
    try {
      const r = await pool.query(
        `SELECT session_id AS telefone, message, created_at, instancia
         FROM n8n_chat_histories
         WHERE user_id = $1
         ORDER BY created_at DESC LIMIT 100`,
        [req.userId]
      );
      return res.json(r.rows.map((row: any) => {
        const m = typeof row.message === 'string'
          ? JSON.parse(row.message) : row.message;
        return {
          telefone: row.telefone,
          role: m.role || m.type || 'unknown',
          content: (m.content || m.text || '').slice(0, 300),
          created_at: row.created_at,
          instancia: row.instancia,
        };
      }));
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  router.get('/debug-agente', async (req: AuthRequest, res: Response) => {
    try {
      const agentes = await pool.query(
        `SELECT id, nome, evolution_instancia, evolution_server_url, ativo
         FROM agentes WHERE user_id = $1`,
        [req.userId]
      );
      const integracoes = await pool.query(
        `SELECT instancia, url, status, updated_at
         FROM integracoes_config WHERE user_id = $1 AND tipo = 'evolution'`,
        [req.userId]
      );
      // [AUDITORIA] FIX APLICADO (2026-07-21): piloto de RLS em whatsapp_messages, só
      // homologação (ver diagnosticos/AUDITORIA_LOG.md).
      const ultimaMensagem = await (await req.getDb!()).query(
        `SELECT created_at, instance_name FROM whatsapp_messages
         WHERE user_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`,
        [req.userId]
      );
      const provider = await pool.query(
        `SELECT nome, slug, modelo, ativo FROM ai_providers
         WHERE user_id = $1 AND ativo = true LIMIT 1`,
        [req.userId]
      );
      // [AUDITORIA] LÓGICA (Sprint 1 unificação, 2026-08-07): resumo de config "ativa" repontado
      // de `agent_configs` (removida) pra `agentes` — mesma linha mais recente que agentEngine.ts
      // usaria de verdade pra essa instância.
      const agentAtivo = await pool.query(
        `SELECT nome, modelo,
                (prompt_sistema IS NOT NULL AND prompt_sistema != '') AS tem_prompt
         FROM agentes WHERE user_id = $1 AND ativo = true ORDER BY updated_at DESC LIMIT 1`,
        [req.userId]
      );
      return res.json({
        agentes: agentes.rows,
        integracoes: integracoes.rows,
        ultima_mensagem: ultimaMensagem.rows[0] || null,
        provider: provider.rows[0] || null,
        agente_ativo: agentAtivo.rows[0] || null,
      });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  router.get('/contatos-search', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const q = ((req.query.q as string) || '').trim();
      if (!q) return res.json([]);
      const r = await pool.query(
        `SELECT id, nome, telefone, push_name, status
         FROM contatos
         WHERE user_id = $1
           AND (nome ILIKE $2 OR telefone ILIKE $2 OR push_name ILIKE $2)
           AND telefone IS NOT NULL AND telefone <> ''
         ORDER BY nome ASC LIMIT 20`,
        [userId, `%${q}%`]
      );
      return res.json(r.rows);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  router.get('/media', async (req: AuthRequest, res: Response) => {
    try {
      const mediaUrl = (req.query.url as string || '').trim();
      if (!mediaUrl) return res.status(400).json({ message: 'url inválida' });

      // [AUDITORIA] LÓGICA: mídia decriptografada e salva localmente (ver
      // utils/whatsappMediaStorage.ts) grava media_url como `local://userId/arquivo` em vez da
      // URL crua da Evolution. Serve direto do disco privado (fora de UPLOADS_DIR, que é público
      // sem autenticação) — confere ownership consultando a própria linha da mensagem antes de
      // entregar o arquivo, pra um usuário não conseguir puxar mídia de outro tenant só
      // adivinhando/reusando um valor de `url`.
      if (mediaUrl.startsWith('local://')) {
        const resolvido = resolverCaminhoLocal(mediaUrl);
        if (!resolvido) return res.status(400).json({ message: 'url local inválida' });

        const tenantId = await resolveOwnerId(req.userId!);
        const check = await pool.query(
          `SELECT media_mimetype FROM whatsapp_messages WHERE user_id = $1 AND media_url = $2 LIMIT 1`,
          [tenantId, mediaUrl]
        ).catch(() => ({ rows: [] as any[] }));
        if (!check.rows.length) return res.status(404).json({ message: 'Mídia não encontrada' });

        try {
          const buf = await fs.readFile(resolvido.caminho);
          res.setHeader('Content-Type', check.rows[0].media_mimetype || 'application/octet-stream');
          res.setHeader('Cache-Control', 'private, max-age=3600');
          res.setHeader('Accept-Ranges', 'bytes');
          return res.send(buf);
        } catch {
          return res.status(404).json({ message: 'Arquivo de mídia não encontrado em disco' });
        }
      }

      // [AUDITORIA] LÓGICA (2026-07-23): mesmo esquema do `local://` acima, mas pra fotos de
      // perfil (marcador `local-pic://userId/arquivo`, ver whatsappMediaStorage.ts) — ownership
      // confere contra `contatos` em vez de `whatsapp_messages`. Sempre JPEG (é o formato que a
      // Evolution/WhatsApp sempre devolve pra foto de perfil, não precisa de coluna própria de
      // mimetype só pra isso).
      if (mediaUrl.startsWith('local-pic://')) {
        const resolvido = resolverCaminhoLocalFoto(mediaUrl);
        if (!resolvido) return res.status(400).json({ message: 'url local inválida' });

        const tenantId = await resolveOwnerId(req.userId!);
        const check = await pool.query(
          `SELECT 1 FROM contatos WHERE user_id = $1 AND (foto_perfil = $2 OR profile_pic_url = $2) LIMIT 1`,
          [tenantId, mediaUrl]
        ).catch(() => ({ rows: [] as any[] }));
        if (!check.rows.length) return res.status(404).json({ message: 'Foto não encontrada' });

        try {
          const buf = await fs.readFile(resolvido.caminho);
          res.setHeader('Content-Type', 'image/jpeg');
          res.setHeader('Cache-Control', 'private, max-age=3600');
          return res.send(buf);
        } catch {
          return res.status(404).json({ message: 'Arquivo de foto não encontrado em disco' });
        }
      }

      if (!/^https?:\/\//.test(mediaUrl)) {
        return res.status(400).json({ message: 'url inválida' });
      }

      const cfg = await getEvolutionConfig(req.userId!);

      // [AUDITORIA] FIX APLICADO: ver comentário completo em isMediaHostAllowed() — bloqueia
      // SSRF via ?url= apontando pra host interno/arbitrário antes de qualquer fetch.
      if (!isMediaHostAllowed(mediaUrl, cfg.url)) {
        log.warn('WHATSAPP', 'GET /media: host não permitido, requisição bloqueada', { userId: req.userId, host: (() => { try { return new URL(mediaUrl).hostname; } catch { return mediaUrl.slice(0, 80); } })() });
        return res.status(400).json({ message: 'Host de mídia não permitido' });
      }

      let mediaRes = await evolutionFetch(mediaUrl, {
        headers: { apikey: cfg.api_key },
      }).catch(() => null);

      if (!mediaRes || !mediaRes.ok) {
        mediaRes = await evolutionFetch(mediaUrl).catch(() => null);
      }

      if (!mediaRes || !mediaRes.ok) {
        return res.status(502).json({ message: 'Mídia não disponível' });
      }

      const contentType = mediaRes.headers.get('content-type') || 'application/octet-stream';
      const contentLength = mediaRes.headers.get('content-length');

      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.setHeader('Accept-Ranges', 'bytes');
      if (contentLength) res.setHeader('Content-Length', contentLength);

      const buf = await mediaRes.arrayBuffer();
      return res.send(Buffer.from(buf));
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  router.post('/status', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const cfg = await getEvolutionConfig(userId);
      const base = cfg.url.replace(/\/$/, '');

      // [AUDITORIA] FIX APLICADO (2026-07-22): `instancia` vinha do body sem checagem de
      // ownership — mesma classe de bug corrigida em DELETE /instances/:name (ver
      // diagnosticos/AUDITORIA_LOG.md, incidente stefanocatedral@hotmail.com). Esta rota não é
      // destrutiva (só consulta status e pode re-registrar webhook), mas re-registrar o
      // webhook de outra instância sem ela pertencer ao usuário não deveria ser possível de
      // jeito nenhum. Mesmo padrão de checagem já usado em /send (instanciaSolicitada).
      const instanciaSolicitada = (req.body?.instancia as string | undefined) || undefined;
      let instancia = cfg.instancia;
      if (instanciaSolicitada && instanciaSolicitada !== cfg.instancia) {
        const instRes = await pool.query(
          `SELECT 1 FROM integracoes_config WHERE user_id = $1 AND instancia = $2 AND tipo = 'evolution'
           UNION
           SELECT 1 FROM agentes WHERE user_id = $1 AND evolution_instancia = $2
           LIMIT 1`,
          [userId, instanciaSolicitada]
        ).catch(() => ({ rows: [] as any[] }));
        if (instRes.rows.length) {
          instancia = instanciaSolicitada;
        } else {
          log.warn('WHATSAPP', 'POST /status: instância solicitada não pertence ao usuário — ignorando', { userId, instanciaSolicitada });
        }
      }

      const r = await evolutionFetch(`${base}/instance/connectionState/${instancia}`, {
        headers: { apikey: cfg.api_key },
      }).catch(() => null);

      if (!r) {
        return res.status(503).json({ state: 'close', error: true, message: 'Evolution API inacessível ou offline.', instancia: instancia });
      }

      if (r.status === 401) {
        log.warn('WHATSAPP', 'Evolution retornou 401 para instância', { instancia });
        return res.json({
          state: 'unauthorized',
          message: 'Sessão expirada ou API Key inválida. Por favor, reconecte.',
          instancia: instancia
        });
      }

      // [AUDITORIA] FIX APLICADO: antes, qualquer erro HTTP não-401 (502/500/503) da Evolution
      // virava silenciosamente 'state: close' sem indicar a falha real — mesma classe de bug já
      // corrigida em /poll-qr e /connect, aplicada aqui.
      if (!r.ok) {
        const errorText = await r.text().catch(() => 'Erro desconhecido');
        return res.status(r.status).json({
          state: 'close',
          error: true,
          code: r.status,
          message: `Evolution API erro (${r.status}): ${errorText.slice(0, 150)}`,
          instancia: instancia,
        });
      }

      const data: any = await r.json().catch(() => ({}));
      const state = data?.instance?.state || data?.state || data?.status || 'close';
      // [AUDITORIA] FIX APLICADO (2026-08-07): ver buscarPhoneNumberInstancia() — connectionState
      // não devolve profile/owner, essa extração sempre voltava vazia antes.
      const isOpen = state === 'open' || state === 'connected' || state === 'CONNECTED';
      const phoneNumber = isOpen ? await buscarPhoneNumberInstancia(base, cfg.api_key, instancia) : '';

      if (isOpen) {
        registrarWebhook(base, cfg.api_key, instancia).catch(() => {});
      }

      return res.json({ state, phoneNumber, instancia: instancia });
    } catch (err: any) {
      return res.json({ state: 'close', instancia: null, error: err.message });
    }
  });

  router.post('/register-webhook', async (req: AuthRequest, res: Response) => {
    try {
      const cfg = await getEvolutionConfig(req.userId!);
      const base = cfg.url.replace(/\/$/, '');
      await registrarWebhook(base, cfg.api_key, cfg.instancia);
      return res.json({ ok: true, instancia: cfg.instancia, webhookUrl: WEBHOOK_URL });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // POST /api/whatsapp/connect — cria instância e retorna QR code
  router.post('/connect', async (req: AuthRequest, res: Response) => {
    const userId = req.userId!;
    const lockKey = `connect:${userId}`;

    if (connectingUsers.has(lockKey)) {
      return res.status(429).json({ message: 'Conexão em andamento. Aguarde 30s e tente novamente.' });
    }

    connectingUsers.add(lockKey);
    const timeout = setTimeout(() => connectingUsers.delete(lockKey), 30_000);

    try {
      const cfg = await getEvolutionConfig(userId);
      const base = cfg.url.replace(/\/$/, '');

      // [AUDITORIA] LÓGICA (Sprint 1 — multi-instância, 2026-07-23): `nova_conexao: true` pede
      // explicitamente um NÚMERO NOVO pro mesmo tenant, em vez de reconectar/reutilizar a
      // instância padrão — sem isso, todo POST /connect resolvia sempre pro mesmo nome
      // determinístico e, se já estivesse aberta, devolvia "já conectado" sem meio de escapar
      // (era isso que impedia conectar um segundo WhatsApp). A instância padrão (sem sufixo)
      // nunca muda — só entra sufixo `_2`, `_3`... quando já existe a anterior.
      const tenantId = await resolveOwnerId(userId);
      const conhecidas = await instanciasConhecidas(tenantId);

      // [AUDITORIA] BUG GRAVE CORRIGIDO (achado 2026-08-10 — cliente real em loop de LOGOUT 401
      // na Evolution, número caindo repetidamente): `nova_conexao:true` é o ÚNICO caminho que
      // sobra na UI quando o card antigo em `agentes` já não existe mais (ex: apagado sem
      // querer, ou nunca sincronizado) — "Conectar nova instância" manda essa flag, mesmo quando
      // a intenção real é só RECONECTAR o número que a pessoa já tem. Sem este guard,
      // `proximaInstanciaLivre()` sempre mintava um nome novo (_2, _3...) cegamente, sem checar
      // se o número já tinha uma sessão aberta sob outro nome. Cada nome novo = um "aparelho
      // conectado" novo pro MESMO número WhatsApp — confirmado nos logs do container `evolution`
      // (mesmo `ownerJid`, 6 instâncias diferentes em ~75min, todas derrubadas com
      // `LOGOUT statusReason:401`, padrão clássico de conflito de multi-dispositivo). [AUDITORIA]
      // FIX APLICADO: antes de mintar um nome novo, verifica se alguma instância JÁ CONHECIDA do
      // tenant está `connectionStatus:'open'` de verdade na Evolution (dado real, não confiamos
      // no `status` do banco que só é reconciliado a cada 15min) — se estiver, e o telefone
      // pedido (quando informado) bater com o `ownerJid` dela, REAPROVEITA essa instância
      // (reconecta/gera QR novo nela) em vez de criar mais uma. Só cria instância genuinamente
      // nova quando nenhuma conhecida está aberta pra aquele número — não muda o fluxo legítimo
      // de somar um SEGUNDO número diferente ao mesmo tenant.
      // [AUDITORIA] FIX APLICADO (achado 2026-08-10, segunda rodada — o guard acima só cobria
      // `connectionStatus:'open'`): mesmo com o fix, o loop voltou a acontecer — cliques
      // repetidos em "Conectar" enquanto a instância anterior ainda estava em `connecting`
      // (QR/pairing code gerado, ainda sem `ownerJid` porque o parceamento não terminou) não
      // eram pegos pelo guard, porque `connecting` ≠ `open`. Cada clique nesse meio-tempo minta
      // outra instância nova, do mesmo jeito que o bug original. `connecting` sem `ownerJid`
      // ainda não sabe qual número vai ser — não dá pra comparar com `phoneDigits`, então só
      // reaproveita esse caso quando NENHUM telefone foi pedido explicitamente (evita bloquear
      // o fluxo legítimo de "conectar um número diferente enquanto o primeiro ainda pareia").
      let instanciaReaproveitada: string | null = null;
      if (req.body?.nova_conexao === true && conhecidas.size > 0) {
        const reais = await fetchInstancesFromServer(cfg.url, cfg.api_key).catch(() => null);
        if (reais) {
          const phoneDigits = String(req.body?.phoneNumber || '').replace(/\D/g, '');
          const candidata = reais.find(i => {
            if (!conhecidas.has(i.name)) return false;
            if (i.connectionStatus === 'open') {
              return !phoneDigits || (i.ownerJid || '').replace(/\D/g, '').endsWith(phoneDigits.slice(-11));
            }
            if (i.connectionStatus === 'connecting') {
              return !phoneDigits; // ainda sem ownerJid pra comparar — só reaproveita se ninguém pediu número específico
            }
            return false;
          });
          if (candidata) {
            instanciaReaproveitada = candidata.name;
            log.warn('WHATSAPP', 'nova_conexao pedida mas já existe instância aberta/conectando — reaproveitando em vez de duplicar sessão', {
              tenantId, instanciaExistente: instanciaReaproveitada, statusExistente: candidata.connectionStatus, phoneDigits: phoneDigits || null,
            });
          }
        }
      }

      if (instanciaReaproveitada) {
        cfg.instancia = instanciaReaproveitada;
        cfg.stableInstancia = instanciaReaproveitada;
      } else if (req.body?.nova_conexao === true) {
        // [AUDITORIA] BUG GRAVE CORRIGIDO (achado no TESTE REAL desta sprint em homolog, não só
        // teórico — ver `verificarLoopDeLogoutTenant` em `services/logoutCircuitBreaker.ts` pro
        // relato completo): o guard abaixo (`verificarLoopDeLogout`, escopo por NOME de
        // instância) não protege este ramo específico — aqui `proximaInstanciaLivre()` sempre
        // minta um nome NUNCA VISTO, sem histórico de LOGOUT próprio, então passaria mesmo se o
        // tenant já tivesse acabado de derrubar 5 nomes diferentes na última hora (exatamente o
        // padrão real dos 2 incidentes). [AUDITORIA] FIX APLICADO: antes de mintar, soma os
        // LOGOUTs recentes de TODAS as instâncias já conhecidas do tenant — só bloqueia MINTAR
        // mais um nome novo enquanto esse padrão persistir; reconectar um nome já conhecido e
        // saudável (sem LOGOUT recente) continua liberado normalmente pelo guard de baixo.
        const loopTenant = await verificarLoopDeLogoutTenant(pool, Array.from(conhecidas));
        if (loopTenant.emLoop) {
          log.warn('WHATSAPP_LOGOUT_LOOP', 'Nova instância bloqueada pelo circuit-breaker (padrão do tenant, não de uma instância específica)', {
            userId, tenantId, totalRecente: loopTenant.totalRecente, minutosRestantes: loopTenant.minutosRestantes,
          });
          return res.status(429).json({
            error: true,
            code: 'LOGOUT_LOOP',
            message: `Suas instâncias tiveram ${loopTenant.totalRecente} desconexões seguidas nos últimos 60 minutos — criar mais uma agora aumenta o risco de bloqueio pelo WhatsApp. Aguarde ${loopTenant.minutosRestantes} min antes de tentar de novo.`,
            minutosRestantes: loopTenant.minutosRestantes,
            totalRecente: loopTenant.totalRecente,
          });
        }
        const instanciaAlvo = await proximaInstanciaLivre(cfg.stableInstancia, conhecidas);
        cfg.instancia = instanciaAlvo;
        cfg.stableInstancia = instanciaAlvo;
        log.info('WHATSAPP', 'Nova conexão solicitada — instância alvo calculada', { tenantId, instanciaAlvo });
      } else {
        // [AUDITORIA] LÓGICA (Sprint 2): "Reconectar" num card específico do painel manda o
        // nome da instância daquele card — sem isso, reconectar qualquer card sempre mexia na
        // instância padrão do tenant, nunca na que o usuário realmente clicou.
        await resolverInstanciaExplicita(tenantId, req.body?.instancia as string | undefined, cfg);
      }

      // [AUDITORIA] BUG GRAVE CORRIGIDO (achado 2026-08-10, continuação direta do incidente
      // Serenovlogs067 + um segundo usuário banido no mesmo dia): o guard de reaproveitamento
      // de instância acima (`instanciaReaproveitada`) só age dentro do branch `nova_conexao` —
      // não cobria `force_reconnect` (botão "Forçar Reinicialização"), que DELETA a instância de
      // propósito e recria do zero a cada clique, por desenho — nem cobria repetir a mesma
      // reconexão explícita várias vezes seguidas. Não existia nenhum limite de QUANTAS vezes
      // isso podia se repetir numa janela de tempo, só um lock de 30s contra 2 cliques
      // SIMULTÂNEOS (`connectingUsers`, acima) — não protege contra 10 tentativas sequenciais ao
      // longo de alguns minutos, exatamente o padrão dos 2 incidentes reais (número derrubado em
      // LOGOUT repetido pelo próprio WhatsApp, `statusReason:401`, até ficar banido). [AUDITORIA]
      // FIX APLICADO: ponto único, DEPOIS que `cfg.instancia`/`cfg.stableInstancia` já está
      // resolvido por QUALQUER um dos 3 caminhos acima (nova_conexao/reaproveitada, nova_conexao
      // mintando nome novo, ou reconexão explícita) e ANTES do bloco `force_reconnect` logo
      // abaixo — cobre os 3 de uma vez, sem duplicar a checagem em cada branch. Janela deslizante
      // (`verificarLoopDeLogout`, `services/logoutCircuitBreaker.ts`): 3+ LOGOUTs reais da MESMA
      // instância nos últimos 60min já bloqueia, independente de qual caminho gerou a tentativa.
      const loopStatus = await verificarLoopDeLogout(pool, cfg.stableInstancia);
      if (loopStatus.emLoop) {
        log.warn('WHATSAPP_LOGOUT_LOOP', 'Tentativa de conexão bloqueada pelo circuit-breaker', {
          userId, instancia: cfg.stableInstancia, totalRecente: loopStatus.totalRecente,
          minutosRestantes: loopStatus.minutosRestantes, forceReconnect: req.body?.force_reconnect === true,
        });
        return res.status(429).json({
          error: true,
          code: 'LOGOUT_LOOP',
          message: `Esta instância teve ${loopStatus.totalRecente} desconexões seguidas nos últimos 60 minutos — novas tentativas agora aumentam o risco de bloqueio pelo WhatsApp. Aguarde ${loopStatus.minutosRestantes} min antes de tentar de novo.`,
          minutosRestantes: loopStatus.minutosRestantes,
          totalRecente: loopStatus.totalRecente,
        });
      }

      // [AUDITORIA] FIX APLICADO (Sprint 6): Se a flag force_reconnect for fornecida, realiza a
      // deleção física da instância antes de gerar um novo QR, limpando sockets de memória fantasmas do Baileys.
      // [AUDITORIA] FIX APLICADO: deletava cfg.instancia, mas a criação logo abaixo usa
      // cfg.stableInstancia — quando esses nomes divergem (integracoes_config com nome legado),
      // o force_reconnect apagava a instância errada e a instância realmente travada continuava
      // intacta na Evolution. Corrigido para deletar cfg.stableInstancia, o mesmo nome usado por
      // /instance/create logo abaixo.
      const forceReconnect = req.body?.force_reconnect === true;
      if (forceReconnect) {
        log.info('WHATSAPP', 'Forçando reconexão - deletando instância antiga', { instancia: cfg.stableInstancia });
        await evolutionFetch(`${base}/instance/delete/${cfg.stableInstancia}`, {
          method: 'DELETE',
          headers: { apikey: cfg.api_key },
        }).catch(() => null);
        await new Promise(r => setTimeout(r, 2000));
      }

      try {
        const listRes = await evolutionFetch(`${base}/instance/fetchInstances`, {
          headers: { apikey: cfg.api_key },
        }).catch(() => null);

        if (listRes?.ok) {
          const instances: any[] = (await listRes.json().catch(() => [])) as any[];
          // [AUDITORIA] FIX APLICADO (Sprint 1 — multi-instância): antes, qualquer instância com
          // o prefixo do tenant que não fosse a "oficial" era tratada como duplicata e apagada —
          // isso apagaria sozinho qualquer segundo número legitimamente conectado. Agora só
          // remove o que não está em `conhecidas` (nenhuma linha em integracoes_config aponta
          // pra ela) — órfã de verdade, não um chip adicional válido. Prefixo comparado contra
          // tenantId (dono da conta), não userId — cfg.stableInstancia também deriva do
          // tenantId, então comparar contra userId (como era antes) nunca batia certo pra
          // membros de equipe que não são o dono.
          const tenantIdShort = tenantId.replace(/-/g, '').slice(0, 12);
          for (const inst of instances) {
            const name = inst.instanceName || inst.name;
            if (name && name.includes(tenantIdShort) && name !== cfg.stableInstancia && !conhecidas.has(name)) {
              log.info('WHATSAPP', 'Removendo instância órfã (sem linha de config)', { name });
              await registrarWebhook(base, cfg.api_key, name, false).catch(() => {});
              await evolutionFetch(`${base}/instance/delete/${name}`, {
                method: 'DELETE',
                headers: { apikey: cfg.api_key },
              }).catch(() => {});
            }
          }
        }
      } catch (err) {
        log.warn('WHATSAPP', 'Erro ao listar/limpar instâncias', { err: (err as Error).message });
      }

      const stateRes = await evolutionFetch(`${base}/instance/connectionState/${cfg.instancia}`, {
        headers: { apikey: cfg.api_key },
      }).catch(() => null);

      if (stateRes?.status === 401) {
        log.warn('WHATSAPP', '401 durante connect — API Key inválida', { instancia: cfg.instancia });
        return res.json({ 
          state: 'unauthorized', 
          message: 'API Key da Evolution inválida ou sessão expirada. Clique em Reconectar.',
          instancia: cfg.instancia 
        });
      }

      if (stateRes?.ok) {
        const stateData: any = await stateRes.json().catch(() => ({}));
        const state = stateData?.instance?.state || stateData?.state || stateData?.status || 'close';
        if (state === 'open' || state === 'CONNECTED' || state === 'connected') {
          // [AUDITORIA] FIX APLICADO (2026-08-07): ver buscarPhoneNumberInstancia() —
          // connectionState não devolve profile/owner/number, `hasPhone` sempre dava falso aqui
          // (mesma causa raiz do phoneNumber vazio na aba Instâncias), fazendo este branch cair
          // sempre no "sem conta vinculada, reconecte" abaixo mesmo pra instância genuinamente
          // aberta e vinculada — só não era mais visível porque este caminho (POST /connect com
          // a instância já aberta) é raro no uso normal (status/polling usam GET /evo/status ou
          // POST /status, não /connect).
          const phoneNumber = await buscarPhoneNumberInstancia(base, cfg.api_key, cfg.instancia);
          if (phoneNumber) {
            await registrarWebhook(base, cfg.api_key, cfg.instancia);
            await saveEvolutionConfig(userId, cfg.agenteId, cfg.url, cfg.api_key, cfg.instancia);
            return res.json({
              state: 'open',
              phoneNumber,
              instancia: cfg.instancia,
            });
          } else {
            log.info('WHATSAPP', 'Instância está em \'open\' mas sem conta vinculada.', { instancia: cfg.instancia });
            return res.json({ 
              state: 'unauthorized', 
              message: 'Instância sem conta do WhatsApp vinculada. Por favor, reconecte.',
              instancia: cfg.instancia 
            });
          }
        }
      }

      const phoneNumber = (req.body?.phoneNumber as string | undefined)?.replace(/\D/g, '') || undefined;
      const createPayload = {
        instanceName: cfg.stableInstancia,
        token: cfg.api_key,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
        rejectCall: false,
        // [AUDITORIA] FIX APLICADO (2026-07-22): groupsIgnore=true fazia a Evolution nunca
        // encaminhar MESSAGES_UPSERT de grupo pro nosso webhook — mensagem existia na Evolution
        // (visível via /chat/findMessages direto), mas nunca chegava aqui, então nunca era salva
        // em whatsapp_messages. Não era filtro nosso (webhook.ts/frontend não filtram @g.us,
        // conferido) — a Evolution nem chegava a enviar o evento. IA interna continua bloqueada
        // pra grupo por outro mecanismo (processarComDebounce só é chamado depois de um
        // `if (isGroup) return` em webhook.ts — ver diagnosticos/AUDITORIA_LOG.md), então habilitar
        // a entrega do evento não reabre esse risco.
        groupsIgnore: false,
        alwaysOnline: true,
        readMessages: true,
        readStatus: false,
        ...(phoneNumber ? { number: phoneNumber } : {}),
        webhook: webhookInner(),
      };

      log.info('WHATSAPP', 'Criando/Conectando instância', { instancia: cfg.stableInstancia });
      
      const createRes = await evolutionFetch(`${base}/instance/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': cfg.api_key },
        body: JSON.stringify(createPayload),
      });

      // [AUDITORIA] FIX APLICADO: a checagem anterior confiava no header Content-Type da
      // resposta, que proxies reversos (Traefik/Nginx) podem alterar ou omitir mesmo em
      // respostas com corpo JSON válido. Agora lemos sempre como texto e tentamos JSON.parse();
      // só tratamos como resposta inválida (HTML/texto puro) se o parse de fato falhar.
      const createRawText = await createRes.text().catch(() => '');
      let created: any = {};
      try {
        created = createRawText ? JSON.parse(createRawText) : {};
      } catch {
        return res.status(createRes.status || 502).json({
          error: true,
          message: `Evolution retornou resposta não-JSON status ${createRes.status}: ${createRawText.slice(0, 150)}`,
        });
      }

      const createErrorMsg = extractEvolutionErrorMessage(created);
      if (!createRes.ok && /already|exist|conflict|in use/i.test(createErrorMsg)) {
        // [AUDITORIA] FIX APLICADO: `rcData.code` é a referência interna do Baileys usada pra
        // montar o QR (formato "ref@chave1,chave2,..."), não uma imagem nem um código de
        // pareamento — usá-la direto como qrCode/pairingCode produzia uma imagem quebrada
        // (data:image/png;base64,2@... não é base64 válido) e um "código de pareamento" ilegível.
        // Só base64/qrcode.base64 (imagem real) e pairingCode (código curto real) valem; se a
        // Evolution ainda não gerou nenhum dos dois, tenta de novo por alguns segundos — igual ao
        // fluxo de criação nova logo abaixo.
        let qrCode: string | null = null;
        let pairingCode: string | null = null;
        for (let attempt = 0; attempt < 5 && !qrCode; attempt++) {
          const connectRes = await evolutionFetch(`${base}/instance/connect/${cfg.instancia}`, {
            headers: { apikey: cfg.api_key },
          }).catch(() => null);
          if (connectRes?.ok) {
            const rcData: any = await connectRes.json().catch(() => ({}));
            const qrRaw = rcData?.base64 || rcData?.qrcode?.base64 || null;
            if (qrRaw) qrCode = normalizeQr(qrRaw);
            pairingCode = pairingCode || rcData?.pairingCode || null;
          }
          if (!qrCode) await new Promise(r => setTimeout(r, 2000));
        }

        await saveEvolutionConfig(userId, cfg.agenteId, cfg.url, cfg.api_key, cfg.stableInstancia);
        await registrarWebhook(base, cfg.api_key, cfg.stableInstancia);
        return res.json({
          state: 'connecting',
          qrCode,
          qrPending: !qrCode,
          pairingCode,
          instanceName: cfg.stableInstancia,
          instancia: cfg.stableInstancia,
        });
      }

      // [AUDITORIA] FIX APLICADO: restaurado (havia sido perdido em uma reescrita anterior) —
      // se /instance/create falhar e não for o caso de "já existe" (tratado acima), o fluxo
      // seguia adiante e devolvia qrPending:true com status 200, escondendo o erro real.
      if (!createRes.ok) {
        log.warn('WHATSAPP', 'Falha ao criar instância na Evolution', { status: createRes.status, message: createErrorMsg });
        return res.status(createRes.status || 502).json({
          state: 'close',
          error: true,
          code: createRes.status,
          message: createErrorMsg || `Evolution API erro (${createRes.status}) ao criar instância.`,
        });
      }

      let qrCode = created?.qrcode?.base64 || created?.hash?.qrcode || null;
      let pairingCode = created?.qrcode?.pairingCode || created?.pairingCode || created?.hash?.pairingCode || null;

      if (!qrCode && createRes.ok) {
        for (let attempt = 0; attempt < 5 && !qrCode; attempt++) {
          await new Promise(r => setTimeout(r, 2000));
          const qrRes = await evolutionFetch(`${base}/instance/connect/${cfg.instancia}`, {
            headers: { apikey: cfg.api_key },
          }).catch(() => null);
          if (qrRes?.ok) {
            const qrData: any = await qrRes.json().catch(() => ({}));
            qrCode = qrData?.base64 || qrData?.qrcode?.base64 || null;
            pairingCode = pairingCode || qrData?.pairingCode || null;
          }
        }
      }

      await saveEvolutionConfig(userId, cfg.agenteId, cfg.url, cfg.api_key, cfg.stableInstancia);
      await registrarWebhook(base, cfg.api_key, cfg.stableInstancia);

      return res.json({
        state: (qrCode || created?.qrcode?.base64) ? 'connecting' : (created?.instance?.state || created?.state || 'connecting'),
        qrCode: normalizeQr(qrCode),
        qrPending: !qrCode,
        pairingCode,
        instanceName: cfg.stableInstancia,
        instancia: cfg.stableInstancia,
      });
    } catch (err: any) {
      log.error('WHATSAPP connect', 'Erro', { err: err?.message, stack: err?.stack });
      return res.status(500).json({ message: err.message });
    } finally {
      clearTimeout(timeout);
      connectingUsers.delete(lockKey);
    }
  });

  // GET /api/whatsapp/poll-qr — polling leve para aguardar QR gerado pelo Baileys
  router.get('/poll-qr', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const cfg = await getEvolutionConfig(userId);
      // [AUDITORIA] LÓGICA (Sprint 2 — multi-instância): sem isso, o polling do QR durante a
      // conexão de uma instância adicional (_2, _3...) checava a instância padrão em vez da
      // que estava de fato sendo conectada.
      const tenantId = await resolveOwnerId(userId);
      await resolverInstanciaExplicita(tenantId, req.query?.instancia as string | undefined, cfg);
      const base = cfg.url.replace(/\/$/, '');

      const stateRes = await evolutionFetch(`${base}/instance/connectionState/${cfg.instancia}`, {
        headers: { apikey: cfg.api_key },
      }).catch(() => null);

      // [AUDITORIA] FIX APLICADO (Sprint 6): Se a conexão com a Evolution falhar sob erro real,
      // propaga o erro explicitamente em vez de silenciar com qrPending: true.
      if (stateRes && !stateRes.ok) {
        const errorText = await stateRes.text().catch(() => String(stateRes.status));
        return res.status(stateRes.status).json({
          state: 'close',
          error: true,
          message: `Evolution Connection State falhou (${stateRes.status}): ${errorText.slice(0, 150)}`
        });
      }

      const stateData: any = stateRes ? await stateRes.json().catch(() => ({})) : {};
      const state = stateData?.instance?.state || stateData?.state || 'close';

      if (state === 'open') {
        return res.json({ state: 'open', qrCode: null, qrPending: false });
      }

      const qrRes = await evolutionFetch(`${base}/instance/connect/${cfg.instancia}`, {
        headers: { apikey: cfg.api_key },
      }).catch(() => null);

      if (qrRes) {
        if (!qrRes.ok) {
          const errorText = await qrRes.text().catch(() => String(qrRes.status));
          return res.status(qrRes.status).json({
            state,
            error: true,
            message: `Evolution Connect falhou (${qrRes.status}): ${errorText.slice(0, 150)}`
          });
        }
        const qrData: any = await qrRes.json().catch(() => ({}));
        const qrCode = qrData?.base64 || qrData?.qrcode?.base64 || null;
        const pairingCode = qrData?.pairingCode || null;
        return res.json({
          state,
          qrCode: normalizeQr(qrCode),
          qrPending: !qrCode,
          pairingCode,
          instancia: cfg.instancia,
        });
      }

      return res.status(503).json({ state, error: true, message: 'Servidor Evolution API indisponível.' });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  router.post('/disconnect', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const cfg = await getEvolutionConfig(userId);
      // [AUDITORIA] LÓGICA (Sprint 2 — multi-instância): sem isso, desconectar qualquer card do
      // painel sempre desconectava a instância padrão do tenant, nunca a instância específica
      // daquele card — grave aqui porque, diferente de /connect, esta rota também apaga dados
      // (integracoes_config/agentes/whatsapp_message_status daquela instância) mais abaixo.
      const tenantId = await resolveOwnerId(userId);
      await resolverInstanciaExplicita(tenantId, req.body?.instancia as string | undefined, cfg);
      const base = cfg.url.replace(/\/$/, '');
      const instancia = cfg.instancia;

      log.info('WHATSAPP', 'Desconexão total iniciada', { userId, instancia });

      await registrarWebhook(base, cfg.api_key, instancia, false).catch(() => {});

      await evolutionFetch(`${base}/instance/logout/${instancia}`, {
        method: 'DELETE',
        headers: { apikey: cfg.api_key },
      }).catch(err => log.warn('WHATSAPP', 'Erro no logout', { instancia, err: err.message }));

      const deleteRes = await evolutionFetch(`${base}/instance/delete/${instancia}`, {
        method: 'DELETE',
        headers: { apikey: cfg.api_key },
      }).catch(err => {
        log.error('WHATSAPP', 'Erro ao deletar instância na Evolution', { instancia, err: err.message });
        return null;
      });

      if (deleteRes && !deleteRes.ok) {
        const errorText = await deleteRes.text().catch(() => 'Erro desconhecido');
        log.warn('WHATSAPP', 'Evolution retornou erro ao deletar instância', { instancia, status: deleteRes.status, errorText });
      }

      log.info('WHATSAPP', 'Limpando registros do BD', { userId });

      // [AUDITORIA] FIX APLICADO: filtro por instance_name adicionado nas queries que antes
      // usavam so `WHERE user_id = $1` — apagavam o historico/config de TODAS as instancias
      // do usuario ao desconectar uma unica instancia. Causou perda real de mensagens em
      // producao (ver diagnosticos/AUDITORIA_LOG.md). Mesma correcao aplicada em /instances/:name.
      // [AUDITORIA] FIX APLICADO (2026-07-21): a linha de whatsapp_messages usa req.getDb()
      // -- piloto de RLS, só homologação (ver diagnosticos/AUDITORIA_LOG.md). As demais
      // tabelas não têm RLS habilitado ainda, seguem em pool.query() normalmente.
      // [AUDITORIA] FIX APLICADO (2026-07-22): removidas as DELETEs de whatsapp_message_status
      // e n8n_chat_histories deste array — a segunda apagava a memória de conversa da IA a
      // cada desconexão/reconexão da mesma instância, decisão explícita do usuário de manter
      // esse contexto vivo entre reconexões (ver AUDITORIA_LOG.md).
      // [AUDITORIA] BUG GRAVE CORRIGIDO (achado 2026-08-10 — cliente real, contato pausado por
      // falha real de LLM (429 da OpenAI) foi reativado sozinho horas depois): as duas UPDATEs
      // de `contatos`/`dados_cliente` abaixo usavam `WHERE user_id = $1` — sem filtro de
      // instância (`contatos` nem tem essa coluna, é por telefone/tenant) — ou seja,
      // desconectar UMA instância reativava a IA pra TODOS OS CONTATOS do tenant, inclusive os
      // que um atendente humano pausou de propósito ou que o gate de segurança
      // (`pausarPorFalhaLLM`, agentEngine.ts) pausou por falha real na chamada à LLM. Não existe
      // relação lógica entre "esta instância desconectou" e "todo contato deve voltar a
      // responder automático" — [AUDITORIA] FIX APLICADO: removido. A reativação de um contato
      // pausado agora só acontece por ação explícita (atendente reativando manualmente, ou
      // reconexão bem-sucedida da MESMA instância que ele estava conversando, já tratado em
      // outro ponto do código).
      // [AUDITORIA] FIX APLICADO (pedido explícito do usuário, 2026-09-09): removida a linha
      // `UPDATE whatsapp_messages SET deleted_at = NOW() WHERE user_id=$1 AND instance_name=$2`.
      // Desconectar/remover uma instância NÃO pode mais apagar o histórico de conversa — é dado
      // de negócio (conversas com clientes). Mensagens só são apagadas por ação explícita do
      // usuário, via DELETE /whatsapp/instances/:name/mensagens (botão em Configurações).
      const queries = [
        pool.query(`DELETE FROM webhook_mensagens_processadas WHERE instancia = $1`, [instancia]),
        pool.query(`DELETE FROM integracoes_config WHERE user_id = $1 AND tipo = 'evolution' AND instancia = $2`, [userId, instancia]),
        pool.query(
          `UPDATE agentes
           SET evolution_instancia = NULL,
               evolution_server_url = NULL,
               evolution_api_key = NULL,
               updated_at = NOW()
           WHERE user_id = $1 AND evolution_instancia = $2`,
          [userId, instancia]
        )
      ];

      await Promise.allSettled(queries);

      return res.json({
        ok: true,
        message: 'WhatsApp desconectado, instância removida e estado limpo com sucesso.'
      });
    } catch (err: any) {
      log.error('WHATSAPP', 'Erro fatal no disconnect', { err: err?.message, stack: err?.stack });
      return res.status(500).json({ message: err.message });
    }
  });

  router.post('/sync-history', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const cfg = await getEvolutionConfig(userId);
      const instancia = cfg.instancia;
      const base = cfg.url.replace(/\/$/, '');

      const PAGE_SIZE = 500;
      const messages: any[] = [];
      let page = 1;
      let totalPages = 1;

      do {
        const msgsRes = await evolutionFetch(`${base}/chat/findMessages/${instancia}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: cfg.api_key },
          body: JSON.stringify({ where: {}, limit: PAGE_SIZE, page }),
        });
        if (!msgsRes.ok) {
          const t = await msgsRes.text().catch(() => '');
          if (messages.length === 0) {
            return res.status(502).json({ message: `Evolution messages ${msgsRes.status}: ${t.slice(0, 200)}` });
          }
          break;
        }
        const msgsJson: any = await msgsRes.json().catch(() => ({}));
        const records: any[] = msgsJson?.messages?.records || msgsJson?.records || (Array.isArray(msgsJson) ? msgsJson : []);
        messages.push(...records);
        totalPages = msgsJson?.messages?.pages || 1;
        page++;
      } while (page <= totalPages && messages.length < 10000);

      const chats: any[] = [];

      let inseridos = 0;
      for (const m of messages) {
        try {
          const key = m.key || {};
          const remoteJid: string = key.remoteJid || m.remoteJid || '';
          // [AUDITORIA] FIX APLICADO (2026-09-18 — pedido do usuário: "filtro de grupo ainda
          // não tá funcionando"): antes pulava toda mensagem de grupo (`@g.us`) na sincronização
          // de histórico — resultado, nenhuma conta tinha histórico de grupo importado, só
          // mensagem nova chegada depois de conectar (o webhook em tempo real já suporta grupo
          // normalmente). O filtro "Grupos" da lista de conversas (WhatsAppInterface.tsx) estava
          // correto o tempo todo — mostrava vazio porque não havia dado nenhum pra filtrar.
          if (!remoteJid) continue;
          const messageId = key.id || m.id || `${remoteJid}_${m.messageTimestamp}`;
          const fromMe = !!key.fromMe;
          const ts = Number(m.messageTimestamp || Math.floor(Date.now() / 1000));
          const msgContent = m.message || {};
          const msgType: string = m.messageType || (
            msgContent.imageMessage ? 'image'
            : msgContent.audioMessage ? 'audio'
            : msgContent.videoMessage ? 'video'
            : msgContent.documentMessage ? 'document'
            : msgContent.stickerMessage ? 'sticker'
            : 'text'
          );
          const content =
            msgContent.conversation ||
            msgContent.extendedTextMessage?.text ||
            msgContent.imageMessage?.caption ||
            msgContent.videoMessage?.caption ||
            msgContent.documentMessage?.caption ||
            null;

          // [AUDITORIA] FIX APLICADO (2026-07-21): req.getDb() -- piloto de RLS, só
          // homologação (ver diagnosticos/AUDITORIA_LOG.md). Memoizado: só adquire o client
          // uma vez, mesmo chamado dentro deste loop.
          const result = await (await req.getDb!()).query(
            `INSERT INTO whatsapp_messages
               (user_id, instance_name, remote_jid, message_id, from_me, message_type,
                content, status, timestamp_wa)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8, to_timestamp($9))
             ON CONFLICT (message_id, instance_name) DO NOTHING`,
            [userId, instancia, remoteJid, messageId, fromMe, msgType,
             content, fromMe ? 'sent' : 'received', ts]
          );
          if (result.rowCount && result.rowCount > 0) inseridos++;
        } catch (err: any) {
          log.warn('SYNC', 'msg skip', { err: err.message });
        }
      }

      return res.json({ chats: chats.length, messages: messages.length, inseridos });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  router.post('/send', async (req: AuthRequest, res: Response) => {
    const userId = req.userId!;
    log.info('DEBUG SEND', 'Payload recebido do Lovable', { body: req.body });
    log.info('DEBUG SEND', 'userId', { userId });
    try {
      const {
        phone, text, instancia: instanciaSolicitada,
        mediaUrl, mediaType, mediaCaption, mediaFilename,
      } = req.body as {
        phone: string; text?: string; instancia?: string;
        mediaUrl?: string; mediaType?: 'image' | 'audio' | 'video' | 'document';
        mediaCaption?: string; mediaFilename?: string;
      };

      const phoneClean = (phone || '').replace(/\D/g, '');
      if (!phoneClean || phoneClean.length < 8 || phoneClean.length > 15) {
        log.warn('DEBUG SEND', 'telefone inválido', { phone });
        return res.status(400).json({ message: `Número de telefone inválido: "${phone}"` });
      }
      if (!text && !mediaUrl) {
        return res.status(400).json({ message: 'text ou mediaUrl são obrigatórios' });
      }

      // [AUDITORIA] FIX APLICADO (Sprint 6, item 2 — teto de segurança de 5MB, 2026-07-23):
      // antes, `mediaUrl` (que pode ser uma URL http(s) OU um data-URI base64 embutido direto
      // no corpo da requisição) ia direto pro payload da Evolution sem nenhuma checagem de
      // tamanho — um base64 gigante (o corpo JSON aceita até 50MB, ver index.ts) ficava
      // inteiro em memória (string + Buffer decodificado) por request simultânea, risco real
      // de Heap OOM sob concorrência. Barra 413 cedo, antes de qualquer processamento pesado.
      let mediaUrlFinal: string | undefined = mediaUrl;
      if (mediaUrlFinal) {
        if (mediaUrlFinal.startsWith('data:')) {
          const base64Part = mediaUrlFinal.slice(mediaUrlFinal.indexOf(',') + 1);
          const approxBytes = Math.floor(base64Part.length * 0.75); // base64 ≈ 4/3 do tamanho real
          if (approxBytes > MAX_OUTBOUND_MEDIA_BYTES) {
            log.warn('DEBUG SEND', 'mídia base64 acima do teto de 5MB — bloqueado', { approxBytes });
            return res.status(413).json({ message: 'O arquivo excede o limite de segurança de 5MB para transmissões WhatsApp.' });
          }
        } else if (/^https?:\/\//i.test(mediaUrlFinal)) {
          // Checagem best-effort via HEAD (evita baixar o arquivo só pra medir) — se o servidor
          // remoto não informar Content-Length, a checagem real acontece dentro de
          // garantirMidiaEstavel() logo abaixo (item 1), que também respeita o mesmo teto.
          try {
            const headController = new AbortController();
            const headTimer = setTimeout(() => headController.abort(), 5000);
            const headRes = await fetch(mediaUrlFinal, { method: 'HEAD', signal: headController.signal }).catch(() => null);
            clearTimeout(headTimer);
            const contentLength = headRes?.headers?.get('content-length');
            if (contentLength && Number(contentLength) > MAX_OUTBOUND_MEDIA_BYTES) {
              log.warn('DEBUG SEND', 'mídia via URL acima do teto de 5MB (HEAD) — bloqueado', { contentLength, mediaUrl: mediaUrlFinal.slice(0, 100) });
              return res.status(413).json({ message: 'O arquivo excede o limite de segurança de 5MB para transmissões WhatsApp.' });
            }
          } catch { /* HEAD falhou/sem suporte no servidor remoto — segue, teto real aplicado abaixo */ }

          // [AUDITORIA] FIX APLICADO (Sprint 6, item 1 — mídia expirada em campanhas/envios,
          // 2026-07-23): se `mediaUrl` for um link externo instável (upload provisório, URL
          // assinada com expiração), baixa uma vez e reescreve pra uma URL estável no nosso
          // próprio domínio (ver garantirMidiaEstavel() em whatsappMediaStorage.ts) — evita que
          // o envio (ou reenvios futuros da mesma mídia) dependam de um link que pode expirar.
          // Fallback seguro: em qualquer falha, devolve a URL original, nunca bloqueia o envio.
          mediaUrlFinal = (await garantirMidiaEstavel(mediaUrlFinal)) || mediaUrlFinal;
        }
      }

      const cfg = await getEvolutionConfig(userId);

      // Multi-instância: se o frontend indicar de qual chip a conversa veio, valida que o
      // usuário é dono dessa instância e usa esse nome de instância, em vez do padrão. URL/API
      // Key continuam sempre as fixas do .env (servidor Evolution único) — só a instancia
      // (o "número"/chip) varia por linha; não confiamos mais em url/api_key vindos do banco.
      if (instanciaSolicitada) {
        const instRes = await pool.query(
          `SELECT instancia FROM integracoes_config
           WHERE user_id = $1 AND instancia = $2 AND tipo = 'evolution' LIMIT 1`,
          [userId, instanciaSolicitada]
        ).catch(() => ({ rows: [] as any[] }));
        if (instRes.rows.length) {
          cfg.instancia = instanciaSolicitada;
        } else {
          log.warn('DEBUG SEND', 'instancia solicitada não pertence ao usuário — usando instância padrão', { userId, instanciaSolicitada });
        }
      }

      log.info('DEBUG SEND', 'Instância encontrada para o usuário', {
        instancia: cfg.instancia,
        url: cfg.url,
        isGlobal: cfg.isGlobal,
        agenteId: cfg.agenteId,
        tokenPresente: !!cfg.api_key,
      });

      const instancia = cfg.instancia;
      const base = cfg.url.replace(/\/$/, '');

      let evolutionResp: any;
      let msgType = 'text';

      if (mediaUrlFinal && mediaType) {
        msgType = mediaType;
        // [AUDITORIA] BUG (achado 2026-09-10 — "meus áudios não dá pra ouvir"): áudio saía por
        // `sendMedia` com `mediatype:'audio'`, que manda o arquivo como anexo cru, sem a
        // conversão pra OGG/Opus (nota de voz) que a Evolution só faz no endpoint dedicado. O
        // composer grava `webm/opus` no navegador — sem transcode, o WhatsApp do destinatário
        // não reconhece como áudio tocável. `disparoProcessor.ts` e `agentEngine.ts` já usam
        // `sendWhatsAppAudio` (payload `{ number, audio }`, sem `mediatype`/`media`) — este
        // fluxo era o único fora do padrão. [AUDITORIA] FIX APLICADO: áudio agora usa o mesmo
        // endpoint/payload dos outros fluxos.
        const isAudio = mediaType === 'audio';
        const endpoint = isAudio ? 'sendWhatsAppAudio' : 'sendMedia';
        const mediaPayload: any = isAudio
          ? { number: phoneClean, audio: mediaUrlFinal }
          : { number: phoneClean, mediatype: mediaType, media: mediaUrlFinal };
        if (!isAudio && mediaCaption) mediaPayload.caption = mediaCaption;
        if (!isAudio && mediaFilename) mediaPayload.fileName = mediaFilename;

        const targetUrl = `${base}/message/${endpoint}/${cfg.instancia}`;
        log.info('DEBUG SEND', 'Disparando para Evolution', { targetUrl, tokenPresente: !!cfg.api_key });
        let evoRes: globalThis.Response;
        try {
          evoRes = await evolutionFetch(targetUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: cfg.api_key },
            body: JSON.stringify(mediaPayload),
          });
        } catch (err: any) {
          log.info('DEBUG SEND', 'Erro cru ao chamar Evolution API (mídia)', { err: err.message });
          return res.status(502).json({ message: `Sem resposta da Evolution API: ${err.message}` });
        }
        if (!evoRes.ok) {
          const errText = await evoRes.text().catch(() => String(evoRes.status));

          if (evoRes.status === 404 || errText.includes('does not exist') || errText.includes('instance not found')) {
            log.info('SEND', 'Instância não existe ou está deslogada na Evolution — solicitando reconexão manual', { instancia });
            return res.status(401).json({
              message: 'Sessão do WhatsApp expirada ou não encontrada. Por favor, reconecte.',
              reconnect_required: true,
              instancia,
            });
          } else if (errText.includes('presenceSubscribe') || errText.includes('Cannot read properties of undefined')) {
            log.info('SEND', 'presenceSubscribe — socket não pronto, aguardando 3s e reenviando...');
            await new Promise(r => setTimeout(r, 3000));
            const retry = await evolutionFetch(targetUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', apikey: cfg.api_key },
              body: JSON.stringify(mediaPayload),
            }).catch(() => null);
            if (!retry?.ok) {
              return res.status(503).json({ message: 'WhatsApp ainda inicializando. Tente novamente em alguns segundos.' });
            }
            evolutionResp = await retry.json().catch(() => ({}));
          } else {
            log.error('DEBUG SEND', 'Evolution mídia falhou', { status: evoRes.status, body: errText.slice(0, 400) });
            return res.status(502).json({ message: `Evolution ${evoRes.status}: ${errText.slice(0, 200)}` });
          }
        }
        evolutionResp = evolutionResp ?? await evoRes.json().catch(() => ({}));
      } else {
        const targetUrl = `${base}/message/sendText/${cfg.instancia}`;
        log.info('DEBUG SEND', 'Disparando para Evolution', { targetUrl, tokenPresente: !!cfg.api_key });
        let evoRes: globalThis.Response;
        try {
          evoRes = await evolutionFetch(targetUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: cfg.api_key },
            body: JSON.stringify({ number: phoneClean, text }),
          });
        } catch (err: any) {
          log.info('DEBUG SEND', 'Erro cru ao chamar Evolution API (texto)', { err: err.message });
          return res.status(502).json({ message: `Sem resposta da Evolution API: ${err.message}` });
        }
        if (!evoRes.ok) {
          const errText = await evoRes.text().catch(() => String(evoRes.status));

          if (evoRes.status === 404 || errText.includes('does not exist') || errText.includes('instance not found')) {
            log.info('SEND', 'Instância não existe ou está deslogada na Evolution — solicitando reconexão manual', { instancia });
            return res.status(401).json({
              message: 'Sessão do WhatsApp expirada ou não encontrada. Por favor, reconecte.',
              reconnect_required: true,
              instancia,
            });
          } else if (errText.includes('presenceSubscribe') || errText.includes('Cannot read properties of undefined')) {
            log.info('SEND', 'presenceSubscribe — socket não pronto, aguardando 3s e reenviando...');
            await new Promise(r => setTimeout(r, 3000));
            const retry = await evolutionFetch(targetUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', apikey: cfg.api_key },
              body: JSON.stringify({ number: phoneClean, text }),
            }).catch(() => null);
            if (!retry?.ok) {
              return res.status(503).json({ message: 'WhatsApp ainda inicializando. Tente novamente em alguns segundos.' });
            }
            evolutionResp = await retry.json().catch(() => ({}));
          } else {
            log.error('DEBUG SEND', 'Evolution texto falhou', { status: evoRes.status, body: errText.slice(0, 400) });
            return res.status(502).json({ message: `Evolution ${evoRes.status}: ${errText.slice(0, 200)}` });
          }
        } else {
          evolutionResp = await evoRes.json().catch(() => ({}));
        }
        log.info('DEBUG SEND', 'Evolution respondeu ok', { messageId: evolutionResp?.key?.id });
      }

      const messageId = evolutionResp?.key?.id || `manual_${Date.now()}`;
      const content = text || mediaCaption || null;
      const tenantId = await resolveOwnerId(userId);

      // [AUDITORIA] BUG (achado 2026-09-10): o INSERT abaixo nunca gravava `media_mimetype` (a
      // coluna nem estava na lista) — toda mídia enviada pelo chat ficava com mimetype NULL, e o
      // proxy `/api/whatsapp/media` (branch `local://`) então servia `application/octet-stream`,
      // que o `<audio>`/`<video>` do navegador se recusa a decodificar. `disparoProcessor.ts` já
      // gravava o mimetype. [AUDITORIA] FIX APLICADO: deriva o mimetype da extensão da URL, com
      // fallback por tipo de mídia.
      const mediaMimetype = (() => {
        if (!mediaUrlFinal || !mediaType) return null;
        const ext = (mediaUrlFinal.split('?')[0].split('.').pop() || '').toLowerCase();
        const byExt: Record<string, string> = {
          ogg: 'audio/ogg', opus: 'audio/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4',
          webm: mediaType === 'audio' ? 'audio/webm' : 'video/webm',
          jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
          mp4: 'video/mp4', mov: 'video/quicktime',
          pdf: 'application/pdf',
        };
        if (byExt[ext]) return byExt[ext];
        return mediaType === 'audio' ? 'audio/ogg'
          : mediaType === 'image' ? 'image/jpeg'
          : mediaType === 'video' ? 'video/mp4'
          : 'application/octet-stream';
      })();

      // [AUDITORIA] LÓGICA: Salva a mensagem associando ao tenantId (dono da instância), mas
      // registrando quem de fato disparou o envio (sent_by_user_id = userId do agente humano logado).
      // [AUDITORIA] FIX APLICADO (2026-07-21): setDbUserId(tenantId) -- o INSERT grava
      // user_id=tenantId, RLS precisa ver o mesmo id. Piloto só em homologação (ver
      // diagnosticos/AUDITORIA_LOG.md).
      await req.setDbUserId!(tenantId);
      await (await req.getDb!()).query(
        `INSERT INTO whatsapp_messages
           (user_id, sent_by_user_id, instance_name, remote_jid, message_id, from_me, message_type,
            content, media_url, media_mimetype, status, timestamp_wa)
         VALUES ($1, $2, $3, $4, $5, true, $6, $7, $8, $9, 'sent', NOW())
         ON CONFLICT (message_id, instance_name) DO NOTHING`,
        [tenantId, userId, instancia, `${phoneClean}@s.whatsapp.net`,
         messageId, msgType, content, mediaUrlFinal || null, mediaMimetype]
      ).catch(err => log.warn('SEND', 'Falha ao salvar', { err: err.message }));

      return res.json({ ok: true, messageId });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // [AUDITORIA] BUG (achado 2026-07-28 — "não consigo enviar imagem nem vídeo no chat"):
  // `enviarMidia()` (WhatsAppInterface.tsx) mandava o arquivo anexado como `data:<mime>;base64,
  // <payload>` inteiro em `mediaUrl`, e `/send` acima repassava essa string sem alteração pro
  // campo `media` do payload da Evolution — sem stripar o prefixo `data:...;base64,` (que não é
  // base64 válido) nem informar `mimetype` separado. É o ÚNICO ponto do sistema que tentava
  // mandar mídia como base64 cru pra Evolution: `disparoProcessor.ts` (imagem/áudio/documento de
  // campanha) e `agentEngine.ts` (resposta em voz) sempre fazem upload prévio e mandam uma URL
  // http(s) estável — nenhum dos dois tem precedente de base64 funcionando de verdade contra
  // essa API. [AUDITORIA] FIX APLICADO: rota nova de upload (mesmo padrão multer+diskless de
  // catalogo.ts/galeria.ts, salvando em `UPLOADS_DIR`/`/uploads`, já servido publicamente) — o
  // composer agora faz upload real do arquivo aqui primeiro e manda a URL resultante pra `/send`,
  // em vez de base64 embutido. Consistente com o único caminho já comprovado de funcionar.
  router.post('/upload-media', uploadMediaSaida.single('arquivo'), async (req: AuthRequest, res: Response) => {
    if (!req.file) return res.status(400).json({ message: 'Nenhum arquivo enviado' });
    try {
      await fs.mkdir(UPLOADS_DIR, { recursive: true });
      // [AUDITORIA] LÓGICA: nome original nem sempre tem extensão de verdade (ex: print colado
      // via Ctrl+V vira um File genérico do navegador) — extensaoParaArquivo() (mesma função já
      // usada pra mídia recebida, agora exportada) resolve por nome -> mimetype -> categoria
      // (`tipo`, enviado pelo frontend junto do arquivo). Extensão certa importa porque
      // `express.static` (rota /uploads) decide o Content-Type servido pela extensão do arquivo.
      const tipoHint = String(req.body?.tipo || 'document');
      const ext = extensaoParaArquivo(req.file.originalname, req.file.mimetype, tipoHint);
      const filename = `wa_out_${uuidv4()}.${ext}`;
      await fs.writeFile(path.join(UPLOADS_DIR, filename), req.file.buffer);
      return res.json({ url: `${API_BASE_URL}/uploads/${filename}` });
    } catch (err: any) {
      log.error('WA_MEDIA_OUT', 'Falha ao salvar upload de mídia de saída', { err: err?.message });
      return res.status(500).json({ message: 'Falha ao salvar arquivo' });
    }
  });

  router.delete('/instances/:name', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const name = req.params.name;

      // [AUDITORIA] FIX APLICADO (2026-07-22): esta rota chamava /instance/logout e
      // /instance/delete de VERDADE na Evolution usando `name` direto da URL, sem verificar
      // se a instância pertence ao usuário autenticado — as queries de limpeza no banco já
      // eram escopadas por user_id+instance_name (não corrompiam dados de outro tenant), mas
      // a desconexão/exclusão REAL na Evolution acontecia mesmo assim. Incidente real em
      // produção: o admin (mentoark@gmail.com) chamou esta rota com a instância de outro
      // cliente (stefanocatedral@hotmail.com) e derrubou o WhatsApp real dele — ver
      // diagnosticos/AUDITORIA_LOG.md. Mesmo padrão de checagem de ownership já usado em
      // /send (instanciaSolicitada) e em kanban.ts.
      const ownRes = await pool.query(
        `SELECT 1 FROM integracoes_config WHERE user_id = $1 AND instancia = $2 AND tipo = 'evolution'
         UNION
         SELECT 1 FROM agentes WHERE user_id = $1 AND evolution_instancia = $2
         LIMIT 1`,
        [userId, name]
      ).catch(() => ({ rows: [] as any[] }));
      if (!ownRes.rows.length) {
        log.warn('WHATSAPP', 'DELETE /instances: instância não pertence ao usuário', { userId, name });
        return res.status(403).json({ message: 'Instância não pertence a este usuário' });
      }

      const cfg = await getEvolutionConfig(userId);
      const base = cfg.url.replace(/\/$/, '');

      await registrarWebhook(base, cfg.api_key, name, false).catch(() => {});

      await evolutionFetch(`${base}/instance/logout/${name}`, {
        method: 'DELETE',
        headers: { apikey: cfg.api_key },
      }).catch(() => null);

      await evolutionFetch(`${base}/instance/delete/${name}`, {
        method: 'DELETE',
        headers: { apikey: cfg.api_key },
      }).catch(() => null);

      await Promise.allSettled([
        // [AUDITORIA] FIX APLICADO: filtro por instance_name adicionado. A query original
        // (`WHERE user_id = $1`, sem filtrar por instância) apagava o historico de TODAS as
        // instancias do usuario ao deletar uma unica instancia — causou perda real de mensagens
        // em producao (ver diagnosticos/AUDITORIA_LOG.md).
        // [AUDITORIA] FIX APLICADO (2026-07-21): req.getDb() -- piloto de RLS, só
        // homologação (ver diagnosticos/AUDITORIA_LOG.md).
        // [AUDITORIA] FIX APLICADO (2026-07-22): removidas as DELETEs de whatsapp_message_status
        // e n8n_chat_histories deste array — a segunda apagava a memória de conversa da IA a
        // cada desconexão/reconexão da mesma instância, decisão explícita do usuário de manter
        // esse contexto vivo entre reconexões (ver AUDITORIA_LOG.md).
        // [AUDITORIA] BUG GRAVE CORRIGIDO (achado 2026-08-10 — mesmo padrão do endpoint
        // /disconnect, ver comentário completo lá): as duas UPDATEs de `contatos`/`dados_cliente`
        // sem filtro de instância reativavam a IA pra TODOS os contatos do tenant, inclusive os
        // pausados de propósito (atendente humano) ou por falha real de LLM. Removido.
        // [AUDITORIA] FIX APLICADO (pedido explícito do usuário, 2026-09-09): removida a linha
        // `UPDATE whatsapp_messages SET deleted_at = NOW()`. Deletar a instância NÃO apaga mais
        // o histórico de conversa — só some por ação explícita do usuário em
        // DELETE /whatsapp/instances/:name/mensagens (botão "Apagar mensagens" em Configurações).
        pool.query(`DELETE FROM webhook_mensagens_processadas WHERE instancia = $1`, [name]),
        pool.query(`DELETE FROM integracoes_config WHERE user_id = $1 AND tipo = 'evolution' AND instancia = $2`, [userId, name]),
        pool.query(
          `UPDATE agentes
           SET evolution_instancia = NULL,
               evolution_server_url = NULL,
               evolution_api_key = NULL,
               updated_at = NOW()
           WHERE user_id = $1 AND evolution_instancia = $2`,
          [userId, name]
        )
      ]);

      return res.json({ ok: true, message: 'Instância removida e estado limpo.' });
    } catch (err: any) {
      log.error('WHATSAPP', 'Erro ao deletar instância via DELETE', { err: err?.message, stack: err?.stack });
      return res.status(500).json({ message: err.message });
    }
  });

  // [AUDITORIA] LÓGICA (pedido explícito do usuário, 2026-09-09): ÚNICA forma de apagar
  // mensagens é esta — ação deliberada do usuário. Deletar/desconectar instância nunca mais
  // toca em whatsapp_messages. Soft-delete (deleted_at) + purga física pelo cron de 90 dias
  // (mesmo padrão LGPD já usado). Checagem de ownership igual à do DELETE /instances/:name.
  router.delete('/instances/:name/mensagens', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const name = req.params.name;

      const ownRes = await pool.query(
        `SELECT 1 FROM integracoes_config WHERE user_id = $1 AND instancia = $2 AND tipo = 'evolution'
         UNION
         SELECT 1 FROM agentes WHERE user_id = $1 AND evolution_instancia = $2
         UNION
         SELECT 1 FROM whatsapp_messages WHERE user_id = $1 AND instance_name = $2 LIMIT 1`,
        [userId, name]
      ).catch(() => ({ rows: [] as any[] }));
      if (!ownRes.rows.length) {
        return res.status(403).json({ message: 'Instância não pertence a este usuário' });
      }

      const db = await req.getDb!();
      const r = await db.query(
        `UPDATE whatsapp_messages SET deleted_at = NOW()
         WHERE user_id = $1 AND instance_name = $2 AND deleted_at IS NULL`,
        [userId, name]
      );

      log.info('WHATSAPP', 'Mensagens apagadas por ação explícita do usuário', { userId, instancia: name, count: r.rowCount });
      return res.json({ ok: true, apagadas: r.rowCount ?? 0 });
    } catch (err: any) {
      log.error('WHATSAPP', 'Erro ao apagar mensagens da instância', { err: err?.message });
      return res.status(500).json({ message: err.message });
    }
  });

  router.post('/evo/test', async (req: AuthRequest, res: Response) => {
    try {
      const bodyUrl    = (req.body?.url    as string | undefined)?.trim();
      const bodyApiKey = (req.body?.api_key as string | undefined)?.trim();

      let url = bodyUrl;
      let api_key = bodyApiKey;
      if (!url || !api_key) {
        const cfg = await getEvolutionConfig(req.userId!);
        url     = cfg.url;
        api_key = cfg.api_key;
      }
      if (!url || !api_key) return res.status(400).json({ message: 'Configure a URL e API Key em Conectores primeiro.' });

      const base = url.replace(/\/$/, '');
      const r = await evolutionFetch(`${base}/instance/fetchInstances`, { headers: { apikey: api_key } });
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        return res.status(r.status).json({ message: `Evolution retornou HTTP ${r.status}`, detail: txt.slice(0, 300) });
      }
      const instances = (await r.json().catch(() => [])) as any[];
      return res.json({ ok: true, instances: Array.isArray(instances) ? instances : [] });
    } catch (err: any) {
      return res.status(502).json({ message: `Sem resposta do servidor Evolution: ${err.message}` });
    }
  });

  router.post('/evo/connect', async (req: AuthRequest, res: Response) => {
    try {
      const cfg = await getEvolutionConfig(req.userId!);
      const base = cfg.url.replace(/\/$/, '');
      const key  = cfg.api_key;

      if (!base || !key) return res.status(400).json({ message: 'Configure URL e API Key em Conectores antes de conectar.' });

      const lockKey = `connect:${req.userId!}`;
      if (connectingUsers.has(lockKey)) {
        return res.json({ state: 'connecting', instancia: cfg.instancia });
      }
      connectingUsers.add(lockKey);
      setTimeout(() => connectingUsers.delete(lockKey), 30_000);

      const stateR = await evolutionFetch(`${base}/instance/connectionState/${cfg.instancia}`, { headers: { apikey: key } }).catch(() => null);
      if (stateR?.status === 401) {
        return res.json({ state: 'unauthorized', instancia: cfg.instancia });
      }
      if (stateR?.ok) {
        const sd: any = await stateR.json().catch(() => ({}));
        const state = sd?.instance?.state || sd?.state || 'close';
        if (state === 'open') {
          await registrarWebhook(base, key, cfg.instancia);
          return res.json({ state: 'open', instancia: cfg.instancia });
        }
      }

      const connR = await evolutionFetch(`${base}/instance/connect/${cfg.instancia}`, { headers: { apikey: key } }).catch(() => null);
      if (connR?.ok) {
        const cd: any = await connR.json().catch(() => ({}));
        const qrRaw = cd?.base64 || cd?.qrcode?.base64 || cd?.code || null;
        if (qrRaw) {
          await registrarWebhook(base, key, cfg.instancia);
          return res.json({ state: 'connecting', qrCode: normalizeQr(qrRaw), pairingCode: cd?.pairingCode || null, instancia: cfg.instancia });
        }
      }

      const createR = await evolutionFetch(`${base}/instance/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: key },
        body: JSON.stringify({
          instanceName: cfg.instancia, qrcode: true, integration: 'WHATSAPP-BAILEYS',
          // [AUDITORIA] FIX APLICADO (2026-07-22): ver comentário completo no outro
          // /instance/create acima (mesmo arquivo) — groupsIgnore=true bloqueava a entrega do
          // webhook de mensagem de grupo na origem (Evolution), não era filtro nosso.
          groupsIgnore: false, alwaysOnline: true, readMessages: true,
          webhook: webhookInner(),
        }),
      });
      const created: any = await createR.json().catch(() => ({}));

      await new Promise(r => setTimeout(r, 1500));
      const qrR = await evolutionFetch(`${base}/instance/connect/${cfg.instancia}`, { headers: { apikey: key } }).catch(() => null);
      const qd: any = qrR?.ok ? await qrR.json().catch(() => ({})) : {};
      const qrCode = created?.qrcode?.base64 || qd?.base64 || qd?.code || null;
      await registrarWebhook(base, key, cfg.instancia);

      return res.json({ state: 'connecting', qrCode: normalizeQr(qrCode), pairingCode: qd?.pairingCode || null, instancia: cfg.instancia });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // [AUDITORIA] FIX APLICADO: esta é a rota que InstanceManagementPanel/WhatsAppInterface
  // realmente chamam (fetchConnectionStatus, poll de status a cada 30s + espera pós-scan do QR
  // em pollUntilConnected) — tinha o mesmo bug de silenciar erro HTTP/rede da Evolution como
  // 'close', já corrigido em /status e /poll-qr mas esquecido aqui.
  router.get('/evo/status', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const cfg = await getEvolutionConfig(userId);

      // [AUDITORIA] FIX APLICADO (2026-07-22): `instancia` vinha da query string sem checagem
      // de ownership — mesma classe do bug corrigido em DELETE /instances/:name e /status
      // (ver diagnosticos/AUDITORIA_LOG.md), aqui de severidade menor (só leitura de status,
      // sem escrita), mas ainda assim permitia consultar o estado de conexão de instância de
      // outro tenant. Mesmo padrão de checagem já usado em /send e /status.
      const instanciaSolicitada = (req.query['instancia'] as string | undefined) || undefined;
      let instancia = cfg.instancia;
      if (instanciaSolicitada && instanciaSolicitada !== cfg.instancia) {
        const instRes = await pool.query(
          `SELECT 1 FROM integracoes_config WHERE user_id = $1 AND instancia = $2 AND tipo = 'evolution'
           UNION
           SELECT 1 FROM agentes WHERE user_id = $1 AND evolution_instancia = $2
           LIMIT 1`,
          [userId, instanciaSolicitada]
        ).catch(() => ({ rows: [] as any[] }));
        if (instRes.rows.length) {
          instancia = instanciaSolicitada;
        } else {
          log.warn('WHATSAPP', 'GET /evo/status: instância solicitada não pertence ao usuário — ignorando', { userId, instanciaSolicitada });
        }
      }

      if (!cfg.url || !cfg.api_key) return res.json({ state: 'nao_configurado' });
      const base = cfg.url.replace(/\/$/, '');

      // [AUDITORIA] LÓGICA: sync_status/sync_progress alimentam a barra de progresso de
      // sincronização de histórico no frontend — lidos junto com o status de conexão, sem
      // endpoint/polling novo (ver diagnosticos/AUDITORIA_LOG.md).
      const syncRes = await pool.query(
        `SELECT sync_status, sync_progress, sync_total FROM integracoes_config
         WHERE user_id = $1 AND instancia = $2 AND tipo = 'evolution' LIMIT 1`,
        [userId, instancia]
      ).catch(() => ({ rows: [] as any[] }));
      const sync = syncRes.rows[0] || {};

      const r = await evolutionFetch(`${base}/instance/connectionState/${instancia}`, { headers: { apikey: cfg.api_key } }).catch(() => null);
      if (!r) return res.status(503).json({ state: 'close', error: true, message: 'Evolution API inacessível ou offline.', instancia, ...sync });
      if (r.status === 401) return res.json({ state: 'unauthorized', instancia, ...sync });
      if (!r.ok) {
        const errorText = await r.text().catch(() => 'Erro desconhecido');
        return res.status(r.status).json({
          state: 'close',
          error: true,
          code: r.status,
          message: `Evolution API erro (${r.status}): ${errorText.slice(0, 150)}`,
          instancia,
          ...sync,
        });
      }
      const d: any = await r.json().catch(() => ({}));
      const state = d?.instance?.state || d?.state || 'close';
      // [AUDITORIA] FIX APLICADO (2026-08-07): ver buscarPhoneNumberInstancia() — connectionState
      // não devolve profile/owner, então isso sempre voltava vazio antes. Só busca quando
      // realmente conectada (evita bater fetchInstances à toa pra instância fechada).
      const phoneNumber = state === 'open' ? await buscarPhoneNumberInstancia(base, cfg.api_key, instancia) : '';
      return res.json({ state, phoneNumber, instancia, ...sync });
    } catch (err: any) {
      return res.status(502).json({ message: err.message });
    }
  });

  router.get('/search', async (req: AuthRequest, res: Response) => {
    const userId = req.userId!;
    const q = ((req.query.q as string) || '').trim();
    if (!q || q.length < 2) return res.json([]);
    const tenantId = await resolveOwnerId(userId);
    // [AUDITORIA] FIX APLICADO (2026-07-21): piloto de RLS em whatsapp_messages, só
    // homologação (ver diagnosticos/AUDITORIA_LOG.md).
    await req.setDbUserId!(tenantId);
    const r = await (await req.getDb!()).query(
      `SELECT m.id, m.content, m.timestamp_wa, m.created_at, m.from_me,
               split_part(m.remote_jid,'@',1) AS phone,
               COALESCE(c.nome, c.push_name, split_part(m.remote_jid,'@',1)) AS contact_name,
               COALESCE(c.foto_perfil, c.profile_pic_url) AS profile_pic
        FROM whatsapp_messages m
        LEFT JOIN contatos c ON c.user_id = m.user_id
          AND c.telefone ILIKE '%' || RIGHT(split_part(m.remote_jid,'@',1), 11)
        WHERE m.user_id = $1 AND m.content ILIKE $2
          AND m.remote_jid NOT LIKE '%@g.us'
          AND m.deleted_at IS NULL
        ORDER BY m.created_at DESC LIMIT 50`,
      [tenantId, `%${q}%`]
    );
    return res.json(r.rows);
  });

  router.delete('/messages/:id', async (req: AuthRequest, res: Response) => {
    const userId = req.userId!;
    const id = req.params.id;
    const { forEveryone, instancia, remoteJid } = req.body as any;
    const tenantId = await resolveOwnerId(userId);
    // [AUDITORIA] FIX APLICADO (2026-07-21): soft-delete em vez de DELETE físico —
    // evita perda irreversível de dados, ver AUDITORIA_LOG.md. Piloto de RLS em
    // whatsapp_messages, só homologação.
    await req.setDbUserId!(tenantId);
    await (await req.getDb!()).query(
      `UPDATE whatsapp_messages SET deleted_at = NOW() WHERE (id::text = $1 OR message_id = $1) AND user_id = $2`,
      [id, tenantId]
    ).catch(() => {});
    if (forEveryone && instancia && remoteJid) {
      const cfg = await getEvolutionConfig(userId);
      const base = cfg.url.replace(/\/$/, '');
      await evolutionFetch(`${base}/chat/deleteMessage/${instancia}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', apikey: cfg.api_key },
        body: JSON.stringify({ remoteJid, messageId: id }),
      }).catch(() => {});
    }
    return res.json({ ok: true });
  });

  // PATCH /messages/:id/fixar — "mensagem fixada" é uma feature só do CRM (não sincroniza com o
  // WhatsApp real — a Evolution API não expõe fixar/desafixar mensagem, ver migrations.ts).
  // Visível pra qualquer atendente do tenant, não só quem fixou.
  router.patch('/messages/:id/fixar', async (req: AuthRequest, res: Response) => {
    const userId = req.userId!;
    const id = req.params.id;
    const fixada = !!req.body?.fixada;
    const tenantId = await resolveOwnerId(userId);
    await req.setDbUserId!(tenantId);
    const r = await (await req.getDb!()).query(
      `UPDATE whatsapp_messages
       SET fixada = $1, fixada_em = CASE WHEN $1 THEN NOW() ELSE NULL END,
           fixada_por = CASE WHEN $1 THEN $2 ELSE NULL END
       WHERE (id::text = $3 OR message_id = $3) AND user_id = $4
       RETURNING id, fixada`,
      [fixada, userId, id, tenantId]
    ).catch(() => ({ rows: [] as any[] }));
    if (!r.rows.length) return res.status(404).json({ message: 'Mensagem não encontrada' });
    return res.json({ ok: true, fixada: r.rows[0].fixada });
  });

  router.patch('/conversas/:phone/read', async (req: AuthRequest, res: Response) => {
    const userId = req.userId!;
    const phone = normalizarPhoneParam(decodeURIComponent(req.params.phone));
    const tenantId = await resolveOwnerId(userId);
    // [AUDITORIA] FIX APLICADO (2026-07-21): piloto de RLS em whatsapp_messages, só
    // homologação (ver diagnosticos/AUDITORIA_LOG.md).
    await req.setDbUserId!(tenantId);
    await (await req.getDb!()).query(
      `UPDATE whatsapp_messages SET is_read = true
       WHERE user_id = $1 AND split_part(remote_jid,'@',1) = $2 AND from_me = false`,
      [tenantId, phone]
    ).catch(() => {});
    return res.json({ ok: true });
  });

  router.post('/chat-prefs/:phone', async (req: AuthRequest, res: Response) => {
    const userId = req.userId!;
    const phone = decodeURIComponent(req.params.phone).replace(/\D/g, '');
    const { pinned, archived, muted_until } = req.body as any;
    const tenantId = await resolveOwnerId(userId);
    const setParts: string[] = [];
    const vals: any[] = [tenantId, `%${phone.slice(-11)}`];
    if (pinned !== undefined)      { setParts.push(`is_pinned = $${vals.length + 1}`);    vals.push(pinned); }
    if (archived !== undefined)    { setParts.push(`is_archived = $${vals.length + 1}`);  vals.push(archived); }
    if (muted_until !== undefined) { setParts.push(`muted_until = $${vals.length + 1}`);  vals.push(muted_until); }
    if (!setParts.length) return res.json({ ok: true });
    await pool.query(
      `UPDATE contatos SET ${setParts.join(', ')}, updated_at = NOW()
       WHERE user_id = $1 AND telefone ILIKE $2`,
      vals
    ).catch(() => {});
    return res.json({ ok: true });
  });

  return router;
}