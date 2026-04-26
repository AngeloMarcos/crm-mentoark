import { Router, Response, Request } from 'express';
import { Pool } from 'pg';
import { makeCrud } from '../crud';

export default function n8nChatHistories(pool: Pool): Router {
  const router = Router();

  // GET by session_id (no user_id scoping — global table)
  router.get('/session/:session_id', async (req: Request, res: Response) => {
    try {
      const r = await pool.query(
        'SELECT * FROM n8n_chat_histories WHERE session_id = $1 ORDER BY created_at ASC',
        [req.params.session_id]
      );
      return res.json(r.rows);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // Standard CRUD without user_id scoping
  const base = makeCrud(pool, 'n8n_chat_histories', { userIdCol: null });
  router.use('/', base);
  return router;
}
