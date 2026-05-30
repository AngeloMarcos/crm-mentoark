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

  // GET /api/integracoes_config  — lista todas as integrações do usuário
  router.get('/', wrap(async (req: AuthRequest, res: Response) => {
    const r = await pool.query(
      `SELECT * FROM integracoes_config WHERE user_id = $1 ORDER BY tipo`,
      [req.userId]
    );
    return res.json(r.rows);
  }));

  // GET /api/integracoes_config/:id
  router.get('/:id', wrap(async (req: AuthRequest, res: Response) => {
    const r = await pool.query(
      `SELECT * FROM integracoes_config WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.userId]
    );
    if (!r.rows.length) return res.status(404).json({ message: 'Não encontrado' });
    return res.json(r.rows[0]);
  }));

  // POST /api/integracoes_config  — UPSERT por (user_id, tipo)
  // Sempre usa ON CONFLICT para evitar duplicidade com a constraint UNIQUE(user_id, tipo)
  router.post('/', wrap(async (req: AuthRequest, res: Response) => {
    const { tipo, nome, url, api_key, instancia, token, status, config } = req.body;
    if (!tipo) return res.status(400).json({ message: 'Campo tipo é obrigatório' });

    const r = await pool.query(
      `INSERT INTO integracoes_config
         (user_id, tipo, nome, url, api_key, instancia, token, status, config, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       ON CONFLICT (user_id, tipo) DO UPDATE SET
         nome       = EXCLUDED.nome,
         url        = EXCLUDED.url,
         api_key    = EXCLUDED.api_key,
         instancia  = EXCLUDED.instancia,
         token      = EXCLUDED.token,
         status     = EXCLUDED.status,
         config     = EXCLUDED.config,
         updated_at = NOW()
       RETURNING *`,
      [
        req.userId,
        tipo,
        nome      || tipo,
        url       || null,
        api_key   || null,
        instancia || null,
        token     || null,
        status    || 'ativo',
        config    ? (typeof config === 'string' ? config : JSON.stringify(config)) : '{}',
      ]
    );
    return res.status(201).json(r.rows[0]);
  }));

  // PUT /api/integracoes_config/:id  — atualiza por ID
  router.put('/:id', wrap(async (req: AuthRequest, res: Response) => {
    const { url, api_key, instancia, token, status, config } = req.body;

    const r = await pool.query(
      `UPDATE integracoes_config SET
         url        = COALESCE($1, url),
         api_key    = COALESCE($2, api_key),
         instancia  = COALESCE($3, instancia),
         token      = COALESCE($4, token),
         status     = COALESCE($5, status),
         config     = COALESCE($6, config),
         updated_at = NOW()
       WHERE id = $7 AND user_id = $8
       RETURNING *`,
      [
        url       ?? null,
        api_key   ?? null,
        instancia ?? null,
        token     ?? null,
        status    ?? null,
        config    ? (typeof config === 'string' ? config : JSON.stringify(config)) : null,
        req.params.id,
        req.userId,
      ]
    );
    if (!r.rows.length) return res.status(404).json({ message: 'Não encontrado' });
    return res.json(r.rows[0]);
  }));

  // PATCH /api/integracoes_config/tipo/:tipo  — upsert direto pelo tipo (mais conveniente pro frontend)
  router.patch('/tipo/:tipo', wrap(async (req: AuthRequest, res: Response) => {
    const { tipo } = req.params;
    const { url, api_key, instancia, token, status, config } = req.body;

    const r = await pool.query(
      `INSERT INTO integracoes_config
         (user_id, tipo, url, api_key, instancia, token, status, config, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (user_id, tipo) DO UPDATE SET
         url        = COALESCE(EXCLUDED.url,       integracoes_config.url),
         api_key    = COALESCE(EXCLUDED.api_key,   integracoes_config.api_key),
         instancia  = COALESCE(EXCLUDED.instancia, integracoes_config.instancia),
         token      = COALESCE(EXCLUDED.token,     integracoes_config.token),
         status     = COALESCE(EXCLUDED.status,    integracoes_config.status),
         config     = COALESCE(EXCLUDED.config,    integracoes_config.config),
         updated_at = NOW()
       RETURNING *`,
      [
        req.userId,
        tipo,
        url       || null,
        api_key   || null,
        instancia || null,
        token     || null,
        status    || 'ativo',
        config    ? (typeof config === 'string' ? config : JSON.stringify(config)) : '{}',
      ]
    );
    return res.json(r.rows[0]);
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
