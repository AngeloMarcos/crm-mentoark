import { Router, Response } from 'express';
import { Pool } from 'pg';
import { AuthRequest } from './middleware';

export interface CrudOptions {
  userIdCol?: string | null; // null = no user scoping (e.g. n8n_chat_histories)
  idCol?: string;
}

const RESERVED_PARAMS = new Set(['order', 'asc', 'limit', 'page', 'head', 'select', 'count']);

function buildWhere(
  query: Record<string, any>,
  userIdCol: string | null,
  userId: string | null
): { conditions: string[]; params: any[]; nextIdx: number } {
  const conditions: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (userIdCol && userId) {
    conditions.push(`${userIdCol} = $${idx++}`);
    params.push(userId);
  }

  for (const [key, val] of Object.entries(query)) {
    if (RESERVED_PARAMS.has(key) || val === undefined || val === '') continue;
    const str = String(val);

    if (key.endsWith('_in')) {
      const col = key.slice(0, -3);
      if (!/^[a-z_]+$/.test(col)) continue;
      const vals = str.split(',').filter(Boolean);
      if (!vals.length) continue;
      const placeholders = vals.map(() => `$${idx++}`).join(', ');
      conditions.push(`${col} IN (${placeholders})`);
      params.push(...vals);
    } else if (key.endsWith('_gte')) {
      const col = key.slice(0, -4);
      if (!/^[a-z_]+$/.test(col)) continue;
      conditions.push(`${col} >= $${idx++}`);
      params.push(str);
    } else if (key.endsWith('_lte')) {
      const col = key.slice(0, -4);
      if (!/^[a-z_]+$/.test(col)) continue;
      conditions.push(`${col} <= $${idx++}`);
      params.push(str);
    } else if (key.endsWith('_gt')) {
      const col = key.slice(0, -3);
      if (!/^[a-z_]+$/.test(col)) continue;
      conditions.push(`${col} > $${idx++}`);
      params.push(str);
    } else if (key.endsWith('_lt')) {
      const col = key.slice(0, -3);
      if (!/^[a-z_]+$/.test(col)) continue;
      conditions.push(`${col} < $${idx++}`);
      params.push(str);
    } else if (key.endsWith('_ilike')) {
      const col = key.slice(0, -6);
      if (!/^[a-z_]+$/.test(col)) continue;
      conditions.push(`${col} ILIKE $${idx++}`);
      params.push(str);
    } else if (/^[a-z_]+$/.test(key)) {
      conditions.push(`${key} = $${idx++}`);
      params.push(str);
    }
  }

  return { conditions, params, nextIdx: idx };
}

export function makeCrud(pool: Pool, tableName: string, options: CrudOptions = {}): Router {
  const router = Router();
  const userIdCol = options.userIdCol !== undefined ? options.userIdCol : 'user_id';
  const idCol = options.idCol ?? 'id';

  const wrap = (fn: Function) => async (req: AuthRequest, res: Response) => {
    try {
      await fn(req, res);
    } catch (err: any) {
      console.error(`[${tableName}]`, err.message);
      res.status(500).json({ message: err.message });
    }
  };

  // GET all (with optional count=only)
  router.get('/', wrap(async (req: AuthRequest, res: Response) => {
    const userId = userIdCol ? req.userId ?? null : null;
    if (userIdCol && !userId) return res.status(401).json({ message: 'userId ausente' });
    const { conditions, params, nextIdx } = buildWhere(req.query as any, userIdCol, userId);

    const whereClause = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';

    // Count-only mode (Database head: true)
    if (req.query.head === '1' || req.query.head === 'true') {
      const r = await pool.query(`SELECT COUNT(*) FROM ${tableName}${whereClause}`, params);
      return res.json({ count: parseInt(r.rows[0].count, 10), data: null });
    }

    let sql = `SELECT * FROM ${tableName}${whereClause}`;

    const orderCol = String(req.query.order || '');
    if (orderCol && /^[a-z_]+$/.test(orderCol)) {
      const dir = req.query.asc === 'false' ? 'DESC' : 'ASC';
      sql += ` ORDER BY ${orderCol} ${dir}`;
    }

    const limit = Math.min(parseInt(String(req.query.limit || '1000'), 10) || 1000, 2000);
    const page = Math.max(parseInt(String(req.query.page || '1'), 10) || 1, 1);
    const offset = (page - 1) * limit;

    sql += ` LIMIT $${nextIdx} OFFSET $${nextIdx + 1}`;
    params.push(limit, offset);

    const r = await pool.query(sql, params);
    return res.json(r.rows);
  }));

  // GET by id
  router.get('/:id', wrap(async (req: AuthRequest, res: Response) => {
    const userId = userIdCol ? req.userId ?? null : null;
    if (userIdCol && !userId) return res.status(401).json({ message: 'userId ausente' });
    const params: any[] = [req.params.id];
    let sql = `SELECT * FROM ${tableName} WHERE ${idCol} = $1`;
    if (userIdCol && userId) {
      sql += ` AND ${userIdCol} = $2`;
      params.push(userId);
    }
    const r = await pool.query(sql, params);
    if (!r.rows.length) return res.status(404).json({ message: 'Não encontrado' });
    return res.json(r.rows[0]);
  }));

  // POST (create single or bulk)
  router.post('/', wrap(async (req: AuthRequest, res: Response) => {
    const userId = userIdCol ? req.userId ?? null : null;
    const items: any[] = Array.isArray(req.body) ? req.body : [req.body];
    const results: any[] = [];

    for (const raw of items) {
      const item = { ...raw };
      if (userIdCol && userId) item[userIdCol] = userId;
      if (!item[idCol]) delete item[idCol];
      delete item.created_at;
      delete item.updated_at;

      const cols = Object.keys(item).filter(k => /^[a-z_]+$/.test(k));
      if (!cols.length) continue;
      const vals = cols.map(k => item[k]);
      const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ');
      const sql = `INSERT INTO ${tableName} (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`;
      const r = await pool.query(sql, vals);
      results.push(r.rows[0]);
    }

    return res.status(201).json(results.length === 1 ? results[0] : results);
  }));

  // PUT /:id (update by primary key)
  router.put('/:id', wrap(async (req: AuthRequest, res: Response) => {
    const userId = userIdCol ? req.userId ?? null : null;
    const data: any = { ...req.body };
    delete data[idCol];
    delete data[userIdCol ?? ''];
    delete data.created_at;
    delete data.updated_at;

    const cols = Object.keys(data).filter(k => /^[a-z_]+$/.test(k));
    if (!cols.length) return res.status(400).json({ message: 'Nenhum campo para atualizar' });

    const setClauses = cols.map((col, i) => `${col} = $${i + 1}`).join(', ');
    const vals: any[] = [...cols.map(k => data[k]), req.params.id];
    let sql = `UPDATE ${tableName} SET ${setClauses}, updated_at = NOW() WHERE ${idCol} = $${cols.length + 1}`;

    if (userIdCol && userId) {
      sql += ` AND ${userIdCol} = $${cols.length + 2}`;
      vals.push(userId);
    }
    sql += ' RETURNING *';

    const r = await pool.query(sql, vals);
    if (!r.rows.length) return res.status(404).json({ message: 'Não encontrado' });
    return res.json(r.rows[0]);
  }));

  // PUT / (bulk update with query filters)
  router.put('/', wrap(async (req: AuthRequest, res: Response) => {
    const userId = userIdCol ? req.userId ?? null : null;
    if (userIdCol && !userId) return res.status(401).json({ message: 'userId ausente' });
    const { conditions, params: whereParams, nextIdx } = buildWhere(req.query as any, userIdCol, userId);

    if (!conditions.length) {
      return res.status(400).json({ message: 'Bulk update requer pelo menos um filtro' });
    }

    const data: any = { ...req.body };
    delete data[idCol];
    delete data[userIdCol ?? ''];
    delete data.created_at;
    delete data.updated_at;

    const cols = Object.keys(data).filter(k => /^[a-z_]+$/.test(k));
    if (!cols.length) return res.status(400).json({ message: 'Nenhum campo para atualizar' });

    const allParams = [...whereParams, ...cols.map(k => data[k])];
    const setClauses = cols.map((col, i) => `${col} = $${nextIdx + i}`).join(', ');
    const sql = `UPDATE ${tableName} SET ${setClauses}, updated_at = NOW() WHERE ${conditions.join(' AND ')} RETURNING *`;

    const r = await pool.query(sql, allParams);
    return res.json(r.rows);
  }));

  // DELETE /:id
  router.delete('/:id', wrap(async (req: AuthRequest, res: Response) => {
    const userId = userIdCol ? req.userId ?? null : null;
    // Segurança: nunca executar sem userId em tabelas protegidas
    if (userIdCol && !userId) return res.status(401).json({ message: 'userId ausente' });
    const params: any[] = [req.params.id];
    let sql = `DELETE FROM ${tableName} WHERE ${idCol} = $1`;
    if (userIdCol && userId) {
      sql += ` AND ${userIdCol} = $2`;
      params.push(userId);
    }
    await pool.query(sql, params);
    return res.status(204).send();
  }));

  // DELETE / (bulk delete por filtros de query string)
  router.delete('/', wrap(async (req: AuthRequest, res: Response) => {
    const userId = userIdCol ? req.userId ?? null : null;
    if (userIdCol && !userId) return res.status(401).json({ message: 'userId ausente' });

    const { conditions, params } = buildWhere(req.query as any, userIdCol, userId);

    // Nunca deletar tudo sem nenhum filtro
    if (!conditions.length) {
      return res.status(400).json({ message: 'Bulk delete requer pelo menos um filtro' });
    }

    const sql = `DELETE FROM ${tableName} WHERE ${conditions.join(' AND ')}`;
    await pool.query(sql, params);
    return res.status(204).send();
  }));

  return router;
}
