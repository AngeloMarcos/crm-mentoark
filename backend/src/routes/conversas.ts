import { Router, Response } from 'express';
import { Pool } from 'pg';
import { AuthRequest } from '../middleware';
import { log } from '../logger';

export default function conversasRouter(pool: Pool): Router {
  const router = Router();

  // ── 1. LISTAR CONVERSAS COM PAGINAÇÃO E STATUS (GET /api/conversas) ───────
  router.get('/', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const status = (req.query.status as string) || 'open'; // open, pending, closed
      const limit = Math.min(Number(req.query.limit) || 50, 100);
      const offset = Number(req.query.offset) || 0;

      const r = await pool.query(
        `SELECT
           c.id, c.instance_name, c.remote_jid, c.status, c.last_message_at, c.unread_count,
           ct.nome AS contato_nome, ct.telefone AS contato_telefone, ct.profile_pic_url AS contato_foto,
           u.display_name AS agent_name,
           (
             SELECT m.content
             FROM whatsapp_messages m
             WHERE m.conversation_id = c.id
             ORDER BY m.created_at DESC LIMIT 1
           ) AS ultima_mensagem
         FROM conversations c
         INNER JOIN contatos ct ON ct.id = c.contato_id
         LEFT JOIN users u ON u.id = c.assigned_agent_id
         WHERE c.user_id = $1 AND c.status = $2
         ORDER BY c.last_message_at DESC
         LIMIT $3 OFFSET $4`,
        [userId, status, limit, offset]
      );
      return res.json(r.rows);
    } catch (err: any) {
      log.error('CONVERSAS', 'Erro ao listar conversas do Inbox', { err: err.message });
      return res.status(500).json({ message: err.message });
    }
  });

  // ── 2. ATRIBUIR CONVERSA A UM ATENDENTE (PATCH /api/conversas/:id/assign) ──
  router.patch('/:id/assign', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const conversationId = req.params.id;
      const { assigned_agent_id } = req.body as { assigned_agent_id: string | null };

      // Se atribuído, opcionalmente move o status para 'open' (em atendimento)
      const r = await pool.query(
        `UPDATE conversations
         SET assigned_agent_id = $1, status = CASE WHEN $1 IS NOT NULL THEN 'open' ELSE status END, updated_at = NOW()
         WHERE id = $2 AND user_id = $3
         RETURNING *`,
        [assigned_agent_id, conversationId, userId]
      );

      if (!r.rowCount) {
        return res.status(404).json({ message: 'Conversa não encontrada.' });
      }
      return res.json(r.rows[0]);
    } catch (err: any) {
      log.error('CONVERSAS', 'Erro ao atribuir atendente à conversa', { err: err.message });
      return res.status(500).json({ message: err.message });
    }
  });

  // ── 3. ALTERAR STATUS DA CONVERSA (PATCH /api/conversas/:id/status) ────────
  router.patch('/:id/status', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const conversationId = req.params.id;
      const { status } = req.body as { status: 'open' | 'pending' | 'closed' };

      if (!['open', 'pending', 'closed'].includes(status)) {
        return res.status(400).json({ message: 'Status inválido.' });
      }

      const r = await pool.query(
        `UPDATE conversations
         SET status = $1, updated_at = NOW()
         WHERE id = $2 AND user_id = $3
         RETURNING *`,
        [status, conversationId, userId]
      );

      if (!r.rowCount) {
        return res.status(404).json({ message: 'Conversa não encontrada.' });
      }
      return res.json(r.rows[0]);
    } catch (err: any) {
      log.error('CONVERSAS', 'Erro ao atualizar status da conversa', { err: err.message });
      return res.status(500).json({ message: err.message });
    }
  });

  // ── 4. ZERAR CONTADOR DE NÃO-LIDAS (PATCH /api/conversas/:id/read) ──────────
  router.patch('/:id/read', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const conversationId = req.params.id;

      await pool.query(
        `UPDATE conversations SET unread_count = 0, updated_at = NOW()
         WHERE id = $1 AND user_id = $2`,
        [conversationId, userId]
      );

      return res.json({ ok: true });
    } catch (err: any) {
      log.error('CONVERSAS', 'Erro ao zerar contador de leitura', { err: err.message });
      return res.status(500).json({ message: err.message });
    }
  });

  return router;
}
