import { Router, Response } from 'express';
import { Pool } from 'pg';
import { AuthRequest } from '../middleware';
import { log } from '../logger';

export default function kanban(pool: Pool): Router {
  const router = Router();

  // 0. POST /api/kanban/tarefas/da-conversa
  router.post('/tarefas/da-conversa', async (req: AuthRequest, res: Response) => {
    try {
      const { conversa_id, titulo: tituloManual } = req.body;
      const userId = req.userId;

      if (!conversa_id) return res.status(400).json({ message: 'conversa_id é obrigatório' });

      // 1. Buscar mensagens contextuais
      const msgsRes = await pool.query(
        `SELECT role, message->>'content' as content 
         FROM n8n_chat_histories 
         WHERE session_id = $1 AND user_id = $2 
         ORDER BY created_at DESC LIMIT 10`,
        [conversa_id, userId]
      );
      
      const context = msgsRes.rows.reverse().map(m => `${m.role}: ${m.content}`).join('\n');

      // 2. Chamar IA para resumo (Usando fetch direto para Anthropic)
      let aiResult = { titulo: tituloManual || 'Nova Tarefa da IA', resumo: '', prioridade: 'media' };
      
      const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
      if (ANTHROPIC_KEY) {
        try {
          const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': ANTHROPIC_KEY,
              'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
              model: 'claude-3-haiku-20240307',
              max_tokens: 500,
              messages: [{
                role: 'user',
                content: `Resuma em 2-3 linhas o assunto desta conversa e sugira um título de tarefa. 
                Retorne APENAS um JSON: { "titulo": "string", "resumo": "string", "prioridade": "baixa"|"media"|"alta" }
                
                Conversa:
                ${context}`
              }]
            })
          });
          
          const aiJson: any = await aiResp.json();
          const text = aiJson.content?.[0]?.text || '';
          const match = text.match(/\{.*\}/s);
          if (match) {
            const parsed = JSON.parse(match[0]);
            aiResult = {
              titulo: tituloManual || parsed.titulo,
              resumo: parsed.resumo,
              prioridade: parsed.prioridade || 'media'
            };
          }
        } catch (err: any) {
          log.error('IA_KANBAN', 'Erro ao chamar Anthropic', { err: err?.message, stack: err?.stack });
        }
      }

      // 3. Buscar coluna Backlog (ou a primeira disponível)
      const colRes = await pool.query(
        "SELECT id FROM kanban_colunas WHERE user_id = $1 AND nome ILIKE '%Backlog%' LIMIT 1",
        [userId]
      );
      let colunaId = colRes.rows[0]?.id;
      
      if (!colunaId) {
        const firstCol = await pool.query(
          "SELECT id FROM kanban_colunas WHERE user_id = $1 ORDER BY ordem ASC LIMIT 1",
          [userId]
        );
        colunaId = firstCol.rows[0]?.id;
      }

      if (!colunaId) return res.status(400).json({ message: 'Nenhuma coluna de Kanban encontrada para o usuário.' });

      // 4. Inserir tarefa
      const orderRes = await pool.query(
        'SELECT COALESCE(MAX(ordem), -1) as last_order FROM tarefas WHERE user_id = $1 AND coluna_id = $2',
        [userId, colunaId]
      );
      
      const insRes = await pool.query(
        `INSERT INTO tarefas (
          user_id, coluna_id, titulo, resumo_ia, prioridade, 
          ordem, conversa_id, origem, criada_por
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
        RETURNING *`,
        [userId, colunaId, aiResult.titulo, aiResult.resumo, aiResult.prioridade, 
         orderRes.rows[0].last_order + 1, conversa_id, 'ia', userId]
      );

      return res.status(201).json(insRes.rows[0]);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // 0b. POST /api/kanban/colunas — criar nova coluna
  router.post('/colunas', async (req: AuthRequest, res: Response) => {
    try {
      const { nome, cor, ordem } = req.body;
      if (!nome) return res.status(400).json({ message: 'Nome é obrigatório' });
      const r = await pool.query(
        'INSERT INTO kanban_colunas (user_id, nome, cor, ordem) VALUES ($1, $2, $3, $4) RETURNING *',
        [req.userId, nome, cor || '#f1f5f9', ordem ?? 99]
      );
      return res.status(201).json(r.rows[0]);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // 0c. PATCH /api/kanban/colunas/:id — renomear coluna
  router.patch('/colunas/:id', async (req: AuthRequest, res: Response) => {
    try {
      const { nome, cor } = req.body;
      const sets: string[] = [];
      const params: any[] = [];
      if (nome)  { params.push(nome); sets.push(`nome = $${params.length}`); }
      if (cor)   { params.push(cor);  sets.push(`cor = $${params.length}`); }
      if (!sets.length) return res.status(400).json({ message: 'Nenhum campo para atualizar' });
      params.push(req.params.id); params.push(req.userId);
      const r = await pool.query(
        `UPDATE kanban_colunas SET ${sets.join(', ')} WHERE id = $${params.length - 1} AND user_id = $${params.length} RETURNING *`,
        params
      );
      if (!r.rows.length) return res.status(404).json({ message: 'Coluna não encontrada' });
      return res.json(r.rows[0]);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // 0d. DELETE /api/kanban/colunas/:id — excluir coluna vazia
  router.delete('/colunas/:id', async (req: AuthRequest, res: Response) => {
    try {
      const countRes = await pool.query(
        'SELECT COUNT(*) FROM tarefas WHERE coluna_id = $1 AND user_id = $2',
        [req.params.id, req.userId]
      );
      if (parseInt(countRes.rows[0].count) > 0) {
        return res.status(400).json({ message: 'Mova as tarefas antes de excluir a coluna' });
      }
      await pool.query('DELETE FROM kanban_colunas WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
      return res.status(204).send();
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

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

// ─── Webhook público do n8n (sem JWT) ─────────────────────────────────────────
// Registrar no index.ts ANTES do authMiddleware:
//   app.post('/api/kanban/webhook/n8n', kanbanWebhookN8n(pool));
export function kanbanWebhookN8n(pool: Pool) {
  return async (req: any, res: Response) => {
    try {
      const secret = req.headers['x-webhook-secret'] as string;
      if (!process.env.N8N_WEBHOOK_SECRET || secret !== process.env.N8N_WEBHOOK_SECRET) {
        return res.status(401).json({ message: 'Webhook secret inválido' });
      }

      const {
        user_id, titulo, resumo, contato_nome, contato_telefone,
        remote_jid, instance_name, conversa_id, prioridade,
      } = req.body;

      if (!user_id || !titulo) {
        return res.status(400).json({ message: 'user_id e titulo são obrigatórios' });
      }

      // Buscar coluna Backlog do usuário — ou criar as 4 colunas padrão
      let backlogRes = await pool.query(
        `SELECT id FROM kanban_colunas WHERE user_id = $1 AND nome = 'Backlog' LIMIT 1`,
        [user_id]
      );

      if (!backlogRes.rows.length) {
        const colunasPadrao = [
          { nome: 'Backlog',       cor: '#f1f5f9', ordem: 0 },
          { nome: 'Em Andamento',  cor: '#dbeafe', ordem: 1 },
          { nome: 'Em Revisão',    cor: '#fef9c3', ordem: 2 },
          { nome: 'Concluído',     cor: '#dcfce7', ordem: 3 },
        ];
        for (const c of colunasPadrao) {
          await pool.query(
            `INSERT INTO kanban_colunas (user_id, nome, cor, ordem)
             VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
            [user_id, c.nome, c.cor, c.ordem]
          );
        }
        backlogRes = await pool.query(
          `SELECT id FROM kanban_colunas WHERE user_id = $1 AND nome = 'Backlog' LIMIT 1`,
          [user_id]
        );
      }

      const backlogId = backlogRes.rows[0]?.id;
      if (!backlogId) {
        return res.status(500).json({ message: 'Falha ao encontrar/criar coluna Backlog' });
      }

      // Calcular próxima ordem
      const orderRes = await pool.query(
        `SELECT COALESCE(MAX(ordem), -1) + 1 AS next_ordem
         FROM tarefas WHERE coluna_id = $1 AND user_id = $2`,
        [backlogId, user_id]
      );
      const nextOrdem = orderRes.rows[0].next_ordem;

      // Inserir tarefa
      const r = await pool.query(
        `INSERT INTO tarefas
           (user_id, coluna_id, titulo, descricao, contato_nome, contato_telefone,
            remote_jid, instance_name, conversa_id, prioridade, origem, ordem)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'n8n',$11)
         RETURNING id`,
        [
          user_id, backlogId, titulo, resumo || null,
          contato_nome || null, contato_telefone || null,
          remote_jid || null, instance_name || null,
          conversa_id || null, prioridade || 'media',
          nextOrdem,
        ]
      );

      return res.json({ success: true, tarefa_id: r.rows[0].id, coluna: 'Backlog' });
    } catch (err: any) {
      log.error('KANBAN_WEBHOOK', 'Erro', { err: err?.message, stack: err?.stack });
      return res.status(500).json({ message: err.message });
    }
  };
}
