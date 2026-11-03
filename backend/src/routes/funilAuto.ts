/**
 * funilAuto.ts — Funil que anda sozinho (2026-11-02, modelo atendIA). Ver services/funilAuto.ts.
 *
 *   GET    /api/funil-auto/etapas                → etapas (cria as padrão se a conta não tem) + nº de cards
 *   POST   /api/funil-auto/etapas                → { nome, cor?, tipo? }
 *   PUT    /api/funil-auto/etapas/:id            → { nome?, cor?, tipo?, automacoes? }
 *   PUT    /api/funil-auto/etapas-ordem          → { ids: [...] }
 *   DELETE /api/funil-auto/etapas/:id            → { mover_para? } (cards vão para outra etapa ou saem do funil)
 *   GET    /api/funil-auto/cards                 → contatos que estão no funil (com etapa)
 *   POST   /api/funil-auto/mover                 → { contato_id, estagio_id | null, motivo? } (origem manual)
 *   GET    /api/funil-auto/eventos?contato_id=   → histórico do card
 */
import { Router, Response } from 'express';
import { Pool } from 'pg';
import { AuthRequest } from '../middleware';
import {
  garantirEtapasPadrao, listarEtapas, moverNoFunil, normalizarAutomacoes, tipoEtapa, MOTIVOS,
} from '../services/funilAuto';

const LIMITE_CARDS = 3000;

export default function funilAutoRouter(pool: Pool): Router {
  const router = Router();

  router.get('/etapas', async (req: AuthRequest, res: Response) => {
    try {
      const etapas = await garantirEtapasPadrao(pool, req.userId!);
      const contagem = await pool.query(
        `SELECT funil_estagio_id AS id, count(*)::int AS n FROM contatos
          WHERE user_id = $1 AND funil_estagio_id IS NOT NULL GROUP BY 1`, [req.userId]);
      const n = new Map(contagem.rows.map(r => [r.id, r.n]));
      return res.json({ etapas: etapas.map(e => ({ ...e, cards: n.get(e.id) ?? 0 })) });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  router.post('/etapas', async (req: AuthRequest, res: Response) => {
    const nome = String(req.body?.nome || '').trim().slice(0, 60);
    if (!nome) return res.status(422).json({ message: 'Dê um nome para a etapa.' });
    try {
      const ordem = (await pool.query(`SELECT COALESCE(max(ordem), -1) + 1 AS o FROM funil_estagios WHERE user_id = $1`, [req.userId])).rows[0].o;
      const r = await pool.query(
        `INSERT INTO funil_estagios (user_id, nome, cor, ordem, tipo) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [req.userId, nome, String(req.body?.cor || '#64748b').slice(0, 20), ordem, tipoEtapa(req.body?.tipo)]);
      return res.status(201).json({ id: r.rows[0].id });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  router.put('/etapas/:id', async (req: AuthRequest, res: Response) => {
    try {
      const sets: string[] = [];
      const vals: any[] = [req.params.id, req.userId];
      if (typeof req.body?.nome === 'string') {
        const nome = req.body.nome.trim().slice(0, 60);
        if (!nome) return res.status(422).json({ message: 'O nome não pode ficar vazio.' });
        vals.push(nome); sets.push(`nome = $${vals.length}`);
      }
      if (typeof req.body?.cor === 'string') { vals.push(req.body.cor.slice(0, 20)); sets.push(`cor = $${vals.length}`); }
      if (req.body?.tipo !== undefined) { vals.push(tipoEtapa(req.body.tipo)); sets.push(`tipo = $${vals.length}`); }
      if (req.body?.automacoes !== undefined) {
        const automacoes = normalizarAutomacoes(req.body.automacoes);
        const incompleta = automacoes.find(a => a.ativo && (a.tipo === 'adicionar_etiqueta' ? !a.etiqueta : !a.responsavel));
        if (incompleta) return res.status(422).json({ message: 'Preencha a automação ou desligue ela antes de salvar.' });
        vals.push(JSON.stringify(automacoes)); sets.push(`automacoes = $${vals.length}::jsonb`);
      }
      if (!sets.length) return res.status(400).json({ message: 'Nada para atualizar' });
      const r = await pool.query(`UPDATE funil_estagios SET ${sets.join(', ')} WHERE id = $1 AND user_id = $2`, vals);
      if (!r.rowCount) return res.status(404).json({ message: 'Etapa não encontrada' });
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  router.put('/etapas-ordem', async (req: AuthRequest, res: Response) => {
    const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.filter((i: unknown) => typeof i === 'string') : [];
    if (!ids.length) return res.status(422).json({ message: 'Informe ids.' });
    try {
      for (const [i, id] of ids.entries()) {
        await pool.query(`UPDATE funil_estagios SET ordem = $3 WHERE id = $1 AND user_id = $2`, [id, req.userId, i]);
      }
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  router.delete('/etapas/:id', async (req: AuthRequest, res: Response) => {
    try {
      const etapas = await listarEtapas(pool, req.userId!);
      if (!etapas.some(e => e.id === req.params.id)) return res.status(404).json({ message: 'Etapa não encontrada' });
      if (etapas.length <= 1) return res.status(422).json({ message: 'O funil precisa de pelo menos uma etapa.' });
      const destino = req.body?.mover_para || req.query.mover_para || null;
      if (destino && !etapas.some(e => e.id === destino && e.id !== req.params.id)) {
        return res.status(422).json({ message: 'Etapa de destino inválida.' });
      }
      await pool.query(
        `UPDATE contatos SET funil_estagio_id = $3, funil_entrou_em = CASE WHEN $3::uuid IS NULL THEN NULL ELSE NOW() END, updated_at = NOW()
          WHERE user_id = $1 AND funil_estagio_id = $2`, [req.userId, req.params.id, destino]);
      // Agentes que liberavam esta etapa simplesmente deixam de ver ela (etapasPermitidasIA filtra).
      await pool.query(`DELETE FROM funil_estagios WHERE id = $1 AND user_id = $2`, [req.params.id, req.userId]);
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  router.get('/cards', async (req: AuthRequest, res: Response) => {
    try {
      const r = await pool.query(
        `SELECT c.id, c.nome, c.telefone, c.empresa, c.tags, c.responsavel, c.valor_potencial, c.temperatura,
                c.funil_estagio_id, c.funil_entrou_em, c.ultima_mensagem_em, c.updated_at,
                (SELECT row_to_json(e) FROM (
                   SELECT origem, resultado, motivo, created_at FROM funil_eventos
                    WHERE contato_id = c.id AND resultado = 'feito' AND origem <> 'automacao'
                    ORDER BY created_at DESC LIMIT 1) e) AS ultimo_movimento
           FROM contatos c
          WHERE c.user_id = $1 AND c.funil_estagio_id IS NOT NULL
          ORDER BY c.funil_entrou_em DESC NULLS LAST
          LIMIT ${LIMITE_CARDS}`, [req.userId]);
      return res.json({ cards: r.rows, limite: LIMITE_CARDS });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  router.post('/mover', async (req: AuthRequest, res: Response) => {
    const contatoId = String(req.body?.contato_id || '');
    if (!contatoId) return res.status(422).json({ message: 'Informe contato_id.' });
    const estagioId = req.body?.estagio_id ? String(req.body.estagio_id) : null;
    try {
      const r = await moverNoFunil(pool, {
        userId: req.userId!, contatoId, paraEstagioId: estagioId, origem: 'manual',
        motivo: typeof req.body?.motivo === 'string' ? req.body.motivo : null,
      });
      if (!r.ok) {
        const status = r.motivo === 'ja_estava' ? 200 : r.motivo === 'sem_contato' || r.motivo === 'etapa_inexistente' ? 404 : 422;
        return res.status(status).json({ ok: false, motivo: r.motivo, message: MOTIVOS[r.motivo!] || r.motivo });
      }
      return res.json(r);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  router.get('/eventos', async (req: AuthRequest, res: Response) => {
    const contatoId = String(req.query.contato_id || '');
    if (!contatoId) return res.status(422).json({ message: 'Informe contato_id.' });
    try {
      const r = await pool.query(
        `SELECT ev.id, ev.origem, ev.resultado, ev.motivo, ev.detalhe, ev.created_at,
                de.nome AS de_nome, para.nome AS para_nome, a.nome AS agente_nome
           FROM funil_eventos ev
           LEFT JOIN funil_estagios de ON de.id = ev.de_estagio_id
           LEFT JOIN funil_estagios para ON para.id = ev.para_estagio_id
           LEFT JOIN agentes a ON a.id = ev.agente_id
          WHERE ev.user_id = $1 AND ev.contato_id = $2
          ORDER BY ev.created_at DESC LIMIT 100`, [req.userId, contatoId]);
      return res.json({ eventos: r.rows });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  return router;
}
