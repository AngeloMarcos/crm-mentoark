import { Router, Response } from 'express';
import { Pool } from 'pg';
import { AuthRequest, adminMiddleware } from '../middleware';
import { log } from '../logger';
import { verificarInstanciaAberta, reconciliarInstanciasEvolution } from '../services/evolutionReconciliation';

// [AUDITORIA] LÓGICA: CRUD de `integracoes_config` (Evolution, N8N, OpenAI, etc.),
// consumido por src/pages/Integracoes.tsx ("Conectores"). Quando uma integração do
// tipo 'evolution' é salva com status='conectado', syncEvolution() espelha
// instancia/url/api_key para `agentes` — a tabela que webhook.ts lê PRIMEIRO
// para resolver o userId de mensagens recebidas (antes de cair nos fallbacks
// prefixo UUID/integracoes_config). [AUDITORIA] LÓGICA (Sprint 1 unificação, 2026-08-07):
// antes espelhava pra `agent_configs` (removida desta cadeia — ver
// diagnosticos/SPRINT_UNIFICAR_CONFIGURACAO_AGENTE_IA.md). Diferença importante: `agent_configs`
// tinha UNIQUE(user_id) — um UPSERT simples por user_id bastava. `agentes` permite VÁRIAS linhas
// por usuário (uma por instância/número conectado, sem UNIQUE de banco pra isso — só disciplina
// de aplicação), então o find-or-create abaixo casa por (user_id, evolution_instancia), igual ao
// padrão já usado em saveEvolutionConfig() (routes/whatsapp.ts) pra não divergir de novo.
export default function integracoesRouter(pool: Pool): Router {
  const router = Router();

  // [AUDITORIA] LÓGICA: Wrapper utilitário para capturar exceções assíncronas e retornar erro 500 estruturado, evitando crashes globais do Express.
  const wrap = (fn: Function) => async (req: AuthRequest, res: Response) => {
    try {
      await fn(req, res);
    } catch (err: any) {
      log.error('INTEGRACOES', 'Erro', { err: err?.message, stack: err?.stack });
      res.status(500).json({ message: err.message });
    }
  };

  // [AUDITORIA] LÓGICA: Mascara credenciais sensíveis (API Keys/Tokens) para evitar vazamento de dados no frontend do CRM.
  function maskKey(key: string | null): string | null {
    if (!key) return null;
    if (key.length <= 4) return '****';
    return '****' + key.slice(-4);
  }

  // [AUDITORIA] LÓGICA: Clona a linha de retorno do banco aplicando a máscara de segurança na chave de API.
  function maskRow(row: any) {
    return { ...row, api_key: maskKey(row.api_key) };
  }

  // [AUDITORIA] FIX APLICADO (2026-07-21): syncEvolution() antes confiava cegamente no
  // status='conectado' enviado pelo frontend, sem checar a Evolution de verdade — causava
  // drift entre agentes/integracoes_config e a Evolution real (documentado em
  // AUDITORIA_LOG.md). Agora chama verificarInstanciaAberta() (services/evolutionReconciliation.ts)
  // e só grava em `agentes` se a instância estiver genuinamente connectionStatus:'open'.
  // Sincroniza instância Evolution conectada com `agentes` (find-or-create por user_id+instancia)
  async function syncEvolution(
    userId: string, instancia: string, url: string, apiKey: string
  ) {
    const aberta = await verificarInstanciaAberta(url, apiKey, instancia);
    if (!aberta) {
      log.warn('INTEGRACOES', 'syncEvolution abortado: instância não está open na Evolution', { userId, instancia });
      return;
    }
    // [AUDITORIA] BUG (achado 2026-07-28 — "IA não pode vir ativada sem antes estar
    // configurada"): conectar o WhatsApp aqui já ligava `ativo=true` — cliente novo conecta o
    // número e a IA já sai respondendo com prompt genérico ou de outro tenant, antes mesmo de
    // configurar persona/prompt. [AUDITORIA] FIX APLICADO (preservado na unificação): o UPDATE
    // abaixo nunca toca `ativo`; só o INSERT do caminho "linha nova" a define, e como `false` —
    // nunca desativa um agente que o usuário já ligou de propósito depois de configurar.
    const upd = await pool.query(
      `UPDATE agentes SET evolution_server_url = $1, evolution_api_key = $2, updated_at = NOW()
       WHERE user_id = $3 AND evolution_instancia = $4`,
      [url, apiKey, userId, instancia]
    ).catch(err => { log.warn('INTEGRACOES', 'sync agentes (update)', { err: err?.message, stack: err?.stack }); return null; });
    if (upd && !upd.rowCount) {
      await pool.query(
        `INSERT INTO agentes (user_id, nome, evolution_instancia, evolution_server_url, evolution_api_key, ativo, ativo_motor)
         VALUES ($1, 'Conexão WhatsApp', $2, $3, $4, false, false)`,
        [userId, instancia, url, apiKey]
      ).catch(err => log.warn('INTEGRACOES', 'sync agentes (insert)', { err: err?.message, stack: err?.stack }));
    }
  }

  // ── GET /api/integracoes_config ─────────────────────────────────────────────
  // [AUDITORIA] LÓGICA: Retorna todas as conexões ativas e mascaradas configuradas para o usuário autenticado.
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
      // [AUDITORIA] LÓGICA: Insere a nova integração na tabela integracoes_config com fallback automático para metadados legados.
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

      // Sincronizar com agentes quando Evolution conectada
      if (tipo === 'evolution' && resolvedInstancia && url && resolvedKey && row.status === 'conectado') {
        await syncEvolution(userId, resolvedInstancia, url, resolvedKey);
      }

      return res.status(201).json(maskRow(row));

    } catch (err: any) {
      // Violação de UNIQUE (código 23505) — trata conflito de duplicidade do banco explicitamente para o cliente.
      if (err.code === '23505') {
        return res.status(409).json({
          message: 'Já existe um registro com esses dados. Use o botão Editar para atualizar.',
        });
      }
      throw err;
    }
  }));

  // ── PUT /api/integracoes_config/:id ─────────────────────────────────────────
  // [AUDITORIA] LÓGICA: Atualiza uma integração existente tratando a segurança das chaves mascaradas para evitar sobregravações.
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
      // [AUDITORIA] FIX APLICADO: query dinâmica em vez de COALESCE($N, campo) — COALESCE com null
      // sempre mantinha o valor antigo, então não havia forma de limpar uma URL/chave já salva.
      // Só entram no SET os campos explicitamente enviados (!== undefined), permitindo null real.
      const setParts: string[] = [];
      const vals: any[] = [];
      let placeholderIdx = 1;

      if (nome !== undefined) {
        setParts.push(`nome = $${placeholderIdx++}`);
        vals.push(nome);
      }
      if (url !== undefined) {
        setParts.push(`url = $${placeholderIdx++}`);
        vals.push(url);
      }
      if (resolvedKey !== undefined) {
        setParts.push(`api_key = $${placeholderIdx++}`);
        vals.push(resolvedKey);
      }
      if (resolvedInstancia !== undefined) {
        setParts.push(`instancia = $${placeholderIdx++}`);
        vals.push(resolvedInstancia);
      }
      if (token !== undefined) {
        setParts.push(`token = $${placeholderIdx++}`);
        vals.push(token);
      }
      if (status !== undefined) {
        setParts.push(`status = $${placeholderIdx++}`);
        vals.push(status);
      }
      if (config !== undefined) {
        setParts.push(`config = $${placeholderIdx++}`);
        vals.push(config ? (typeof config === 'string' ? config : JSON.stringify(config)) : null);
      }

      if (setParts.length === 0) {
        const current = await pool.query(
          `SELECT * FROM integracoes_config WHERE id = $1 AND user_id = $2`,
          [req.params.id, userId]
        );
        if (!current.rows.length) return res.status(404).json({ message: 'Não encontrado' });
        return res.json(maskRow(current.rows[0]));
      }

      setParts.push(`updated_at = NOW()`);
      vals.push(req.params.id, userId);

      const r = await pool.query(
        `UPDATE integracoes_config SET ${setParts.join(', ')}
         WHERE id = $${placeholderIdx++} AND user_id = $${placeholderIdx++}
         RETURNING *`,
        vals
      );

      if (!r.rows.length) return res.status(404).json({ message: 'Não encontrado' });

      const row = r.rows[0];

      // [AUDITORIA] LÓGICA: Força sincronização com a tabela do motor IA caso a integração atualizada seja do WhatsApp (Evolution API).
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
  // [AUDITORIA] FIX APLICADO: antes de deletar, se o conector for do tipo 'evolution', limpa a
  // referência espelhada em `agentes` (ver syncEvolution acima) — sem isso o motor de
  // IA/webhook ficava com credenciais órfãs de uma instância já excluída. [AUDITORIA] LÓGICA
  // (Sprint 1 unificação, 2026-08-07): antes limpava `agent_configs` (única por user_id); agora
  // limpa a(s) linha(s) de `agentes` cujo `evolution_instancia` bate exatamente com a instância
  // deletada — deletar uma instância inativa/extra não deve afetar a instância ativa de outro
  // conector do mesmo usuário.
  router.delete('/:id', wrap(async (req: AuthRequest, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: 'Usuário não autenticado' });

    const intRes = await pool.query(
      `SELECT tipo, instancia FROM integracoes_config WHERE id = $1 AND user_id = $2`,
      [req.params.id, userId]
    );

    if (intRes.rows.length && intRes.rows[0].tipo === 'evolution') {
      await pool.query(
        `UPDATE agentes
         SET evolution_instancia = NULL,
             evolution_server_url = NULL,
             evolution_api_key = NULL,
             updated_at = NOW()
         WHERE user_id = $1 AND evolution_instancia IS NOT DISTINCT FROM $2`,
        [userId, intRes.rows[0].instancia]
      ).catch(err => log.warn('INTEGRACOES', 'limpar agentes orfao', { err: err?.message, stack: err?.stack }));
    }

    await pool.query(
      `DELETE FROM integracoes_config WHERE id = $1 AND user_id = $2`,
      [req.params.id, userId]
    );
    return res.status(204).send();
  }));

  // ── POST /api/integracoes_config/reconciliar (admin) ─────────────────────────
  // [AUDITORIA] LÓGICA: Dispara sob demanda a mesma reconciliação que roda automaticamente
  // a cada 15min via cron (ver backend/src/cron.ts) — útil para depuração/correção imediata.
  router.post('/reconciliar', adminMiddleware, wrap(async (_req: AuthRequest, res: Response) => {
    const { corrigidos } = await reconciliarInstanciasEvolution(pool);
    return res.json({ ok: true, corrigidos });
  }));

  return router;
}