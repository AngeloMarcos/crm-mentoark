import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from './db';

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
  userEmail?: string;
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Token não fornecido' });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as any;
    if (!payload.sub) {
      return res.status(401).json({ message: 'Token inválido: sub ausente' });
    }
    req.userId   = String(payload.sub);
    req.userRole = payload.role;
    req.userEmail = payload.email;
    next();
  } catch {
    return res.status(401).json({ message: 'Token inválido ou expirado' });
  }
}

/**
 * Middleware de admin:
 * 1. Verifica se o role está no JWT.
 * 2. Se não estiver (ex: token do Supabase), verifica na tabela user_roles.
 */
export async function adminMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.userId) {
    return res.status(401).json({ message: 'Sessão inválida (userId ausente)' });
  }

  // Se o JWT já diz que é admin, passamos
  if (req.userRole === 'admin') {
    return next();
  }

  // Senão, checamos no banco (fallback para tokens do Supabase ou migrados)
  try {
    const { rows } = await pool.query(
      "SELECT role FROM user_roles WHERE user_id = $1 AND role = 'admin' LIMIT 1",
      [req.userId]
    );
    if (rows.length > 0) {
      req.userRole = 'admin'; // Cacheia para o resto da request
      return next();
    }
    return res.status(403).json({ message: 'Acesso restrito a administradores' });
  } catch (err: any) {
    console.error('[Middleware] Erro ao verificar admin:', err.message);
    return res.status(500).json({ message: 'Erro interno ao validar permissões' });
  }
}
