import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { PoolClient } from 'pg';
import { pool } from './db';
import { log, setRequestUserId } from './logger';

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
  userEmail?: string;
  // [AUDITORIA] LÓGICA: getDb() adquire (de forma preguiçosa/lazy) um client dedicado do pool
  // com SET LOCAL app.user_id/app.is_admin já aplicados, pra rotas que precisam do contexto de
  // tenant propagado pro Postgres (piloto de RLS, ver diagnosticos/AUDITORIA_LOG.md). Rotas que
  // nunca chamam getDb() não pagam custo nenhum de conexão extra.
  getDb?: () => Promise<PoolClient>;
  // [AUDITORIA] LÓGICA: várias rotas de whatsapp.ts consultam whatsapp_messages pelo
  // resolveOwnerId(userId) (Tenant ID de equipe), não pelo userId bruto do JWT — RLS precisa
  // ver o mesmo id que o WHERE da query usa. setDbUserId() reescreve app.user_id na mesma
  // transação já aberta por getDb() (SET LOCAL pode ser chamado várias vezes por transação).
  setDbUserId?: (userId: string) => Promise<void>;
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
    setRequestUserId(req.userId);
    next();
  } catch {
    return res.status(401).json({ message: 'Token inválido ou expirado', code: 'TOKEN_EXPIRED' });
  }
}

/**
 * [AUDITORIA] LÓGICA: Piloto de RLS (Row-Level Security) — propaga o usuário autenticado pro
 * Postgres via SET LOCAL, pra que políticas RLS (hoje só em whatsapp_messages, em
 * homologação) possam usar `current_setting('app.user_id')`/`current_setting('app.is_admin')`
 * como fonte de verdade, em vez de depender só do WHERE user_id=$1 escrito à mão em cada
 * query — rede de segurança contra o padrão de bug já visto hoje (webhook.ts/agentEngine.ts/
 * kanban.ts). Lazy: só adquire client dedicado do pool quando a rota efetivamente chama
 * req.getDb(); rotas que não usam RLS ainda (a maioria) continuam usando `pool.query()`
 * normalmente, sem custo extra de conexão. Em produção, RLS não está habilitado em nenhuma
 * tabela — esse middleware roda mas getDb() só é chamado pelas rotas do piloto.
 */
export function tenantContextMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  let client: PoolClient | null = null;
  let finalized = false;

  req.getDb = async (): Promise<PoolClient> => {
    if (client) return client;
    client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.user_id', $1, true)`, [req.userId || '']);
      await client.query(`SELECT set_config('app.is_admin', $1, true)`, [req.userRole === 'admin' ? 'true' : 'false']);
    } catch (err: any) {
      client.release();
      client = null;
      log.error('TENANT_CTX', 'Falha ao inicializar contexto de tenant', { err: err?.message });
      throw err;
    }
    return client;
  };

  req.setDbUserId = async (userId: string): Promise<void> => {
    const c = await req.getDb!();
    await c.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
  };

  res.on('finish', () => {
    if (finalized || !client) return;
    finalized = true;
    const c = client;
    const ok = res.statusCode < 500;
    c.query(ok ? 'COMMIT' : 'ROLLBACK')
      .catch(err => log.error('TENANT_CTX', 'Erro ao finalizar transação de tenant', { err: err?.message }))
      .finally(() => c.release());
  });

  next();
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
    log.error('MIDDLEWARE', 'Erro ao verificar admin', { err: err?.message });
    return res.status(500).json({ message: 'Erro interno ao validar permissões' });
  }
}
