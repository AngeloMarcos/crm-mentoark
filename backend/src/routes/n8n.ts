import { Router, Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';

function n8nSecretMiddleware(req: Request, res: Response, next: NextFunction) {
  const secret = req.headers['x-n8n-secret'] as string;
  const expected = process.env.N8N_SECRET;
  if (!expected || secret !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

export { n8nSecretMiddleware };

export default function n8nRouter(pool: Pool): Router {
  const router = Router();
  router.use(n8nSecretMiddleware);

  // GET /api/n8n/agente-config/:instancia
  // Alias: GET /api/agentes/by-instancia/:instancia (montado em index.ts)
  router.get('/agente-config/:instancia', async (req: Request, res: Response) => {
    try {
      const r = await pool.query(
        `SELECT id, user_id, nome, modelo, temperatura, max_tokens,
                rag_ativo, rag_threshold, rag_resultados,
                n8n_webhook_url, evolution_api_key, evolution_server_url, ativo
         FROM agentes
         WHERE evolution_instancia = $1 AND ativo = true
         LIMIT 1`,
        [req.params.instancia]
      );
      if (!r.rows.length) return res.status(404).json({ error: 'Agente não encontrado' });
      return res.json(r.rows[0]);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // GET /api/n8n/prompt-ativo?user_id=xxx
  // Alias: GET /api/agent_prompts/ativo (montado em index.ts)
  router.get('/prompt-ativo', async (req: Request, res: Response) => {
    const userId = req.query.user_id as string;
    if (!userId) return res.status(400).json({ error: 'user_id é obrigatório' });
    try {
      const r = await pool.query(
        `SELECT id, nome, conteudo, ativo
         FROM agent_prompts
         WHERE user_id = $1 AND ativo = true
         LIMIT 1`,
        [userId]
      );
      if (!r.rows.length) return res.status(404).json({ error: 'Prompt ativo não encontrado' });
      return res.json(r.rows[0]);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  return router;
}
