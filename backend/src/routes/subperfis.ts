import { Router, Response } from 'express';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import { AuthRequest } from '../middleware';

export default function subPerfis(pool: Pool): Router {
  const router = Router();

  // 1. GET /api/sub-perfis
  // Lista sub-perfis do usuário logado com dados do membro vinculado
  router.get('/', async (req: AuthRequest, res: Response) => {
    try {
      const r = await pool.query(
        `SELECT sp.*, u.email as membro_email 
         FROM sub_perfis sp 
         LEFT JOIN users u ON u.id = sp.membro_id 
         WHERE sp.user_id = $1
         ORDER BY sp.created_at DESC`,
        [req.userId]
      );
      return res.json(r.rows);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // 2. POST /api/sub-perfis
  // Body: { nome, email, senha, modulos: string[], avatar_cor? }
  router.post('/', async (req: AuthRequest, res: Response) => {
    const client = await pool.connect();
    try {
      const { nome, email, senha, modulos, avatar_cor } = req.body;

      if (!nome || !email || !senha || !modulos) {
        return res.status(400).json({ message: 'Dados obrigatórios ausentes: nome, email, senha, modulos' });
      }

      await client.query('BEGIN');

      // Verifica se email já existe em users
      const userExists = await client.query('SELECT id FROM users WHERE email = $1', [email]);
      let membro_id: string;

      if (userExists.rows.length === 0) {
        // Se não existe: INSERT em users (display_name, email, password_hash, role='membro')
        const passwordHash = await bcrypt.hash(senha, 12);
        const newUser = await client.query(
          `INSERT INTO users (display_name, email, password_hash, role) 
           VALUES ($1, $2, $3, $4) 
           RETURNING id`,
          [nome, email, passwordHash, 'membro']
        );
        membro_id = newUser.rows[0].id;
      } else {
        membro_id = userExists.rows[0].id;
      }

      // INSERT em sub_perfis (user_id, membro_id, nome, email, modulos, senha_temp=hash(senha))
      const senhaTempHash = await bcrypt.hash(senha, 12);
      const subPerfil = await client.query(
        `INSERT INTO sub_perfis (user_id, membro_id, nome, email, modulos, senha_temp, avatar_cor) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) 
         RETURNING *`,
        [req.userId, membro_id, nome, email, modulos, senhaTempHash, avatar_cor || '#6366f1']
      );

      await client.query('COMMIT');
      return res.status(201).json(subPerfil.rows[0]);
    } catch (err: any) {
      await client.query('ROLLBACK');
      if (err.code === '23505') { // unique_violation
        return res.status(400).json({ message: 'Este e-mail já está vinculado a um sub-perfil seu.' });
      }
      return res.status(500).json({ message: err.message });
    } finally {
      client.release();
    }
  });

  // 3. PATCH /api/sub-perfis/:id
  // Atualiza: nome, modulos, avatar_cor, ativo
  router.patch('/:id', async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { nome, modulos, avatar_cor, ativo } = req.body;

      const r = await pool.query(
        `UPDATE sub_perfis 
         SET nome = COALESCE($1, nome),
             modulos = COALESCE($2, modulos),
             avatar_cor = COALESCE($3, avatar_cor),
             ativo = COALESCE($4, ativo),
             updated_at = now()
         WHERE id = $5 AND user_id = $6
         RETURNING *`,
        [nome, modulos, avatar_cor, ativo, id, req.userId]
      );

      if (r.rows.length === 0) {
        return res.status(404).json({ message: 'Sub-perfil não encontrado ou permissão negada.' });
      }

      return res.json(r.rows[0]);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // 4. DELETE /api/sub-perfis/:id
  // Soft delete: SET ativo = false
  router.delete('/:id', async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const r = await pool.query(
        `UPDATE sub_perfis SET ativo = false, updated_at = now() 
         WHERE id = $1 AND user_id = $2 
         RETURNING id`,
        [id, req.userId]
      );

      if (r.rows.length === 0) {
        return res.status(404).json({ message: 'Sub-perfil não encontrado ou permissão negada.' });
      }

      return res.status(204).send();
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // 5. PATCH /api/sub-perfis/:id/modulos
  router.patch('/:id/modulos', async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { modulos } = req.body;

      if (!modulos || !Array.isArray(modulos)) {
        return res.status(400).json({ message: 'O campo modulos deve ser um array.' });
      }

      const r = await pool.query(
        `UPDATE sub_perfis SET modulos = $1, updated_at = now() 
         WHERE id = $2 AND user_id = $3 
         RETURNING *`,
        [modulos, id, req.userId]
      );

      if (r.rows.length === 0) {
        return res.status(404).json({ message: 'Sub-perfil não encontrado ou permissão negada.' });
      }

      return res.json(r.rows[0]);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  return router;
}
