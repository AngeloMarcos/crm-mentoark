/**
 * baseConhecimento.ts — status e ações da indexação automática (2026-10-30, services/indexacao.ts).
 *
 *   GET  /api/base-conhecimento/status        → contagem por status + itens com erro + total por agente
 *   POST /api/base-conhecimento/indexar-agora → roda a varredura desta conta já (sem esperar o cron)
 *   POST /api/base-conhecimento/reindexar     → { conhecimento_id? , so_erros? } marca e roda
 */
import { Router, Response } from 'express';
import { Pool } from 'pg';
import { AuthRequest } from '../middleware';
import { marcarParaReindexar, varrerIndexacao } from '../services/indexacao';

export default function baseConhecimentoRouter(pool: Pool): Router {
  const router = Router();

  router.get('/status', async (req: AuthRequest, res: Response) => {
    try {
      const [porStatus, erros, porAgente, docs] = await Promise.all([
        pool.query(
          `SELECT COALESCE(status_indexacao, 'pendente') AS status, count(*)::int AS total
             FROM conhecimento WHERE user_id = $1 GROUP BY 1`, [req.userId]),
        pool.query(
          `SELECT id, tipo, campo, erro_indexacao FROM conhecimento
            WHERE user_id = $1 AND status_indexacao = 'erro' ORDER BY updated_at DESC LIMIT 20`, [req.userId]),
        pool.query(
          `SELECT agente_id, count(*)::int AS total FROM conhecimento WHERE user_id = $1 GROUP BY 1`, [req.userId]),
        pool.query(
          `SELECT count(*) FILTER (WHERE embedding IS NOT NULL)::int AS indexados,
                  count(*) FILTER (WHERE embedding IS NULL)::int AS pendentes
             FROM documents WHERE user_id = $1`, [req.userId]),
      ]);
      const status: Record<string, number> = { pendente: 0, indexando: 0, indexado: 0, erro: 0 };
      for (const r of porStatus.rows) status[r.status] = (status[r.status] || 0) + r.total;
      return res.json({ status, erros: erros.rows, por_agente: porAgente.rows, trechos: docs.rows[0] });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  router.post('/indexar-agora', async (req: AuthRequest, res: Response) => {
    try {
      const r = await varrerIndexacao(pool, { userId: req.userId!, limite: 50 });
      return res.json(r);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  router.post('/reindexar', async (req: AuthRequest, res: Response) => {
    try {
      const marcados = await marcarParaReindexar(pool, req.userId!, {
        conhecimentoId: req.body?.conhecimento_id || undefined,
        soErros: req.body?.so_erros === true,
      });
      const r = await varrerIndexacao(pool, { userId: req.userId!, limite: 50 });
      return res.json({ marcados, ...r });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  return router;
}
