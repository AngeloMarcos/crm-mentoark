/**
 * organizacao.ts — cadastros da estrutura organizacional do tenant:
 * /api/departamentos, /api/filiais, /api/squads.
 *
 * [AUDITORIA] LÓGICA (2026-09-10 — Fase 4b): escopo por TENANT (`resolverOwnerId`), não por
 * usuário — todo mundo do time vê/usa os mesmos cadastros. Leitura liberada a qualquer usuário
 * autenticado (pra preencher os selects); escrita só admin.
 */
import { Router, Response } from 'express';
import { Pool } from 'pg';
import { AuthRequest, adminMiddleware } from '../middleware';
import { log } from '../logger';
import { resolverOwnerId } from '../services/subscription';

const TABELAS = new Set(['departamentos', 'filiais', 'squads']);

export default function organizacaoRouter(pool: Pool, tabela: string): Router {
  if (!TABELAS.has(tabela)) throw new Error(`organizacaoRouter: tabela inválida "${tabela}"`);
  const router = Router();

  const wrap = (fn: Function) => async (req: AuthRequest, res: Response) => {
    try { await fn(req, res); }
    catch (err: any) {
      log.error('ORGANIZACAO', `Erro em ${tabela}`, { err: err?.message });
      res.status(500).json({ message: err.message });
    }
  };

  // GET /api/<tabela>?incluir_inativos=1
  router.get('/', wrap(async (req: AuthRequest, res: Response) => {
    const ownerId = await resolverOwnerId(pool, req.userId!);
    const incluirInativos = req.query.incluir_inativos === '1' || req.query.incluir_inativos === 'true';
    const r = await pool.query(
      `SELECT id, nome, ativo, created_at FROM ${tabela}
       WHERE owner_id = $1 ${incluirInativos ? '' : 'AND ativo = true'}
       ORDER BY nome ASC`,
      [ownerId]
    );
    return res.json(r.rows);
  }));

  // POST /api/<tabela>  { nome }
  router.post('/', adminMiddleware, wrap(async (req: AuthRequest, res: Response) => {
    const ownerId = await resolverOwnerId(pool, req.userId!);
    const nome = String(req.body?.nome ?? '').trim().slice(0, 120);
    if (!nome) return res.status(400).json({ message: 'nome é obrigatório' });
    try {
      const r = await pool.query(
        `INSERT INTO ${tabela} (owner_id, nome) VALUES ($1, $2) RETURNING id, nome, ativo, created_at`,
        [ownerId, nome]
      );
      return res.status(201).json(r.rows[0]);
    } catch (err: any) {
      if (err.code === '23505') return res.status(409).json({ message: 'Já existe um item com esse nome.' });
      throw err;
    }
  }));

  // PATCH /api/<tabela>/:id  { nome?, ativo? }
  router.patch('/:id', adminMiddleware, wrap(async (req: AuthRequest, res: Response) => {
    const ownerId = await resolverOwnerId(pool, req.userId!);
    const sets: string[] = ['updated_at = now()'];
    const params: any[] = [];
    if (req.body?.nome !== undefined) { params.push(String(req.body.nome).trim().slice(0, 120)); sets.push(`nome = $${params.length}`); }
    if (req.body?.ativo !== undefined) { params.push(!!req.body.ativo); sets.push(`ativo = $${params.length}`); }
    if (sets.length === 1) return res.status(400).json({ message: 'Nada para atualizar' });
    params.push(req.params.id, ownerId);
    const r = await pool.query(
      `UPDATE ${tabela} SET ${sets.join(', ')} WHERE id = $${params.length - 1} AND owner_id = $${params.length} RETURNING id, nome, ativo`,
      params
    );
    if (!r.rows.length) return res.status(404).json({ message: 'Não encontrado' });
    return res.json(r.rows[0]);
  }));

  // DELETE /api/<tabela>/:id — hard delete (a FK em users é ON DELETE SET NULL)
  router.delete('/:id', adminMiddleware, wrap(async (req: AuthRequest, res: Response) => {
    const ownerId = await resolverOwnerId(pool, req.userId!);
    await pool.query(`DELETE FROM ${tabela} WHERE id = $1 AND owner_id = $2`, [req.params.id, ownerId]);
    return res.status(204).send();
  }));

  return router;
}
