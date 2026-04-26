import { Router, Response } from 'express';
import { Pool } from 'pg';
import { makeCrud } from '../crud';
import { AuthRequest } from '../middleware';

export default function contatos(pool: Pool): Router {
  const router = makeCrud(pool, 'contatos');

  // Override GET / to support text search via ?search=
  router.get('/', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId;
      const params: any[] = [userId];
      let idx = 2;
      const conditions: string[] = ['user_id = $1'];

      if (req.query.lista_id) {
        conditions.push(`lista_id = $${idx++}`);
        params.push(req.query.lista_id);
      }
      if (req.query.status) {
        conditions.push(`status = $${idx++}`);
        params.push(req.query.status);
      }
      if (req.query.status_in) {
        const vals = String(req.query.status_in).split(',').filter(Boolean);
        if (vals.length) {
          const ph = vals.map(() => `$${idx++}`).join(', ');
          conditions.push(`status IN (${ph})`);
          params.push(...vals);
        }
      }
      if (req.query.search) {
        const s = `%${String(req.query.search)}%`;
        conditions.push(`(nome ILIKE $${idx} OR telefone ILIKE $${idx} OR email ILIKE $${idx} OR empresa ILIKE $${idx})`);
        params.push(s);
        idx++;
      }
      // Arbitrary field filter (e.g. ?telefone_ilike=%551199%)
      for (const [key, val] of Object.entries(req.query)) {
        const skip = new Set(['lista_id', 'status', 'status_in', 'search', 'order', 'asc', 'limit', 'page', 'head', 'user_id']);
        if (skip.has(key) || val === '') continue;
        const str = String(val);
        if (key.endsWith('_ilike')) {
          const col = key.slice(0, -6);
          if (/^[a-z_]+$/.test(col)) {
            conditions.push(`${col} ILIKE $${idx++}`);
            params.push(str);
          }
        } else if (/^[a-z_]+$/.test(key) && key !== 'user_id') {
          conditions.push(`${key} = $${idx++}`);
          params.push(str);
        }
      }

      let sql = `SELECT * FROM contatos WHERE ${conditions.join(' AND ')}`;

      const orderCol = String(req.query.order || 'created_at');
      if (/^[a-z_]+$/.test(orderCol)) {
        const dir = req.query.asc === 'false' ? 'DESC' : 'ASC';
        sql += ` ORDER BY ${orderCol} ${dir}`;
      }

      if (req.query.head === '1' || req.query.head === 'true') {
        const r = await pool.query(`SELECT COUNT(*) FROM contatos WHERE ${conditions.join(' AND ')}`, params);
        return res.json({ count: parseInt(r.rows[0].count, 10), data: null });
      }

      const limit = Math.min(parseInt(String(req.query.limit || '1000'), 10) || 1000, 2000);
      const page = Math.max(parseInt(String(req.query.page || '1'), 10) || 1, 1);
      sql += ` LIMIT $${idx} OFFSET $${idx + 1}`;
      params.push(limit, (page - 1) * limit);

      const r = await pool.query(sql, params);
      return res.json(r.rows);
    } catch (err: any) {
      console.error('[contatos GET]', err.message);
      return res.status(500).json({ message: err.message });
    }
  });

  return router;
}
