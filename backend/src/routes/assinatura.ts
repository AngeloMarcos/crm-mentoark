/**
 * assinatura.ts — status da assinatura do tenant + pedido de reativação.
 *
 * [AUDITORIA] LÓGICA (2026-09-10 — trial de 3 dias): rotas de LEITURA/pedido, nunca são
 * bloqueadas pela trava de assinatura (a allowlist do assinaturaGuard inclui /api/assinatura).
 * O painel super-admin de assinaturas (listar todos os tenants, ativar/estender) fica em
 * routes/admin_assinaturas.ts (Fase 3), separado.
 */
import { Router, Response } from 'express';
import { Pool } from 'pg';
import { AuthRequest } from '../middleware';
import { log } from '../logger';
import { getAssinatura, resolverOwnerId, invalidarAssinaturaCache } from '../services/subscription';

export default function assinaturaRouter(pool: Pool): Router {
  const router = Router();

  // GET /api/assinatura — usado pelo banner do frontend
  router.get('/', async (req: AuthRequest, res: Response) => {
    try {
      const ownerId = await resolverOwnerId(pool, req.userId!);
      const a = await getAssinatura(pool, ownerId);
      return res.json({
        status: a.status,
        plano: a.plano,
        trial_fim: a.trial_fim,
        dias_restantes: a.dias_restantes,
        read_only: a.read_only,
        sou_dono: ownerId === req.userId,
      });
    } catch (err: any) {
      log.error('ASSINATURA', 'Erro ao ler status', { err: err?.message });
      // fail-open: banner some, nada trava
      return res.json({ status: 'ativa', plano: 'free', trial_fim: null, dias_restantes: 0, read_only: false, sou_dono: false });
    }
  });

  // POST /api/assinatura/reativar-solicitacao — registra o pedido (o super-admin atende manualmente)
  router.post('/reativar-solicitacao', async (req: AuthRequest, res: Response) => {
    try {
      const ownerId = await resolverOwnerId(pool, req.userId!);
      const mensagem = String(req.body?.mensagem ?? '').slice(0, 1000) || null;

      // dedup: no máx. 1 pedido aberto por tenant a cada 10 min
      const recente = await pool.query(
        `SELECT 1 FROM assinatura_solicitacoes
         WHERE owner_id = $1 AND created_at > now() - interval '10 minutes' LIMIT 1`,
        [ownerId]
      ).catch(() => ({ rows: [] as any[] }));

      if (!recente.rows.length) {
        await pool.query(
          `INSERT INTO assinatura_solicitacoes (owner_id, solicitado_por, mensagem)
           VALUES ($1, $2, $3)`,
          [ownerId, req.userId, mensagem]
        );
        log.info('ASSINATURA', 'Pedido de reativação registrado', { ownerId, solicitadoPor: req.userId });
      }

      return res.json({
        ok: true,
        contato_whatsapp: process.env.SUPORTE_WHATSAPP || null,
        contato_site: process.env.SUPORTE_SITE || 'https://mentoark.com.br',
      });
    } catch (err: any) {
      log.error('ASSINATURA', 'Erro ao registrar pedido de reativação', { err: err?.message });
      return res.status(500).json({ message: 'Não foi possível registrar o pedido agora. Tente novamente.' });
    }
  });

  // POST /api/assinatura/_recheck — invalida o cache do próprio tenant (usado logo após uma
  // reativação feita pelo super-admin, pra o banner sumir sem esperar o TTL)
  router.post('/_recheck', async (req: AuthRequest, res: Response) => {
    const ownerId = await resolverOwnerId(pool, req.userId!);
    invalidarAssinaturaCache(ownerId);
    const a = await getAssinatura(pool, ownerId);
    return res.json({ status: a.status, dias_restantes: a.dias_restantes, read_only: a.read_only });
  });

  return router;
}
