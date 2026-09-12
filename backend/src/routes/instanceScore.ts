/**
 * routes/instanceScore.ts — `POST /api/instancias/:id/score`, recalcula sob demanda o Score de
 * Saúde real de UMA instância (botão "Recalcular score" em `InstanceManagementPanel.tsx`).
 * Cálculo em si vive em `services/instanceScore.ts` (mesma função usada pelo cron de 15min, ver
 * `cron.ts`) — esta rota só valida ownership e devolve o resultado.
 *
 * [AUDITORIA] LÓGICA: mesma frase do comentário original do mock que esta sprint substitui —
 * "Em um cenário real, isso seria uma chamada para /api/agentes/:id/score" — é literalmente essa
 * chamada, só que num prefixo próprio (`/api/instancias`) pra não colidir com o CRUD genérico já
 * montado em `/api/agentes` (`makeCrud`, `index.ts`).
 */
import { Router, Response } from 'express';
import { Pool } from 'pg';
import { AuthRequest } from '../middleware';
import { log } from '../logger';
import { recalcularScoreAgente } from '../services/instanceScore';

export default function instanceScoreRouter(pool: Pool): Router {
  const router = Router();

  router.post('/:id/score', async (req: AuthRequest, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: 'Usuário não autenticado' });
    try {
      const resultado = await recalcularScoreAgente(pool, req.params.id, userId);
      if (!resultado) {
        return res.status(404).json({ message: 'Instância não encontrada (ou sem evolution_instancia configurada)' });
      }
      return res.json(resultado);
    } catch (err: any) {
      log.error('SCORE_INSTANCIA', 'Falha ao recalcular score sob demanda', { agenteId: req.params.id, err: err?.message });
      return res.status(500).json({ message: err?.message || 'Falha ao calcular score' });
    }
  });

  return router;
}
