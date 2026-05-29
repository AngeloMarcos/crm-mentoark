import { Router, Response } from 'express';
import { Pool } from 'pg';
import { AuthRequest } from '../middleware';

export default function aiUso(pool: Pool): Router {
  const router = Router();

  // GET /api/ai/uso?periodo=hoje|7d|30d
  router.get('/uso', async (req: AuthRequest, res: Response) => {
    try {
      const periodo = (req.query.periodo as string) || '30d';
      const userId = req.userId;
      let rows;

      if (periodo === 'hoje') {
        const r = await pool.query(
          `SELECT * FROM ai_uso_diario
           WHERE user_id = $1 AND data = CURRENT_DATE
           ORDER BY provider_slug, modelo`,
          [userId]
        );
        rows = r.rows;
      } else if (periodo === '7d') {
        const r = await pool.query(
          `SELECT * FROM ai_uso_diario
           WHERE user_id = $1 AND data >= CURRENT_DATE - 7
           ORDER BY data DESC, provider_slug`,
          [userId]
        );
        rows = r.rows;
      } else {
        // 30d — usa a view
        const r = await pool.query(
          `SELECT * FROM vw_ai_uso_30d WHERE user_id = $1`,
          [userId]
        );
        rows = r.rows;
      }

      return res.json(rows);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // GET /api/ai/uso/resumo — agregado dos últimos 30 dias
  router.get('/uso/resumo', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId;

      const totalR = await pool.query(
        `SELECT
           COALESCE(SUM(total_mensagens), 0)::int   AS total_mensagens,
           COALESCE(SUM(tokens_entrada), 0)::bigint  AS tokens_entrada,
           COALESCE(SUM(tokens_saida), 0)::bigint    AS tokens_saida,
           COALESCE(SUM(custo_usd), 0)              AS custo_usd_total
         FROM ai_uso_diario
         WHERE user_id = $1 AND data >= CURRENT_DATE - 30`,
        [userId]
      );

      const hojeR = await pool.query(
        `SELECT
           COALESCE(SUM(total_mensagens), 0)::int AS mensagens_hoje,
           COALESCE(SUM(custo_usd), 0)            AS custo_hoje
         FROM ai_uso_diario
         WHERE user_id = $1 AND data = CURRENT_DATE`,
        [userId]
      );

      const porDiaR = await pool.query(
        `SELECT data, SUM(total_mensagens)::int AS total_mensagens,
                SUM(custo_usd) AS custo_usd
         FROM ai_uso_diario
         WHERE user_id = $1 AND data >= CURRENT_DATE - 7
         GROUP BY data ORDER BY data ASC`,
        [userId]
      );

      return res.json({
        ...totalR.rows[0],
        ...hojeR.rows[0],
        por_dia: porDiaR.rows,
      });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // GET /api/ai/conversas
  router.get('/conversas', async (req: AuthRequest, res: Response) => {
    try {
      const r = await pool.query(
        `SELECT * FROM vw_conversas_ativas
         WHERE user_id = $1
         ORDER BY ultima_mensagem DESC LIMIT 50`,
        [req.userId]
      );
      return res.json(r.rows);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  return router;
}
