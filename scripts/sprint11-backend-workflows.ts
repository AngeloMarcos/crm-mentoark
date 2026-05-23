// backend/src/routes/workflows.ts
// Deploy: scp para /opt/crm/backend/src/routes/workflows.ts
// e adicionar em src/index.ts:
//   import workflowsRouter from "./routes/workflows.js";
//   app.use("/api/workflows", workflowsRouter);

import { Router } from "express";
import type { Pool } from "pg";

export function makeWorkflowsRouter(pool: Pool) {
  const router = Router();

  // GET /api/workflows — lista do usuário
  router.get("/", async (req: any, res) => {
    const { rows } = await pool.query(
      `SELECT id, nome, descricao, ativo, ultima_exec, created_at, updated_at
         FROM workflows WHERE user_id = $1 ORDER BY updated_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  });

  // GET /api/workflows/:id — detalhe (com nodes/edges)
  router.get("/:id", async (req: any, res) => {
    const { rows } = await pool.query(
      `SELECT * FROM workflows WHERE id=$1 AND user_id=$2`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "not_found" });
    res.json(rows[0]);
  });

  // POST /api/workflows — criar
  router.post("/", async (req: any, res) => {
    const { nome, descricao, nodes = [], edges = [], n8n_webhook = null, ativo = false } = req.body || {};
    if (!nome) return res.status(400).json({ error: "nome obrigatório" });
    const { rows } = await pool.query(
      `INSERT INTO workflows (user_id, nome, descricao, nodes, edges, n8n_webhook, ativo)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7) RETURNING *`,
      [req.user.id, nome, descricao, JSON.stringify(nodes), JSON.stringify(edges), n8n_webhook, ativo]
    );
    res.json(rows[0]);
  });

  // PATCH /api/workflows/:id — atualizar
  router.patch("/:id", async (req: any, res) => {
    const fields: string[] = [];
    const values: any[] = [];
    let i = 1;
    for (const k of ["nome", "descricao", "ativo", "n8n_webhook"]) {
      if (k in req.body) { fields.push(`${k}=$${i++}`); values.push(req.body[k]); }
    }
    if ("nodes" in req.body) { fields.push(`nodes=$${i++}::jsonb`); values.push(JSON.stringify(req.body.nodes)); }
    if ("edges" in req.body) { fields.push(`edges=$${i++}::jsonb`); values.push(JSON.stringify(req.body.edges)); }
    if (!fields.length) return res.status(400).json({ error: "nenhum campo" });
    fields.push(`updated_at=now()`);
    values.push(req.params.id, req.user.id);
    const { rows } = await pool.query(
      `UPDATE workflows SET ${fields.join(",")} WHERE id=$${i++} AND user_id=$${i} RETURNING *`,
      values
    );
    if (!rows[0]) return res.status(404).json({ error: "not_found" });
    res.json(rows[0]);
  });

  // DELETE /api/workflows/:id
  router.delete("/:id", async (req: any, res) => {
    await pool.query(`DELETE FROM workflows WHERE id=$1 AND user_id=$2`, [req.params.id, req.user.id]);
    res.json({ ok: true });
  });

  // POST /api/workflows/:id/executar — dispara webhook n8n
  router.post("/:id/executar", async (req: any, res) => {
    const { rows } = await pool.query(
      `SELECT * FROM workflows WHERE id=$1 AND user_id=$2`,
      [req.params.id, req.user.id]
    );
    const wf = rows[0];
    if (!wf) return res.status(404).json({ error: "not_found" });
    if (!wf.n8n_webhook) return res.status(400).json({ error: "workflow_sem_webhook", msg: "Configure n8n_webhook antes de executar" });

    try {
      const r = await fetch(wf.n8n_webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflow_id: wf.id,
          user_id: req.user.id,
          nodes: wf.nodes,
          edges: wf.edges,
          payload: req.body || {},
        }),
      });
      await pool.query(`UPDATE workflows SET ultima_exec=now() WHERE id=$1`, [wf.id]);
      const body = await r.text();
      res.status(r.status).json({ ok: r.ok, status: r.status, body });
    } catch (e: any) {
      res.status(502).json({ error: "n8n_unreachable", msg: e?.message });
    }
  });

  return router;
}
