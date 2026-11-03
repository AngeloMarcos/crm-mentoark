/**
 * apiKeys.ts — Tela "API Keys" (2026-11-02, modelo Cubo Configurações → API Keys). Sessão normal
 * (JWT); a API pública que usa estas chaves fica em routes/apiPublica.ts.
 *
 *   GET    /api/api-keys            → chaves do usuário (sem o valor) + catálogo de escopos
 *   POST   /api/api-keys            → { titulo, scopes?, full_access?, expira_em? } → chave (mostrada uma vez)
 *   PATCH  /api/api-keys/:id        → { titulo?, scopes?, full_access?, ativo? }
 *   DELETE /api/api-keys/:id        → revoga (apaga)
 */
import { Router, Response } from 'express';
import { Pool } from 'pg';
import { AuthRequest } from '../middleware';
import { RECURSOS, gerarChave, normalizarEscopos } from '../services/apiKeys';

const CAMPOS = `id, titulo, prefixo, scopes, full_access, ativo, last_used_at, expira_em, created_at`;
const MAX_CHAVES = 20;

export default function apiKeysRouter(pool: Pool): Router {
  const router = Router();

  router.get('/', async (req: AuthRequest, res: Response) => {
    try {
      const r = await pool.query(`SELECT ${CAMPOS} FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC`, [req.userId]);
      return res.json({ chaves: r.rows, recursos: RECURSOS });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  router.post('/', async (req: AuthRequest, res: Response) => {
    try {
      const titulo = String(req.body?.titulo || '').trim().slice(0, 80);
      if (!titulo) return res.status(422).json({ message: 'Dê um nome para a chave (ex.: "n8n", "site").' });
      const fullAccess = req.body?.full_access === true;
      const scopes = normalizarEscopos(req.body?.scopes);
      if (!fullAccess && !Object.keys(scopes).length) {
        return res.status(422).json({ message: 'Escolha pelo menos uma permissão ou marque acesso total.' });
      }
      const expira = req.body?.expira_em ? new Date(req.body.expira_em) : null;
      if (expira && (isNaN(expira.getTime()) || expira.getTime() <= Date.now())) {
        return res.status(422).json({ message: 'A data de expiração precisa estar no futuro.' });
      }
      const qtd = (await pool.query(`SELECT count(*)::int AS n FROM api_keys WHERE user_id = $1`, [req.userId])).rows[0].n;
      if (qtd >= MAX_CHAVES) return res.status(422).json({ message: `Limite de ${MAX_CHAVES} chaves. Revogue uma antes de criar outra.` });

      const { chave, prefixo, hash } = gerarChave();
      const r = await pool.query(
        `INSERT INTO api_keys (user_id, titulo, prefixo, hash_sha256, scopes, full_access, expira_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${CAMPOS}`,
        [req.userId, titulo, prefixo, hash, JSON.stringify(scopes), fullAccess, expira]);
      return res.status(201).json({ ...r.rows[0], chave });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  router.patch('/:id', async (req: AuthRequest, res: Response) => {
    try {
      const sets: string[] = [];
      const vals: any[] = [req.params.id, req.userId];
      if (typeof req.body?.titulo === 'string' && req.body.titulo.trim()) {
        vals.push(req.body.titulo.trim().slice(0, 80)); sets.push(`titulo = $${vals.length}`);
      }
      if (req.body?.scopes !== undefined) {
        vals.push(JSON.stringify(normalizarEscopos(req.body.scopes))); sets.push(`scopes = $${vals.length}`);
      }
      if (typeof req.body?.full_access === 'boolean') { vals.push(req.body.full_access); sets.push(`full_access = $${vals.length}`); }
      if (typeof req.body?.ativo === 'boolean') { vals.push(req.body.ativo); sets.push(`ativo = $${vals.length}`); }
      if (!sets.length) return res.status(400).json({ message: 'Nada para atualizar' });
      const r = await pool.query(
        `UPDATE api_keys SET ${sets.join(', ')} WHERE id = $1 AND user_id = $2 RETURNING ${CAMPOS}`, vals);
      if (!r.rows.length) return res.status(404).json({ message: 'Chave não encontrada' });
      return res.json(r.rows[0]);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  router.delete('/:id', async (req: AuthRequest, res: Response) => {
    try {
      const r = await pool.query(`DELETE FROM api_keys WHERE id = $1 AND user_id = $2`, [req.params.id, req.userId]);
      if (!r.rowCount) return res.status(404).json({ message: 'Chave não encontrada' });
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  return router;
}
