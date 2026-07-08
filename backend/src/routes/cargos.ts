import { Router, Response } from 'express';
import { Pool } from 'pg';
import { AuthRequest, adminMiddleware } from '../middleware';
import { log } from '../logger';

export default function cargosRouter(pool: Pool): Router {
  const router = Router();

  const wrap = (fn: Function) => async (req: AuthRequest, res: Response) => {
    try {
      await fn(req, res);
    } catch (err: any) {
      log.error('CARGOS', 'Erro', { err: err?.message, stack: err?.stack });
      res.status(500).json({ message: err.message });
    }
  };

  // GET /api/cargos — lista cargos do usuário logado
  router.get('/', wrap(async (req: AuthRequest, res: Response) => {
    const r = await pool.query(
      `SELECT id, nome, permissoes, created_at FROM cargos WHERE user_id = $1 ORDER BY nome ASC`,
      [req.userId]
    );
    return res.json(r.rows);
  }));

  // POST /api/cargos — cria cargo (admin only)
  router.post('/', adminMiddleware, wrap(async (req: AuthRequest, res: Response) => {
    const { nome, permissoes } = req.body;
    if (!nome) return res.status(400).json({ message: 'Nome do cargo é obrigatório' });

    const r = await pool.query(
      `INSERT INTO cargos (user_id, nome, permissoes)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [req.userId, nome, permissoes || []]
    );
    return res.status(201).json(r.rows[0]);
  }));

  // PATCH /api/cargos/:id — edita cargo (admin only)
  router.patch('/:id', adminMiddleware, wrap(async (req: AuthRequest, res: Response) => {
    const { nome, permissoes } = req.body;
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (nome !== undefined)       { fields.push(`nome = $${idx++}`);       values.push(nome); }
    if (permissoes !== undefined) { fields.push(`permissoes = $${idx++}`); values.push(permissoes); }
    if (!fields.length) return res.status(400).json({ message: 'Nada para atualizar' });

    values.push(req.params.id, req.userId);
    const r = await pool.query(
      `UPDATE cargos SET ${fields.join(', ')}
       WHERE id = $${idx} AND user_id = $${idx + 1}
       RETURNING *`,
      values
    );
    if (!r.rows.length) return res.status(404).json({ message: 'Cargo não encontrado' });
    return res.json(r.rows[0]);
  }));

  // DELETE /api/cargos/:id — exclui (admin only, bloqueia se houver users usando)
  router.delete('/:id', adminMiddleware, wrap(async (req: AuthRequest, res: Response) => {
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
