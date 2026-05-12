import { Router, Response } from 'express';
import { Pool } from 'pg';
import { makeCrud } from '../crud';
import { AuthRequest } from '../middleware';

export default function disparos(pool: Pool): Router {
  const base = makeCrud(pool, 'disparos');

  // We need a fresh router to add special routes before the base CRUD catches them
  const router = Router();

  // POST /disparos/enviar — proxy seguro para Evolution (evita expor api_key no frontend)
  router.post('/enviar', async (req: AuthRequest, res: Response) => {
    try {
      const { telefone, texto, disparo_log_id } = req.body;
      if (!telefone || !texto) {
        return res.status(400).json({ message: 'telefone e texto obrigatórios' });
      }

      const evoRes = await pool.query(
        `SELECT url, api_key, instancia FROM integracoes_config
         WHERE user_id = $1 AND tipo = 'evolution' AND status IN ('ativo','conectado')
         LIMIT 1`,
        [req.userId]
      );
      if (!evoRes.rows.length) {
        return res.status(400).json({ message: 'Evolution API não configurada ou desconectada' });
      }
      const { url, api_key, instancia } = evoRes.rows[0];
      const baseUrl = url.replace(/\/$/, '');

      const resp = await fetch(`${baseUrl}/message/sendText/${instancia}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: api_key },
        body: JSON.stringify({ number: telefone, text: texto, delay: 1200 }),
      });

      if (!resp.ok) {
        const errBody = await resp.text().catch(() => '');
        return res.status(resp.status).json({ message: `Evolution API ${resp.status}: ${errBody}` });
      }

      if (disparo_log_id) {
        await pool.query(
          `UPDATE disparo_logs SET status = 'sent', enviado_at = NOW()
           WHERE id = $1 AND user_id = $2`,
          [disparo_log_id, req.userId]
        );
      }

      return res.json({ ok: true });
    } catch (err: any) {
      console.error('[DISPARO/ENVIAR]', err.message);
      return res.status(500).json({ message: err.message });
    }
  });

  // GET /disparos/:id/logs
  router.get('/:id/logs', async (req: AuthRequest, res: Response) => {
    try {
      const r = await pool.query(
        `SELECT * FROM disparo_logs WHERE disparo_id = $1 AND user_id = $2 ORDER BY created_at ASC`,
        [req.params.id, req.userId]
      );
      return res.json(r.rows);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // Mount all CRUD routes from base
  router.use('/', base);

  return router;
}
