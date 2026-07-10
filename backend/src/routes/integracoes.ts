import { Router, Response } from 'express';
import { Pool } from 'pg';
import { AuthRequest } from '../middleware';
import { log } from '../logger';

// [AUDITORIA] LÓGICA: CRUD de `integracoes_config` (Evolution, N8N, OpenAI, etc.),
// consumido por src/pages/Integracoes.tsx ("Conectores"). Quando uma integração do
// tipo 'evolution' é salva com status='conectado', syncEvolution() espelha
// instancia/url/api_key para agent_configs — a tabela que webhook.ts lê PRIMEIRO
// para resolver o userId de mensagens recebidas (antes de cair nos fallbacks
// agentes/integracoes_config/prefixo UUID). Ver BUG em syncEvolution() abaixo.
export default function integracoesRouter(pool: Pool): Router {
  const router = Router();

  const wrap = (fn: Function) => async (req: AuthRequest, res: Response) => {
    try {
      await fn(req, res);
    } catch (err: any) {
      log.error('INTEGRACOES', 'Erro', { err: err?.message, stack: err?.stack });
      res.status(500).json({ message: err.message });
    }
  };

  // Máscara a api_key — expõe apenas os últimos 4 chars
  function maskKey(key: string | null): string | null {
    if (!key) return null;
    if (key.length <= 4) return '****';
    return '****' + key.slice(-4);
  }

  function maskRow(row: any) {
    return { ...row, api_key: maskKey(row.api_key) };
  }

  // [AUDITORIA] BUG: syncEvolution() é chamada sempre que o registro salvo em
  // integracoes_config tem status==='conectado' — mas esse status vem direto do
  // corpo da requisição (POST/PUT), escrito pelo frontend em Integracoes.tsx.
  // O frontend, por sua vez, seta status='conectado' apenas com base em
  // `/instance/fetchInstances` responder HTTP 200 (API key válida), SEM checar se a
  // instância específica está de fato pareada (connectionStatus==='open'). Resultado:
  // uma instância presa em loop de QR (nunca pareada) pode ser marcada 'conectado' e
  // sobrescrever agent_configs com uma instancia errada/obsoleta — bate exatamente
  // com a divergência já documentada em AUDITORIA_LOG.md (agent_configs.evolution_instancia
  // ='teste' enquanto agentes/integracoes_config tinham a instância correta).
  // FIX PENDENTE (motivo: validar de verdade exigiria o backend chamar a Evolution API
  // (serviço externo) antes de confiar no status enviado pelo cliente — mudança de
  // modelo de confiança em rota de produção, precisa decisão do usuário sobre se vale
  // a latência extra numa chamada síncrona). Mitigação parcial aplicada no frontend:
  // ver [AUDITORIA] FIX APLICADO em Integracoes.tsx (testar() agora só marca
  // 'conectado' se a instância aparecer com connectionStatus:'open' na resposta).
  // Sincroniza instância Evolution conectada com agent_configs
  async function syncEvolution(
    userId: string, instancia: string, url: string, apiKey: string
  ) {
    await pool.query(
      `INSERT INTO agent_configs
         (user_id, evolution_instancia, evolution_server_url, evolution_api_key, ativo)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (user_id) DO UPDATE SET
         evolution_instancia  = EXCLUDED.evolution_instancia,
         evolution_server_url = EXCLUDED.evolution_server_url,
         evolution_api_key    = EXCLUDED.evolution_api_key,
         updated_at           = NOW()`,
      [userId, instancia, url, apiKey]
    ).catch(err => log.warn('INTEGRACOES', 'sync agent_configs', { err: err?.message, stack: err?.stack }));
  }

  // ── GET /api/integracoes_config ─────────────────────────────────────────────
  router.get('/', wrap(async (req: AuthRequest, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: 'Usuário não autenticado' });

    const r = await pool.query(
      `SELECT * FROM integracoes_config WHERE user_id = $1 ORDER BY tipo, created_at`,
      [userId]
    );
    return res.json(r.rows.map(maskRow));
  }));

  // ── POST /api/integracoes_config ────────────────────────────────────────────
  // Aceita tanto 'api_key' quanto 'token' (compatibilidade com payloads legados)
  // Aceita tanto 'instancia' quanto 'name' / 'instance_name'
  router.post('/', wrap(async (req: AuthRequest, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: 'Usuário não autenticado' });

    const {
      tipo, nome,
      url,
      api_key, token,                                    // aceita ambos
      instancia, name, instance_name,                    // aceita ambos
      status, config,
    } = req.body;

    if (!tipo) return res.status(400).json({ message: 'tipo é obrigatório' });

    const resolvedKey      = api_key || token || null;
    const resolvedInstancia = instancia || name || instance_name || null;

    // Verificar duplicata exata (mesmo tipo + instância) para dar mensagem clara
    if (resolvedInstancia) {
      const dup = await pool.query(
        `SELECT id FROM integracoes_config WHERE user_id = $1 AND tipo = $2 AND instancia = $3`,
        [userId, tipo, resolvedInstancia]
      );
      if (dup.rows.length) {
        return res.status(409).json({
          message: `Já existe uma integração do tipo "${tipo}" com a instância "${resolvedInstancia}". Edite o registro existente.`,
          existing_id: dup.rows[0].id,
        });
      }
    }

    try {
      const r = await pool.query(
        `INSERT INTO integracoes_config
           (user_id, tipo, nome, url, api_key, instancia, token, status, config, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
         RETURNING *`,
        [
          userId,
          tipo,
          nome          || tipo,
          url           || null,
          resolvedKey,
          resolvedInstancia,
          token         || null,
          status        || 'inativo',
          config
            ? (typeof config === 'string' ? config : JSON.stringify(config))
            : '{}',
        ]
      );

      const row = r.rows[0];

      // Sincronizar com agent_configs quando Evolution conectada
      if (tipo === 'evolution' && resolvedInstancia && url && resolvedKey && row.status === 'conectado') {
        await syncEvolution(userId, resolvedInstancia, url, resolvedKey);
      }

      return res.status(201).json(maskRow(row));

    } catch (err: any) {
      // Violação de UNIQUE (código 23505) — trata conflito explicitamente
      if (err.code === '23505') {
        return res.status(409).json({
          message: 'Já existe um registro com esses dados. Use o botão Editar para atualizar.',
        });
      }
      throw err;
    }
  }));

  // ── PUT /api/integracoes_config/:id ─────────────────────────────────────────
  router.put('/:id', wrap(async (req: AuthRequest, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: 'Usuário não autenticado' });

    const {
      nome, url,
      api_key, token,
      instancia, name, instance_name,
      status, config,
    } = req.body;

    // Se o valor enviado começar com a máscara, ignoramos para não sobrescrever a chave real
    const isMasked = (val: string | undefined) => typeof val === 'string' && val.startsWith('****');

    const resolvedKey = (api_key !== undefined && !isMasked(api_key)) ? api_key
                      : (token !== undefined && !isMasked(token)) ? token
                      : undefined;
                      
    const resolvedInstancia = instancia     !== undefined ? instancia
                            : name          !== undefined ? name
                            : instance_name !== undefined ? instance_name
                            : undefined;

    try {
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
          nome              ?? null,
          url               ?? null,
          resolvedKey       ?? null,
          resolvedInstancia ?? null,
          token             ?? null,
          status            ?? null,
          config
            ? (typeof config === 'string' ? config : JSON.stringify(config))
            : null,
          req.params.id,
          userId,
        ]
      );

      if (!r.rows.length) return res.status(404).json({ message: 'Não encontrado' });

      const row = r.rows[0];

      if (row.tipo === 'evolution' && row.instancia && row.url && row.api_key && row.status === 'conectado') {
        await syncEvolution(userId, row.instancia, row.url, row.api_key);
      }

      return res.json(maskRow(row));

    } catch (err: any) {
      if (err.code === '23505') {
        return res.status(409).json({ message: 'Conflito: instância duplicada para este tipo.' });
      }
      throw err;
    }
  }));

  // ── DELETE /api/integracoes_config/:id ──────────────────────────────────────
  router.delete('/:id', wrap(async (req: AuthRequest, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: 'Usuário não autenticado' });

    await pool.query(
      `DELETE FROM integracoes_config WHERE id = $1 AND user_id = $2`,
      [req.params.id, userId]
    );
    return res.status(204).send();
  }));

  return router;
}
