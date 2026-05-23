// backend/src/routes/seguranca.ts
// Deploy: scp para /opt/crm/backend/src/routes/seguranca.ts
// Adicionar em src/index.ts (após adminMiddleware):
//   import { makeSegurancaRouter } from "./routes/seguranca.js";
//   app.use("/api/seguranca", adminMiddleware, makeSegurancaRouter(pool));

import { Router } from "express";
import type { Pool } from "pg";

export function makeSegurancaRouter(pool: Pool) {
  const router = Router();

  // GET /api/seguranca/tabelas — lista dinâmica via pg_catalog
  router.get("/tabelas", async (_req, res) => {
    const { rows } = await pool.query(`
      SELECT
        c.relname AS nome,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name=c.relname AND column_name='user_id'
        ) AS tem_user_id,
        pg_size_pretty(pg_total_relation_size(c.oid)) AS tamanho,
        (SELECT COUNT(*) FROM pg_indexes WHERE schemaname='public' AND tablename=c.relname) AS indices
      FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r'
      ORDER BY pg_total_relation_size(c.oid) DESC
    `);
    res.json(rows.map((r: any) => ({
      nome: r.nome,
      isolamento: r.tem_user_id ? "user_id" : "público/global",
      status: r.tem_user_id ? "Protegida" : "Sem multi-tenant",
      nivel: r.tem_user_id ? "Alta" : "Baixa",
      tamanho: r.tamanho,
      indices: Number(r.indices),
    })));
  });

  // GET /api/seguranca/auditoria — roda checks de verdade
  router.get("/auditoria", async (_req, res) => {
    const checks: { label: string; status: "ok" | "warn" | "error" }[] = [];

    // Check 1: JWT_SECRET configurado
    checks.push({
      label: "JWT_SECRET configurado no env",
      status: process.env.JWT_SECRET ? "ok" : "error",
    });

    // Check 2: MASTERS via env (não hardcoded)
    checks.push({
      label: "Admins MASTERS via env (não hardcoded em modulos.ts)",
      status: process.env.MASTER_EMAILS ? "ok" : "warn",
    });

    // Check 3: tabelas sem user_id
    const { rows: semUser } = await pool.query(`
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r'
        AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name=c.relname AND column_name='user_id'
        )
        AND c.relname NOT IN ('webhook_mensagens_processadas','user_modulos_master')
    `);
    checks.push({
      label: `Tabelas sem user_id (${semUser.length})`,
      status: semUser.length === 0 ? "ok" : "warn",
    });

    // Check 4: refresh_tokens expirados
    const { rows: expirados } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM refresh_tokens WHERE expires_at < now()`
    );
    checks.push({
      label: `Refresh tokens expirados acumulados: ${expirados[0]?.n ?? 0}`,
      status: (expirados[0]?.n ?? 0) > 100 ? "warn" : "ok",
    });

    // Check 5: índices em tabelas grandes
    const { rows: semIdx } = await pool.query(`
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r'
        AND pg_total_relation_size(c.oid) > 10*1024*1024
        AND (SELECT COUNT(*) FROM pg_indexes WHERE schemaname='public' AND tablename=c.relname) < 2
    `);
    checks.push({
      label: `Tabelas >10MB com poucos índices (${semIdx.length})`,
      status: semIdx.length === 0 ? "ok" : "warn",
    });

    res.json({ checks, executado_em: new Date().toISOString() });
  });

  // GET /api/seguranca/logins-recentes
  router.get("/logins-recentes", async (_req, res) => {
    const { rows } = await pool.query(`
      SELECT rt.user_id, u.email, rt.created_at, rt.expires_at, rt.revoked
      FROM refresh_tokens rt
      LEFT JOIN users u ON u.id = rt.user_id
      ORDER BY rt.created_at DESC LIMIT 50
    `);
    res.json(rows);
  });

  return router;
}
