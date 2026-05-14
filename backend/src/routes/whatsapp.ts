import { Router, Response } from 'express';
import { Pool } from 'pg';
import { AuthRequest } from '../middleware';

// Default Evolution server (VPS local — disparo.mentoark.com.br)
const DEFAULT_EVO_URL = process.env.EVOLUTION_API_URL || 'https://disparo.mentoark.com.br';
const DEFAULT_EVO_KEY = process.env.EVOLUTION_API_KEY || 'mentoark2025evolutionkey';

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
    const r = await pool.query(
      `SELECT id, evolution_server_url AS url, evolution_api_key AS api_key, evolution_instancia AS instancia
       FROM agentes
       WHERE user_id = $1 AND ativo = true
       ORDER BY updated_at DESC LIMIT 1`,
      [userId]
    );

    if (r.rows.length) {
      const row = r.rows[0];
      // Tem agente — usa config dele se completa, senão usa global com instância do agente
      const url = row.url || DEFAULT_EVO_URL;
      const api_key = row.api_key || DEFAULT_EVO_KEY;
      const instancia = row.instancia || `crm_${userId.slice(0, 8)}`;
      return { url, api_key, instancia, agenteId: row.id, isGlobal: !row.url };
    }

    // Sem agente — usa global e cria instância única por userId
    const instancia = `crm_${userId.slice(0, 8)}`;
    return { url: DEFAULT_EVO_URL, api_key: DEFAULT_EVO_KEY, instancia, agenteId: null, isGlobal: true };
  }

  // Salva/atualiza a config Evolution no agente do usuário
  async function saveEvolutionConfig(
    userId: string, agenteId: string | null,
    url: string, api_key: string, instancia: string
  ) {
    if (agenteId) {
      await pool.query(
        `UPDATE agentes SET evolution_server_url=$1, evolution_api_key=$2, evolution_instancia=$3, updated_at=NOW()
         WHERE id=$4 AND user_id=$5`,
        [url, api_key, instancia, agenteId, userId]
      );
    } else {
      await pool.query(
        `INSERT INTO agentes (user_id, nome, ativo, evolution_server_url, evolution_api_key, evolution_instancia)
         VALUES ($1, 'Agente IA', true, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [userId, url, api_key, instancia]
      );
    }
  }

  // GET /api/whatsapp/conversas
  router.get('/conversas', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;

      const r = await pool.query(
        `SELECT
           h.session_id,
           h.instancia,
           MAX(h.created_at) AS ultima_atividade,
           COUNT(*) AS total,
           (
             SELECT h2.message->>'content'
             FROM n8n_chat_histories h2
             WHERE h2.session_id = h.session_id AND h2.user_id = $1
             ORDER BY h2.created_at DESC LIMIT 1
           ) AS ultima_mensagem,
           (
             SELECT h2.message->>'role'
             FROM n8n_chat_histories h2
             WHERE h2.session_id = h.session_id AND h2.user_id = $1
             ORDER BY h2.created_at DESC LIMIT 1
           ) AS ultimo_role
         FROM n8n_chat_histories h
         WHERE h.user_id = $1
         GROUP BY h.session_id, h.instancia
         ORDER BY ultima_atividade DESC
         LIMIT 200`,
        [userId]
      );

      let nomes: Record<string, string> = {};
      if (r.rows.length) {
        const contatos = await pool.query(
          `SELECT telefone, nome FROM contatos WHERE user_id = $1`,
          [userId]
        );
        for (const c of contatos.rows) {
          const digits = (c.telefone || '').replace(/\D/g, '');
          nomes[digits] = c.nome;
        }
      }

      const conversas = r.rows.map(row => {
        const digits = (row.session_id || '').replace(/\D/g, '');
        return {
          session_id: row.session_id,
          instancia: row.instancia,
          nome: nomes[digits] || nomes[digits.slice(-11)] || null,
          ultima_atividade: row.ultima_atividade,
          ultima_mensagem: row.ultima_mensagem || '',
          ultimo_role: row.ultimo_role,
          total: Number(row.total),
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
    try {
      const userId = req.userId!;
      const phone = decodeURIComponent(req.params.phone);

      const r = await pool.query(
        `SELECT message, created_at
         FROM n8n_chat_histories
         WHERE session_id = $1 AND user_id = $2
         ORDER BY created_at ASC`,
        [phone, userId]
      );

      const mensagens = r.rows.map(row => {
        const msg = typeof row.message === 'string' ? JSON.parse(row.message) : row.message;
        return {
          role: msg.role as 'user' | 'assistant',
          content: msg.content as string,
          created_at: row.created_at,
        };
      }).filter(m => m.role && m.content);

      return res.json(mensagens);
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

      return res.json({ state, phoneNumber, instancia: cfg.instancia });
    } catch (err: any) {
      return res.json({ state: 'close', instancia: null });
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
        const qrRaw = connectData?.base64 || connectData?.qrcode?.base64 || connectData?.code || null;
        if (qrRaw) {
          await saveEvolutionConfig(req.userId!, cfg.agenteId, cfg.url, cfg.api_key, cfg.instancia);
          return res.json({
            state: 'connecting',
            qrCode: normalizeQr(qrRaw),
            instancia: cfg.instancia,
          });
        }
      }

      // 3. Cria nova instância
      const createRes = await fetch(`${base}/instance/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: cfg.api_key },
        body: JSON.stringify({
          instanceName: cfg.instancia,
          qrcode: true,
          integration: 'WHATSAPP-BAILEYS',
          rejectCall: false,
          groupsIgnore: false,
          alwaysOnline: false,
          readMessages: false,
          readStatus: false,
        }),
      });

      const created: any = await createRes.json();

      // Se já existe, tenta conectar
      if (!createRes.ok && (created?.message?.includes('already') || created?.message?.includes('exist'))) {
        const reconnectRes = await fetch(`${base}/instance/connect/${cfg.instancia}`, {
          headers: { apikey: cfg.api_key },
        }).catch(() => null);
        if (reconnectRes?.ok) {
          const rcData: any = await reconnectRes.json();
          const qrRaw = rcData?.base64 || rcData?.qrcode?.base64 || rcData?.code || null;
          await saveEvolutionConfig(req.userId!, cfg.agenteId, cfg.url, cfg.api_key, cfg.instancia);
          return res.json({
            state: 'connecting',
            qrCode: normalizeQr(qrRaw),
            instancia: cfg.instancia,
          });
        }
      }

      const qrCode = created?.qrcode?.base64 || created?.hash?.qrcode || created?.code || null;
      await saveEvolutionConfig(req.userId!, cfg.agenteId, cfg.url, cfg.api_key, cfg.instancia);

      return res.json({
        state: created?.instance?.state || 'connecting',
        qrCode: normalizeQr(qrCode),
        instancia: cfg.instancia,
      });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // POST /api/whatsapp/disconnect
  router.post('/disconnect', async (req: AuthRequest, res: Response) => {
    try {
      const cfg = await getEvolutionConfig(req.userId!);
      const base = cfg.url.replace(/\/$/, '');

      await fetch(`${base}/instance/logout/${cfg.instancia}`, {
        method: 'DELETE',
        headers: { apikey: cfg.api_key },
      }).catch(() => null);

      await fetch(`${base}/instance/delete/${cfg.instancia}`, {
        method: 'DELETE',
        headers: { apikey: cfg.api_key },
      }).catch(() => null);

      // Limpa instância no agente
      if (cfg.agenteId) {
        await pool.query(
          `UPDATE agentes SET evolution_instancia=NULL WHERE id=$1 AND user_id=$2`,
          [cfg.agenteId, req.userId]
        );
      }

      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  return router;
}
