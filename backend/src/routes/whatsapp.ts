/**
 * whatsapp.ts — Todas as rotas REST de WhatsApp usadas pelo frontend (montadas em /api/whatsapp).
 *
 * Cobre: listar/ler conversas e mensagens, enviar texto/mídia, pausar/reativar IA por contato,
 * conectar/desconectar instância na Evolution API (com QR code), sincronizar histórico, buscar
 * fotos de perfil, e registrar o webhook da instância na Evolution (registrarWebhook/webhookInner).
 * getEvolutionConfig()/saveEvolutionConfig() são a fonte de verdade da config Evolution (url,
 * api_key, instancia) usada por toda ação de saída — ver [AUDITORIA] BUG logo abaixo sobre a
 * relação (inconsistente) dessas funções com a tabela agent_configs.
 */
import { Router, Response } from 'express';
import { Pool } from 'pg';
import fs from 'fs/promises';
import path from 'path';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { AuthRequest } from '../middleware';
import { evolutionFetch, sanitizeEvolutionUrl } from '../utils/resilientFetch';
import { resolverCaminhoLocal, salvarFotoPerfilLocal, resolverCaminhoLocalFoto, garantirMidiaEstavel, MAX_OUTBOUND_MEDIA_BYTES, extensaoParaArquivo, buscarInfoGrupo } from '../utils/whatsappMediaStorage';
import { log } from '../logger';

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
      await pool.query(
        `UPDATE agentes SET evolution_server_url=$1, evolution_api_key=$2, evolution_instancia=$3, updated_at=NOW()
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
        `UPDATE agentes SET evolution_server_url=$1, evolution_api_key=$2, updated_at=NOW()
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
          `INSERT INTO agentes (user_id, nome, evolution_server_url, evolution_api_key, evolution_instancia, ativo_motor)
           VALUES ($1, 'Conexão WhatsApp', $2, $3, $4, false)`,
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
            await pool.query(
              `INSERT INTO contatos (user_id, nome, telefone, origem, status, ultima_mensagem_em)
               VALUES ($1, $2, $3, 'WhatsApp', 'novo', NOW())
               ON CONFLICT (user_id, telefone) DO UPDATE
                 SET nome = CASE WHEN $2 IS NOT NULL AND $2 <> contatos.telefone THEN $2 ELSE contatos.nome END,
                     profile_pic_url = COALESCE($4, contatos.profile_pic_url),
                     foto_perfil = COALESCE($4, contatos.foto_perfil),
                     ultima_mensagem_em = NOW()`,
              [userId, subject || groupId, groupId, localUrl || pictureUrl]
            ).catch(() => {});
            gruposSincronizados++;
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

  router.get('/conversas', async (req: AuthRequest, res: Response) => {
    log.info('WHATSAPP', 'request recebida', { method: req.method, path: req.path, userId: req.userId, query: req.query });
    try {
      const userId = req.userId!;
      const showArchived = req.query.archived === 'true';
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
         WHERE r.rn = 1
           AND COALESCE(cu.is_archived, false) = $2
         ORDER BY cu.is_pinned DESC NULLS LAST, r.created_at DESC
         LIMIT 300`,
        [tenantId, showArchived]
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
           m.timestamp_wa, m.created_at, m.is_read,
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
      const agentConfig = await pool.query(
        `SELECT nome_agente, modelo_llm, ativo,
                (prompt_sistema IS NOT NULL AND prompt_sistema != '') AS tem_prompt
         FROM agent_configs WHERE user_id = $1 AND ativo = true LIMIT 1`,
        [req.userId]
      );
      return res.json({
        agentes: agentes.rows,
        integracoes: integracoes.rows,
        ultima_mensagem: ultimaMensagem.rows[0] || null,
        provider: provider.rows[0] || null,
        agent_config: agentConfig.rows[0] || null,
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
      const phoneNumber = data?.instance?.profileName || data?.instance?.number || data?.instance?.owner || '';

      if (state === 'open' || state === 'connected' || state === 'CONNECTED') {
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
      if (req.body?.nova_conexao === true) {
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
          const hasPhone = !!(stateData?.instance?.profileName || stateData?.instance?.number || stateData?.instance?.owner || stateData?.instance?.profile);
          if (hasPhone) {
            await registrarWebhook(base, cfg.api_key, cfg.instancia);
            await saveEvolutionConfig(userId, cfg.agenteId, cfg.url, cfg.api_key, cfg.instancia);
            return res.json({
              state: 'open',
              phoneNumber: stateData?.instance?.profileName || stateData?.instance?.number || stateData?.instance?.owner || '',
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
      const queries = [
        (await req.getDb!()).query(`UPDATE whatsapp_messages SET deleted_at = NOW() WHERE user_id = $1 AND instance_name = $2`, [userId, instancia]),
        pool.query(`DELETE FROM webhook_mensagens_processadas WHERE instancia = $1`, [instancia]),
        pool.query(`DELETE FROM integracoes_config WHERE user_id = $1 AND tipo = 'evolution' AND instancia = $2`, [userId, instancia]),
        pool.query(`UPDATE contatos SET atendente_pausou_ia = false WHERE user_id = $1`, [userId]),
        pool.query(`UPDATE dados_cliente SET atendimento_ia = 'ativo' WHERE user_id = $1`, [userId]),
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
          if (!remoteJid || remoteJid.endsWith('@g.us')) continue;
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
        const mediaEndpoints: Record<string, string> = {
          image: 'sendMedia',
          video: 'sendMedia',
          document: 'sendMedia',
          audio: 'sendMedia',
        };
        const endpoint = mediaEndpoints[mediaType] || 'sendMedia';
        const mediaPayload: any = {
          number: phoneClean,
          mediatype: mediaType,
          media: mediaUrlFinal,
        };
        if (mediaCaption) mediaPayload.caption = mediaCaption;
        if (mediaFilename) mediaPayload.fileName = mediaFilename;

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

      // [AUDITORIA] LÓGICA: Salva a mensagem associando ao tenantId (dono da instância), mas
      // registrando quem de fato disparou o envio (sent_by_user_id = userId do agente humano logado).
      // [AUDITORIA] FIX APLICADO (2026-07-21): setDbUserId(tenantId) -- o INSERT grava
      // user_id=tenantId, RLS precisa ver o mesmo id. Piloto só em homologação (ver
      // diagnosticos/AUDITORIA_LOG.md).
      await req.setDbUserId!(tenantId);
      await (await req.getDb!()).query(
        `INSERT INTO whatsapp_messages
           (user_id, sent_by_user_id, instance_name, remote_jid, message_id, from_me, message_type,
            content, media_url, status, timestamp_wa)
         VALUES ($1, $2, $3, $4, $5, true, $6, $7, $8, 'sent', NOW())
         ON CONFLICT (message_id, instance_name) DO NOTHING`,
        [tenantId, userId, instancia, `${phoneClean}@s.whatsapp.net`,
         messageId, msgType, content, mediaUrlFinal || null]
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
        (await req.getDb!()).query(`UPDATE whatsapp_messages SET deleted_at = NOW() WHERE user_id = $1 AND instance_name = $2`, [userId, name]),
        pool.query(`DELETE FROM webhook_mensagens_processadas WHERE instancia = $1`, [name]),
        pool.query(`DELETE FROM integracoes_config WHERE user_id = $1 AND tipo = 'evolution' AND instancia = $2`, [userId, name]),
        pool.query(`UPDATE contatos SET atendente_pausou_ia = false WHERE user_id = $1`, [userId]),
        pool.query(`UPDATE dados_cliente SET atendimento_ia = 'ativo' WHERE user_id = $1`, [userId]),
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
      return res.json({ state: d?.instance?.state || d?.state || 'close', instancia, ...sync });
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