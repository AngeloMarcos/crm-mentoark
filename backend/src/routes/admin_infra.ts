/**
 * admin_infra.ts — Painel Super Admin: Infraestrutura e Firewall
 *
 * CONTRATO IMUTÁVEL:
 *   Este módulo é 100% passivo. Ele APENAS registra dados no banco para
 *   visualização na UI do painel. Nenhuma linha deste arquivo:
 *     - chama iptables, ufw, tc, nftables ou qualquer utilitário de sistema
 *     - bloqueia, rejeita ou modifica requisições HTTP em produção
 *     - altera tabelas de roteamento ou regras de kernel
 *
 *   O middleware `firewallPassiveMiddleware` exportado por este módulo
 *   retorna next() imediatamente quando firewall_ligado = false (padrão).
 *   Quando firewall_ligado = true mas modo_simulacao = true, apenas loga.
 *   Bloqueio real NUNCA acontece enquanto modo_simulacao = true.
 *
 * Rotas (todas requerem authMiddleware + adminMiddleware):
 *   GET  /api/admin/firewall/config          → lê config global
 *   PUT  /api/admin/firewall/config          → atualiza config (sem efeito imediato no tráfego)
 *   GET  /api/admin/firewall/ips             → lista IPs registrados (paginado)
 *   POST /api/admin/firewall                 → registra IP para visualização na UI
 *   PATCH /api/admin/firewall/:id            → edita entrada (tipo, motivo, ativo)
 *   DELETE /api/admin/firewall/:id           → remove registro da UI
 *   GET  /api/admin/firewall/stats           → estatísticas para o painel
 */

import { Router, Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import type { AuthRequest } from '../middleware';

// ── Validadores ───────────────────────────────────────────────────────────────

const RE_IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const RE_IPV6 = /^[0-9a-fA-F:]{2,39}$/;
const RE_CIDR = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;

const TIPOS_IP: ReadonlySet<string> = new Set(['blocked', 'allowed', 'monitored']);

/** Aceita IPv4, IPv6 simples ou CIDR IPv4. Não toca em nada do sistema. */
function isValidIp(v: string): boolean {
  const s = v.trim();
  return RE_IPV4.test(s) || RE_IPV6.test(s) || RE_CIDR.test(s);
}

function sanitizeText(v: unknown, max = 500): string {
  return String(v ?? '').trim().slice(0, max);
}

// ── Cache em memória da config (TTL 30s) — evita hit no banco a cada request ─

interface ConfigCache {
  firewall_ligado: boolean;
  modo_simulacao: boolean;
  ts: number;
}

let configCache: ConfigCache | null = null;
const CONFIG_TTL_MS = 30_000;

async function getFirewallConfig(pool: Pool): Promise<ConfigCache> {
  const now = Date.now();
  if (configCache && now - configCache.ts < CONFIG_TTL_MS) return configCache;

  const r = await pool.query(
    'SELECT firewall_ligado, modo_simulacao FROM firewall_config WHERE id = 1 LIMIT 1',
  ).catch(() => ({ rows: [] as any[] }));

  configCache = {
    firewall_ligado: r.rows[0]?.firewall_ligado ?? false,
    modo_simulacao:  r.rows[0]?.modo_simulacao  ?? true,
    ts:              now,
  };
  return configCache;
}

function invalidateConfigCache(): void {
  configCache = null;
}

// ── Middleware passivo exportado ──────────────────────────────────────────────
//
// Este middleware deve ser montado ANTES das rotas protegidas se/quando o
// painel de controle for ativado. Enquanto firewall_ligado = false (padrão),
// ele é operacionalmente um no-op: chama next() sem inspecionar nada.

export function createFirewallMiddleware(pool: Pool) {
  return async function firewallPassiveMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const cfg = await getFirewallConfig(pool);

      // ── BYPASS TOTAL (padrão) ─────────────────────────────────────────────
      // Enquanto firewall_ligado = false, este bloco é o único executado.
      // Nenhuma lógica adicional roda. OpenAI, Evolution e webhooks passam livres.
      if (!cfg.firewall_ligado) {
        return next();
      }

      // ── A partir daqui só executa se firewall_ligado = true ──────────────
      const rawIp = (
        (req.headers['x-forwarded-for'] as string) ||
        req.socket?.remoteAddress ||
        ''
      ).split(',')[0].trim();

      // Remove prefixo IPv6-mapped (::ffff:1.2.3.4 → 1.2.3.4)
      const clientIp = rawIp.replace(/^::ffff:/, '');

      const blocked = await pool.query(
        `SELECT id FROM firewall_ips
         WHERE ip = $1 AND tipo = 'blocked' AND ativo = true
         LIMIT 1`,
        [clientIp],
      ).catch(() => ({ rows: [] as any[] }));

      const isBlocked = blocked.rows.length > 0;

      // ── MODO SIMULAÇÃO — log apenas, sem bloqueio real ────────────────────
      if (cfg.modo_simulacao) {
        if (isBlocked) {
          console.warn(
            `[FIREWALL SIM] ${new Date().toISOString()} ` +
            `IP=${clientIp} path=${req.path} — seria bloqueado (simulação)`,
          );
        }
        return next(); // nunca bloqueia em modo simulação
      }

      // ── BLOQUEIO REAL — só atinge este ponto se: ──────────────────────────
      //   firewall_ligado = true  E  modo_simulacao = false
      // Não é o estado atual (defaults: false / true), mas o código está aqui
      // para quando o painel for ativado pelo admin.
      if (isBlocked) {
        console.warn(
          `[FIREWALL BLOCK] ${new Date().toISOString()} ` +
          `IP=${clientIp} path=${req.path}`,
        );
        res.status(403).json({ message: 'Acesso bloqueado.' });
        return;
      }

      return next();
    } catch {
      // Falha silenciosa — nunca bloqueia por erro interno
      return next();
    }
  };
}

// ── Roteador do painel Super Admin ───────────────────────────────────────────

export default function adminInfraRouter(pool: Pool): Router {
  const router = Router();

  // ── GET /config — lê configuração global do firewall ─────────────────────
  router.get('/config', async (_req: AuthRequest, res: Response) => {
    try {
      const r = await pool.query(
        `SELECT id, firewall_ligado, modo_simulacao, updated_at, updated_by
         FROM firewall_config WHERE id = 1`,
      );
      return res.json(r.rows[0] ?? {
        id: 1, firewall_ligado: false, modo_simulacao: true, updated_at: null,
      });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ── PUT /config — atualiza flags globais (sem efeito no tráfego atual) ───
  router.put('/config', async (req: AuthRequest, res: Response) => {
    const { firewall_ligado, modo_simulacao } = req.body as {
      firewall_ligado?: boolean;
      modo_simulacao?: boolean;
    };

    if (typeof firewall_ligado !== 'boolean' && typeof modo_simulacao !== 'boolean') {
      return res.status(400).json({
        message: 'Envie ao menos um campo: firewall_ligado (boolean) ou modo_simulacao (boolean).',
      });
    }

    try {
      const sets: string[] = ['updated_at = NOW()', 'updated_by = $1'];
      const vals: unknown[] = [req.userId];
      let i = 2;

      if (typeof firewall_ligado === 'boolean') {
        sets.push(`firewall_ligado = $${i++}`);
        vals.push(firewall_ligado);
      }
      if (typeof modo_simulacao === 'boolean') {
        sets.push(`modo_simulacao = $${i++}`);
        vals.push(modo_simulacao);
      }

      vals.push(1); // WHERE id = $last

      const r = await pool.query(
        `UPDATE firewall_config SET ${sets.join(', ')} WHERE id = $${i}
         RETURNING id, firewall_ligado, modo_simulacao, updated_at`,
        vals,
      );

      invalidateConfigCache();

      console.log(
        `[FIREWALL CONFIG] userId=${req.userId} ` +
        `ligado=${r.rows[0]?.firewall_ligado} simulacao=${r.rows[0]?.modo_simulacao}`,
      );

      return res.json(r.rows[0]);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ── GET /ips — lista IPs registrados (paginação) ──────────────────────────
  router.get('/ips', async (req: AuthRequest, res: Response) => {
    const limit  = Math.min(Number(req.query.limit)  || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const tipo   = req.query.tipo ? sanitizeText(req.query.tipo, 20) : null;
    const search = req.query.search ? sanitizeText(req.query.search, 50) : null;

    try {
      const conditions: string[] = [];
      const vals: unknown[]      = [];
      let i = 1;

      if (tipo && TIPOS_IP.has(tipo)) {
        conditions.push(`tipo = $${i++}`);
        vals.push(tipo);
      }
      if (search) {
        conditions.push(`(ip ILIKE $${i} OR motivo ILIKE $${i})`);
        vals.push(`%${search}%`);
        i++;
      }

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

      const [rows, total] = await Promise.all([
        pool.query(
          `SELECT id, ip, tipo, motivo, ativo, criado_por, created_at, updated_at
           FROM firewall_ips ${where}
           ORDER BY created_at DESC
           LIMIT $${i} OFFSET $${i + 1}`,
          [...vals, limit, offset],
        ),
        pool.query(
          `SELECT COUNT(*) AS total FROM firewall_ips ${where}`,
          vals,
        ),
      ]);

      return res.json({
        items:  rows.rows,
        total:  Number(total.rows[0]?.total ?? 0),
        limit,
        offset,
      });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ── POST / — registra IP para visualização na UI ─────────────────────────
  // NÃO aplica regras de sistema. NÃO bloqueia tráfego.
  router.post('/', async (req: AuthRequest, res: Response) => {
    const { ip, tipo = 'blocked', motivo, ativo = false } = req.body as {
      ip?: string;
      tipo?: string;
      motivo?: string;
      ativo?: boolean;
    };

    // Validação de IP
    const ipClean = sanitizeText(ip, 50);
    if (!ipClean || !isValidIp(ipClean)) {
      return res.status(400).json({
        message: 'IP inválido. Aceita IPv4 (ex: 1.2.3.4), IPv6 ou CIDR (ex: 1.2.3.0/24).',
        recebido: ip,
      });
    }

    // Validação de tipo
    const tipoClean = sanitizeText(tipo, 20).toLowerCase();
    if (!TIPOS_IP.has(tipoClean)) {
      return res.status(400).json({
        message: `Tipo inválido. Use: ${[...TIPOS_IP].join(', ')}.`,
      });
    }

    // Sanitização de motivo
    const motivoClean = motivo ? sanitizeText(motivo, 500) : null;

    // ativo deve ser boolean — não aceita strings
    const ativoClean = typeof ativo === 'boolean' ? ativo : false;

    try {
      const r = await pool.query(
        `INSERT INTO firewall_ips (ip, tipo, motivo, ativo, criado_por)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (ip) DO UPDATE
           SET tipo       = EXCLUDED.tipo,
               motivo     = EXCLUDED.motivo,
               ativo      = EXCLUDED.ativo,
               updated_at = NOW()
         RETURNING id, ip, tipo, motivo, ativo, created_at, updated_at`,
        [ipClean, tipoClean, motivoClean, ativoClean, req.userId],
      );

      console.log(
        `[FIREWALL UI] userId=${req.userId} ` +
        `ip=${ipClean} tipo=${tipoClean} ativo=${ativoClean} — registro salvo (sem bloqueio)`,
      );

      return res.status(201).json(r.rows[0]);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ── PATCH /:id — edita entrada (tipo, motivo, ativo) ─────────────────────
  router.patch('/:id', async (req: AuthRequest, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ message: 'ID inválido.' });
    }

    const { tipo, motivo, ativo } = req.body as {
      tipo?: string;
      motivo?: string;
      ativo?: boolean;
    };

    const sets: string[] = ['updated_at = NOW()'];
    const vals: unknown[] = [];
    let i = 1;

    if (tipo !== undefined) {
      const tipoClean = sanitizeText(tipo, 20).toLowerCase();
      if (!TIPOS_IP.has(tipoClean)) {
        return res.status(400).json({ message: `Tipo inválido. Use: ${[...TIPOS_IP].join(', ')}.` });
      }
      sets.push(`tipo = $${i++}`);
      vals.push(tipoClean);
    }

    if (motivo !== undefined) {
      sets.push(`motivo = $${i++}`);
      vals.push(motivo ? sanitizeText(motivo, 500) : null);
    }

    if (ativo !== undefined) {
      if (typeof ativo !== 'boolean') {
        return res.status(400).json({ message: 'ativo deve ser boolean.' });
      }
      sets.push(`ativo = $${i++}`);
      vals.push(ativo);
    }

    if (sets.length === 1) {
      return res.status(400).json({ message: 'Envie ao menos um campo para atualizar.' });
    }

    vals.push(id);

    try {
      const r = await pool.query(
        `UPDATE firewall_ips SET ${sets.join(', ')} WHERE id = $${i}
         RETURNING id, ip, tipo, motivo, ativo, updated_at`,
        vals,
      );

      if (!r.rowCount) {
        return res.status(404).json({ message: 'Registro não encontrado.' });
      }

      invalidateConfigCache(); // Garante que o middleware relê se ativo mudou

      return res.json(r.rows[0]);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ── DELETE /:id — remove registro da UI ──────────────────────────────────
  router.delete('/:id', async (req: AuthRequest, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ message: 'ID inválido.' });
    }

    try {
      const r = await pool.query(
        `DELETE FROM firewall_ips WHERE id = $1 RETURNING id, ip`,
        [id],
      );

      if (!r.rowCount) {
        return res.status(404).json({ message: 'Registro não encontrado.' });
      }

      console.log(`[FIREWALL UI] userId=${req.userId} ip=${r.rows[0].ip} removido da UI`);

      return res.json({ ok: true, removido: r.rows[0] });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ── GET /stats — estatísticas para o painel ───────────────────────────────
  router.get('/stats', async (_req: AuthRequest, res: Response) => {
    try {
      const [config, counts, recent] = await Promise.all([
        pool.query(
          'SELECT firewall_ligado, modo_simulacao FROM firewall_config WHERE id = 1',
        ),
        pool.query(`
          SELECT
            COUNT(*)                                    AS total,
            COUNT(*) FILTER (WHERE tipo = 'blocked')    AS bloqueados,
            COUNT(*) FILTER (WHERE tipo = 'allowed')    AS permitidos,
            COUNT(*) FILTER (WHERE tipo = 'monitored')  AS monitorados,
            COUNT(*) FILTER (WHERE ativo = true)        AS ativos
          FROM firewall_ips
        `),
        pool.query(`
          SELECT id, ip, tipo, motivo, ativo, created_at
          FROM firewall_ips
          ORDER BY created_at DESC LIMIT 10
        `),
      ]);

      return res.json({
        config: config.rows[0] ?? { firewall_ligado: false, modo_simulacao: true },
        counts: counts.rows[0],
        recentes: recent.rows,
      });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  return router;
}
