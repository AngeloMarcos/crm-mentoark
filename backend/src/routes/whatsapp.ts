import { Router, Response } from 'express';
import { Pool } from 'pg';
import { AuthRequest } from '../middleware';

export default function whatsappRouter(pool: Pool): Router {
  const router = Router();

  async function getEvolutionConfig(userId: string) {
    const r = await pool.query(
      `SELECT evolution_server_url AS url, evolution_api_key AS api_key, evolution_instancia AS instancia
       FROM agentes
       WHERE user_id = $1 AND ativo = true AND evolution_instancia IS NOT NULL
         AND evolution_server_url IS NOT NULL AND evolution_api_key IS NOT NULL
       ORDER BY updated_at DESC LIMIT 1`,
      [userId]
    );
    if (!r.rows.length) {
      throw new Error('Nenhum agente ativo com Evolution configurada. Configure em Agentes → WhatsApp.');
    }
    return r.rows[0] as { url: string; api_key: string; instancia: string };
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
             SELECT (m->>'content')
             FROM n8n_chat_histories h2
             WHERE h2.session_id = h.session_id AND h2.user_id = $1
             ORDER BY h2.created_at DESC LIMIT 1
           ) AS ultima_mensagem,
           (
             SELECT m->>'role'
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

      const phones = r.rows.map(row => row.session_id);
      let nomes: Record<string, string> = {};
      if (phones.length) {
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
      });

      if (!r.ok) {
        return res.json({ state: 'close' });
      }

      const data: any = await r.json();
      const state = data?.instance?.state || data?.state || 'close';
      const phoneNumber = data?.instance?.profileName || data?.phoneNumber || '';

      return res.json({ state, phoneNumber });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // POST /api/whatsapp/connect
  router.post('/connect', async (req: AuthRequest, res: Response) => {
    try {
      const cfg = await getEvolutionConfig(req.userId!);
      const base = cfg.url.replace(/\/$/, '');

      const stateRes = await fetch(`${base}/instance/connectionState/${cfg.instancia}`, {
        headers: { apikey: cfg.api_key },
      });

      if (stateRes.ok) {
        const stateData: any = await stateRes.json();
        const state = stateData?.instance?.state || stateData?.state || 'close';
        if (state === 'open') {
          return res.json({ state: 'open', phoneNumber: stateData?.instance?.profileName || '' });
        }
      }

      const connectRes = await fetch(`${base}/instance/connect/${cfg.instancia}`, {
        method: 'GET',
        headers: { apikey: cfg.api_key },
      });

      if (!connectRes.ok) {
        const createRes = await fetch(`${base}/instance/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: cfg.api_key },
          body: JSON.stringify({
            instanceName: cfg.instancia,
            qrcode: true,
            integration: 'WHATSAPP-BAILEYS',
          }),
        });
        const created: any = await createRes.json();
        const qrCode = created?.qrcode?.base64 || created?.hash?.qrcode || null;
        return res.json({
          state: 'connecting',
          qrCode: qrCode ? `data:image/png;base64,${qrCode.replace(/^data:image\/\w+;base64,/, '')}` : null,
          instanceName: cfg.instancia,
        });
      }

      const connectData: any = await connectRes.json();
      const qrRaw = connectData?.base64 || connectData?.qrcode?.base64 || null;
      return res.json({
        state: connectData?.state || 'connecting',
        qrCode: qrRaw ? `data:image/png;base64,${qrRaw.replace(/^data:image\/\w+;base64,/, '')}` : null,
        instanceName: cfg.instancia,
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

      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  return router;
}
