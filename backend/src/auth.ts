import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt, { SignOptions } from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import rateLimit from 'express-rate-limit';
import { pool } from './db';
import { authMiddleware, AuthRequest } from './middleware';

const router = Router();

// Rate limiter: máximo 10 tentativas por IP+email em 15 minutos
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { message: 'Muitas tentativas de login. Aguarde 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const ip = ((req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '')
      .split(',')[0].trim();
    const email = (req.body?.email || '').toLowerCase().trim();
    return `${ip}:${email}`;
  },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { message: 'Limite de cadastros por IP atingido. Aguarde 1 hora.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
router.post('/login', loginLimiter, async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'E-mail e senha são obrigatórios' });
    }
    if (!EMAIL_REGEX.test(String(email))) {
      return res.status(400).json({ message: 'Formato de e-mail inválido' });
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

    // Fallback: try pgcrypto crypt() comparison for Database-migrated passwords
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
        console.log(`[AUTH] Senha migrada de pgcrypto → bcrypt para user ${user.id}`);
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
router.post('/register', registerLimiter, async (req: Request, res: Response) => {
  try {
    const { email, password, display_name } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'E-mail e senha são obrigatórios' });
    }
    if (!EMAIL_REGEX.test(String(email))) {
      return res.status(400).json({ message: 'Formato de e-mail inválido' });
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

// POST /auth/turnstile-verify
// Verifica o token Turnstile gerado no frontend
router.post('/turnstile-verify', async (req, res) => {
  const { token } = req.body as { token?: string };

  if (!token) {
    return res.status(400).json({ error: 'Token ausente' });
  }

  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // Se não configurado no servidor, permite passar (dev sem variável)
    console.warn('[Turnstile] TURNSTILE_SECRET_KEY não configurado — verificação ignorada');
    return res.json({ success: true, dev: true });
  }

  try {
    const formData = new URLSearchParams();
    formData.append('secret', secret);
    formData.append('response', token);
    // Opcional: remoteip para maior segurança
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (ip) formData.append('remoteip', String(ip).split(',')[0].trim());

    const cfResp = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString(),
      }
    );

    const result = await cfResp.json() as { success: boolean; 'error-codes'?: string[] };

    if (!result.success) {
      console.warn('[Turnstile] Falha na verificação:', result['error-codes']);
      return res.status(403).json({
        error: 'Verificação de segurança falhou. Tente novamente.',
        codes: result['error-codes'],
      });
    }

    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Turnstile] Erro ao verificar:', err.message);
    return res.status(500).json({ error: 'Erro interno na verificação' });
  }
});

// ─────────────────────────────────────────────────────────────
// Google OAuth
// ─────────────────────────────────────────────────────────────
const GOOGLE_REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI ||
  `${process.env.API_PUBLIC_URL || 'https://api.mentoark.com.br'}/auth/callback/google`;

router.get('/authorize', (req: Request, res: Response) => {
  const provider = String(req.query.provider || '');
  const redirect_to = String(req.query.redirect_to || process.env.CORS_ORIGIN || 'https://crm.mentoark.com.br');

  if (provider !== 'google') {
    return res.status(400).send('Provider não suportado');
  }
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(500).send('Google OAuth não configurado no servidor');
  }

  const state = jwt.sign(
    { redirect_to, nonce: uuidv4() },
    process.env.JWT_SECRET!,
    { expiresIn: '10m' }
  );

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'select_account',
    state,
  });

  return res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

router.get('/callback/google', async (req: Request, res: Response) => {
  try {
    const { code, state, error: gError } = req.query as Record<string, string>;
    if (gError) return res.status(400).send(`Google OAuth erro: ${gError}`);
    if (!code || !state) return res.status(400).send('Parâmetros inválidos');

    let payload: any;
    try {
      payload = jwt.verify(state, process.env.JWT_SECRET!);
    } catch {
      return res.status(400).send('State inválido ou expirado');
    }
    const redirect_to: string = payload.redirect_to;

    // 1) Trocar code por token
    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code',
      }).toString(),
    });
    const tokenData = await tokenResp.json() as any;
    if (!tokenResp.ok || !tokenData.access_token) {
      console.error('[GOOGLE] Token exchange falhou:', tokenData);
      return res.status(400).send('Falha ao autenticar com Google');
    }

    // 2) Buscar perfil
    const profileResp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = await profileResp.json() as any;
    if (!profile.email) {
      return res.status(400).send('Não foi possível obter o e-mail do Google');
    }

    const email = String(profile.email).toLowerCase().trim();
    const display_name = profile.name || email.split('@')[0];
    const avatar_url = profile.picture || null;

    // 3) Upsert do usuário
    let user;
    const existing = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (existing.rows.length) {
      user = existing.rows[0];
      if (!user.active) return res.status(403).send('Usuário desativado');
      await pool.query(
        `UPDATE users SET last_login_at = NOW(),
           avatar_url = COALESCE(avatar_url, $1),
           email_verified = true
         WHERE id = $2`,
        [avatar_url, user.id]
      );
    } else {
      const randomHash = await bcrypt.hash(uuidv4(), 12);
      const ins = await pool.query(
        `INSERT INTO users (email, password_hash, display_name, avatar_url, role, active, email_verified, last_login_at)
         VALUES ($1, $2, $3, $4, 'user', true, true, NOW()) RETURNING *`,
        [email, randomHash, display_name, avatar_url]
      );
      user = ins.rows[0];
    }

    // 4) Emitir nossos JWTs
    const access_token = signAccessToken({
      id: user.id, email: user.email, role: user.role, display_name: user.display_name,
    });
    const refresh_token = await createRefreshToken(user.id);

    // 5) Redirecionar com tokens no fragment (#)
    const hash = new URLSearchParams({ access_token, refresh_token, token_type: 'bearer' }).toString();
    return res.redirect(`${redirect_to}#${hash}`);
  } catch (err: any) {
    console.error('[GOOGLE CALLBACK] erro:', err);
    return res.status(500).send('Erro interno no callback do Google');
  }
});

export default router;
