import { Router, Response } from 'express';
import { Pool } from 'pg';
import { AuthRequest } from '../middleware';
import { evolutionFetch, sanitizeEvolutionUrl } from '../utils/resilientFetch';

// Default Evolution server (VPS local — disparo.mentoark.com.br)
const DEFAULT_EVO_URL = process.env.EVOLUTION_API_URL || 'https://disparo.mentoark.com.br';
const DEFAULT_EVO_KEY = process.env.EVOLUTION_API_KEY || 'mentoark2025evolutionkey';
const WEBHOOK_URL =
  process.env.EVOLUTION_WEBHOOK_URL || 'https://api.mentoark.com.br/webhook/evolution';
const WEBHOOK_EVENTS = ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'MESSAGES_DELETE', 'SEND_MESSAGE', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'];

function webhookPayload() {
  return {
    enabled: true,
    url: WEBHOOK_URL,
    webhookByEvents: false,
    webhookBase64: false,
    events: WEBHOOK_EVENTS,
  };
}

// Registra (ou atualiza) o webhook da instância no Evolution.
// Tenta payload flat (v2) primeiro; se o servidor exigir wrapper {webhook:...} (v1), usa esse.
async function registrarWebhook(base: string, apiKey: string, instancia: string): Promise<void> {
  const cleanBase = sanitizeEvolutionUrl(base);
  const url = `${cleanBase}/webhook/set/${instancia}`;
  const headers = { 'Content-Type': 'application/json', apikey: apiKey };
  try {
    // Tenta Evolution v2 — payload flat
    const res = await evolutionFetch(url, {
      method: 'POST', headers,
      body: JSON.stringify(webhookPayload()),
    });
    const body = await res.json().catch(() => ({})) as any;
    if (!res.ok && JSON.stringify(body).includes('webhook')) {
      // Evolution v1 — payload aninhado em {webhook:{...}}
      const res2 = await evolutionFetch(url, {
        method: 'POST', headers,
        body: JSON.stringify({ webhook: webhookPayload() }),
      });
      const body2 = await res2.json().catch(() => ({}));
      console.log(`[whatsapp] webhook (v1) registrado para ${instancia}:`, JSON.stringify(body2).slice(0, 120));
      return;
    }
    console.log(`[whatsapp] webhook (v2) registrado para ${instancia}:`, JSON.stringify(body).slice(0, 120));
  } catch (err) {
    console.warn(`[whatsapp] Falha ao registrar webhook para ${instancia}:`, (err as Error).message);
  }
}

function normalizeQr(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const b64 = raw.replace(/^data:image\/\w+;base64,/, '');
  return `data:image/png;base64,${b64}`;
}

export default function whatsappRouter(pool: Pool): Router {
  const router = Router();

  // Retorna config do agente, ou config global com nome de instância gerado
  async function getEvolutionConfig(userId: string): Promise<{
    url: string; api_key: string; instancia: string; agenteId: string | null; isGlobal: boolean;
  }> {
    // 1. Tenta buscar em integracoes_config (onde o status de conexão principal é salvo)
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
        instancia: row.instancia || `crm_${userId.replace(/-/g, '').slice(0, 12)}`,
        agenteId: null,
        isGlobal: !row.url
      };
    }

    // 2. Fallback para Agentes
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
      const instancia = row.instancia || `crm_${userId.replace(/-/g, '').slice(0, 12)}`;
      return { url, api_key, instancia, agenteId: row.id, isGlobal: !row.url };
    }

    // 3. Fallback final global
    const instancia = `crm_${userId.replace(/-/g, '').slice(0, 12)}`;
    return { url: DEFAULT_EVO_URL, api_key: DEFAULT_EVO_KEY, instancia, agenteId: null, isGlobal: true };
  }

  // Salva/atualiza a config Evolution no agente do usuário
  async function saveEvolutionConfig(
    userId: string, agenteId: string | null,
    url: string, api_key: string, instancia: string
  ) {
    // 1. Atualiza registro existente; se não existir, insere novo
    const upd = await pool.query(
      `UPDATE integracoes_config SET url=$2, api_key=$3, instancia=$4, status='conectado', updated_at=NOW()
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

    // 2. Sincronizar com Agente se existir
    if (agenteId) {
      await pool.query(
        `UPDATE agentes SET evolution_server_url=$1, evolution_api_key=$2, evolution_instancia=$3, updated_at=NOW()
         WHERE id=$4 AND user_id=$5`,
        [url, api_key, instancia, agenteId, userId]
      );
    } else {
      // Tentar encontrar um agente ativo para este usuário e atualizar
      await pool.query(
        `UPDATE agentes SET evolution_server_url=$1, evolution_api_key=$2, evolution_instancia=$3, updated_at=NOW()
         WHERE user_id=$4 AND ativo=true`,
        [url, api_key, instancia, userId]
      );
    }
  }

  // ── Helpers internos de foto de perfil ──────────────────────────────────────
  async function buscarFotoEvo(base: string, apiKey: string, instancia: string, phone: string): Promise<string | null> {
    // Tenta POST (Evolution v2)
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
    // Tenta GET (Evolution v1 fallback)
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

  // GET /api/whatsapp/search — busca global de mensagens
  router.get('/search', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const q = (req.query.q as string || '').trim();
      const limit = Math.min(Number(req.query.limit) || 20, 100);

      if (!q || q.length < 2) return res.json([]);

      const r = await pool.query(
        `SELECT 
           m.id, m.message_id, m.remote_jid,
           split_part(m.remote_jid,'@',1) AS phone,
           m.content, m.from_me, m.timestamp_wa, m.message_type,
           COALESCE(c.push_name, c.nome, split_part(m.remote_jid,'@',1)) AS contact_name,
           COALESCE(c.foto_perfil, c.profile_pic_url) AS profile_pic
         FROM whatsapp_messages m
         LEFT JOIN contatos c 
           ON c.user_id = m.user_id 
           AND c.telefone ILIKE '%' || RIGHT(split_part(m.remote_jid,'@',1), 11)
         WHERE m.user_id = $1
           AND m.content ILIKE $2
           AND m.message_type = 'text'
         ORDER BY m.timestamp_wa DESC
         LIMIT $3`,
        [userId, `%${q}%`, limit]
      );

      return res.json(r.rows);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // GET /api/whatsapp/profile-pic/:phone — busca foto de perfil on-demand

  router.get('/profile-pic/:phone', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const phone = decodeURIComponent(req.params.phone).replace(/\D/g, '');
      if (!phone) return res.status(400).json({ message: 'phone inválido' });

      // Checa se já existe no banco
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

      // Busca na Evolution API
      const cfg = await getEvolutionConfig(userId);
      const base = cfg.url.replace(/\/$/, '');
      const picUrl = await buscarFotoEvo(base, cfg.api_key, cfg.instancia, phone);

      if (picUrl) await salvarFotoContato(userId, phone, picUrl, pushName);

      return res.json({ foto_perfil: picUrl, push_name: pushName });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // POST /api/whatsapp/sync-profiles — sincroniza fotos de todos os contatos
  router.post('/sync-profiles', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;

      // Todos os telefones únicos que enviaram mensagens
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
        await new Promise(r => setTimeout(r, 150)); // respeita rate limit
      }

      return res.json({ sincronizados, total: phonesRes.rows.length });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // GET /api/whatsapp/conversas
  router.get('/conversas', async (req: AuthRequest, res: Response) => {
    console.log('[WHATSAPP]', req.method, req.path, { userId: req.userId });
    try {
      const userId = req.userId!;

      // PARTITION BY phone (não por instância) — evita duplicatas quando o mesmo
      // número existiu em duas instâncias diferentes
      const showArchived = req.query.archived === 'true';

      const r = await pool.query(
        `WITH ranked AS (
           SELECT
             split_part(m.remote_jid,'@',1) AS phone,
             m.remote_jid,
             m.instance_name,
             m.content,
             m.from_me,
             m.created_at,
             m.message_id,
             m.remote_jid LIKE '%@g.us' AS is_group,
             m.push_name AS last_sender,
             COUNT(*) OVER (PARTITION BY split_part(m.remote_jid,'@',1)) AS total,
             COUNT(*) FILTER (WHERE NOT m.from_me AND NOT m.is_read) 
               OVER (PARTITION BY split_part(m.remote_jid,'@',1)) AS unread_count,
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
             COALESCE(foto_perfil, profile_pic_url) AS profile_pic_url
           FROM contatos
           WHERE user_id = $1 AND telefone IS NOT NULL
           ORDER BY RIGHT(telefone, 11), updated_at DESC NULLS LAST
         )
         SELECT
           r.phone AS session_id,
           r.instance_name AS instancia,
           r.created_at AS ultima_atividade,
           r.total::int AS total,
           r.unread_count::int AS unread,
           r.content AS ultima_mensagem,
           r.is_group,
           r.last_sender,
           CASE WHEN r.from_me THEN 'assistant' ELSE 'user' END AS ultimo_role,
           cu.push_name,
           cu.nome_contato,
           cu.profile_pic_url,
           COALESCE(wcp.pinned, false) as pinned,
           COALESCE(wcp.archived, false) as archived,
           wcp.muted_until
         FROM ranked r
         LEFT JOIN contato_unico cu ON cu.sufixo = RIGHT(r.phone, 11) AND NOT r.is_group
         LEFT JOIN whatsapp_chat_prefs wcp ON wcp.user_id = $1 AND wcp.remote_jid = r.remote_jid
         WHERE r.rn = 1 AND (COALESCE(wcp.archived, false) = $2)
         ORDER BY COALESCE(wcp.pinned, false) DESC, r.created_at DESC
         LIMIT 300`,
        [userId, showArchived]
      );

      const conversas = r.rows.map(row => {
        const isGroup = row.is_group;
        // Nome: para grupos usa "Grupo XXXX" se não tiver nome; para contatos usa nome do CRM
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
          unread: Number(row.unread || 0),
          pinned: row.pinned === true,
          archived: row.archived === true,
          muted_until: row.muted_until,
          mensagens: [],
        };
      });

      return res.json(conversas);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // GET /api/whatsapp/conversas/:phone
  router.get('/conversas/:phone', async (req: AuthRequest, res: Response) => {
    console.log('[WHATSAPP]', req.method, req.path, { userId: req.userId, params: req.params });
    try {
      const userId = req.userId!;
      // Aceita tanto "5511..." (com DDI) quanto "11..." (sem DDI) — remove tudo exceto dígitos
      const phone = decodeURIComponent(req.params.phone).replace(/\D/g, '');
      if (!phone || phone.length < 8) return res.status(400).json({ message: 'Telefone inválido' });

      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const offset = Number(req.query.offset) || 0;

      // Busca por sufixo do número + nome do remetente via JOIN com users
      const r = await pool.query(
        `SELECT
           m.id, m.message_id, m.from_me, m.message_type, m.content,
           m.media_url, m.media_mimetype, m.status, m.push_name,
           m.timestamp_wa, m.created_at,
           m.reply_to_message_id, m.reply_to_content, m.reply_to_sender,
           COALESCE(s.status, m.status) AS delivery_status,
           u.display_name AS sender_name

         FROM whatsapp_messages m
         LEFT JOIN whatsapp_message_status s
           ON s.message_id = m.message_id AND s.instance_name = m.instance_name
         LEFT JOIN users u ON u.id = m.sent_by_user_id
         WHERE (split_part(m.remote_jid, '@', 1) = $1 OR split_part(m.remote_jid, '@', 1) = '55' || $1)

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
        sender_name: row.sender_name || null,
        created_at: row.created_at,
        timestamp_wa: row.timestamp_wa,
        reply_to_message_id: row.reply_to_message_id,
        reply_to_content: row.reply_to_content,
        reply_to_sender: row.reply_to_sender,
      }));

      return res.json(mensagens);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // GET /api/whatsapp/status/:phone — status de entrega das últimas mensagens enviadas
  router.get('/status/:phone', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const phone = decodeURIComponent(req.params.phone).replace(/\D/g, '');
      const r = await pool.query(
        `SELECT m.message_id, COALESCE(s.status, m.status) AS status, m.created_at
         FROM whatsapp_messages m
         LEFT JOIN whatsapp_message_status s
           ON s.message_id = m.message_id AND s.instance_name = m.instance_name
         WHERE (split_part(m.remote_jid, '@', 1) = $1 OR split_part(m.remote_jid, '@', 1) = '55' || $1) AND m.user_id = $2 AND m.from_me = true
         ORDER BY m.created_at DESC LIMIT 50`,
        [phone, userId]
      );
      return res.json(r.rows);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // PATCH /api/whatsapp/conversas/:phone/read — marca mensagens como lidas
  router.patch('/conversas/:phone/read', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const phone = decodeURIComponent(req.params.phone).replace(/\D/g, '');
      if (!phone) return res.status(400).json({ message: 'phone inválido' });

      await pool.query(
        `UPDATE whatsapp_messages 
         SET is_read = true 
         WHERE (split_part(remote_jid,'@',1) = $1 OR split_part(remote_jid,'@',1) = '55' || $1)
           AND user_id = $2 
           AND from_me = false 
           AND is_read = false`,
        [phone, userId]
      );

      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // POST /api/whatsapp/chat-prefs/:phone — atualiza preferências de conversa (pin, archive, mute)
  router.post('/chat-prefs/:phone', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const phone = decodeURIComponent(req.params.phone).replace(/\D/g, '');
      const { pinned, archived, muted_until } = req.body;
      const remoteJid = `${phone}@s.whatsapp.net`; // TODO: suporte a grupos se phone contiver '-'

      await pool.query(
        `INSERT INTO whatsapp_chat_prefs (user_id, remote_jid, pinned, archived, muted_until, updated_at)
         VALUES ($1, $2, COALESCE($3, false), COALESCE($4, false), $5, NOW())
         ON CONFLICT (user_id, remote_jid) DO UPDATE SET
           pinned = COALESCE($3, whatsapp_chat_prefs.pinned),
           archived = COALESCE($4, whatsapp_chat_prefs.archived),
           muted_until = COALESCE($5, whatsapp_chat_prefs.muted_until),
           updated_at = NOW()`,
        [userId, remoteJid, pinned, archived, muted_until]
      );

      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // GET /api/whatsapp/ia-status/:phone — lê se IA está pausada para esse contato


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

  // POST /api/whatsapp/ia-toggle — pausa ou reativa IA para um contato manualmente
  router.post('/ia-toggle', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const { phone, pausar } = req.body as { phone: string; pausar: boolean };
      if (!phone) return res.status(400).json({ message: 'phone obrigatório' });
      const phoneClean = phone.replace(/\D/g, '');
      const suffix = `%${phoneClean.slice(-11)}`;

      // 1. Tenta UPDATE em contato existente
      const upd = await pool.query(
        `UPDATE contatos SET atendente_pausou_ia = $1
         WHERE user_id = $2 AND telefone ILIKE $3`,
        [pausar, userId, suffix]
      );

      // 2. Se nenhuma linha afetada, cria o contato (número ainda não tem cadastro)
      if (!upd.rowCount) {
        await pool.query(
          `INSERT INTO contatos (user_id, nome, telefone, origem, status, atendente_pausou_ia)
           VALUES ($1, $2, $3, 'WhatsApp', 'novo', $4)`,
          [userId, phoneClean, phoneClean, pausar]
        ).catch(() => {}); // ignora se criado por race condition
      }

      // 3. Atualiza dados_cliente também (sem travar em erro)
      await pool.query(
        `UPDATE dados_cliente SET atendimento_ia = $1
         WHERE user_id = $2 AND telefone ILIKE $3`,
        [pausar ? 'pause' : 'ativo', userId, suffix]
      ).catch(() => {});

      return res.json({ ok: true, pausada: pausar });
    } catch (err: any) {
      console.error('[IA-TOGGLE] Erro:', err.message);
      return res.status(500).json({ message: err.message });
    }
  });

  // PATCH /api/whatsapp/contato/:phone — edita nome do contato
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
        // Contato não existe, cria
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

  // GET /api/whatsapp/logs-ia — últimas interações do motor de IA
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

  // GET /api/whatsapp/debug-agente — diagnóstico completo de configuração
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

  // GET /api/whatsapp/contatos-search — busca contatos CRM para nova conversa
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

  // GET /api/whatsapp/media — proxy autenticado para mídias da Evolution API (áudio, vídeo, doc)
  router.get('/media', async (req: AuthRequest, res: Response) => {
    try {
      const mediaUrl = (req.query.url as string || '').trim();
      if (!mediaUrl || !/^https?:\/\//.test(mediaUrl)) {
        return res.status(400).json({ message: 'url inválida' });
      }

      const cfg = await getEvolutionConfig(req.userId!);

      // Tenta buscar com apikey primeiro; se falhar, tenta sem auth (URL pública)
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

  // POST /api/whatsapp/status
  router.post('/status', async (req: AuthRequest, res: Response) => {
    try {
      const cfg = await getEvolutionConfig(req.userId!);
      const base = cfg.url.replace(/\/$/, '');

      const r = await fetch(`${base}/instance/connectionState/${cfg.instancia}`, {
        headers: { apikey: cfg.api_key },
      }).catch(() => null);

      if (!r || !r.ok) {
        return res.json({ state: 'close', instancia: cfg.instancia });
      }

      const data: any = await r.json();
      const state = data?.instance?.state || data?.state || 'close';
      const phoneNumber = data?.instance?.profileName || data?.instance?.name || '';

      // Re-registra webhook toda vez que a instância está conectada
      if (state === 'open') {
        registrarWebhook(base, cfg.api_key, cfg.instancia).catch(() => {});
      }

      return res.json({ state, phoneNumber, instancia: cfg.instancia });
    } catch (err: any) {
      return res.json({ state: 'close', instancia: null });
    }
  });

  // POST /api/whatsapp/register-webhook — força re-registro do webhook na Evolution
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
    try {
      const cfg = await getEvolutionConfig(req.userId!);
      const base = cfg.url.replace(/\/$/, '');

      // 1. Verifica estado atual
      const stateRes = await fetch(`${base}/instance/connectionState/${cfg.instancia}`, {
        headers: { apikey: cfg.api_key },
      }).catch(() => null);

      if (stateRes?.ok) {
        const stateData: any = await stateRes.json();
        const state = stateData?.instance?.state || stateData?.state || 'close';
        if (state === 'open') {
          // Sempre re-registra o webhook ao confirmar que está conectado
          await registrarWebhook(base, cfg.api_key, cfg.instancia);
          return res.json({
            state: 'open',
            phoneNumber: stateData?.instance?.profileName || '',
            instancia: cfg.instancia,
          });
        }
      }

      // 2. Tenta conectar instância existente
      const connectRes = await fetch(`${base}/instance/connect/${cfg.instancia}`, {
        headers: { apikey: cfg.api_key },
      }).catch(() => null);

      if (connectRes?.ok) {
        const connectData: any = await connectRes.json();
        const qrRaw = connectData?.base64 || connectData?.qrcode?.base64 || null;
        // Só retorna aqui se tiver QR; se não tiver, segue para criar nova instância
        if (qrRaw) {
          await saveEvolutionConfig(req.userId!, cfg.agenteId, cfg.url, cfg.api_key, cfg.instancia);
          await registrarWebhook(base, cfg.api_key, cfg.instancia);
          return res.json({
            state: 'connecting',
            qrCode: normalizeQr(qrRaw),
            pairingCode: connectData?.pairingCode || null,
            instanceName: cfg.instancia,
            instancia: cfg.instancia,
          });
        }
      }

      // 3. Cria nova instância (webhook embutido — Evolution v2)
      const phoneNumber = (req.body?.phoneNumber as string | undefined)?.replace(/\D/g, '') || undefined;
      
      const createPayload = {
        instanceName: cfg.instancia,
        token: cfg.api_key,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
        rejectCall: false,
        groupsIgnore: true,
        alwaysOnline: true,
        readMessages: true,
        readStatus: false,
        ...(phoneNumber ? { number: phoneNumber } : {}),
        webhook: webhookPayload(),
      };

      console.log(`[WHATSAPP] Criando instância em ${base}: ${cfg.instancia}`);
      
      const createRes = await fetch(`${base}/instance/create`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          'apikey': cfg.api_key 
        },
        body: JSON.stringify(createPayload),
      });

      const created: any = await createRes.json();
      console.log(`[WHATSAPP] Resposta Evolution create:`, JSON.stringify(created).slice(0, 500));



      // Se já existe, tenta conectar
      if (!createRes.ok && (created?.message?.includes('already') || created?.message?.includes('exist'))) {
        const reconnectRes = await fetch(`${base}/instance/connect/${cfg.instancia}`, {
          headers: { apikey: cfg.api_key },
        }).catch(() => null);
        if (reconnectRes?.ok) {
          const rcData: any = await reconnectRes.json();
          const qrRaw = rcData?.base64 || rcData?.qrcode?.base64 || rcData?.code || null;
          await saveEvolutionConfig(req.userId!, cfg.agenteId, cfg.url, cfg.api_key, cfg.instancia);
          await registrarWebhook(base, cfg.api_key, cfg.instancia);
          return res.json({
            state: 'connecting',
            qrCode: normalizeQr(qrRaw),
            pairingCode: rcData?.pairingCode || rcData?.code || null,
            instanceName: cfg.instancia,
            instancia: cfg.instancia,
          });
        }
      }

      let qrCode = created?.qrcode?.base64 || created?.hash?.qrcode || null;
      let pairingCode =
        created?.qrcode?.pairingCode || created?.pairingCode || created?.hash?.pairingCode || null;

      // Se o create não retornou QR (comum no Evolution v2), busca via /connect
      if (!qrCode) {
        await new Promise(r => setTimeout(r, 1500)); // aguarda instância inicializar
        const qrRes = await fetch(`${base}/instance/connect/${cfg.instancia}`, {
          headers: { apikey: cfg.api_key },
        }).catch(() => null);
        if (qrRes?.ok) {
          const qrData: any = await qrRes.json();
          qrCode = qrData?.base64 || qrData?.qrcode?.base64 || null;
          pairingCode = pairingCode || qrData?.pairingCode || null;
        }
      }

      await saveEvolutionConfig(req.userId!, cfg.agenteId, cfg.url, cfg.api_key, cfg.instancia);
      // Garante webhook configurado mesmo se o create inline foi ignorado
      await registrarWebhook(base, cfg.api_key, cfg.instancia);

      return res.json({
        state: created?.instance?.state || 'connecting',
        qrCode: normalizeQr(qrCode),
        pairingCode,
        instanceName: cfg.instancia,
        instancia: cfg.instancia,
      });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // POST /api/whatsapp/disconnect
  router.post('/disconnect', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const cfg = await getEvolutionConfig(userId);
      const base = cfg.url.replace(/\/$/, '');
      const instancia = cfg.instancia;

      console.log(`[WHATSAPP] Desconectando instância: ${instancia} para o usuário ${userId}`);

      // 1. Tentar fazer logout (desconecta o WhatsApp da instância)
      await fetch(`${base}/instance/logout/${instancia}`, {
        method: 'DELETE',
        headers: { apikey: cfg.api_key },
      }).catch(err => console.warn(`[WHATSAPP] Erro no logout de ${instancia}:`, err.message));

      // 2. Tentar deletar a instância permanentemente da Evolution API
      const deleteRes = await fetch(`${base}/instance/delete/${instancia}`, {
        method: 'DELETE',
        headers: { apikey: cfg.api_key },
      }).catch(err => {
        console.error(`[WHATSAPP] Erro crítico ao deletar ${instancia}:`, err.message);
        return null;
      });

      if (deleteRes && !deleteRes.ok) {
        const errorText = await deleteRes.text().catch(() => 'Erro desconhecido');
        console.warn(`[WHATSAPP] Evolution retornou erro ao deletar ${instancia}: ${deleteRes.status} - ${errorText}`);
      }

      // 3. Limpar a referência da instância no banco de dados do sistema
      if (cfg.agenteId) {
        await pool.query(
          `UPDATE agentes 
           SET evolution_instancia = NULL, 
               evolution_server_url = NULL, 
               evolution_api_key = NULL,
               updated_at = NOW() 
           WHERE id = $1 AND user_id = $2`,
          [cfg.agenteId, userId]
        );
      }

      // 4. Também limpar em integracoes_config para garantir (G1/B3)
      await pool.query(
        `DELETE FROM integracoes_config 
         WHERE user_id = $1 AND instancia = $2 AND tipo = 'evolution'`,
        [userId, instancia]
      );

      return res.json({ ok: true, message: 'Instância desconectada e removida com sucesso' });
    } catch (err: any) {
      console.error('[WHATSAPP] Erro ao processar disconnect:', err);
      return res.status(500).json({ message: err.message });
    }
  });

  // POST /api/whatsapp/sync-history — importa mensagens da Evolution para whatsapp_messages
  router.post('/sync-history', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const instanciaParam = (req.body?.instancia as string | undefined)?.trim();
      const cfg = await getEvolutionConfig(userId);
      const instancia = instanciaParam || cfg.instancia;
      const base = cfg.url.replace(/\/$/, '');

      // Buscar mensagens com paginação via /chat/findMessages
      // (findChats pode falhar em algumas versões da Evolution — usamos findMessages diretamente)
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
          break; // Se já temos mensagens, continua com o que tem
        }
        const msgsJson: any = await msgsRes.json();
        const records: any[] = msgsJson?.messages?.records || msgsJson?.records || (Array.isArray(msgsJson) ? msgsJson : []);
        messages.push(...records);
        totalPages = msgsJson?.messages?.pages || 1;
        page++;
      } while (page <= totalPages && messages.length < 10000);

      const chats: any[] = []; // findChats omitido — não necessário para importação

      let inseridos = 0;
      for (const m of messages) {
        try {
          const key = m.key || {};
          const remoteJid: string = key.remoteJid || m.remoteJid || '';
          if (!remoteJid || remoteJid.endsWith('@g.us')) continue;
          // message_id = WhatsApp message ID (key.id); fallback para id interno da Evolution
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
          console.warn('[SYNC] msg skip:', err.message);
        }
      }

      return res.json({ chats: chats.length, messages: messages.length, inseridos });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // POST /api/whatsapp/send — envia mensagem manual (texto ou mídia)
  router.post('/send', async (req: AuthRequest, res: Response) => {
    const userId = req.userId!;
    console.log('[DEBUG SEND] Payload recebido do Lovable:', JSON.stringify(req.body, null, 2));
    console.log('[DEBUG SEND] userId:', userId);
    try {
      const {
        phone, text, instancia: instanciaParam,
        mediaUrl, mediaType, mediaCaption, mediaFilename,
        replyToMessageId,
      } = req.body as {
        phone: string; text?: string; instancia?: string;
        mediaUrl?: string; mediaType?: 'image' | 'audio' | 'video' | 'document';
        mediaCaption?: string; mediaFilename?: string;
        replyToMessageId?: string;
      };

      // Normaliza o telefone — remove tudo exceto dígitos
      const phoneClean = (phone || '').replace(/\D/g, '');
      if (!phoneClean || phoneClean.length < 8 || phoneClean.length > 15) {
        console.warn('[DEBUG SEND] telefone inválido:', phone);
        return res.status(400).json({ message: `Número de telefone inválido: "${phone}"` });
      }
      if (!text && !mediaUrl) {
        return res.status(400).json({ message: 'text ou mediaUrl são obrigatórios' });
      }

      const cfg = await getEvolutionConfig(userId);
      console.log('[DEBUG SEND] Instância encontrada para o usuário:', {
        instancia: cfg.instancia,
        url: cfg.url,
        isGlobal: cfg.isGlobal,
        agenteId: cfg.agenteId,
        tokenPresente: !!cfg.api_key,
      });

      const instancia = instanciaParam || cfg.instancia;
      const base = cfg.url.replace(/\/$/, '');

      let evolutionResp: any;
      let msgType = 'text';

      if (mediaUrl && mediaType) {
        // Envio de mídia
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
          delay: 1200,
        };
        if (mediaCaption) mediaPayload.caption = mediaCaption;
        if (mediaFilename) mediaPayload.fileName = mediaFilename;

        const targetUrl = `${base}/message/${endpoint}/${instancia}`;
        console.log(`[DEBUG SEND] Disparando para Evolution: ${targetUrl}`, { tokenPresente: !!cfg.api_key });
        let evoRes: Response;
        try {
          evoRes = await evolutionFetch(targetUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: cfg.api_key },
            body: JSON.stringify(mediaPayload),
          });
        } catch (err: any) {
          console.log('[DEBUG SEND] Erro cru ao chamar Evolution API (mídia):', err.message);
          return res.status(502).json({ message: `Sem resposta da Evolution API: ${err.message}` });
        }
        if (!evoRes.ok) {
          const errText = await evoRes.text().catch(() => String(evoRes.status));
          console.error(`[DEBUG SEND] Evolution mídia falhou — status=${evoRes.status} body=${errText.slice(0, 400)}`);
          return res.status(502).json({ message: `Evolution ${evoRes.status}: ${errText.slice(0, 200)}` });
        }
        evolutionResp = await evoRes.json().catch(() => ({}));
      } else {
        // Envio de texto
        const targetUrl = `${base}/message/sendText/${instancia}`;
        console.log(`[DEBUG SEND] Disparando para Evolution: ${targetUrl}`, { tokenPresente: !!cfg.api_key });
        let evoRes: Response;
        try {
          evoRes = await evolutionFetch(targetUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: cfg.api_key },
            body: JSON.stringify({ 
              number: phoneClean, 
              text, 
              delay: 1200,
              quoted: replyToMessageId ? { key: { id: replyToMessageId } } : undefined
            }),
          });
        } catch (err: any) {
          console.log('[DEBUG SEND] Erro cru ao chamar Evolution API (texto):', err.message);
          return res.status(502).json({ message: `Sem resposta da Evolution API: ${err.message}` });
        }
        if (!evoRes.ok) {
          const errText = await evoRes.text().catch(() => String(evoRes.status));
          console.error(`[DEBUG SEND] Evolution texto falhou — status=${evoRes.status} body=${errText.slice(0, 400)}`);
          return res.status(502).json({ message: `Evolution ${evoRes.status}: ${errText.slice(0, 200)}` });
        }
        evolutionResp = await evoRes.json().catch(() => ({}));
        console.log(`[DEBUG SEND] Evolution respondeu ok — messageId=${evolutionResp?.key?.id}`);
      }

      const messageId = evolutionResp?.key?.id || `manual_${Date.now()}`;
      const content = text || mediaCaption || null;

      await pool.query(
        `INSERT INTO whatsapp_messages
           (user_id, sent_by_user_id, instance_name, remote_jid, message_id, from_me, message_type,
            content, media_url, status, timestamp_wa, reply_to_message_id)
         VALUES ($1, $2, $3, $4, $5, true, $6, $7, $8, 'sent', NOW(), $9)
         ON CONFLICT (message_id, instance_name) DO NOTHING`,
        [userId, userId, instancia, `${phoneClean}@s.whatsapp.net`,
         messageId, msgType, content, mediaUrl || null, replyToMessageId || null]
      ).catch(err => console.warn('[SEND] Falha ao salvar:', err.message));

      return res.json({ ok: true, messageId });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // DELETE /api/whatsapp/instances/:name — remove instância na Evolution e desvincula do agente
  router.delete('/instances/:name', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const name = req.params.name;
      const cfg = await getEvolutionConfig(userId);
      const base = cfg.url.replace(/\/$/, '');

      await fetch(`${base}/instance/logout/${name}`, {
        method: 'DELETE',
        headers: { apikey: cfg.api_key },
      }).catch(() => null);

      await fetch(`${base}/instance/delete/${name}`, {
        method: 'DELETE',
        headers: { apikey: cfg.api_key },
      }).catch(() => null);

      await pool.query(
        `UPDATE agentes SET evolution_instancia=NULL WHERE user_id=$1 AND evolution_instancia=$2`,
        [userId, name]
      );

      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ── Proxy para Evolution API — resolve CORS, lê config do banco ─────────────

  // POST /api/whatsapp/evo/test — valida conexão usando config do banco
  // Aceita url+api_key no body para testar antes de salvar (opcional)
  router.post('/evo/test', async (req: AuthRequest, res: Response) => {
    try {
      const bodyUrl    = (req.body?.url    as string | undefined)?.trim();
      const bodyApiKey = (req.body?.api_key as string | undefined)?.trim();

      // Usa parâmetros do body se fornecidos (teste antes de salvar)
      // Caso contrário lê da tabela integracoes_config (fonte de verdade)
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
      const instances: any[] = await r.json().catch(() => []);
      return res.json({ ok: true, instances: Array.isArray(instances) ? instances : [] });
    } catch (err: any) {
      return res.status(502).json({ message: `Sem resposta do servidor Evolution: ${err.message}` });
    }
  });

  // POST /api/whatsapp/evo/connect — conecta instância usando config salva no banco
  router.post('/evo/connect', async (req: AuthRequest, res: Response) => {
    try {
      // Lê tudo do banco — nenhum parâmetro sensível vem do body
      const cfg = await getEvolutionConfig(req.userId!);
      const base = cfg.url.replace(/\/$/, '');
      const key  = cfg.api_key;

      if (!base || !key) return res.status(400).json({ message: 'Configure URL e API Key em Conectores antes de conectar.' });

      // 1. Verificar se já está conectado
      const stateR = await fetch(`${base}/instance/connectionState/${cfg.instancia}`, { headers: { apikey: key } }).catch(() => null);
      if (stateR?.ok) {
        const sd: any = await stateR.json();
        const state = sd?.instance?.state || sd?.state || 'close';
        if (state === 'open') {
          await registrarWebhook(base, key, cfg.instancia);
          return res.json({ state: 'open', instancia: cfg.instancia });
        }
      }

      // 2. Tentar conectar instância existente
      const connR = await fetch(`${base}/instance/connect/${cfg.instancia}`, { headers: { apikey: key } }).catch(() => null);
      if (connR?.ok) {
        const cd: any = await connR.json();
        const qrRaw = cd?.base64 || cd?.qrcode?.base64 || cd?.code || null;
        if (qrRaw) {
          await registrarWebhook(base, key, cfg.instancia);
          return res.json({ state: 'connecting', qrCode: normalizeQr(qrRaw), pairingCode: cd?.pairingCode || null, instancia: cfg.instancia });
        }
      }

      // 3. Criar nova instância (primeira vez)
      const createR = await fetch(`${base}/instance/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: key },
        body: JSON.stringify({
          instanceName: cfg.instancia, qrcode: true, integration: 'WHATSAPP-BAILEYS',
          groupsIgnore: true, alwaysOnline: true, readMessages: true,
          webhook: webhookPayload(),
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

  // GET /api/whatsapp/evo/status — verifica estado da instância usando config do banco
  router.get('/evo/status', async (req: AuthRequest, res: Response) => {
    try {
      const cfg  = await getEvolutionConfig(req.userId!);
      if (!cfg.url || !cfg.api_key) return res.json({ state: 'nao_configurado' });
      const base = cfg.url.replace(/\/$/, '');
      const r    = await fetch(`${base}/instance/connectionState/${cfg.instancia}`, { headers: { apikey: cfg.api_key } }).catch(() => null);
      if (!r?.ok) return res.json({ state: 'close', instancia: cfg.instancia });
      const d: any = await r.json();
      return res.json({ state: d?.instance?.state || d?.state || 'close', instancia: cfg.instancia });
    } catch (err: any) {
      return res.status(502).json({ message: err.message });
    }
  });

  // GET /api/whatsapp/evo/status/:instance — estado de instância específica direto da Evolution
  router.get('/evo/status/:instance', async (req: AuthRequest, res: Response) => {
    try {
      const cfg      = await getEvolutionConfig(req.userId!);
      const instancia = req.params.instance;
      if (!cfg.url || !cfg.api_key) return res.json({ state: 'nao_configurado', instancia });
      const base = cfg.url.replace(/\/$/, '');
      const r = await fetch(`${base}/instance/connectionState/${instancia}`, {
        headers: { apikey: cfg.api_key },
      }).catch(() => null);
      if (!r?.ok) return res.json({ state: 'close', instancia });
      const d: any = await r.json();
      const state: string = d?.instance?.state || d?.state || 'close';
      if (state === 'open') registrarWebhook(base, cfg.api_key, instancia).catch(() => {});
      return res.json({ state, instancia });
    } catch (err: any) {
      return res.status(502).json({ message: err.message });
    }
  });

  return router;
}

