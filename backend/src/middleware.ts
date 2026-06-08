import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from './db';

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
  userEmail?: string;
}

/**
 * Extrai o JWT de múltiplas origens para compatibilidade com Lovable e clientes customizados:
 * 1. Authorization: Bearer <token>   (padrão)
 * 2. x-auth-token: <token>           (fallback Lovable/componentes legados)
 * 3. x-access-token: <token>         (fallback alternativo)
 */
function extractToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();

  const xAuth = req.headers['x-auth-token'];
  if (xAuth && typeof xAuth === 'string') return xAuth.trim();

  const xAccess = req.headers['x-access-token'];
  if (xAccess && typeof xAccess === 'string') return xAccess.trim();

  return null;
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({ message: 'Token não fornecido' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as any;

    if (!payload.sub) {
      return res.status(401).json({ message: 'Token inválido: sub ausente' });
    }

    req.userId    = String(payload.sub);
    req.userRole  = payload.role;
    req.userEmail = payload.email;
    next();
  } catch {
    return res.status(401).json({ message: 'Token inválido ou expirado', code: 'TOKEN_EXPIRED' });
  }
}

/**
 * Middleware de admin:
 * 1. Verifica se o role está no JWT.
 * 2. Se não estiver (tokens migrados/legados), verifica na tabela user_roles.
 */
export async function adminMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.userId) {
    return res.status(401).json({ message: 'Sessão inválida (userId ausente)' });
  }

  if (req.userRole === 'admin') {
    return next();
  }

  try {
    const { rows } = await pool.query(
      "SELECT role FROM user_roles WHERE user_id = $1 AND role = 'admin' LIMIT 1",
      [req.userId]
    );
    if (rows.length > 0) {
      req.userRole = 'admin';
      return next();
    }
    return res.status(403).json({ message: 'Acesso restrito a administradores' });
  } catch (err: any) {
    console.error('[Middleware] Erro ao verificar admin:', err.message);
    return res.status(500).json({ message: 'Erro interno ao validar permissões' });
  }
}
