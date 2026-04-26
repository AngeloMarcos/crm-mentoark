import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt, { SignOptions } from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { pool } from './db';
import { authMiddleware, AuthRequest } from './middleware';

const router = Router();

function signAccessToken(user: { id: string; email: string; role: string; display_name: string }) {
  const opts: SignOptions = { expiresIn: (process.env.JWT_EXPIRES_IN || '1h') as SignOptions['expiresIn'] };
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role, display_name: user.display_name },
    process.env.JWT_SECRET!,
    opts
  );
}

async function createRefreshToken(userId: string): Promise<string> {
  const token = uuidv4();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);
  await pool.query(
    'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
    [userId, token, expiresAt]
  );
  return token;
}

function mapUser(row: any) {
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    avatar_url: row.avatar_url,
    role: row.role,
    user_metadata: { display_name: row.display_name },
  };
}

// POST /auth/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'E-mail e senha são obrigatórios' });
    }

    const { rows } = await pool.query(
      'SELECT * FROM users WHERE email = $1 AND active = true',
      [email.toLowerCase().trim()]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ message: 'E-mail ou senha incorretos' });

    let valid = false;

    // Try bcrypt first (for users created via our API)
    if (user.password_hash && user.password_hash.startsWith('$2')) {
      valid = await bcrypt.compare(password, user.password_hash);
    }

    // Fallback: try pgcrypto crypt() comparison for Supabase-migrated passwords
    if (!valid && user.password_hash) {
      const r = await pool.query(
        "SELECT crypt($1, password_hash) = password_hash AS ok FROM users WHERE id = $2",
        [password, user.id]
      );
      valid = r.rows[0]?.ok === true;
      // Rehash with bcrypt on first successful login with pgcrypto
      if (valid) {
        const newHash = await bcrypt.hash(password, 12);
        await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, user.id]);
      }
    }

    if (!valid) return res.status(401).json({ message: 'E-mail ou senha incorretos' });

    await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    const access_token = signAccessToken({ id: user.id, email: user.email, role: user.role, display_name: user.display_name });
    const refresh_token = await createRefreshToken(user.id);

    return res.json({ access_token, refresh_token, user: mapUser(user) });
  } catch (err: any) {
    console.error('Login error:', err);
    return res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// POST /auth/register
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, display_name } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'E-mail e senha são obrigatórios' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'Senha deve ter pelo menos 6 caracteres' });
    }

    const exists = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    if (exists.rows.length) {
      return res.status(409).json({ message: 'E-mail já cadastrado' });
    }

    const password_hash = await bcrypt.hash(password, 12);
    const name = display_name || email.split('@')[0];

    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, display_name, role, active, email_verified)
       VALUES ($1, $2, $3, 'user', true, false) RETURNING *`,
      [email.toLowerCase().trim(), password_hash, name]
    );
    const user = rows[0];

    const access_token = signAccessToken({ id: user.id, email: user.email, role: user.role, display_name: user.display_name });
    const refresh_token = await createRefreshToken(user.id);

    return res.status(201).json({ access_token, refresh_token, user: mapUser(user) });
  } catch (err: any) {
    console.error('Register error:', err);
    return res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// POST /auth/refresh
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) return res.status(400).json({ message: 'refresh_token obrigatório' });

    const { rows } = await pool.query(
      `SELECT rt.*, u.* FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token = $1 AND rt.revoked = false AND rt.expires_at > NOW() AND u.active = true`,
      [refresh_token]
    );
    if (!rows.length) return res.status(401).json({ message: 'Refresh token inválido ou expirado' });

    const row = rows[0];
    // Revoke old token
    await pool.query('UPDATE refresh_tokens SET revoked = true WHERE token = $1', [refresh_token]);

    const user = { id: row.user_id, email: row.email, role: row.role, display_name: row.display_name };
    const access_token = signAccessToken(user);
    const new_refresh_token = await createRefreshToken(user.id);

    return res.json({ access_token, refresh_token: new_refresh_token, user: mapUser(row) });
  } catch (err: any) {
    console.error('Refresh error:', err);
    return res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// POST /auth/logout
router.post('/logout', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { refresh_token } = req.body;
    if (refresh_token) {
      await pool.query('UPDATE refresh_tokens SET revoked = true WHERE token = $1', [refresh_token]);
    }
    return res.json({ message: 'Logout realizado' });
  } catch (err: any) {
    return res.status(500).json({ message: 'Erro interno' });
  }
});

// GET /auth/me
router.get('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, email, display_name, avatar_url, role FROM users WHERE id = $1 AND active = true',
      [req.userId]
    );
    if (!rows.length) return res.status(404).json({ message: 'Usuário não encontrado' });
    return res.json(mapUser(rows[0]));
  } catch (err: any) {
    return res.status(500).json({ message: 'Erro interno' });
  }
});

export default router;
