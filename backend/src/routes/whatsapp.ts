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
import { AuthRequest } from '../middleware';
import { evolutionFetch, sanitizeEvolutionUrl } from '../utils/resilientFetch';
import { log } from '../logger';

const DEFAULT_EVO_URL = process.env.EVOLUTION_API_URL || 'https://disparo.mentoark.com.br';
const DEFAULT_EVO_KEY = process.env.EVOLUTION_API_KEY || 'mentoark2025evolutionkey';

const WEBHOOK_URL = (() => {
  const base = process.env.EVOLUTION_WEBHOOK_URL || 'https://api.mentoark.com.br/webhook/evolution';
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET;
  if (!secret) return base;
  return `${base}${base.includes('?') ? '&' : '?'}key=${secret}`;
})();
const WEBHOOK_EVENTS = ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'MESSAGES_DELETE', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'];

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

export default function whatsappRouter(pool: Pool): Router {
  const connectingUsers = new Set<string>();
  const router = Router();

  async function getEvolutionConfig(userId: string): Promise<{
    url: string; api_key: string; instancia: string; agenteId: string | null; isGlobal: boolean; stableInstancia: string;
  }> {
    const stableInstancia = `crm_${userId.replace(/-/g, '').slice(0, 12)}`;
    const intRes = await pool.query(
      `SELECT url, api_key, instancia FROM integracoes_config 
       WHERE user_id = $1 AND tipo = 'evolution' LIMIT 1`,
      [userId]
    );

    if (intRes.rows.length) {
      const row = intRes.rows[0];
      return {
        url: row.url || DEFAULT_EVO_URL,
        api_key: row.api_key || DEFAULT_EVO_KEY,
        instancia: row.instancia || stableInstancia,
        agenteId: null,
        isGlobal: !row.url,
        stableInstancia
      };
    }

    const r = await pool.query(
      `SELECT id, evolution_server_url AS url, evolution_api_key AS api_key, evolution_instancia AS instancia
       FROM agentes
       WHERE user_id = $1 AND ativo = true
       ORDER BY updated_at DESC LIMIT 1`,
      [userId]
    );

    if (r.rows.length) {
      const row = r.rows[0];
      const url = row.url || DEFAULT_EVO_URL;
      const api_key = row.api_key || DEFAULT_EVO_KEY;
      const instancia = row.instancia || stableInstancia;
      return { url, api_key, instancia, agenteId: row.id, isGlobal: !row.url, stableInstancia };
    }

    return { url: DEFAULT_EVO_URL, api_key: DEFAULT_EVO_KEY, instancia: stableInstancia, agenteId: null, isGlobal: true, stableInstancia };
  }

  async function saveEvolutionConfig(
    userId: string, agenteId: string | null,
    url: string, api_key: string, instancia: string
  ) {
    await pool.query(
      `DELETE FROM integracoes_config WHERE user_id=$1 AND tipo='evolution' AND instancia!=$2`,
      [userId, instancia]
    );
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
      await pool.query(
        `UPDATE agentes SET evolution_server_url=$1, evolution_api_key=$2, evolution_instancia=$3, updated_at=NOW()
         WHERE user_id=$4 AND ativo=true`,
        [url, api_key, instancia, userId]
      );
    }
  }

  async function buscarFotoEvo(base: string, apiKey: string, instancia: string, phone: string): Promise<string | null> {
    try {
      const r = await fetch(`${base}/chat/fetchProfilePictureUrl/${instancia}`, {
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
      const r = await fetch(`${base}/fetchProfilePicture/${instancia}?number=${phone}`, {
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
    const suffix = `%${phone.slice(-11)}`;
    await pool.query(
      `UPDATE contatos SET foto_perfil = $1, profile_pic_url = $1${pushName ? ', push_name = COALESCE($4, push_name)' : ''}
       WHERE user_id = $2 AND telefone ILIKE $3`,
      pushName ? [picUrl, userId, suffix, pushName] : [picUrl, userId, suffix]
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
      const phonesRes = await pool.query(
        `SELECT DISTINCT split_part(remote_jid, '@', 1) AS phone
         FROM whatsapp_messages
         WHERE user_id = $1 AND remote_jid NOT LIKE '%@g.us'
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

      return res.json({ sincronizados, total: phonesRes.rows.length });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  router.get('/conversas', async (req: AuthRequest, res: Response) => {
    log.info('WHATSAPP', 'request recebida', { method: req.method, path: req.path, userId: req.userId, query: req.query });
    try {
      const userId = req.userId!;
      const showArchived = req.query.archived === 'true';

      const r = await pool.query(
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
           WHERE m.user_id = $1
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
           COALESCE(cu.is_pinned, false) AS is_pinned,
           COALESCE(cu.is_archived, false) AS is_archived,
           cu.muted_until
         FROM ranked r
         LEFT JOIN contato_unico cu ON cu.sufixo = RIGHT(r.phone, 11) AND NOT r.is_group
         WHERE r.rn = 1
           AND COALESCE(cu.is_archived, false) = $2
         ORDER BY cu.is_pinned DESC NULLS LAST, r.created_at DESC
         LIMIT 300`,
        [userId, showArchived]
      );

      const conversas = r.rows.map(row => {
        const isGroup = row.is_group;
        const nomeFormatado = isGroup
          ? `Grupo ${row.session_id.split('-')[0]?.slice(-4) ?? row.session_id.slice(-8)}`
          : (row.nome_contato || row.push_name || row.session_id.replace(/^55/, '').replace(/(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3'));
        return {
          session_id: row.session_id,
          instancia: row.instancia,
          is_group: isGroup,
          nome: nomeFormatado,
          push_name: isGroup ? (row.last_sender || null) : (row.push_name || null),
          profile_pic_url: row.profile_pic_url || null,
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
      const phone = decodeURIComponent(req.params.phone).replace(/\D/g, '');
      if (!phone || phone.length < 8) return res.status(400).json({ message: 'Telefone inválido' });

      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const offset = Number(req.query.offset) || 0;

      const r = await pool.query(
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
         ORDER BY COALESCE(m.timestamp_wa, m.created_at) ASC
         LIMIT $3 OFFSET $4`,
        [phone, userId, limit, offset]
      );

      const mensagens = r.rows.map(row => ({
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
      const phone = decodeURIComponent(req.params.phone).replace(/\D/g, '');
      const r = await pool.query(
        `SELECT m.message_id, COALESCE(s.status, m.status) AS status, m.created_at
         FROM whatsapp_messages m
         LEFT JOIN whatsapp_message_status s
           ON s.message_id = m.message_id AND s.instance_name = m.instance_name
         WHERE split_part(m.remote_jid, '@', 1) = $1 AND m.user_id = $2 AND m.from_me = true
         ORDER BY m.created_at DESC LIMIT 50`,
        [phone, userId]
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
      const r = await pool.query(
        `SELECT atendente_pausou_ia, nome, push_name
         FROM contatos
         WHERE user_id = $1 AND telefone ILIKE $2
         LIMIT 1`,
        [userId, `%${phone.slice(-11)}`]
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

      const upd = await pool.query(
        `UPDATE contatos SET atendente_pausou_ia = $1
         WHERE user_id = $2 AND telefone ILIKE $3`,
        [pausar, userId, suffix]
      );

      if (!upd.rowCount) {
        await pool.query(
          `INSERT INTO contatos (user_id, nome, telefone, origem, status, atendente_pausou_ia)
           VALUES ($1, $2, $3, 'WhatsApp', 'novo', $4)`,
          [userId, phoneClean, phoneClean, pausar]
        ).catch(() => {});
      }

      await pool.query(
        `UPDATE dados_cliente SET atendimento_ia = $1
         WHERE user_id = $2 AND telefone ILIKE $3`,
        [pausar ? 'pause' : 'ativo', userId, suffix]
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

      const r = await pool.query(
        `UPDATE contatos SET nome = $1
         WHERE user_id = $2 AND telefone ILIKE $3
         RETURNING id, nome, telefone, push_name, profile_pic_url`,
        [nome.trim(), userId, `%${phone.slice(-11)}`]
      );

      if (!r.rowCount) {
        const ins = await pool.query(
          `INSERT INTO contatos (user_id, nome, telefone, origem, status, atendente_pausou_ia)
           VALUES ($1, $2, $3, 'WhatsApp', 'novo', false)
           RETURNING id, nome, telefone, push_name, profile_pic_url`,
          [userId, nome.trim(), phone]
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
      const ultimaMensagem = await pool.query(
        `SELECT created_at, instance_name FROM whatsapp_messages
         WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
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
      if (!mediaUrl || !/^https?:\/\//.test(mediaUrl)) {
        return res.status(400).json({ message: 'url inválida' });
      }

      const cfg = await getEvolutionConfig(req.userId!);
      let mediaRes = await fetch(mediaUrl, {
        headers: { apikey: cfg.api_key },
      }).catch(() => null);

      if (!mediaRes || !mediaRes.ok) {
        mediaRes = await fetch(mediaUrl).catch(() => null);
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
      const cfg = await getEvolutionConfig(req.userId!);
      const base = cfg.url.replace(/\/$/, '');
      const instancia = (req.body?.instancia as string | undefined) || cfg.instancia;

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
          const instances: any[] = await listRes.json().catch(() => []);
          const userIdShort = userId.replace(/-/g, '').slice(0, 12);
          for (const inst of instances) {
            const name = inst.instanceName || inst.name;
            if (name && name.includes(userIdShort) && name !== cfg.stableInstancia) {
              log.info('WHATSAPP', 'Removendo instância duplicada/antiga', { name });
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
        groupsIgnore: true,
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

      if (!createRes.ok && (created?.message?.includes('already') || created?.message?.includes('exist') || created?.message?.includes('conflict'))) {
        const connectRes = await evolutionFetch(`${base}/instance/connect/${cfg.instancia}`, {
          headers: { apikey: cfg.api_key },
        }).catch(() => null);

        if (connectRes?.ok) {
          const rcData: any = await connectRes.json().catch(() => ({}));
          const qrRaw = rcData?.base64 || rcData?.qrcode?.base64 || rcData?.code || null;
          await saveEvolutionConfig(userId, cfg.agenteId, cfg.url, cfg.api_key, cfg.stableInstancia);
          await registrarWebhook(base, cfg.api_key, cfg.stableInstancia);
          return res.json({
            state: 'connecting',
            qrCode: normalizeQr(qrRaw),
            pairingCode: rcData?.pairingCode || rcData?.code || null,
            instanceName: cfg.stableInstancia,
            instancia: cfg.stableInstancia,
          });
        }
      }

      // [AUDITORIA] FIX APLICADO: restaurado (havia sido perdido em uma reescrita anterior) —
      // se /instance/create falhar e não for o caso de "já existe" (tratado acima), o fluxo
      // seguia adiante e devolvia qrPending:true com status 200, escondendo o erro real.
      if (!createRes.ok) {
        log.warn('WHATSAPP', 'Falha ao criar instância na Evolution', { status: createRes.status, message: created?.message });
        return res.status(createRes.status || 502).json({
          state: 'close',
          error: true,
          code: createRes.status,
          message: created?.message || `Evolution API erro (${createRes.status}) ao criar instância.`,
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
      const cfg = await getEvolutionConfig(req.userId!);
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
      const base = cfg.url.replace(/\/$/, '');
      const instancia = cfg.instancia;

      log.info('WHATSAPP', 'Desconexão total iniciada', { userId, instancia });

      await registrarWebhook(base, cfg.api_key, instancia, false).catch(() => {});

      await fetch(`${base}/instance/logout/${instancia}`, {
        method: 'DELETE',
        headers: { apikey: cfg.api_key },
      }).catch(err => log.warn('WHATSAPP', 'Erro no logout', { instancia, err: err.message }));

      const deleteRes = await fetch(`${base}/instance/delete/${instancia}`, {
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
      
      const queries = [
        pool.query(`DELETE FROM whatsapp_messages WHERE user_id = $1`, [userId]),
        pool.query(`DELETE FROM whatsapp_message_status WHERE instance_name = $1`, [instancia]),
        pool.query(`DELETE FROM webhook_mensagens_processadas WHERE instancia = $1`, [instancia]),
        pool.query(`DELETE FROM n8n_chat_histories WHERE user_id = $1`, [userId]),
        pool.query(`DELETE FROM integracoes_config WHERE user_id = $1 AND tipo = 'evolution'`, [userId]),
        pool.query(`UPDATE contatos SET atendente_pausou_ia = false WHERE user_id = $1`, [userId]),
        pool.query(`UPDATE dados_cliente SET atendimento_ia = 'ativo' WHERE user_id = $1`, [userId]),
        pool.query(
          `UPDATE agentes 
           SET evolution_instancia = NULL, 
               evolution_server_url = NULL, 
               evolution_api_key = NULL, 
               updated_at = NOW() 
           WHERE user_id = $1`,
          [userId]
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
        const msgsRes = await fetch(`${base}/chat/findMessages/${instancia}`, {
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

          const result = await pool.query(
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
        phone, text,
        mediaUrl, mediaType, mediaCaption, mediaFilename,
      } = req.body as {
        phone: string; text?: string;
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

      const cfg = await getEvolutionConfig(userId);
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

      if (mediaUrl && mediaType) {
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
          media: mediaUrl,
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

      await pool.query(
        `INSERT INTO whatsapp_messages
           (user_id, sent_by_user_id, instance_name, remote_jid, message_id, from_me, message_type,
            content, media_url, status, timestamp_wa)
         VALUES ($1, $2, $3, $4, $5, true, $6, $7, $8, 'sent', NOW())
         ON CONFLICT (message_id, instance_name) DO NOTHING`,
        [userId, userId, instancia, `${phoneClean}@s.whatsapp.net`,
         messageId, msgType, content, mediaUrl || null]
      ).catch(err => log.warn('SEND', 'Falha ao salvar', { err: err.message }));

      return res.json({ ok: true, messageId });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  router.delete('/instances/:name', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const name = req.params.name;
      const cfg = await getEvolutionConfig(userId);
      const base = cfg.url.replace(/\/$/, '');

      await registrarWebhook(base, cfg.api_key, name, false).catch(() => {});

      await fetch(`${base}/instance/logout/${name}`, {
        method: 'DELETE',
        headers: { apikey: cfg.api_key },
      }).catch(() => null);

      await fetch(`${base}/instance/delete/${name}`, {
        method: 'DELETE',
        headers: { apikey: cfg.api_key },
      }).catch(() => null);

      await Promise.allSettled([
        pool.query(`DELETE FROM whatsapp_messages WHERE user_id = $1`, [userId]),
        pool.query(`DELETE FROM whatsapp_message_status WHERE instance_name = $1`, [name]),
        pool.query(`DELETE FROM webhook_mensagens_processadas WHERE instancia = $1`, [name]),
        pool.query(`DELETE FROM n8n_chat_histories WHERE user_id = $1`, [userId]),
        pool.query(`DELETE FROM integracoes_config WHERE user_id = $1 AND tipo = 'evolution'`, [userId]),
        pool.query(`UPDATE contatos SET atendente_pausou_ia = false WHERE user_id = $1`, [userId]),
        pool.query(`UPDATE dados_cliente SET atendimento_ia = 'ativo' WHERE user_id = $1`, [userId]),
        pool.query(
          `UPDATE agentes 
           SET evolution_instancia = NULL, 
               evolution_server_url = NULL, 
               evolution_api_key = NULL, 
               updated_at = NOW() 
           WHERE user_id = $1`,
          [userId]
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
      const r = await fetch(`${base}/instance/fetchInstances`, { headers: { apikey: api_key } });
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

      const stateR = await fetch(`${base}/instance/connectionState/${cfg.instancia}`, { headers: { apikey: key } }).catch(() => null);
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

      const connR = await fetch(`${base}/instance/connect/${cfg.instancia}`, { headers: { apikey: key } }).catch(() => null);
      if (connR?.ok) {
        const cd: any = await connR.json().catch(() => ({}));
        const qrRaw = cd?.base64 || cd?.qrcode?.base64 || cd?.code || null;
        if (qrRaw) {
          await registrarWebhook(base, key, cfg.instancia);
          return res.json({ state: 'connecting', qrCode: normalizeQr(qrRaw), pairingCode: cd?.pairingCode || null, instancia: cfg.instancia });
        }
      }

      const createR = await fetch(`${base}/instance/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: key },
        body: JSON.stringify({
          instanceName: cfg.instancia, qrcode: true, integration: 'WHATSAPP-BAILEYS',
          groupsIgnore: true, alwaysOnline: true, readMessages: true,
          webhook: webhookInner(),
        }),
      });
      const created: any = await createR.json().catch(() => ({}));

      await new Promise(r => setTimeout(r, 1500));
      const qrR = await fetch(`${base}/instance/connect/${cfg.instancia}`, { headers: { apikey: key } }).catch(() => null);
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
      const cfg      = await getEvolutionConfig(req.userId!);
      const instancia = (req.query['instancia'] as string | undefined) || cfg.instancia;
      if (!cfg.url || !cfg.api_key) return res.json({ state: 'nao_configurado' });
      const base = cfg.url.replace(/\/$/, '');
      const r    = await evolutionFetch(`${base}/instance/connectionState/${instancia}`, { headers: { apikey: cfg.api_key } }).catch(() => null);
      if (!r) return res.status(503).json({ state: 'close', error: true, message: 'Evolution API inacessível ou offline.', instancia });
      if (r.status === 401) return res.json({ state: 'unauthorized', instancia });
      if (!r.ok) {
        const errorText = await r.text().catch(() => 'Erro desconhecido');
        return res.status(r.status).json({
          state: 'close',
          error: true,
          code: r.status,
          message: `Evolution API erro (${r.status}): ${errorText.slice(0, 150)}`,
          instancia,
        });
      }
      const d: any = await r.json().catch(() => ({}));
      return res.json({ state: d?.instance?.state || d?.state || 'close', instancia });
    } catch (err: any) {
      return res.status(502).json({ message: err.message });
    }
  });

  router.get('/search', async (req: AuthRequest, res: Response) => {
    const userId = req.userId!;
    const q = ((req.query.q as string) || '').trim();
    if (!q || q.length < 2) return res.json([]);
    const r = await pool.query(
      `SELECT m.id, m.content, m.timestamp_wa, m.created_at, m.from_me,
               split_part(m.remote_jid,'@',1) AS phone,
               COALESCE(c.nome, c.push_name, split_part(m.remote_jid,'@',1)) AS contact_name,
               COALESCE(c.foto_perfil, c.profile_pic_url) AS profile_pic
        FROM whatsapp_messages m
        LEFT JOIN contatos c ON c.user_id = m.user_id
          AND c.telefone ILIKE '%' || RIGHT(split_part(m.remote_jid,'@',1), 11)
        WHERE m.user_id = $1 AND m.content ILIKE $2
          AND m.remote_jid NOT LIKE '%@g.us'
        ORDER BY m.created_at DESC LIMIT 50`,
      [userId, `%${q}%`]
    );
    return res.json(r.rows);
  });

  router.delete('/messages/:id', async (req: AuthRequest, res: Response) => {
    const userId = req.userId!;
    const id = req.params.id;
    const { forEveryone, instancia, remoteJid } = req.body as any;
    await pool.query(
      `DELETE FROM whatsapp_messages WHERE (id::text = $1 OR message_id = $1) AND user_id = $2`,
      [id, userId]
    ).catch(() => {});
    if (forEveryone && instancia && remoteJid) {
      const cfg = await getEvolutionConfig(userId);
      const base = cfg.url.replace(/\/$/, '');
      await fetch(`${base}/chat/deleteMessage/${instancia}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', apikey: cfg.api_key },
        body: JSON.stringify({ remoteJid, messageId: id }),
      }).catch(() => {});
    }
    return res.json({ ok: true });
  });

  router.patch('/conversas/:phone/read', async (req: AuthRequest, res: Response) => {
    const userId = req.userId!;
    const phone = decodeURIComponent(req.params.phone).replace(/\D/g, '');
    await pool.query(
      `UPDATE whatsapp_messages SET is_read = true
       WHERE user_id = $1 AND split_part(remote_jid,'@',1) = $2 AND from_me = false`,
      [userId, phone]
    ).catch(() => {});
    return res.json({ ok: true });
  });

  router.post('/chat-prefs/:phone', async (req: AuthRequest, res: Response) => {
    const userId = req.userId!;
    const phone = decodeURIComponent(req.params.phone).replace(/\D/g, '');
    const { pinned, archived, muted_until } = req.body as any;
    const setParts: string[] = [];
    const vals: any[] = [userId, `%${phone.slice(-11)}`];
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