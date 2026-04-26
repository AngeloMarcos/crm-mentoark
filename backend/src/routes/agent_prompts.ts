import { Router, Response } from 'express';
import { Pool } from 'pg';
import { makeCrud } from '../crud';
import { AuthRequest } from '../middleware';

export default function agentPrompts(pool: Pool): Router {
  const router = Router();
  const base = makeCrud(pool, 'agent_prompts');

  // PATCH /agent_prompts/:id/ativar — deactivates all other prompts and activates this one
  router.patch('/:id/ativar', async (req: AuthRequest, res: Response) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'UPDATE agent_prompts SET ativo = false WHERE user_id = $1',
        [req.userId]
      );
      const r = await client.query(
        'UPDATE agent_prompts SET ativo = true WHERE id = $1 AND user_id = $2 RETURNING *',
        [req.params.id, req.userId]
      );
      await client.query('COMMIT');
      if (!r.rows.length) return res.status(404).json({ message: 'Prompt não encontrado' });
      return res.json(r.rows[0]);
    } catch (err: any) {
      await client.query('ROLLBACK');
      return res.status(500).json({ message: err.message });
    } finally {
      client.release();
    }
  });

  router.use('/', base);
  return router;
}
