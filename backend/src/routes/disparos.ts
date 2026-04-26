import { Router, Response } from 'express';
import { Pool } from 'pg';
import { makeCrud } from '../crud';
import { AuthRequest } from '../middleware';

export default function disparos(pool: Pool): Router {
  const base = makeCrud(pool, 'disparos');

  // We need a fresh router to add special routes before the base CRUD catches them
  const router = Router();

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
