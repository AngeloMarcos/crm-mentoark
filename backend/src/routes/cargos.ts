import { Router, Response } from 'express';
import { Pool } from 'pg';
import { AuthRequest } from '../middleware';

export default function cargosRouter(pool: Pool): Router {
  const router = Router();

  const wrap = (fn: Function) => async (req: AuthRequest, res: Response) => {
    try {
      await fn(req, res);
    } catch (err: any) {
      console.error('[cargos]', err.message);
      res.status(500).json({ message: err.message });
    }
  };

  // GET /api/cargos
  router.get('/', wrap(async (req: AuthRequest, res: Response) => {
    const r = await pool.query(
      `SELECT id, nome, permissoes, created_at FROM cargos WHERE user_id = $1 ORDER BY nome`,
      [req.userId]
    );
    return res.json(r.rows);
  }));

  // POST /api/cargos
  router.post('/', wrap(async (req: AuthRequest, res: Response) => {
    const { nome, permissoes } = req.body;
    if (!nome) return res.status(400).json({ message: 'nome é obrigatório' });

    const r = await pool.query(
      `INSERT INTO cargos (user_id, nome, permissoes)
       VALUES ($1, $2, $3)
       RETURNING id, nome, permissoes, created_at`,
      [req.userId, nome, permissoes || []]
    );
    return res.status(201).json(r.rows[0]);
  }));

  // PATCH /api/cargos/:id
  router.patch('/:id', wrap(async (req: AuthRequest, res: Response) => {
    const { nome, permissoes } = req.body;
    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (nome !== undefined)       { sets.push(`nome = $${idx++}`);       vals.push(nome); }
    if (permissoes !== undefined) { sets.push(`permissoes = $${idx++}`); vals.push(permissoes); }
    if (!sets.length) return res.status(400).json({ message: 'Nenhum campo para atualizar' });

    vals.push(req.params.id, req.userId);
    const r = await pool.query(
      `UPDATE cargos SET ${sets.join(', ')}
       WHERE id = $${idx} AND user_id = $${idx + 1}
       RETURNING id, nome, permissoes, created_at`,
      vals
    );
    if (!r.rows.length) return res.status(404).json({ message: 'Cargo não encontrado' });
    return res.json(r.rows[0]);
  }));

  // DELETE /api/cargos/:id
  router.delete('/:id', wrap(async (req: AuthRequest, res: Response) => {
    const { id } = req.params;

    const emUso = await pool.query(
      `SELECT COUNT(*) AS cnt FROM users WHERE cargo_id = $1`,
      [id]
    );
    if (parseInt(emUso.rows[0].cnt, 10) > 0) {
      return res.status(400).json({ message: 'Este cargo está atribuído a um ou mais usuários' });
    }

    const r = await pool.query(
      `DELETE FROM cargos WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, req.userId]
    );
    if (!r.rows.length) return res.status(404).json({ message: 'Cargo não encontrado' });
    return res.status(204).send();
  }));

  return router;
}
