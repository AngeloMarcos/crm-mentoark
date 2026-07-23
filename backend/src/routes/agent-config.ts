import { Router, Response } from 'express';
import { Pool } from 'pg';
import { AuthRequest } from '../middleware';
import { log } from '../logger';

export default function agentConfigRouter(pool: Pool): Router {
  const router = Router();

  const wrap = (fn: Function) => async (req: AuthRequest, res: Response) => {
    try { await fn(req, res); }
    catch (err: any) {
      log.error('AGENT_CONFIG', 'Erro', { err: err?.message, stack: err?.stack });
      res.status(500).json({ message: err.message });
    }
  };

  // GET /api/agent-config — lê config do usuário autenticado
  router.get('/', wrap(async (req: AuthRequest, res: Response) => {
    const r = await pool.query(
      `SELECT * FROM agent_configs WHERE user_id = $1 AND ativo = true LIMIT 1`,
      [req.userId]
    );
    return res.json(r.rows[0] ?? null);
  }));

  // POST /api/agent-config — UPSERT único por user_id
  // Aceita qualquer subconjunto dos campos; os não enviados mantêm valor atual.
  router.post('/', wrap(async (req: AuthRequest, res: Response) => {
    const {
      prompt_sistema,
      nome_agente,
      sinal_pausa,
      palavra_reativar,
      modelo_llm,
      modelo_parser,
      saudacao_inicial,
      bloco_qualificacao,
      mensagem_encaminhamento,
      mensagem_encerramento,
      tempo_espera_mensagem,
      tempo_espera_resposta,
      grupo_notificacao,
      evolution_server_url,
      evolution_api_key,
      evolution_instancia,
      operation_mode,
      distribution_mode,
      ativo,
    } = req.body;

    const r = await pool.query(
      `INSERT INTO agent_configs
         (user_id, prompt_sistema, nome_agente, sinal_pausa, palavra_reativar,
          modelo_llm, modelo_parser, saudacao_inicial, bloco_qualificacao,
          mensagem_encaminhamento, mensagem_encerramento,
          tempo_espera_mensagem, tempo_espera_resposta, grupo_notificacao,
          evolution_server_url, evolution_api_key, evolution_instancia,
          operation_mode, distribution_mode, ativo, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         prompt_sistema          = COALESCE(EXCLUDED.prompt_sistema,          agent_configs.prompt_sistema),
         nome_agente             = COALESCE(EXCLUDED.nome_agente,             agent_configs.nome_agente),
         sinal_pausa             = COALESCE(EXCLUDED.sinal_pausa,             agent_configs.sinal_pausa),
         palavra_reativar        = COALESCE(EXCLUDED.palavra_reativar,        agent_configs.palavra_reativar),
         modelo_llm              = COALESCE(EXCLUDED.modelo_llm,              agent_configs.modelo_llm),
         modelo_parser           = COALESCE(EXCLUDED.modelo_parser,           agent_configs.modelo_parser),
         saudacao_inicial        = COALESCE(EXCLUDED.saudacao_inicial,        agent_configs.saudacao_inicial),
         bloco_qualificacao      = COALESCE(EXCLUDED.bloco_qualificacao,      agent_configs.bloco_qualificacao),
         mensagem_encaminhamento = COALESCE(EXCLUDED.mensagem_encaminhamento, agent_configs.mensagem_encaminhamento),
         mensagem_encerramento   = COALESCE(EXCLUDED.mensagem_encerramento,   agent_configs.mensagem_encerramento),
         tempo_espera_mensagem   = COALESCE(EXCLUDED.tempo_espera_mensagem,   agent_configs.tempo_espera_mensagem),
         tempo_espera_resposta   = COALESCE(EXCLUDED.tempo_espera_resposta,   agent_configs.tempo_espera_resposta),
         grupo_notificacao       = COALESCE(EXCLUDED.grupo_notificacao,       agent_configs.grupo_notificacao),
         evolution_server_url    = COALESCE(EXCLUDED.evolution_server_url,    agent_configs.evolution_server_url),
         evolution_api_key       = COALESCE(EXCLUDED.evolution_api_key,       agent_configs.evolution_api_key),
         evolution_instancia     = COALESCE(EXCLUDED.evolution_instancia,     agent_configs.evolution_instancia),
         operation_mode          = COALESCE(EXCLUDED.operation_mode,          agent_configs.operation_mode),
         distribution_mode       = COALESCE(EXCLUDED.distribution_mode,       agent_configs.distribution_mode),
         ativo                   = COALESCE(EXCLUDED.ativo,                   agent_configs.ativo),
         updated_at              = NOW()
       RETURNING *`,
      [
        req.userId,
        prompt_sistema ?? null,
        nome_agente ?? null,
        sinal_pausa ?? null,
        palavra_reativar ?? null,
        modelo_llm ?? null,
        modelo_parser ?? null,
        saudacao_inicial ?? null,
        bloco_qualificacao ?? null,
        mensagem_encaminhamento ?? null,
        mensagem_encerramento ?? null,
        tempo_espera_mensagem ?? null,
        tempo_espera_resposta ?? null,
        grupo_notificacao ?? null,
        evolution_server_url ?? null,
        evolution_api_key ?? null,
        evolution_instancia ?? null,
        operation_mode ?? null,
        distribution_mode ?? null,
        ativo ?? true,
      ]
    );
    return res.json(r.rows[0]);
  }));

  // PUT /api/agent-config — alias do POST (compatibilidade com clientes que usam PUT)
  router.put('/', wrap(async (req: AuthRequest, res: Response) => {
    req.method = 'POST';
    return router.handle(req as any, res, () => {});
  }));

  // PATCH /api/agent-config — atualiza campos parcialmente
  router.patch('/', wrap(async (req: AuthRequest, res: Response) => {
    const data = { ...req.body };
    delete data.id;
    delete data.user_id;
    delete data.created_at;

    const cols = Object.keys(data).filter(k => /^[a-z_]+$/.test(k));
    if (!cols.length) return res.status(400).json({ message: 'Nenhum campo enviado' });

    const setClauses = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
    const vals = [req.userId, ...cols.map(k => data[k])];

    const r = await pool.query(
      `UPDATE agent_configs SET ${setClauses}, updated_at = NOW()
       WHERE user_id = $1 RETURNING *`,
      vals
    );
    if (!r.rows.length) return res.status(404).json({ message: 'Config não encontrada' });
    return res.json(r.rows[0]);
  }));

  return router;
}
