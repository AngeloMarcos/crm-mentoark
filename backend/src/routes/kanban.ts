import { Router, Response } from 'express';
import { Pool } from 'pg';
import { AuthRequest } from '../middleware';
import OpenAI from 'openai';

const anthropic = new OpenAI({
  apiKey: process.env.ANTHROPIC_API_KEY || 'sk-ant-...', // Placeholder
  baseURL: 'https://api.anthropic.com/v1', // Using OpenAI SDK with Anthropic base if possible, but actually we should use standard fetch or dedicated lib
});

export default function kanban(pool: Pool): Router {
  const router = Router();

  // 1. GET /api/kanban/colunas
  router.get('/colunas', async (req: AuthRequest, res: Response) => {
    try {
      const r = await pool.query(
        'SELECT * FROM kanban_colunas WHERE user_id = $1 ORDER BY ordem ASC',
        [req.userId]
      );

      if (r.rows.length === 0) {
        // Cria colunas padrão
        const defaults = [
          { nome: 'Backlog', ordem: 0, cor: '#f1f5f9' },
          { nome: 'Em Andamento', ordem: 1, cor: '#dbeafe' },
          { nome: 'Em Revisão', ordem: 2, cor: '#fef9c3' },
          { nome: 'Concluído', ordem: 3, cor: '#dcfce7' }
        ];

        const inserted = [];
        for (const col of defaults) {
          const resCol = await pool.query(
            'INSERT INTO kanban_colunas (user_id, nome, ordem, cor) VALUES ($1, $2, $3, $4) RETURNING *',
            [req.userId, col.nome, col.ordem, col.cor]
          );
          inserted.push(resCol.rows[0]);
        }
        return res.json(inserted);
      }

      return res.json(r.rows);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // 2. GET /api/kanban/tarefas
  router.get('/tarefas', async (req: AuthRequest, res: Response) => {
    try {
      const { coluna_id, atribuido_a, prioridade, origem } = req.query;
      
      let sql = `
        SELECT 
          t.*,
          u.display_name as atribuido_nome,
          u.email as atribuido_email,
          c.nome as contato_nome,
          sp.nome as sub_perfil_nome,
          (SELECT COUNT(*) FROM tarefa_comentarios tc WHERE tc.tarefa_id = t.id) as total_comentarios
        FROM tarefas t
        LEFT JOIN users u ON u.id = t.atribuido_a
        LEFT JOIN contatos c ON c.id = t.contato_id
        LEFT JOIN sub_perfis sp ON sp.id = t.sub_perfil_id
        WHERE t.user_id = $1
      `;
      
      const params: any[] = [req.userId];
      
      if (coluna_id) {
        params.push(coluna_id);
        sql += ` AND t.coluna_id = $${params.length}`;
      }
      if (atribuido_a) {
        params.push(atribuido_a);
        sql += ` AND t.atribuido_a = $${params.length}`;
      }
      if (prioridade) {
        params.push(prioridade);
        sql += ` AND t.prioridade = $${params.length}`;
      }
      if (origem) {
        params.push(origem);
        sql += ` AND t.origem = $${params.length}`;
      }

      sql += ` ORDER BY t.ordem ASC`;

      const r = await pool.query(sql, params);
      return res.json(r.rows);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // 3. POST /api/kanban/tarefas
  router.post('/tarefas', async (req: AuthRequest, res: Response) => {
    try {
      const { 
        titulo, descricao, coluna_id, prioridade, atribuido_a, 
        sub_perfil_id, contato_id, conversa_id, tags, data_limite, origem 
      } = req.body;

      if (!titulo || !coluna_id) {
        return res.status(400).json({ message: 'Título e coluna_id são obrigatórios' });
      }

      // Pega a última ordem da coluna
      const orderRes = await pool.query(
        'SELECT COALESCE(MAX(ordem), -1) as last_order FROM tarefas WHERE user_id = $1 AND coluna_id = $2',
        [req.userId, coluna_id]
      );
      const nextOrder = orderRes.rows[0].last_order + 1;

      const r = await pool.query(
        `INSERT INTO tarefas (
          user_id, coluna_id, titulo, descricao, prioridade, 
          ordem, atribuido_a, sub_perfil_id, contato_id, 
          conversa_id, tags, data_limite, origem, criada_por
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) 
        RETURNING *`,
        [
          req.userId, coluna_id, titulo, descricao, prioridade || 'media', 
          nextOrder, atribuido_a, sub_perfil_id, contato_id, 
          conversa_id, tags || [], data_limite, origem || 'manual', req.userId
        ]
      );

      return res.status(201).json(r.rows[0]);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // 4. PATCH /api/kanban/tarefas/:id
  router.patch('/tarefas/:id', async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const data = req.body;
      
      // Se coluna_id mudar, precisamos de uma nova ordem
      if (data.coluna_id) {
        const currentRes = await pool.query('SELECT coluna_id FROM tarefas WHERE id = $1 AND user_id = $2', [id, req.userId]);
        if (currentRes.rows.length === 0) return res.status(404).json({ message: 'Tarefa não encontrada' });
        
        if (currentRes.rows[0].coluna_id !== data.coluna_id) {
          const orderRes = await pool.query(
            'SELECT COALESCE(MAX(ordem), -1) as last_order FROM tarefas WHERE user_id = $1 AND coluna_id = $2',
            [req.userId, data.coluna_id]
          );
          data.ordem = orderRes.rows[0].last_order + 1;
        }
      }

      const keys = Object.keys(data).filter(k => k !== 'id');
      if (keys.length === 0) return res.status(400).json({ message: 'Nenhum campo para atualizar' });

      const setClause = keys.map((key, i) => `${key} = $${i + 1}`).join(', ');
      const params = [...keys.map(k => data[k]), id, req.userId];

      const r = await pool.query(
        `UPDATE tarefas SET ${setClause}, updated_at = now() WHERE id = $${keys.length + 1} AND user_id = $${keys.length + 2} RETURNING *`,
        params
      );

      if (r.rows.length === 0) return res.status(404).json({ message: 'Tarefa não encontrada' });
      return res.json(r.rows[0]);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // 5. PATCH /api/kanban/tarefas/:id/mover
  router.patch('/tarefas/:id/mover', async (req: AuthRequest, res: Response) => {
    const client = await pool.connect();
    try {
      const { id } = req.params;
      const { coluna_id, ordem } = req.body;

      if (coluna_id === undefined || ordem === undefined) {
        return res.status(400).json({ message: 'coluna_id e ordem são obrigatórios' });
      }

      await client.query('BEGIN');

      const taskRes = await client.query('SELECT coluna_id, ordem FROM tarefas WHERE id = $1 AND user_id = $2', [id, req.userId]);
      if (taskRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Tarefa não encontrada' });
      }

      const oldCol = taskRes.rows[0].coluna_id;
      const oldOrder = taskRes.rows[0].ordem;

      if (oldCol === coluna_id) {
        // Movendo dentro da mesma coluna
        if (ordem > oldOrder) {
          await client.query(
            'UPDATE tarefas SET ordem = ordem - 1 WHERE user_id = $1 AND coluna_id = $2 AND ordem > $3 AND ordem <= $4',
            [req.userId, coluna_id, oldOrder, ordem]
          );
        } else if (ordem < oldOrder) {
          await client.query(
            'UPDATE tarefas SET ordem = ordem + 1 WHERE user_id = $1 AND coluna_id = $2 AND ordem >= $3 AND ordem < $4',
            [req.userId, coluna_id, ordem, oldOrder]
          );
        }
      } else {
        // Movendo para outra coluna
        // Abre espaço na coluna de destino
        await client.query(
          'UPDATE tarefas SET ordem = ordem + 1 WHERE user_id = $1 AND coluna_id = $2 AND ordem >= $3',
          [req.userId, coluna_id, ordem]
        );
        // Fecha buraco na coluna de origem
        await client.query(
          'UPDATE tarefas SET ordem = ordem - 1 WHERE user_id = $1 AND coluna_id = $2 AND ordem > $3',
          [req.userId, oldCol, oldOrder]
        );
      }

      const r = await client.query(
        'UPDATE tarefas SET coluna_id = $1, ordem = $2, updated_at = now() WHERE id = $3 AND user_id = $4 RETURNING *',
        [coluna_id, ordem, id, req.userId]
      );

      await client.query('COMMIT');
      return res.json(r.rows[0]);
    } catch (err: any) {
      await client.query('ROLLBACK');
      return res.status(500).json({ message: err.message });
    } finally {
      client.release();
    }
  });

  // 6. DELETE /api/kanban/tarefas/:id
  router.delete('/tarefas/:id', async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const r = await pool.query('DELETE FROM tarefas WHERE id = $1 AND user_id = $2 RETURNING id', [id, req.userId]);
      if (r.rows.length === 0) return res.status(404).json({ message: 'Tarefa não encontrada' });
      return res.status(204).send();
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // 7. GET /api/kanban/tarefas/:id/comentarios
  router.get('/tarefas/:id/comentarios', async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const r = await pool.query(
        `SELECT tc.*, u.display_name, u.email 
         FROM tarefa_comentarios tc 
         JOIN users u ON u.id = tc.user_id 
         WHERE tc.tarefa_id = $1 
         ORDER BY tc.created_at ASC`,
        [id]
      );
      return res.json(r.rows);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // 8. POST /api/kanban/tarefas/:id/comentarios
  router.post('/tarefas/:id/comentarios', async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { conteudo } = req.body;

      if (!conteudo) return res.status(400).json({ message: 'Conteúdo é obrigatório' });

      const r = await pool.query(
        'INSERT INTO tarefa_comentarios (tarefa_id, user_id, conteudo) VALUES ($1, $2, $3) RETURNING *',
        [id, req.userId, conteudo]
      );

      return res.status(201).json(r.rows[0]);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  return router;
}
