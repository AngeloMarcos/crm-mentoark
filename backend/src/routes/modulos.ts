import { Router, Response } from 'express';
import { Pool } from 'pg';
import { AuthRequest, adminMiddleware } from '../middleware';

// Lista canônica de todos os módulos do sistema
export const TODOS_MODULOS = [
  { key: 'dashboard',   label: 'Dashboard',         padrao: true  },
  { key: 'leads',       label: 'Leads',              padrao: true  },
  { key: 'contatos',    label: 'Contatos',           padrao: true  },
  { key: 'discagem',    label: 'Discagem',           padrao: true  },
  { key: 'funil',       label: 'Funil de Vendas',   padrao: true  },
  { key: 'whatsapp',    label: 'WhatsApp',           padrao: true  },
  { key: 'disparos',    label: 'Disparos',           padrao: true  },
  { key: 'campanhas',   label: 'Campanhas',          padrao: false },
  { key: 'workflows',   label: 'Workflows',          padrao: false },
  { key: 'integracoes', label: 'Integrações',        padrao: false },
  { key: 'agentes',     label: 'Agentes',            padrao: false },
  { key: 'catalogo',    label: 'Catálogo',           padrao: false },
  { key: 'cerebro',     label: 'Cérebro do Agente', padrao: false },
  { key: 'galeria',     label: 'Galeria',            padrao: false },
  { key: 'docs',        label: 'Documentação',       padrao: false },
  { key: 'usuarios',    label: 'Usuários',           padrao: false },
];

const MASTERS = ['angelobispofilho@gmail.com', 'mentoark@gmail.com'];

export default function modulosRouter(pool: Pool): Router {
  const router = Router();

  // ── GET /api/modulos ─────────────────────────────────────────────────────
  // Retorna os módulos habilitados para o usuário autenticado.
  // Admins (masters) recebem todos os módulos automaticamente.
  router.get('/', async (req: AuthRequest, res: Response) => {
    try {
      // Masters: retorna tudo sem consultar a tabela
      if (req.userRole === 'admin' || MASTERS.includes(req.userEmail ?? '')) {
        return res.json(TODOS_MODULOS.map(m => m.key));
      }

      const r = await pool.query(
        `SELECT modulo FROM user_modulos WHERE user_id = $1 AND ativo = true`,
        [req.userId]
      );

      // Se não tiver registro, retorna os módulos padrão (segurança)
      if (r.rows.length === 0) {
        return res.json(TODOS_MODULOS.filter(m => m.padrao).map(m => m.key));
      }

      return res.json(r.rows.map(row => row.modulo));
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ── GET /api/modulos/lista ────────────────────────────────────────────────
  // Retorna a lista canônica de todos os módulos (com label e padrao flag)
  // Usado pelo painel de admin para montar os toggles
  router.get('/lista', adminMiddleware, async (_req: AuthRequest, res: Response) => {
    return res.json(TODOS_MODULOS);
  });

  // ── GET /api/modulos/usuario/:userId ─────────────────────────────────────
  // Admin: retorna módulos habilitados de um usuário específico
  router.get('/usuario/:userId', adminMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const r = await pool.query(
        `SELECT modulo, ativo FROM user_modulos WHERE user_id = $1`,
        [req.params.userId]
      );
      return res.json(r.rows);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ── PUT /api/modulos/usuario/:userId ─────────────────────────────────────
  // Admin: substitui completamente os módulos de um usuário.
  // Body: { modulos: string[] }  — ex: ["dashboard","leads","disparos"]
  router.put('/usuario/:userId', adminMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { modulos } = req.body as { modulos: string[] };
      if (!Array.isArray(modulos)) {
        return res.status(400).json({ message: 'modulos deve ser um array de strings.' });
      }

      // Valida que os módulos existem na lista canônica
      const validos = new Set(TODOS_MODULOS.map(m => m.key));
      const invalidos = modulos.filter(m => !validos.has(m));
      if (invalidos.length) {
        return res.status(400).json({ message: `Módulos inválidos: ${invalidos.join(', ')}` });
      }

      // Upsert: marca ativo=true para os incluídos, ativo=false para os outros
      await pool.query('BEGIN');

      // Desativa todos primeiro
      await pool.query(
        `UPDATE user_modulos SET ativo = false WHERE user_id = $1`,
        [req.params.userId]
      );

      // Ativa/insere os selecionados
      for (const mod of modulos) {
        await pool.query(
          `INSERT INTO user_modulos (user_id, modulo, ativo)
           VALUES ($1, $2, true)
           ON CONFLICT (user_id, modulo) DO UPDATE SET ativo = true`,
          [req.params.userId, mod]
        );
      }

      await pool.query('COMMIT');
      return res.json({ ok: true, modulos_ativos: modulos.length });
    } catch (err: any) {
      await pool.query('ROLLBACK');
      return res.status(500).json({ message: err.message });
    }
  });

  // ── POST /api/modulos/usuario/:userId/toggle ──────────────────────────────
  // Admin: ativa ou desativa um único módulo para um usuário
  // Body: { modulo: string, ativo: boolean }
  router.post('/usuario/:userId/toggle', adminMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { modulo, ativo } = req.body;
      if (!modulo || typeof ativo !== 'boolean') {
        return res.status(400).json({ message: 'modulo e ativo são obrigatórios.' });
      }

      await pool.query(
        `INSERT INTO user_modulos (user_id, modulo, ativo)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, modulo) DO UPDATE SET ativo = $3`,
        [req.params.userId, modulo, ativo]
      );

      return res.json({ ok: true, modulo, ativo });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  return router;
}
