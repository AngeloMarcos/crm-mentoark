import { Router, Response } from 'express';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import { AuthRequest, adminMiddleware } from '../middleware';

export default function usuarios(pool: Pool): Router {

  const router = Router();

  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const MODULOS_PADRAO_NOVO_USUARIO = ['dashboard', 'leads', 'whatsapp'];

  // POST /api/profiles — criar novo usuário (admin)
  router.post('/profiles', adminMiddleware, async (req: AuthRequest, res: Response) => {
    const client = await pool.connect();
    try {
      const { email, password, display_name } = req.body || {};
      const adminId = req.userId!;

      if (!email || !password) {
        return res.status(400).json({ message: 'E-mail e senha são obrigatórios' });
      }
      if (!EMAIL_REGEX.test(String(email))) {
        return res.status(400).json({ message: 'Formato de e-mail inválido' });
      }
      if (String(password).length < 6) {
        return res.status(400).json({ message: 'Senha deve ter pelo menos 6 caracteres' });
      }

      const emailNorm = String(email).toLowerCase().trim();
      const exists = await client.query('SELECT id FROM users WHERE email = $1', [emailNorm]);
      if (exists.rows.length) {
        return res.status(409).json({ message: 'E-mail já cadastrado' });
      }

      const password_hash = await bcrypt.hash(String(password), 12);
      const nome = (display_name && String(display_name).trim()) || emailNorm.split('@')[0];

      await client.query('BEGIN');
      
      // 1. Criar usuário com owner_id
      const ins = await client.query(
        `INSERT INTO users (email, password_hash, display_name, role, active, email_verified, owner_id)
         VALUES ($1, $2, $3, 'user', true, false, $4)
         RETURNING id, email, display_name, role, created_at`,
        [emailNorm, password_hash, nome, adminId]
      );
      const novo = ins.rows[0];

      // 2. Sincroniza com a tabela profiles
      await client.query(
        `INSERT INTO profiles (user_id, email, display_name)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name`,
        [novo.id, novo.email, novo.display_name]
      );

      // 3. Sincroniza com a tabela user_roles
      await client.query(
        `INSERT INTO user_roles (user_id, role)
         VALUES ($1, 'user')
         ON CONFLICT (user_id) DO UPDATE SET role = 'user'`,
        [novo.id]
      );

      // 4. Módulos padrão
      for (const mod of MODULOS_PADRAO_NOVO_USUARIO) {
        await client.query(
          `INSERT INTO user_modulos (user_id, modulo, ativo)
           VALUES ($1, $2, true)
           ON CONFLICT (user_id, modulo) DO UPDATE SET ativo = true`,
          [novo.id, mod]
        );
      }

      // 5. Adicionar automaticamente à equipe do admin
      // Busca a equipe onde o admin é owner
      const equipeRes = await client.query(
        `SELECT id FROM equipes WHERE owner_id = $1 LIMIT 1`,
        [adminId]
      );
      
      if (equipeRes.rows.length > 0) {
        const equipeId = equipeRes.rows[0].id;
        await client.query(
          `INSERT INTO equipe_membros (equipe_id, user_id, role, convidado_por)
           VALUES ($1, $2, 'membro', $3)
           ON CONFLICT (equipe_id, user_id) DO NOTHING`,
          [equipeId, novo.id, adminId]
        );
      }

      await client.query('COMMIT');

      return res.status(201).json({
        user_id: novo.id,
        email: novo.email,
        display_name: novo.display_name,
        role: novo.role,
        created_at: novo.created_at,
        modulos_iniciais: MODULOS_PADRAO_NOVO_USUARIO,
      });
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => {});
      return res.status(500).json({ message: err.message });
    } finally {
      client.release();
    }
  });

  // ----- Virtual table: profiles -----
  // GET /api/profiles — returns users as profile rows with pagination
  router.get('/profiles', adminMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const adminId = req.userId!;
      const limit  = Math.min(parseInt(String(req.query.limit  || '50'), 10), 200);
      const offset = Math.max(parseInt(String(req.query.offset || '0'),  10), 0);
      const search = req.query.search ? `%${req.query.search}%` : null;

      const r = await pool.query(
        `SELECT u.id AS user_id, u.email, u.display_name, u.role, u.active, u.created_at,
                (SELECT array_agg(modulo) FROM user_modulos WHERE user_id = u.id AND ativo = true) as modulos
         FROM users u
         WHERE (u.owner_id = $1)
           AND ($2::text IS NULL OR u.email ILIKE $2 OR u.display_name ILIKE $2)
         ORDER BY u.created_at DESC
         LIMIT $3 OFFSET $4`,
        [adminId, search, limit, offset]
      );
      return res.json(r.rows);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ----- Virtual table: user_roles -----
  // GET /api/user_roles — returns role info for users (admin only)
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

  const ROLES_PERMITIDOS = ['admin', 'user'] as const;
  type UserRole = typeof ROLES_PERMITIDOS[number];

  // POST /api/user_roles — grant role
  router.post('/user_roles', adminMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { user_id, role } = req.body;
      if (!user_id || !role) return res.status(400).json({ message: 'user_id e role obrigatórios' });

      // Validar role
      if (!ROLES_PERMITIDOS.includes(role as UserRole)) {
        return res.status(400).json({
          message: `Role inválido. Valores aceitos: ${ROLES_PERMITIDOS.join(', ')}`,
        });
      }

      await pool.query('BEGIN');
      await pool.query(
        `UPDATE users SET role = $1 WHERE id = $2`,
        [role, user_id]
      );
      const r = await pool.query(
        `INSERT INTO user_roles (user_id, role) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role
         RETURNING user_id, role`,
        [user_id, role]
      );
      await pool.query('COMMIT');

      if (!r.rows.length) return res.status(404).json({ message: 'Usuário não encontrado' });
      return res.status(201).json(r.rows[0]);
    } catch (err: any) {
      await pool.query('ROLLBACK').catch(() => {});
      return res.status(500).json({ message: err.message });
    }
  });

  // ----- Virtual table: user_modulos -----
  // GET /api/user_modulos — returns all user module assignments (admin only)
  router.get('/user_modulos', adminMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const r = await pool.query(
        `SELECT user_id, modulo, ativo FROM user_modulos ORDER BY user_id, modulo`
      );
      return res.json(r.rows);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // DELETE /api/user_roles — remove admin (reset to 'user')
  router.delete('/user_roles', adminMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const user_id = req.query.user_id || req.body.user_id;
      if (!user_id) return res.status(400).json({ message: 'user_id obrigatório' });

      // Impedir auto-rebaixamento de admin
      if (String(user_id) === req.userId) {
        return res.status(403).json({ message: 'Você não pode remover seu próprio acesso de admin.' });
      }

      await pool.query(`UPDATE users SET role = 'user' WHERE id = $1`, [user_id]);
      return res.status(204).send();
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // DELETE /api/profiles/:user_id — exclui um usuário (admin)
  router.delete('/profiles/:user_id', adminMiddleware, async (req: AuthRequest, res: Response) => {
    const client = await pool.connect();
    try {
      const { user_id } = req.params;
      if (!user_id) return res.status(400).json({ message: 'user_id obrigatório' });
      if (String(user_id) === req.userId) {
        return res.status(403).json({ message: 'Você não pode excluir sua própria conta.' });
      }

      await client.query('BEGIN');
      // Remove de todas as tabelas relacionadas (ordem importa se houver FKs manuais)
      await client.query('DELETE FROM user_modulos WHERE user_id = $1', [user_id]);
      await client.query('DELETE FROM user_roles WHERE user_id = $1', [user_id]);
      await client.query('DELETE FROM profiles WHERE user_id = $1', [user_id]);
      const r = await client.query(`DELETE FROM users WHERE id = $1 RETURNING id`, [user_id]);
      
      if (!r.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Usuário não encontrado' });
      }
      
      await client.query('COMMIT');
      return res.status(204).send();
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => {});
      return res.status(500).json({ message: err.message });
    } finally {
      client.release();
    }
  });

  // PATCH /api/profiles/:user_id — atualizar status (admin)
  router.patch('/profiles/:user_id', adminMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { user_id } = req.params;
      const { active } = req.body;
      const adminId = req.userId!;

      if (typeof active !== 'boolean') {
        return res.status(400).json({ message: 'Status active deve ser booleano' });
      }

      const r = await pool.query(
        `UPDATE users SET active = $1 WHERE id = $2 AND owner_id = $3 RETURNING id`,
        [active, user_id, adminId]
      );

      if (!r.rows.length) return res.status(404).json({ message: 'Usuário não encontrado ou você não tem permissão.' });
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // POST /api/profiles/:user_id/reset-password — redefine a senha (admin)
  router.post('/profiles/:user_id/reset-password', adminMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { user_id } = req.params;
      const { new_password } = req.body || {};
      if (!user_id) return res.status(400).json({ message: 'user_id obrigatório' });
      if (!new_password || String(new_password).length < 6) {
        return res.status(400).json({ message: 'Nova senha deve ter pelo menos 6 caracteres' });
      }
      const hash = await bcrypt.hash(String(new_password), 12);
      const r = await pool.query(
        `UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING id`,
        [hash, user_id]
      );
      if (!r.rows.length) return res.status(404).json({ message: 'Usuário não encontrado' });
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  return router;
}

