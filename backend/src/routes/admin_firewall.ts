/**
 * admin_firewall.ts — Super Admin: Gerenciamento de Firewall (passivo)
 *
 * CONTRATO ABSOLUTO:
 *   Nenhuma linha deste arquivo toca iptables, ufw, nftables ou qualquer
 *   primitiva de rede do SO. Todas as operações são APENAS registro em banco.
 *
 * Rotas (authMiddleware já aplicado em app.use('/api', authMiddleware)):
 *   GET  /api/admin/firewall/config
 *   PUT  /api/admin/firewall/config
 *   GET  /api/admin/firewall/stats
 *   GET  /api/admin/firewall/ips
 *   POST /api/admin/firewall
 *   PATCH /api/admin/firewall/:id   ← inverte flag 'ativo'
 *   DELETE /api/admin/firewall/:id
 *
 * Middleware exportado:
 *   createFirewallMiddleware(pool) — retorna next() imediato se
 *   firewall_ligado=false OU modo_simulacao=true (padrão de produção).
 */

import { Router, Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import type { AuthRequest } from '../middleware';

// ── Validação ─────────────────────────────────────────────────────────────────

const TIPOS_VALIDOS = new Set(['blocked', 'allowed', 'monitored']);

/** Aceita IPv4, IPv4 CIDR, IPv6 simples. Sem sistema de arquivos ou chamadas de SO. */
const RE_IP = /^(?:(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?|[0-9a-fA-F:]{2,45})$/;

function validarIp(ip: unknown): ip is string {
  return typeof ip === 'string' && RE_IP.test(ip.trim());
}

function sanitize(v: unknown, max = 500): string {
  return String(v ?? '').trim().slice(0, max);
}

function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.userRole !== 'admin') {
    return res.status(403).json({ message: 'Acesso restrito a administradores.' });
  }
  next();
}

// ── Cache da config (TTL 30s — evita hit no banco em cada request) ────────────

interface FwConfig { firewall_ligado: boolean; modo_simulacao: boolean; ts: number }
let _cfgCache: FwConfig | null = null;

async function lerConfig(pool: Pool): Promise<FwConfig> {
  const now = Date.now();
  if (_cfgCache && now - _cfgCache.ts < 30_000) return _cfgCache;
  const r = await pool.query(
    'SELECT firewall_ligado, modo_simulacao FROM firewall_config WHERE id = 1 LIMIT 1',
  ).catch(() => ({ rows: [] as any[] }));
  _cfgCache = {
    firewall_ligado: r.rows[0]?.firewall_ligado ?? false,
    modo_simulacao:  r.rows[0]?.modo_simulacao  ?? true,
    ts:              now,
  };
  return _cfgCache;
}

function invalidarCache() { _cfgCache = null; }

// ── Middleware passivo exportado ──────────────────────────────────────────────

export function createFirewallMiddleware(pool: Pool) {
  return async function firewallMiddleware(
    req: Request, res: Response, next: NextFunction,
  ): Promise<void> {
    try {
      const cfg = await lerConfig(pool);

      // BYPASS TOTAL — padrão enquanto firewall_ligado = false
      if (!cfg.firewall_ligado) return next();

      // Extrai IP real (atrás de proxy/Traefik)
      const rawIp = ((req.headers['x-forwarded-for'] as string) || req.socket?.remoteAddress || '')
        .split(',')[0].trim().replace(/^::ffff:/, '');

      const bloqueado = await pool.query(
        `SELECT 1 FROM firewall_ips WHERE ip = $1 AND tipo = 'blocked' AND ativo = true LIMIT 1`,
        [rawIp],
      ).catch(() => ({ rows: [] }));

      // MODO SIMULAÇÃO — loga, mas nunca bloqueia
      if (cfg.modo_simulacao) {
        if (bloqueado.rows.length)
          console.warn(`[FIREWALL SIM] ${rawIp} ${req.path} — seria bloqueado`);
        return next();
      }

      // BLOQUEIO REAL (só ativo se firewall_ligado=true E modo_simulacao=false)
      if (bloqueado.rows.length) {
        res.status(403).json({ message: 'Acesso bloqueado.' });
        return;
      }
      next();
    } catch {
      next(); // falha silenciosa — nunca bloqueia por erro
    }
  };
}

// ── Router ────────────────────────────────────────────────────────────────────

export default function adminFirewallRouter(pool: Pool): Router {
  const router = Router();

  // Todos os endpoints exigem role=admin
  router.use(requireAdmin);

  // ── GET /config ──────────────────────────────────────────────────────────
  router.get('/config', async (_req: AuthRequest, res: Response) => {
    try {
      const r = await pool.query(
        'SELECT id, firewall_ligado, modo_simulacao, updated_at FROM firewall_config WHERE id = 1',
      );
      return res.json(r.rows[0] ?? { id: 1, firewall_ligado: false, modo_simulacao: true });
    } catch (e: any) {
      return res.status(500).json({ message: e.message });
    }
  });

  // ── PUT /config ───────────────────────────────────────────────────────────
  router.put('/config', async (req: AuthRequest, res: Response) => {
    const { firewall_ligado, modo_simulacao } = req.body ?? {};
    if (typeof firewall_ligado !== 'boolean' && typeof modo_simulacao !== 'boolean') {
      return res.status(400).json({ message: 'Envie firewall_ligado e/ou modo_simulacao (boolean).' });
    }

    const sets: string[] = ['updated_at = NOW()'];
    const vals: unknown[] = [];
    let i = 1;

    if (typeof firewall_ligado === 'boolean') { sets.push(`firewall_ligado = $${i++}`); vals.push(firewall_ligado); }
    if (typeof modo_simulacao  === 'boolean') { sets.push(`modo_simulacao = $${i++}`);  vals.push(modo_simulacao);  }
    vals.push(1);

    try {
      const r = await pool.query(
        `UPDATE firewall_config SET ${sets.join(', ')} WHERE id = $${i}
         RETURNING id, firewall_ligado, modo_simulacao, updated_at`,
        vals,
      );
      invalidarCache();
      console.log(`[FIREWALL CONFIG] userId=${req.userId} → ${JSON.stringify(r.rows[0])}`);
      return res.json(r.rows[0]);
    } catch (e: any) {
      return res.status(500).json({ message: e.message });
    }
  });

  // ── GET /stats ────────────────────────────────────────────────────────────
  router.get('/stats', async (_req: AuthRequest, res: Response) => {
    try {
      const [cfg, cnt, recent] = await Promise.all([
        pool.query('SELECT firewall_ligado, modo_simulacao FROM firewall_config WHERE id = 1'),
        pool.query(`
          SELECT
            COUNT(*)                                   AS total,
            COUNT(*) FILTER (WHERE tipo = 'blocked')   AS bloqueados,
            COUNT(*) FILTER (WHERE tipo = 'allowed')   AS permitidos,
            COUNT(*) FILTER (WHERE tipo = 'monitored') AS monitorados,
            COUNT(*) FILTER (WHERE ativo = true)       AS ativos
          FROM firewall_ips
        `),
        pool.query(
          `SELECT id, ip, tipo, motivo, ativo, created_at
           FROM firewall_ips ORDER BY created_at DESC LIMIT 10`,
        ),
      ]);
      return res.json({
        config:   cfg.rows[0]   ?? { firewall_ligado: false, modo_simulacao: true },
        counts:   cnt.rows[0],
        recentes: recent.rows,
      });
    } catch (e: any) {
      return res.status(500).json({ message: e.message });
    }
  });

  // ── GET /ips ──────────────────────────────────────────────────────────────
  router.get('/ips', async (req: AuthRequest, res: Response) => {
    const limit  = Math.min(Number(req.query.limit)  || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const tipo   = req.query.tipo   ? sanitize(req.query.tipo,   20) : null;
    const search = req.query.search ? sanitize(req.query.search, 50) : null;

    const conds: string[] = [];
    const vals:  unknown[] = [];
    let i = 1;

    if (tipo && TIPOS_VALIDOS.has(tipo))  { conds.push(`tipo = $${i++}`);                     vals.push(tipo);          }
    if (search)                           { conds.push(`(ip ILIKE $${i} OR motivo ILIKE $${i})`); vals.push(`%${search}%`); i++; }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    try {
      const [rows, total] = await Promise.all([
        pool.query(
          `SELECT id, ip, tipo, motivo, ativo, created_at, updated_at
           FROM firewall_ips ${where} ORDER BY created_at DESC
           LIMIT $${i} OFFSET $${i + 1}`,
          [...vals, limit, offset],
        ),
        pool.query(`SELECT COUNT(*) AS total FROM firewall_ips ${where}`, vals),
      ]);
      return res.json({ items: rows.rows, total: Number(total.rows[0]?.total ?? 0), limit, offset });
    } catch (e: any) {
      return res.status(500).json({ message: e.message });
    }
  });

  // ── POST / ────────────────────────────────────────────────────────────────
  router.post('/', async (req: AuthRequest, res: Response) => {
    const { ip, tipo = 'blocked', motivo, ativo = false } = req.body ?? {};

    const ipClean = sanitize(ip, 50);
    if (!validarIp(ipClean)) {
      return res.status(400).json({ message: 'IP inválido. Use IPv4 (1.2.3.4), CIDR (1.2.3.0/24) ou IPv6.' });
    }
    const tipoClean = sanitize(tipo, 20).toLowerCase();
    if (!TIPOS_VALIDOS.has(tipoClean)) {
      return res.status(400).json({ message: `tipo inválido. Use: ${[...TIPOS_VALIDOS].join(', ')}.` });
    }
    if (typeof ativo !== 'boolean') {
      return res.status(400).json({ message: 'ativo deve ser boolean.' });
    }

    try {
      const r = await pool.query(
        `INSERT INTO firewall_ips (ip, tipo, motivo, ativo, criado_por)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (ip) DO UPDATE
           SET tipo = EXCLUDED.tipo, motivo = EXCLUDED.motivo,
               ativo = EXCLUDED.ativo, updated_at = NOW()
         RETURNING id, ip, tipo, motivo, ativo, created_at, updated_at`,
        [ipClean, tipoClean, motivo ? sanitize(motivo) : null, ativo, req.userId],
      );
      console.log(`[FIREWALL UI] userId=${req.userId} → ${ipClean} tipo=${tipoClean} ativo=${ativo}`);
      return res.status(201).json(r.rows[0]);
    } catch (e: any) {
      return res.status(500).json({ message: e.message });
    }
  });

  // ── PATCH /:id — inverte flag 'ativo' ────────────────────────────────────
  router.patch('/:id', async (req: AuthRequest, res: Response) => {
    const id = sanitize(req.params.id, 36);
    if (!id) return res.status(400).json({ message: 'ID inválido.' });

    try {
      const r = await pool.query(
        `UPDATE firewall_ips SET ativo = NOT ativo, updated_at = NOW()
         WHERE id = $1
         RETURNING id, ip, tipo, motivo, ativo, updated_at`,
        [id],
      );
      if (!r.rowCount) return res.status(404).json({ message: 'Registro não encontrado.' });
      invalidarCache();
      return res.json(r.rows[0]);
    } catch (e: any) {
      return res.status(500).json({ message: e.message });
    }
  });

  // ── DELETE /:id ────────────────────────────────────────────────────────────
  router.delete('/:id', async (req: AuthRequest, res: Response) => {
    const id = sanitize(req.params.id, 36);
    if (!id) return res.status(400).json({ message: 'ID inválido.' });

    try {
      const r = await pool.query(
        'DELETE FROM firewall_ips WHERE id = $1 RETURNING id, ip',
        [id],
      );
      if (!r.rowCount) return res.status(404).json({ message: 'Registro não encontrado.' });
      console.log(`[FIREWALL UI] userId=${req.userId} removeu ${r.rows[0].ip}`);
      return res.json({ ok: true, removido: r.rows[0] });
    } catch (e: any) {
      return res.status(500).json({ message: e.message });
    }
  });

  return router;
}
