import { Router, Response } from 'express';
import { Pool } from 'pg';
import { makeCrud } from '../crud';
import { AuthRequest } from '../middleware';

export default function contatos(pool: Pool): Router {
  const router = makeCrud(pool, 'contatos');

  // Override GET / to support text search via ?search=
  router.get('/', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      
      // Verifica se é membro
      const equipeRes = await pool.query(
        `SELECT role FROM equipe_membros WHERE user_id = $1 LIMIT 1`,
        [userId]
      );
      const isMembro = equipeRes.rowCount > 0 && equipeRes.rows[0].role === 'membro';

      const params: any[] = [userId];
      let idx = 2;
      const conditions: string[] = [isMembro ? 'atribuido_a = $1' : 'user_id = $1'];

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

  // PATCH /:id/pausa-ia — ativa ou desativa pausa de atendimento humano
  // Body: { ativo: boolean, duracao_min?: number }
  router.patch('/:id/pausa-ia', async (req: AuthRequest, res: Response) => {
    const { ativo, duracao_min } = req.body as { ativo: boolean; duracao_min?: number };
    const userId = req.userId!;
    if (typeof ativo !== 'boolean') {
      return res.status(400).json({ message: 'Campo ativo (boolean) é obrigatório' });
    }
    try {
      const contatoRes = await pool.query(
        `SELECT telefone FROM contatos WHERE id = $1 AND user_id = $2`,
        [req.params.id, userId]
      );
      if (!contatoRes.rows.length) {
        return res.status(404).json({ message: 'Contato não encontrado' });
      }
      const { telefone } = contatoRes.rows[0];

      if (ativo) {
        const duracao = duracao_min ?? 30;
        await pool.query(
          `UPDATE dados_cliente
           SET atendimento_ia = 'pause',
               pausa_timestamp = NOW(),
               pausa_duracao_min = $3,
               pausa_atendente_id = $4
           WHERE user_id = $1 AND telefone = $2`,
          [userId, telefone, duracao, userId]
        );
        // Insere em dados_cliente se ainda não existe
        await pool.query(
          `INSERT INTO dados_cliente (user_id, telefone, atendimento_ia, pausa_timestamp, pausa_duracao_min, pausa_atendente_id)
           VALUES ($1, $2, 'pause', NOW(), $3, $4)
           ON CONFLICT (user_id, telefone) DO NOTHING`,
          [userId, telefone, duracao, userId]
        ).catch(() => {});
        await pool.query(
          `INSERT INTO ia_pausa_log (user_id, telefone, atendente_id, acao, duracao_min)
           VALUES ($1, $2, $3, 'pause', $4)`,
          [userId, telefone, userId, duracao]
        );
        return res.json({ ok: true, ativo: true, telefone, duracao_min: duracao });
      } else {
        await pool.query(
          `UPDATE dados_cliente
           SET atendimento_ia = 'ativo',
               pausa_timestamp = NULL,
               pausa_duracao_min = NULL,
               pausa_atendente_id = NULL
           WHERE user_id = $1 AND telefone = $2`,
          [userId, telefone]
        );
        await pool.query(
          `INSERT INTO ia_pausa_log (user_id, telefone, atendente_id, acao)
           VALUES ($1, $2, $3, 'ativo')`,
          [userId, telefone, userId]
        );
        return res.json({ ok: true, ativo: false, telefone });
      }
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // GET /:id/pausa-status — retorna status atual da pausa de IA para um contato
  router.get('/:id/pausa-status', async (req: AuthRequest, res: Response) => {
    const userId = req.userId!;
    try {
      const contatoRes = await pool.query(
        `SELECT telefone FROM contatos WHERE id = $1 AND user_id = $2`,
        [req.params.id, userId]
      );
      if (!contatoRes.rows.length) {
        return res.status(404).json({ message: 'Contato não encontrado' });
      }
      const { telefone } = contatoRes.rows[0];

      const r = await pool.query(
        `SELECT atendimento_ia, pausa_timestamp, pausa_duracao_min
         FROM dados_cliente
         WHERE user_id = $1 AND telefone = $2
         LIMIT 1`,
        [userId, telefone]
      );

      if (!r.rows.length) {
        return res.json({ ativo: false, atendimento_ia: 'ativo', pausa_timestamp: null, tempo_restante_seg: 0 });
      }

      const dc = r.rows[0];
      const pausaAtiva = dc.atendimento_ia === 'pause';
      let tempoRestanteSeg = 0;
      if (pausaAtiva && dc.pausa_timestamp && dc.pausa_duracao_min) {
        const expiresAt = new Date(dc.pausa_timestamp).getTime() + dc.pausa_duracao_min * 60 * 1000;
        tempoRestanteSeg = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      }

      return res.json({
        ativo: pausaAtiva,
        atendimento_ia: dc.atendimento_ia,
        pausa_timestamp: dc.pausa_timestamp,
        tempo_restante_seg: tempoRestanteSeg,
      });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  return router;
}
