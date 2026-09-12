/**
 * admin_assinaturas.ts — painel do MASTER do sistema (MASTER_EMAILS) para gerenciar o trial /
 * assinatura de cada tenant. Montado com o middleware `masterOnly` em index.ts.
 *
 * [AUDITORIA] LÓGICA (2026-09-10 — Fase 3 do trial de 3 dias): reativação é MANUAL (decisão do
 * usuário) — este painel é a ferramenta. Ativar marca `ativada_em`/`ativada_por`. Estender soma
 * dias ao `trial_fim` e volta o status pra `trial`. Toda mudança invalida o cache de
 * `subscription.ts` pro efeito ser imediato.
 */
import { Router, Response } from 'express';
import { Pool } from 'pg';
import { AuthRequest } from '../middleware';
import { log } from '../logger';
import { invalidarAssinaturaCache } from '../services/subscription';

export default function adminAssinaturasRouter(pool: Pool): Router {
  const router = Router();

  const wrap = (fn: Function) => async (req: AuthRequest, res: Response) => {
    try { await fn(req, res); }
    catch (err: any) {
      log.error('ADMIN_ASSINATURAS', 'Erro', { err: err?.message, stack: err?.stack });
      res.status(500).json({ message: err.message });
    }
  };

  // GET /api/admin/assinaturas — lista todos os tenants + status + dono + pedidos abertos
  router.get('/', wrap(async (req: AuthRequest, res: Response) => {
    const busca = String(req.query.busca ?? '').trim().toLowerCase();
    const statusFiltro = String(req.query.status ?? '').trim();

    const cond: string[] = [];
    const params: any[] = [];
    if (busca) {
      params.push(`%${busca}%`);
      cond.push(`(lower(u.email) LIKE $${params.length} OR lower(u.display_name) LIKE $${params.length})`);
    }
    if (statusFiltro && ['trial', 'ativa', 'expirada'].includes(statusFiltro)) {
      params.push(statusFiltro);
      cond.push(`a.status = $${params.length}`);
    }
    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';

    const r = await pool.query(
      `SELECT
         a.owner_id, a.status, a.plano, a.trial_inicio, a.trial_fim,
         a.ativada_em, a.ativada_por, a.observacao, a.updated_at,
         u.email, u.display_name, u.role, u.active, u.created_at AS conta_criada_em, u.last_login_at,
         (SELECT count(*)::int FROM users m WHERE m.owner_id = a.owner_id) AS membros,
         (SELECT count(*)::int FROM assinatura_solicitacoes s WHERE s.owner_id = a.owner_id AND s.atendida = false) AS pedidos_abertos,
         CASE
           WHEN a.status = 'trial' AND a.trial_fim IS NOT NULL
           THEN GREATEST(0, CEIL(EXTRACT(EPOCH FROM (a.trial_fim - now())) / 86400))::int
           ELSE 0
         END AS dias_restantes
       FROM assinaturas a
       JOIN users u ON u.id = a.owner_id
       ${where}
       ORDER BY
         CASE a.status WHEN 'expirada' THEN 0 WHEN 'trial' THEN 1 ELSE 2 END,
         a.trial_fim ASC NULLS LAST,
         u.created_at DESC
       LIMIT 500`,
      params
    );
    return res.json(r.rows);
  }));

  // PATCH /api/admin/assinaturas/:ownerId — { status?, plano?, dias_extra?, observacao? }
  router.patch('/:ownerId', wrap(async (req: AuthRequest, res: Response) => {
    const { ownerId } = req.params;
    const { status, plano, dias_extra, observacao } = req.body ?? {};

    const existe = await pool.query(`SELECT 1 FROM assinaturas WHERE owner_id = $1`, [ownerId]);
    if (!existe.rows.length) return res.status(404).json({ message: 'Assinatura não encontrada' });

    const sets: string[] = ['updated_at = now()'];
    const params: any[] = [];

    if (status && ['trial', 'ativa', 'expirada'].includes(status)) {
      params.push(status);
      sets.push(`status = $${params.length}`);
      if (status === 'ativa') {
        params.push(req.userId);
        sets.push(`ativada_em = now()`, `ativada_por = $${params.length}`);
      }
    }

    if (plano && typeof plano === 'string') {
      params.push(plano.slice(0, 40));
      sets.push(`plano = $${params.length}`);
    }

    const diasExtra = Number(dias_extra);
    if (Number.isFinite(diasExtra) && diasExtra !== 0) {
      params.push(Math.trunc(diasExtra));
      // estende a partir do maior entre (trial_fim atual, agora) — nunca "perde" tempo já dado
      sets.push(`trial_fim = GREATEST(COALESCE(trial_fim, now()), now()) + ($${params.length} || ' days')::interval`);
      // reabrir como trial se estava expirada/ativa e o master está dando mais dias
      if (!status) sets.push(`status = 'trial'`);
      if (!sets.some(s => s.startsWith('trial_inicio'))) sets.push(`trial_inicio = COALESCE(trial_inicio, now())`);
    }

    if (observacao !== undefined) {
      params.push(observacao === null ? null : String(observacao).slice(0, 1000));
      sets.push(`observacao = $${params.length}`);
    }

    if (sets.length === 1) return res.status(400).json({ message: 'Nada para atualizar' });

    params.push(ownerId);
    const r = await pool.query(
      `UPDATE assinaturas SET ${sets.join(', ')} WHERE owner_id = $${params.length} RETURNING *`,
      params
    );

    invalidarAssinaturaCache(ownerId);
    log.info('ADMIN_ASSINATURAS', 'Assinatura alterada pelo master', {
      ownerId, por: req.userId, status, dias_extra: diasExtra, plano,
    });
    return res.json(r.rows[0]);
  }));

  // GET /api/admin/assinaturas/solicitacoes — pedidos de reativação (abertos por padrão)
  router.get('/solicitacoes', wrap(async (req: AuthRequest, res: Response) => {
    const todas = req.query.todas === '1' || req.query.todas === 'true';
    const r = await pool.query(
      `SELECT s.id, s.owner_id, s.solicitado_por, s.mensagem, s.atendida, s.created_at,
              u.email AS dono_email, u.display_name AS dono_nome,
              a.status AS assinatura_status
       FROM assinatura_solicitacoes s
       JOIN users u ON u.id = s.owner_id
       LEFT JOIN assinaturas a ON a.owner_id = s.owner_id
       ${todas ? '' : 'WHERE s.atendida = false'}
       ORDER BY s.created_at DESC
       LIMIT 300`
    );
    return res.json(r.rows);
  }));

  // POST /api/admin/assinaturas/solicitacoes/:id/atender
  router.post('/solicitacoes/:id/atender', wrap(async (req: AuthRequest, res: Response) => {
    const r = await pool.query(
      `UPDATE assinatura_solicitacoes SET atendida = true WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ message: 'Pedido não encontrado' });
    return res.json({ ok: true });
  }));

  return router;
}
