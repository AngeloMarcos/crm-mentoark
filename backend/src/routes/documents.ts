import { Router, Response } from 'express';
import { Pool } from 'pg';
import { makeCrud } from '../crud';
import { AuthRequest } from '../middleware';

export default function documents(pool: Pool): Router {
  const router = Router();
  const base = makeCrud(pool, 'documents');

  // POST /documents/search — vector similarity search
  router.post('/search', async (req: AuthRequest, res: Response) => {
    try {
      const { query_embedding, match_count = 5 } = req.body;
      if (!Array.isArray(query_embedding)) {
        return res.status(400).json({ message: 'query_embedding deve ser um array de números' });
      }

      const embeddingStr = `[${query_embedding.join(',')}]`;
      const r = await pool.query(
        `SELECT id, content, metadata, 1 - (embedding <=> $1::vector) AS similarity
         FROM documents
         WHERE user_id = $2
         ORDER BY embedding <=> $1::vector
         LIMIT $3`,
        [embeddingStr, req.userId, match_count]
      );
      return res.json(r.rows);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  router.use('/', base);
  return router;
}
