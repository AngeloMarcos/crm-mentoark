import { Router, Response } from 'express';
import { Pool } from 'pg';
import { AuthRequest } from '../middleware';

export default function dashboard(pool: Pool): Router {
  const router = Router();

  router.get('/', async (req: AuthRequest, res: Response) => {
    try {
      const r = await pool.query(
        'SELECT * FROM dashboard_resumo WHERE user_id = $1',
        [req.userId]
      );
      return res.json(r.rows[0] ?? { user_id: req.userId, total_leads: 0, novos_hoje: 0, convertidos: 0, em_atendimento: 0 });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  return router;
}
