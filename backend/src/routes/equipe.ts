/**
 * equipe.ts — Rotas de gerenciamento de equipes e chat interno
 *
 * Modelo de dados:
 *  equipes          → uma equipe por usuário (owner_id)
 *  equipe_membros   → N membros por equipe (role: 'membro' | 'gerente')
 *  equipe_chat      → mensagens do chat interno da equipe
 *
 * Endpoints:
 *  GET  /api/equipes/minha              → equipe do usuário + lista de membros
 *  POST /api/equipes                    → criar nova equipe (dono vira gerente)
 *  GET  /api/equipes/:id/membros        → listar membros
 *  POST /api/equipes/:id/convidar       → convidar por email (usuário já cadastrado)
 *  DELETE /api/equipes/:id/membros/:uid → remover membro
 *  PATCH  /api/equipes/:id/membros/:uid → alterar papel (owner only)
 *  GET  /api/equipes/:id/chat           → últimas 50 mensagens do chat
 *  POST /api/equipes/:id/chat           → enviar mensagem no chat
 *
 * Autorização:
 *  - Apenas owner e gerentes podem convidar/remover membros
 *  - Apenas o owner pode alterar papéis
 *  - Todos os membros podem enviar mensagens no chat
 */

import { Router, Response } from 'express';
import { Pool } from 'pg';
import { AuthRequest } from '../middleware';

export default function equipeRouter(pool: Pool): Router {
  const router = Router();

  const wrap = (fn: Function) => async (req: AuthRequest, res: Response) => {
    try {
      await fn(req, res);
    } catch (err: any) {
      console.error('[equipe]', err.message);
      res.status(500).json({ message: err.message });
    }
  };

  // 1. GET /api/equipes/minha
  router.get('/minha', wrap(async (req: AuthRequest, res: Response) => {
    const userId = req.userId!;

    // Busca a equipe onde o usuário é owner ou membro
    const equipeRes = await pool.query(
      `SELECT DISTINCT e.*
       FROM equipes e
       LEFT JOIN equipe_membros em ON em.equipe_id = e.id
       WHERE e.owner_id = $1 OR em.user_id = $1
       ORDER BY e.created_at DESC LIMIT 1`,
      [userId]
    );

    if (!equipeRes.rows.length) {
      return res.json({ equipe: null, membros: [] });
    }

    const equipe = equipeRes.rows[0];

    // Buscar membros com nome e email
    const membrosRes = await pool.query(
      `SELECT em.user_id, em.role, em.joined_at,
              COALESCE(u.display_name, u.email) AS display_name,
              u.email
       FROM equipe_membros em
       JOIN users u ON u.id = em.user_id
       WHERE em.equipe_id = $1
       ORDER BY em.joined_at ASC`,
      [equipe.id]
    );

    res.json({ equipe, membros: membrosRes.rows });
  }));

  // 2. POST /api/equipes
  router.post('/', wrap(async (req: AuthRequest, res: Response) => {
    const { nome } = req.body;
    const userId = req.userId!;

    if (!nome) return res.status(400).json({ message: 'Nome é obrigatório' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Criar equipe
      const resEquipe = await client.query(
        `INSERT INTO equipes (nome, owner_id) VALUES ($1, $2) RETURNING *`,
        [nome, userId]
      );
      const equipe = resEquipe.rows[0];

      // Inserir criador como gerente
      await client.query(
        `INSERT INTO equipe_membros (equipe_id, user_id, role) VALUES ($1, $2, 'gerente')`,
        [equipe.id, userId]
      );

      await client.query('COMMIT');
      res.status(201).json(equipe);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }));

  // Helper para validar se o usuário é membro/owner
  const checkAccess = async (equipeId: string, userId: string) => {
    const r = await pool.query(
      `SELECT e.owner_id, em.role 
       FROM equipes e
       LEFT JOIN equipe_membros em ON em.equipe_id = e.id AND em.user_id = $2
       WHERE e.id = $1`,
      [equipeId, userId]
    );
    if (r.rowCount === 0) return null;
    return {
      isOwner: r.rows[0].owner_id === userId,
      role: r.rows[0].role
    };
  };

  // 3. GET /api/equipes/:id/membros
  router.get('/:id/membros', wrap(async (req: AuthRequest, res: Response) => {
    const equipeId = req.params.id;
    const userId = req.userId!;

    const access = await checkAccess(equipeId, userId);
    if (!access || (!access.isOwner && !access.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }

    const r = await pool.query(
      `SELECT em.user_id, COALESCE(u.display_name, u.email) as nome, u.email, em.role, em.joined_at
       FROM equipe_membros em
       JOIN users u ON u.id = em.user_id
       WHERE em.equipe_id = $1
       ORDER BY em.joined_at ASC`,
      [equipeId]
    );

    res.json(r.rows);
  }));

  // 4. POST /api/equipes/:id/convidar
  router.post('/:id/convidar', wrap(async (req: AuthRequest, res: Response) => {
    const equipeId = req.params.id;
    const inviterId = req.userId!;
    const { email, role } = req.body;

    if (!email) return res.status(400).json({ message: 'Email é obrigatório' });

    const access = await checkAccess(equipeId, inviterId);
    if (!access || (!access.isOwner && access.role !== 'gerente')) {
      return res.status(403).json({ message: 'Apenas proprietários ou gerentes podem convidar' });
    }

    // Busca usuário por email
    const userRes = await pool.query(
      `SELECT id, COALESCE(display_name, email) as nome FROM users WHERE email = $1`,
      [email]
    );
    if (userRes.rowCount === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado. Peça que ele crie uma conta primeiro, ou use a tela de Sub-perfis para criar um acesso.' });
    }
    const targetUser = userRes.rows[0];

    await pool.query(
      `INSERT INTO equipe_membros (equipe_id, user_id, role, convidado_por)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (equipe_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [equipeId, targetUser.id, role || 'membro', inviterId]
    );

    res.json({ success: true, user_id: targetUser.id, nome: targetUser.nome });
  }));

  // 4b. GET /api/equipes/:id/membros-disponiveis
  router.get('/:id/membros-disponiveis', wrap(async (req: AuthRequest, res: Response) => {
    const equipeId = req.params.id;
    const userId = req.userId!;

    const access = await checkAccess(equipeId, userId);
    if (!access || (!access.isOwner && access.role !== 'gerente')) {
      return res.status(403).json({ message: 'Acesso negado' });
    }

    const r = await pool.query(
      `SELECT u.id, u.email, u.display_name
       FROM users u
       WHERE u.owner_id = $1
         AND u.active = true
         AND NOT EXISTS (
           SELECT 1 FROM equipe_membros em 
           WHERE em.user_id = u.id AND em.equipe_id = $2
         )
       ORDER BY u.display_name ASC, u.email ASC`,
      [userId, equipeId]
    );

    res.json(r.rows);
  }));

  // 4c. POST /api/equipes/:id/membros
  router.post('/:id/membros', wrap(async (req: AuthRequest, res: Response) => {
    const equipeId = req.params.id;
    const adminId = req.userId!;
    const { user_id, role } = req.body;

    if (!user_id) return res.status(400).json({ message: 'user_id é obrigatório' });
    if (!['membro', 'gerente'].includes(role)) {
      return res.status(400).json({ message: 'Role inválida' });
    }

    const access = await checkAccess(equipeId, adminId);
    if (!access || (!access.isOwner && access.role !== 'gerente')) {
      return res.status(403).json({ message: 'Apenas proprietários ou gerentes podem adicionar membros' });
    }

    // Validações do usuário a ser adicionado
    const userCheck = await pool.query(
      `SELECT id, email, display_name, active, owner_id FROM users WHERE id = $1`,
      [user_id]
    );

    if (userCheck.rowCount === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    const targetUser = userCheck.rows[0];

    if (!targetUser.active) {
      return res.status(400).json({ message: 'O usuário selecionado está inativo' });
    }

    if (targetUser.owner_id !== adminId) {
      return res.status(403).json({ message: 'Você só pode adicionar membros que você mesmo cadastrou' });
    }

    const r = await pool.query(
      `INSERT INTO equipe_membros (equipe_id, user_id, role, convidado_por)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [equipeId, targetUser.id, role, adminId]
    );

    const inserted = r.rows[0];

    res.status(201).json({
      ...inserted,
      display_name: targetUser.display_name,
      email: targetUser.email
    });
  }));

  // 5. DELETE /api/equipes/:id/membros/:userId
  router.delete('/:id/membros/:userId', wrap(async (req: AuthRequest, res: Response) => {
    const equipeId = req.params.id;
    const removerId = req.userId!;
    const targetUserId = req.params.userId;

    const access = await checkAccess(equipeId, removerId);
    if (!access || (!access.isOwner && access.role !== 'gerente')) {
      return res.status(403).json({ message: 'Sem permissão para remover membros' });
    }

    // Não pode remover o próprio owner
    const equipeRes = await pool.query(`SELECT owner_id FROM equipes WHERE id = $1`, [equipeId]);
    if (equipeRes.rows[0].owner_id === targetUserId) {
      return res.status(400).json({ message: 'Não é possível remover o proprietário da equipe' });
    }

    await pool.query(
      `DELETE FROM equipe_membros WHERE equipe_id = $1 AND user_id = $2`,
      [equipeId, targetUserId]
    );

    res.status(204).send();
  }));

  // 6. PATCH /api/equipes/:id/membros/:userId
  router.patch('/:id/membros/:userId', wrap(async (req: AuthRequest, res: Response) => {
    const equipeId = req.params.id;
    const updaterId = req.userId!;
    const targetUserId = req.params.userId;
    const { role } = req.body;

    if (!['membro', 'gerente'].includes(role)) {
      return res.status(400).json({ message: 'Role inválida' });
    }

    const access = await checkAccess(equipeId, updaterId);
    if (!access || !access.isOwner) {
      return res.status(403).json({ message: 'Apenas o proprietário pode alterar papéis' });
    }

    await pool.query(
      `UPDATE equipe_membros SET role = $1 WHERE equipe_id = $2 AND user_id = $3`,
      [role, equipeId, targetUserId]
    );

    res.json({ success: true });
  }));

  // 7. GET /api/equipes/:id/chat
  router.get('/:id/chat', wrap(async (req: AuthRequest, res: Response) => {
    const equipeId = req.params.id;
    const userId = req.userId!;

    const access = await checkAccess(equipeId, userId);
    if (!access || (!access.isOwner && !access.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }

    const r = await pool.query(
      `SELECT ec.*, u.display_name as nome, u.email
       FROM equipe_chat ec
       JOIN users u ON u.id = ec.user_id
       WHERE ec.equipe_id = $1
       ORDER BY ec.created_at DESC
       LIMIT 50`,
      [equipeId]
    );

    // Retornar em ordem ASC para o chat
    res.json(r.rows.reverse());
  }));

  // 8. POST /api/equipes/:id/chat
  router.post('/:id/chat', wrap(async (req: AuthRequest, res: Response) => {
    const equipeId = req.params.id;
    const userId = req.userId!;
    const { conteudo } = req.body;

    if (!conteudo || String(conteudo).trim().length === 0) {
      return res.status(400).json({ message: 'Conteúdo não pode estar vazio' });
    }
    if (String(conteudo).length > 2000) {
      return res.status(400).json({ message: 'Mensagem muito longa (máximo 2000 caracteres)' });
    }

    const access = await checkAccess(equipeId, userId);
    if (!access || (!access.isOwner && !access.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }

    const r = await pool.query(
      `WITH inserted AS (
        INSERT INTO equipe_chat (equipe_id, user_id, conteudo)
        VALUES ($1, $2, $3)
        RETURNING *
      )
      SELECT i.*, u.display_name as nome, u.email
      FROM inserted i
      JOIN users u ON u.id = i.user_id`,
      [equipeId, userId, conteudo]
    );

    res.status(201).json(r.rows[0]);
  }));

  return router;
}
