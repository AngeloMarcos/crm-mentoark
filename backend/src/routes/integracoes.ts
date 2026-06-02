import { Router, Response } from 'express';
import { Pool } from 'pg';
import { AuthRequest } from '../middleware';

export default function integracoesRouter(pool: Pool): Router {
  const router = Router();

  const wrap = (fn: Function) => async (req: AuthRequest, res: Response) => {
    try {
      await fn(req, res);
    } catch (err: any) {
      console.error('[integracoes]', err.message);
      res.status(500).json({ message: err.message });
    }
  };

  // Sincroniza instância Evolution com agent_configs (fonte de verdade do webhook)
  async function syncEvolutionToAgentConfig(
    userId: string, instancia: string, url: string, apiKey: string, status: string
  ) {
    if (status !== 'conectado') return;
    await pool.query(
      `INSERT INTO agent_configs (user_id, evolution_instancia, evolution_server_url, evolution_api_key, ativo)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (user_id) DO UPDATE SET
         evolution_instancia  = EXCLUDED.evolution_instancia,
         evolution_server_url = EXCLUDED.evolution_server_url,
         evolution_api_key    = EXCLUDED.evolution_api_key,
         updated_at           = NOW()`,
      [userId, instancia, url, apiKey]
    ).catch(err => console.warn('[integracoes] sync agent_configs:', err.message));
  }

  // GET /api/integracoes_config
  router.get('/', wrap(async (req: AuthRequest, res: Response) => {
    const r = await pool.query(
      `SELECT * FROM integracoes_config WHERE user_id = $1 ORDER BY tipo, created_at`,
      [req.userId]
    );
    return res.json(r.rows);
  }));

  // POST /api/integracoes_config — cria nova integração (sem UPSERT, permite múltiplas por tipo)
  router.post('/', wrap(async (req: AuthRequest, res: Response) => {
    const { tipo, nome, url, api_key, instancia, token, status, config } = req.body;
    if (!tipo) return res.status(400).json({ message: 'tipo é obrigatório' });

    const r = await pool.query(
      `INSERT INTO integracoes_config
         (user_id, tipo, nome, url, api_key, instancia, token, status, config, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
       RETURNING *`,
      [
        req.userId, tipo,
        nome      || tipo,
        url       || null,
        api_key   || null,
        instancia || null,
        token     || null,
        status    || 'inativo',
        config ? (typeof config === 'string' ? config : JSON.stringify(config)) : '{}',
      ]
    );

    const row = r.rows[0];
    if (tipo === 'evolution' && instancia && url && api_key) {
      await syncEvolutionToAgentConfig(req.userId!, instancia, url, api_key, row.status);
    }

    return res.status(201).json(row);
  }));

  // PUT /api/integracoes_config/:id — atualiza por ID
  router.put('/:id', wrap(async (req: AuthRequest, res: Response) => {
    const { nome, url, api_key, instancia, token, status, config } = req.body;

    const r = await pool.query(
      `UPDATE integracoes_config SET
         nome       = COALESCE($1, nome),
         url        = COALESCE($2, url),
         api_key    = COALESCE($3, api_key),
         instancia  = COALESCE($4, instancia),
         token      = COALESCE($5, token),
         status     = COALESCE($6, status),
         config     = COALESCE($7, config),
         updated_at = NOW()
       WHERE id = $8 AND user_id = $9
       RETURNING *`,
      [
        nome      ?? null,
        url       ?? null,
        api_key   ?? null,
        instancia ?? null,
        token     ?? null,
        status    ?? null,
        config ? (typeof config === 'string' ? config : JSON.stringify(config)) : null,
        req.params.id,
        req.userId,
      ]
    );

    if (!r.rows.length) return res.status(404).json({ message: 'Não encontrado' });

    const row = r.rows[0];
    if (row.tipo === 'evolution' && row.instancia && row.url && row.api_key) {
      await syncEvolutionToAgentConfig(req.userId!, row.instancia, row.url, row.api_key, row.status);
    }

    return res.json(row);
  }));

  // DELETE /api/integracoes_config/:id
  router.delete('/:id', wrap(async (req: AuthRequest, res: Response) => {
    await pool.query(
      `DELETE FROM integracoes_config WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.userId]
    );
    return res.status(204).send();
  }));

  return router;
}
