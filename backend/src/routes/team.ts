import { Router, Response } from 'express';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { AuthRequest } from '../middleware';
import { log } from '../logger';
import { TODOS_MODULOS } from './modulos';

const MODULOS_DELEGAVEIS = new Set(TODOS_MODULOS.filter(m => !m.adminOnly).map(m => m.key));

/**
 * /api/team/*  — pessoas, perfis (roles), permissões e convites.
 * Owner derivation: hoje cada user é o seu próprio owner.
 * (No futuro, quando um convidado aceitar, ele herda o owner_id do convite.)
 */
export default function teamRouter(pool: Pool): Router {
  const router = Router();

  const wrap = (fn: Function) => async (req: AuthRequest, res: Response) => {
    try { await fn(req, res); }
    catch (err: any) {
      log.error('TEAM', 'Erro', { err: err?.message, stack: err?.stack });
      res.status(500).json({ message: err.message });
    }
  };

  // Resolve owner_id do user logado: se ele é membro de um workspace, usa esse owner;
  // caso contrário ele é o próprio owner.
  async function ownerOf(userId: string): Promise<string> {
    const r = await pool.query(
      `SELECT owner_id FROM team_members
       WHERE user_id = $1 AND status = 'ativo'
       ORDER BY (owner_id = user_id) DESC, created_at ASC
       LIMIT 1`,
      [userId]
    );
    return r.rows[0]?.owner_id || userId;
  }

  async function isOwnerOrAdmin(userId: string, ownerId: string): Promise<boolean> {
    if (userId === ownerId) return true;
    const r = await pool.query(
      `SELECT 1
         FROM team_members tm
         JOIN team_member_roles tmr ON tmr.member_id = tm.id
         JOIN team_roles tr         ON tr.id = tmr.role_id
        WHERE tm.user_id = $1 AND tm.owner_id = $2
          AND tr.nome IN ('Owner','Admin')
        LIMIT 1`,
      [userId, ownerId]
    );
    return r.rowCount! > 0;
  }

  // ─────────────────────────── PESSOAS ───────────────────────────
  router.get('/members', wrap(async (req: AuthRequest, res: Response) => {
    const ownerId = await ownerOf(req.userId!);
    const r = await pool.query(
      `SELECT tm.*,
              COALESCE(
                json_agg(json_build_object('id', tr.id, 'nome', tr.nome, 'cor', tr.cor))
                  FILTER (WHERE tr.id IS NOT NULL),
                '[]'
              ) AS roles
         FROM team_members tm
         LEFT JOIN team_member_roles tmr ON tmr.member_id = tm.id
         LEFT JOIN team_roles tr         ON tr.id = tmr.role_id
        WHERE tm.owner_id = $1
        GROUP BY tm.id
        ORDER BY tm.created_at ASC`,
      [ownerId]
    );
    res.json(r.rows);
  }));

  router.post('/members', wrap(async (req: AuthRequest, res: Response) => {
    const ownerId = await ownerOf(req.userId!);
    if (!(await isOwnerOrAdmin(req.userId!, ownerId))) {
      return res.status(403).json({ message: 'Sem permissão para convidar pessoas' });
    }
    const { email, nome, cargo, role_ids } = req.body || {};
    if (!email || !nome) return res.status(400).json({ message: 'email e nome são obrigatórios' });

    const token = uuidv4();
    const expira = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const ins = await pool.query(
      `INSERT INTO team_members
        (owner_id, email, nome, cargo, status, convite_token, convite_expira_at)
       VALUES ($1, lower($2), $3, $4, 'convidado', $5, $6)
       ON CONFLICT (owner_id, email) DO UPDATE
         SET nome = EXCLUDED.nome,
             cargo = EXCLUDED.cargo,
             convite_token = EXCLUDED.convite_token,
             convite_expira_at = EXCLUDED.convite_expira_at,
             status = CASE WHEN team_members.status = 'inativo' THEN 'convidado' ELSE team_members.status END,
             updated_at = NOW()
       RETURNING *`,
      [ownerId, email, nome, cargo || null, token, expira]
    );
    const member = ins.rows[0];

    if (Array.isArray(role_ids) && role_ids.length) {
      await pool.query(`DELETE FROM team_member_roles WHERE member_id = $1`, [member.id]);
      for (const rid of role_ids) {
        await pool.query(
          `INSERT INTO team_member_roles (member_id, role_id)
           SELECT $1, $2 WHERE EXISTS
             (SELECT 1 FROM team_roles WHERE id = $2 AND owner_id = $3)
           ON CONFLICT DO NOTHING`,
          [member.id, rid, ownerId]
        );
      }
    }

    const baseUrl = process.env.APP_PUBLIC_URL || 'https://crm.mentoark.com.br';
    res.status(201).json({ ...member, invite_url: `${baseUrl}/convite/${token}` });
  }));

  router.patch('/members/:id', wrap(async (req: AuthRequest, res: Response) => {
    const ownerId = await ownerOf(req.userId!);
    const isAdmin = await isOwnerOrAdmin(req.userId!, ownerId);
    const isSelf  = req.params.id && (await pool.query(
      `SELECT 1 FROM team_members WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.userId])
    ).rowCount! > 0;
    if (!isAdmin && !isSelf) return res.status(403).json({ message: 'Sem permissão' });

    const { nome, cargo, bio, avatar_url, status, role_ids } = req.body || {};
    const sets: string[] = [];
    const vals: any[] = [];
    let i = 1;
    const push = (sql: string, v: any) => { sets.push(sql.replace('?', `$${i++}`)); vals.push(v); };
    if (nome       !== undefined) push('nome = ?', nome);
    if (cargo      !== undefined) push('cargo = ?', cargo);
    if (bio        !== undefined) push('bio = ?', bio);
    if (avatar_url !== undefined) push('avatar_url = ?', avatar_url);
    if (status     !== undefined && isAdmin) push('status = ?', status);

    if (sets.length) {
      vals.push(req.params.id, ownerId);
      await pool.query(
        `UPDATE team_members SET ${sets.join(', ')}, updated_at = NOW()
         WHERE id = $${i++} AND owner_id = $${i}`,
        vals
      );
    }

    if (Array.isArray(role_ids) && isAdmin) {
      await pool.query(`DELETE FROM team_member_roles WHERE member_id = $1`, [req.params.id]);
      for (const rid of role_ids) {
        await pool.query(
          `INSERT INTO team_member_roles (member_id, role_id)
           SELECT $1, $2 WHERE EXISTS
             (SELECT 1 FROM team_roles WHERE id = $2 AND owner_id = $3)
           ON CONFLICT DO NOTHING`,
          [req.params.id, rid, ownerId]
        );
      }
    }

    const r = await pool.query(`SELECT * FROM team_members WHERE id = $1 AND owner_id = $2`, [req.params.id, ownerId]);
    res.json(r.rows[0]);
  }));

  router.delete('/members/:id', wrap(async (req: AuthRequest, res: Response) => {
    const ownerId = await ownerOf(req.userId!);
    if (!(await isOwnerOrAdmin(req.userId!, ownerId))) {
      return res.status(403).json({ message: 'Sem permissão' });
    }
    // soft delete — não pode inativar o próprio owner
    await pool.query(
      `UPDATE team_members SET status = 'inativo', updated_at = NOW()
       WHERE id = $1 AND owner_id = $2 AND user_id IS DISTINCT FROM $2`,
      [req.params.id, ownerId]
    );
    res.status(204).send();
  }));

  // ─────────────────────────── ROLES ─────────────────────────────
  router.get('/roles', wrap(async (req: AuthRequest, res: Response) => {
    const ownerId = await ownerOf(req.userId!);
    const r = await pool.query(
      `SELECT tr.*,
              COALESCE(
                json_agg(json_build_object('modulo', p.modulo, 'acao', p.acao))
                  FILTER (WHERE p.modulo IS NOT NULL),
                '[]'
              ) AS permissions
         FROM team_roles tr
         LEFT JOIN team_role_permissions p ON p.role_id = tr.id
        WHERE tr.owner_id = $1
        GROUP BY tr.id
        ORDER BY tr.is_system DESC, tr.nome ASC`,
      [ownerId]
    );
    res.json(r.rows);
  }));

  router.post('/roles', wrap(async (req: AuthRequest, res: Response) => {
    const ownerId = await ownerOf(req.userId!);
    if (!(await isOwnerOrAdmin(req.userId!, ownerId))) return res.status(403).json({ message: 'Sem permissão' });
    const { nome, cor, descricao } = req.body || {};
    if (!nome) return res.status(400).json({ message: 'nome obrigatório' });
    const r = await pool.query(
      `INSERT INTO team_roles (owner_id, nome, cor, descricao)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [ownerId, nome, cor || '#3b82f6', descricao || null]
    );
    res.status(201).json(r.rows[0]);
  }));

  router.patch('/roles/:id', wrap(async (req: AuthRequest, res: Response) => {
    const ownerId = await ownerOf(req.userId!);
    if (!(await isOwnerOrAdmin(req.userId!, ownerId))) return res.status(403).json({ message: 'Sem permissão' });
    const { nome, cor, descricao } = req.body || {};
    const sets: string[] = [];
    const vals: any[] = [];
    let i = 1;
    if (nome      !== undefined) { sets.push(`nome = $${i++}`);      vals.push(nome); }
    if (cor       !== undefined) { sets.push(`cor = $${i++}`);       vals.push(cor); }
    if (descricao !== undefined) { sets.push(`descricao = $${i++}`); vals.push(descricao); }
    if (!sets.length) return res.json({});
    vals.push(req.params.id, ownerId);
    const r = await pool.query(
      `UPDATE team_roles SET ${sets.join(', ')}
       WHERE id = $${i++} AND owner_id = $${i} AND is_system = false
       RETURNING *`,
      vals
    );
    res.json(r.rows[0] || {});
  }));

  router.delete('/roles/:id', wrap(async (req: AuthRequest, res: Response) => {
    const ownerId = await ownerOf(req.userId!);
    if (!(await isOwnerOrAdmin(req.userId!, ownerId))) return res.status(403).json({ message: 'Sem permissão' });
    const r = await pool.query(
      `DELETE FROM team_roles WHERE id = $1 AND owner_id = $2 AND is_system = false`,
      [req.params.id, ownerId]
    );
    if (!r.rowCount) return res.status(400).json({ message: 'Role não encontrada ou é do sistema' });
    res.status(204).send();
  }));

  // PUT /api/team/roles/:id/permissions  body: { permissions: [{modulo, acao}, ...] }
  router.put('/roles/:id/permissions', wrap(async (req: AuthRequest, res: Response) => {
    const ownerId = await ownerOf(req.userId!);
    if (!(await isOwnerOrAdmin(req.userId!, ownerId))) return res.status(403).json({ message: 'Sem permissão' });
    const role = await pool.query(`SELECT id, nome FROM team_roles WHERE id = $1 AND owner_id = $2`, [req.params.id, ownerId]);
    if (!role.rows.length) return res.status(404).json({ message: 'Role não encontrada' });
    if (role.rows[0].nome === 'Owner') return res.status(400).json({ message: 'Não é possível alterar permissões do Owner' });

    const perms: Array<{ modulo: string; acao: string }> = Array.isArray(req.body?.permissions) ? req.body.permissions : [];
    await pool.query(`DELETE FROM team_role_permissions WHERE role_id = $1`, [req.params.id]);
    for (const p of perms) {
      if (!p?.modulo || !p?.acao) continue;
      if (!MODULOS_DELEGAVEIS.has(p.modulo)) continue; // módulos admin-only nunca são delegáveis via papel de equipe
      await pool.query(
        `INSERT INTO team_role_permissions (role_id, modulo, acao)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [req.params.id, p.modulo, p.acao]
      );
    }
    res.json({ ok: true, count: perms.length });
  }));

  // ─────────────── Permissões consolidadas do user logado ────────
  router.get('/me/permissions', wrap(async (req: AuthRequest, res: Response) => {
    const ownerId = await ownerOf(req.userId!);
    const r = await pool.query(
      `SELECT DISTINCT p.modulo, p.acao
         FROM team_members tm
         JOIN team_member_roles tmr ON tmr.member_id = tm.id
         JOIN team_role_permissions p ON p.role_id = tmr.role_id
        WHERE tm.user_id = $1 AND tm.owner_id = $2 AND tm.status = 'ativo'`,
      [req.userId, ownerId]
    );
    res.json({ owner_id: ownerId, is_owner: ownerId === req.userId, permissions: r.rows });
  }));

  // ────────────────────────── CONVITE ────────────────────────────
  // PÚBLICO — GET /api/team/invite/:token (sem auth) — info do convite
  // Como esse router é montado dentro de /api (protegido), expomos via /auth abaixo.

  return router;
}

/**
 * Sub-router PÚBLICO para fluxo de convite — montado em /auth.
 */
export function teamInvitePublicRouter(pool: Pool): Router {
  const router = Router();

  router.get('/invite/:token', async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT tm.id, tm.email, tm.nome, tm.cargo, tm.owner_id, tm.convite_expira_at,
                u.display_name AS owner_nome, u.email AS owner_email
           FROM team_members tm
           JOIN users u ON u.id = tm.owner_id
          WHERE tm.convite_token = $1 AND tm.status = 'convidado'`,
        [req.params.token]
      );
      if (!r.rows.length) return res.status(404).json({ message: 'Convite inválido ou já utilizado' });
      const m = r.rows[0];
      if (new Date(m.convite_expira_at) < new Date()) return res.status(410).json({ message: 'Convite expirado' });
      res.json(m);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /auth/accept-invite  { token, senha, nome? }
  router.post('/accept-invite', async (req, res) => {
    const bcrypt = await import('bcryptjs');
    const { token, senha, nome } = req.body || {};
    if (!token || !senha) return res.status(400).json({ message: 'token e senha obrigatórios' });
    if (String(senha).length < 8) return res.status(400).json({ message: 'Senha deve ter ao menos 8 caracteres' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const r = await client.query(
        `SELECT * FROM team_members WHERE convite_token = $1 AND status = 'convidado' FOR UPDATE`,
        [token]
      );
      if (!r.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Convite inválido' }); }
      const m = r.rows[0];
      if (new Date(m.convite_expira_at) < new Date()) {
        await client.query('ROLLBACK');
        return res.status(410).json({ message: 'Convite expirado' });
      }

      // Cria ou reutiliza user
      const existing = await client.query(`SELECT id FROM users WHERE email = $1`, [m.email]);
      let userId: string;
      if (existing.rows.length) {
        userId = existing.rows[0].id;
      } else {
        const hash = await bcrypt.default.hash(String(senha), 12);
        const ins = await client.query(
          `INSERT INTO users (email, password_hash, display_name, role, active, email_verified)
           VALUES ($1, $2, $3, 'user', true, true) RETURNING id`,
          [m.email, hash, nome || m.nome]
        );
        userId = ins.rows[0].id;
      }

      await client.query(
        `UPDATE team_members
           SET user_id = $1, status = 'ativo', convite_token = NULL, convite_expira_at = NULL, updated_at = NOW(),
               nome = COALESCE($2, nome)
         WHERE id = $3`,
        [userId, nome || null, m.id]
      );
      await client.query('COMMIT');
      res.json({ ok: true, email: m.email });
    } catch (err: any) {
      await client.query('ROLLBACK');
      res.status(500).json({ message: err.message });
    } finally {
      client.release();
    }
  });

  return router;
}
