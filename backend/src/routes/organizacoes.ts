/**
 * organizacoes.ts — `/api/organizacoes` (2026-11-12, lacuna P3 do Cubo: empresa do contato como
 * entidade). Escopo por CONTA (users.owner_id), como motivos/campos: a organização é compartilhada
 * pela equipe; `contatos.organizacao_id` aponta para ela (excluir organização solta os contatos —
 * ON DELETE SET NULL). `contatos.empresa` (texto livre) continua existindo, sem migração automática.
 */
import { Router, Response } from 'express';
import { Pool } from 'pg';
import { AuthRequest } from '../middleware';
import { log } from '../logger';
import { resolverOwnerId } from '../services/subscription';

const ehUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export const CAMPOS_ORG = ['nome', 'site', 'telefone', 'cidade', 'estado', 'notas'] as const;

/** Valida o corpo de criação/edição. `parcial` = edição. */
export function validarOrganizacao(body: any, parcial: boolean): { ok: true; dados: Record<string, string | null> } | { ok: false; erro: string } {
  const dados: Record<string, string | null> = {};
  for (const campo of CAMPOS_ORG) {
    if (body?.[campo] === undefined) continue;
    const v = body[campo];
    if (v !== null && typeof v !== 'string') return { ok: false, erro: `${campo} deve ser texto.` };
    dados[campo] = v === null ? null : v.trim().slice(0, campo === 'notas' ? 5000 : 200) || null;
  }
  if (!parcial || body?.nome !== undefined) {
    if (!dados.nome) return { ok: false, erro: 'Informe o nome da organização.' };
    if (dados.nome.length > 120) return { ok: false, erro: 'Nome até 120 caracteres.' };
  }
  return { ok: true, dados };
}

export default function organizacoesRouter(pool: Pool): Router {
  const router = Router();

  const falha = (res: Response, err: any, contexto: string) => {
    log.error('ORGANIZACOES', contexto, { err: err?.message });
    return res.status(500).json({ message: 'Erro ao processar organizações.' });
  };
  // Contatos da conta inteira (dono + membros criaram linhas com user_id próprio em alguns fluxos).
  // Recebe o placeholder do ownerId, que NEM SEMPRE é $1 — as duas ocorrências precisam do mesmo.
  const usuariosDaConta = (ph: string) => `SELECT id FROM users WHERE id = ${ph} OR owner_id = ${ph}`;

  router.get('/', async (req: AuthRequest, res: Response) => {
    try {
      const ownerId = await resolverOwnerId(pool, req.userId!);
      const busca = String(req.query.search || '').trim();
      const r = await pool.query(
        `SELECT o.*, (SELECT count(*) FROM contatos c WHERE c.organizacao_id = o.id)::int AS contatos
           FROM organizacoes o
          WHERE o.user_id = $1 AND ($2 = '' OR o.nome ILIKE '%' || $2 || '%')
          ORDER BY lower(o.nome)`, [ownerId, busca]);
      return res.json(r.rows);
    } catch (err) { return falha(res, err, 'Falha ao listar'); }
  });

  router.get('/:id', async (req: AuthRequest, res: Response) => {
    try {
      if (!ehUuid(req.params.id)) return res.status(404).json({ message: 'Organização não encontrada.' });
      const ownerId = await resolverOwnerId(pool, req.userId!);
      const org = (await pool.query(`SELECT * FROM organizacoes WHERE id = $1 AND user_id = $2`, [req.params.id, ownerId])).rows[0];
      if (!org) return res.status(404).json({ message: 'Organização não encontrada.' });
      const contatos = await pool.query(
        `SELECT id, nome, telefone, email, cargo, status FROM contatos
          WHERE organizacao_id = $1 AND user_id IN (${usuariosDaConta('$2')})
          ORDER BY lower(nome) LIMIT 500`, [org.id, ownerId]);
      return res.json({ ...org, contatos: contatos.rows });
    } catch (err) { return falha(res, err, 'Falha ao detalhar'); }
  });

  router.post('/', async (req: AuthRequest, res: Response) => {
    try {
      const v = validarOrganizacao(req.body, false);
      if (!v.ok) return res.status(400).json({ message: v.erro });
      const ownerId = await resolverOwnerId(pool, req.userId!);
      const cols = Object.keys(v.dados);
      const r = await pool.query(
        `INSERT INTO organizacoes (user_id, ${cols.join(', ')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING *`,
        [ownerId, ...cols.map(c => v.dados[c])]);
      return res.status(201).json({ ...r.rows[0], contatos: 0 });
    } catch (err: any) {
      if (err?.code === '23505') return res.status(409).json({ message: 'Já existe uma organização com este nome.' });
      return falha(res, err, 'Falha ao criar');
    }
  });

  router.patch('/:id', async (req: AuthRequest, res: Response) => {
    try {
      if (!ehUuid(req.params.id)) return res.status(404).json({ message: 'Organização não encontrada.' });
      const v = validarOrganizacao(req.body, true);
      if (!v.ok) return res.status(400).json({ message: v.erro });
      const cols = Object.keys(v.dados);
      if (!cols.length) return res.status(400).json({ message: 'Nada para atualizar.' });
      const ownerId = await resolverOwnerId(pool, req.userId!);
      const r = await pool.query(
        `UPDATE organizacoes SET ${cols.map((c, i) => `${c} = $${i + 3}`).join(', ')}, updated_at = NOW()
          WHERE id = $1 AND user_id = $2 RETURNING *`, [req.params.id, ownerId, ...cols.map(c => v.dados[c])]);
      if (!r.rowCount) return res.status(404).json({ message: 'Organização não encontrada.' });
      return res.json(r.rows[0]);
    } catch (err: any) {
      if (err?.code === '23505') return res.status(409).json({ message: 'Já existe uma organização com este nome.' });
      return falha(res, err, 'Falha ao editar');
    }
  });

  router.delete('/:id', async (req: AuthRequest, res: Response) => {
    try {
      if (!ehUuid(req.params.id)) return res.status(404).json({ message: 'Organização não encontrada.' });
      const ownerId = await resolverOwnerId(pool, req.userId!);
      const r = await pool.query(`DELETE FROM organizacoes WHERE id = $1 AND user_id = $2`, [req.params.id, ownerId]);
      if (!r.rowCount) return res.status(404).json({ message: 'Organização não encontrada.' });
      return res.json({ ok: true }); // contatos soltam sozinhos (ON DELETE SET NULL)
    } catch (err) { return falha(res, err, 'Falha ao excluir'); }
  });

  // Body: { contatoIds: [] } — vincula (ou desvincula) contatos da conta a esta organização.
  const mudarVinculo = (vincular: boolean) => async (req: AuthRequest, res: Response) => {
    try {
      if (!ehUuid(req.params.id)) return res.status(404).json({ message: 'Organização não encontrada.' });
      const ids = Array.isArray(req.body?.contatoIds) ? req.body.contatoIds.filter((x: unknown) => typeof x === 'string' && ehUuid(x)).slice(0, 500) : [];
      if (!ids.length) return res.status(400).json({ message: 'Envie contatoIds.' });
      const ownerId = await resolverOwnerId(pool, req.userId!);
      const org = await pool.query(`SELECT 1 FROM organizacoes WHERE id = $1 AND user_id = $2`, [req.params.id, ownerId]);
      if (!org.rowCount) return res.status(404).json({ message: 'Organização não encontrada.' });
      const r = await pool.query(
        vincular
          ? `UPDATE contatos SET organizacao_id = $1, updated_at = NOW() WHERE id = ANY($2::uuid[]) AND user_id IN (${usuariosDaConta('$3')})`
          : `UPDATE contatos SET organizacao_id = NULL, updated_at = NOW() WHERE organizacao_id = $1 AND id = ANY($2::uuid[]) AND user_id IN (${usuariosDaConta('$3')})`,
        [req.params.id, ids, ownerId]);
      return res.json({ ok: true, alterados: r.rowCount ?? 0 });
    } catch (err) { return falha(res, err, 'Falha ao vincular'); }
  };
  router.post('/:id/vincular', mudarVinculo(true));
  router.post('/:id/desvincular', mudarVinculo(false));

  return router;
}
