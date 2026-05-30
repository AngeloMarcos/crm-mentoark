import { Router, Response } from 'express';
import { Pool } from 'pg';
import { AuthRequest, adminMiddleware } from '../middleware';

export default function cargos(pool: Pool): Router {
  const router = Router();

  // GET /api/cargos — lista cargos do admin logado
  router.get('/', async (req: AuthRequest, res: Response) => {
    try {
      const adminId = req.userId!;
      const r = await pool.query(
        'SELECT * FROM cargos WHERE user_id = $1 ORDER BY nome ASC',
        [adminId]
      );
      return res.json(r.rows);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // POST /api/cargos — cria cargo
  router.post('/', adminMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { nome, permissoes } = req.body;
      const adminId = req.userId!;

      if (!nome) return res.status(400).json({ message: 'Nome do cargo é obrigatório' });

      const r = await pool.query(
        'INSERT INTO cargos (user_id, nome, permissoes) VALUES ($1, $2, $3) RETURNING *',
        [adminId, nome, permissoes || []]
      );
      return res.status(201).json(r.rows[0]);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // PATCH /api/cargos/:id — edita
  router.patch('/:id', adminMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { nome, permissoes } = req.body;
      const adminId = req.userId!;

      const fields: string[] = [];
      const values: any[] = [];
      let idx = 1;

      if (nome !== undefined) {
        fields.push(`nome = $${idx++}`);
        values.push(nome);
      }
      if (permissoes !== undefined) {
        fields.push(`permissoes = $${idx++}`);
        values.push(permissoes);
      }

      if (fields.length === 0) return res.status(400).json({ message: 'Nada para atualizar' });

      values.push(id, adminId);
      const r = await pool.query(
        `UPDATE cargos SET ${fields.join(', ')} WHERE id = $${idx++} AND user_id = $${idx} RETURNING *`,
        values
      );

      if (!r.rows.length) return res.status(404).json({ message: 'Cargo não encontrado' });
      return res.json(r.rows[0]);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // DELETE /api/cargos/:id — exclui
  router.delete('/:id', adminMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const adminId = req.userId!;

      const r = await pool.query(
        'DELETE FROM cargos WHERE id = $1 AND user_id = $2 RETURNING id',
        [id, adminId]
      );

      if (!r.rows.length) return res.status(404).json({ message: 'Cargo não encontrado' });
      return res.status(204).send();
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  return router;
}
