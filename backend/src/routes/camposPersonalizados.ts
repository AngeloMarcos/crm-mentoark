/**
 * camposPersonalizados.ts — `/api/campos-personalizados` (2026-11-11).
 * Cadastro de campos da CONTA (users.owner_id) e valores de um contato.
 * Regras de tipo/valor em services/camposPersonalizados.ts.
 */
import { Router, Response } from 'express';
import { Pool } from 'pg';
import { AuthRequest } from '../middleware';
import { log } from '../logger';
import { resolverOwnerId } from '../services/subscription';
import { chaveLivre, gerarChave, gravarValoresDoContato, listarCampos, validarDefinicao } from '../services/camposPersonalizados';

const ehUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const MAX_CAMPOS = 100;

export default function camposPersonalizadosRouter(pool: Pool): Router {
  const router = Router();

  const falha = (res: Response, err: any, contexto: string) => {
    log.error('CAMPOS', contexto, { err: err?.message });
    return res.status(500).json({ message: 'Erro ao processar os campos personalizados.' });
  };

  router.get('/', async (req: AuthRequest, res: Response) => {
    try {
      const ownerId = await resolverOwnerId(pool, req.userId!);
      return res.json(await listarCampos(pool, ownerId, { todos: req.query.todos === '1' }));
    } catch (err) { return falha(res, err, 'Falha ao listar'); }
  });

  router.post('/', async (req: AuthRequest, res: Response) => {
    try {
      const v = validarDefinicao(req.body, false);
      if (!v.ok) return res.status(400).json({ message: v.erro });
      const ownerId = await resolverOwnerId(pool, req.userId!);
      const existentes = await pool.query(`SELECT chave, lower(nome) AS nome, ativo FROM campos_personalizados WHERE user_id = $1`, [ownerId]);
      if (existentes.rows.filter(r => r.ativo).length >= MAX_CAMPOS) return res.status(400).json({ message: `Limite de ${MAX_CAMPOS} campos por conta.` });
      if (existentes.rows.some(r => r.ativo && r.nome === v.dados.nome!.toLowerCase())) return res.status(409).json({ message: 'Já existe um campo com este nome.' });
      const chave = chaveLivre(gerarChave(v.dados.nome!), existentes.rows.map(r => r.chave));
      const r = await pool.query(
        `INSERT INTO campos_personalizados (user_id, nome, chave, tipo, opcoes, descricao, ia_preenche, ordem)
         VALUES ($1, $2, $3, $4, $5, $6, $7, (SELECT COALESCE(MAX(ordem) + 1, 0) FROM campos_personalizados WHERE user_id = $1))
         RETURNING id, nome, chave, tipo, opcoes, descricao, ia_preenche, ativo, ordem`,
        [ownerId, v.dados.nome, chave, v.dados.tipo, v.dados.opcoes ?? [], v.dados.descricao ?? null, v.dados.ia_preenche ?? false]);
      return res.status(201).json(r.rows[0]);
    } catch (err) { return falha(res, err, 'Falha ao criar'); }
  });

  // Ordem: [id, id, ...] na ordem desejada. Antes de /:id para não casar como id.
  router.put('/ordem', async (req: AuthRequest, res: Response) => {
    try {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x: unknown) => typeof x === 'string' && ehUuid(x)) : [];
      if (!ids.length) return res.status(400).json({ message: 'Envie a lista de ids.' });
      const ownerId = await resolverOwnerId(pool, req.userId!);
      await pool.query(
        `UPDATE campos_personalizados c SET ordem = o.pos
           FROM unnest($2::uuid[]) WITH ORDINALITY AS o(id, pos)
          WHERE c.id = o.id AND c.user_id = $1`, [ownerId, ids]);
      return res.json(await listarCampos(pool, ownerId, { todos: true }));
    } catch (err) { return falha(res, err, 'Falha ao ordenar'); }
  });

  router.patch('/:id', async (req: AuthRequest, res: Response) => {
    try {
      if (!ehUuid(req.params.id)) return res.status(404).json({ message: 'Campo não encontrado.' });
      const ownerId = await resolverOwnerId(pool, req.userId!);
      const atual = (await pool.query(`SELECT * FROM campos_personalizados WHERE id = $1 AND user_id = $2`, [req.params.id, ownerId])).rows[0];
      if (!atual) return res.status(404).json({ message: 'Campo não encontrado.' });
      // Tipo não muda depois de criado: os valores já gravados seguem o tipo antigo.
      if (req.body?.tipo !== undefined && req.body.tipo !== atual.tipo) return res.status(400).json({ message: 'O tipo do campo não pode ser trocado depois de criado.' });
      const v = validarDefinicao({ ...req.body, tipo: undefined }, true);
      if (!v.ok) return res.status(400).json({ message: v.erro });
      if ((atual.tipo === 'selecao' || atual.tipo === 'multipla') && v.dados.opcoes && !v.dados.opcoes.length) {
        return res.status(400).json({ message: 'Campo de seleção precisa de pelo menos uma opção.' });
      }
      if (v.dados.nome) {
        const dup = await pool.query(`SELECT 1 FROM campos_personalizados WHERE user_id = $1 AND ativo AND lower(nome) = lower($2) AND id <> $3`, [ownerId, v.dados.nome, atual.id]);
        if (dup.rowCount) return res.status(409).json({ message: 'Já existe um campo com este nome.' });
      }
      const cols = Object.keys(v.dados) as (keyof typeof v.dados)[];
      if (!cols.length) return res.json(atual);
      const r = await pool.query(
        `UPDATE campos_personalizados SET ${cols.map((c, i) => `${c} = $${i + 3}`).join(', ')}
          WHERE id = $1 AND user_id = $2
          RETURNING id, nome, chave, tipo, opcoes, descricao, ia_preenche, ativo, ordem`,
        [atual.id, ownerId, ...cols.map(c => v.dados[c])]);
      return res.json(r.rows[0]);
    } catch (err) { return falha(res, err, 'Falha ao editar'); }
  });

  router.delete('/:id', async (req: AuthRequest, res: Response) => {
    try {
      if (!ehUuid(req.params.id)) return res.status(404).json({ message: 'Campo não encontrado.' });
      const ownerId = await resolverOwnerId(pool, req.userId!);
      const r = await pool.query(`UPDATE campos_personalizados SET ativo = false WHERE id = $1 AND user_id = $2`, [req.params.id, ownerId]);
      if (!r.rowCount) return res.status(404).json({ message: 'Campo não encontrado.' });
      return res.json({ ok: true });
    } catch (err) { return falha(res, err, 'Falha ao excluir'); }
  });

  // ── Valores de um contato ──────────────────────────────────────────────────
  router.get('/contato/:contatoId', async (req: AuthRequest, res: Response) => {
    try {
      if (!ehUuid(req.params.contatoId)) return res.status(404).json({ message: 'Contato não encontrado.' });
      const ownerId = await resolverOwnerId(pool, req.userId!);
      const c = await pool.query(`SELECT campos FROM contatos WHERE id = $1 AND user_id = ANY($2::uuid[])`, [req.params.contatoId, [ownerId, req.userId]]);
      if (!c.rowCount) return res.status(404).json({ message: 'Contato não encontrado.' });
      return res.json({ campos: await listarCampos(pool, ownerId), valores: c.rows[0].campos || {} });
    } catch (err) { return falha(res, err, 'Falha ao ler valores'); }
  });

  // Body: { valores: { chave: valor } } — mescla; valor vazio/null apaga só aquele campo.
  router.put('/contato/:contatoId', async (req: AuthRequest, res: Response) => {
    try {
      if (!ehUuid(req.params.contatoId)) return res.status(404).json({ message: 'Contato não encontrado.' });
      const valores = req.body?.valores;
      if (!valores || typeof valores !== 'object' || Array.isArray(valores)) return res.status(400).json({ message: 'Envie { valores: { chave: valor } }.' });
      const ownerId = await resolverOwnerId(pool, req.userId!);
      const r = await gravarValoresDoContato(pool, ownerId, req.params.contatoId, [ownerId, req.userId!], valores);
      if (!r.ok) return res.status(r.code === 'not_found' ? 404 : 400).json({ message: r.erro, chave: (r as any).chave });
      return res.json({ valores: r.campos });
    } catch (err) { return falha(res, err, 'Falha ao gravar valores'); }
  });

  return router;
}
