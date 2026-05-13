import { Router, Response, Request } from 'express';
import { Pool } from 'pg';
import { makeCrud } from '../crud';

export default function n8nChatHistories(pool: Pool): Router {
  const router = Router();

  // GET by session_id (scoped by user_id)
  router.get('/session/:session_id', async (req: any, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ message: 'userId ausente' });

      const r = await pool.query(
        'SELECT * FROM n8n_chat_histories WHERE session_id = $1 AND user_id = $2 ORDER BY created_at ASC',
        [req.params.session_id, userId]
      );
      return res.json(r.rows);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // Standard CRUD with user_id scoping
  const base = makeCrud(pool, 'n8n_chat_histories');
  router.use('/', base);
  return router;
}
