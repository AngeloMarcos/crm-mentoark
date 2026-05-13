import { Router, Response } from 'express';
import { Pool } from 'pg';
import { AuthRequest, adminMiddleware } from '../middleware';

export default function usuarios(pool: Pool): Router {
  const router = Router();

  // ----- Virtual table: profiles -----
  // GET /api/profiles — returns all users as profile rows
  router.get('/profiles', adminMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const r = await pool.query(
        `SELECT id AS user_id, email, display_name, created_at FROM users ORDER BY created_at DESC`
      );
      return res.json(r.rows);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ----- Virtual table: user_roles -----
<<<<<<< HEAD
  // GET /api/user_roles — returns role info for users (admin only)
=======
  // GET /api/user_roles — returns role info for users
>>>>>>> 904d36cded8e47b0c079ee780dde5b0d285782c4
  router.get('/user_roles', adminMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      let sql = `SELECT id AS user_id, role FROM users`;
      const params: any[] = [];
      const conditions: string[] = [];

      if (req.query.user_id) {
        conditions.push(`id = $${params.length + 1}`);
        params.push(req.query.user_id);
      }
      if (req.query.role) {
        conditions.push(`role = $${params.length + 1}`);
        params.push(req.query.role);
      }
      if (conditions.length) sql += ` WHERE ${conditions.join(' AND ')}`;

      const r = await pool.query(sql, params);
      return res.json(r.rows);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // POST /api/user_roles — grant admin role
  router.post('/user_roles', adminMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { user_id, role } = req.body;
      if (!user_id || !role) return res.status(400).json({ message: 'user_id e role obrigatórios' });

      const r = await pool.query(
        `UPDATE users SET role = $1 WHERE id = $2 RETURNING id AS user_id, role`,
        [role, user_id]
      );
      if (!r.rows.length) return res.status(404).json({ message: 'Usuário não encontrado' });
      return res.status(201).json(r.rows[0]);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // DELETE /api/user_roles — remove admin (reset to 'user')
  router.delete('/user_roles', adminMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const user_id = req.query.user_id || req.body.user_id;
      if (!user_id) return res.status(400).json({ message: 'user_id obrigatório' });

      await pool.query(`UPDATE users SET role = 'user' WHERE id = $1`, [user_id]);
      return res.status(204).send();
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  return router;
}
