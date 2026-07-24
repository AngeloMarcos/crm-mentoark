import { Router, Response } from 'express';
import { Pool } from 'pg';
import { AuthRequest } from '../middleware';
import { log } from '../logger';

export default function funisRouter(pool: Pool): Router {
  const router = Router();

  // ── 1. LISTAR FUNIS E SEUS ESTÁGIOS (GET /api/funis) ───────────────────────
  router.get('/', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const r = await pool.query(
        `SELECT p.id, p.nome, p.created_at,
                COALESCE(
                  JSON_AGG(
                    JSON_BUILD_OBJECT(
                      'id', s.id,
                      'nome', s.nome,
                      'ordem', s.ordem,
                      'is_won', s.is_won,
                      'is_lost', s.is_lost
                    ) ORDER BY s.ordem ASC
                  ) FILTER (WHERE s.id IS NOT NULL),
                  '[]'
                ) AS estagios
         FROM pipelines p
         LEFT JOIN pipeline_stages s ON s.pipeline_id = p.id
         WHERE p.user_id = $1
         GROUP BY p.id
         ORDER BY p.created_at DESC`,
        [userId]
      );
      return res.json(r.rows);
    } catch (err: any) {
      log.error('FUNIS', 'Erro ao listar funis', { err: err.message });
      return res.status(500).json({ message: err.message });
    }
  });

  // ── 2. CRIAR NOVO FUNIL COM ESTÁGIOS PADRÃO (POST /api/funis) ───────────────
  router.post('/', async (req: AuthRequest, res: Response) => {
    const client = await pool.connect();
    try {
      const userId = req.userId!;
      const { nome, estagios } = req.body as { nome: string; estagios?: string[] };
      if (!nome?.trim()) {
        return res.status(400).json({ message: 'Nome do funil é obrigatório.' });
      }

      await client.query('BEGIN');

      const pRes = await client.query(
        `INSERT INTO pipelines (user_id, nome) VALUES ($1, $2) RETURNING *`,
        [userId, nome.trim()]
      );
      const pipeline = pRes.rows[0];

      const defaultStages = estagios && estagios.length > 0
        ? estagios
        : ['Novo', 'Contatado', 'Proposta', 'Ganho', 'Perdido'];

      for (let i = 0; i < defaultStages.length; i++) {
        const stageName = defaultStages[i].trim();
        const isWon = stageName.toLowerCase() === 'ganho';
        const isLost = stageName.toLowerCase() === 'perdido';
        await client.query(
          `INSERT INTO pipeline_stages (pipeline_id, nome, ordem, is_won, is_lost)
           VALUES ($1, $2, $3, $4, $5)`,
          [pipeline.id, stageName, i, isWon, isLost]
        );
      }

      await client.query('COMMIT');
      return res.status(201).json(pipeline);
    } catch (err: any) {
      await client.query('ROLLBACK');
      log.error('FUNIS', 'Erro ao criar funil', { err: err.message });
      return res.status(500).json({ message: err.message });
    } finally {
      client.release();
    }
  });

  // ── 3. LISTAR NEGÓCIOS DE UM FUNIL (GET /api/funis/:id/deals) ───────────────
  router.get('/:id/deals', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const pipelineId = req.params.id;
      const r = await pool.query(
        `SELECT d.id, d.stage_id, d.titulo, d.valor, d.status, d.motivo_perda, d.versao, d.created_at,
                c.nome AS contato_nome, c.telefone AS contato_telefone, c.profile_pic_url AS contato_foto,
                u.display_name AS owner_name
         FROM deals d
         LEFT JOIN contatos c ON c.id = d.contato_id
         LEFT JOIN users u ON u.id = d.owner_id
         WHERE d.pipeline_id = $1 AND d.user_id = $2
         ORDER BY d.created_at DESC`,
        [pipelineId, userId]
      );
      return res.json(r.rows);
    } catch (err: any) {
      log.error('FUNIS', 'Erro ao listar deals', { err: err.message });
      return res.status(500).json({ message: err.message });
    }
  });

  // ── 4. CRIAR NOVO NEGÓCIO/CARD (POST /api/funis/deals) ──────────────────────
  router.post('/deals', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const { pipeline_id, stage_id, contato_id, titulo, valor, owner_id } = req.body;
      if (!pipeline_id || !stage_id || !titulo?.trim()) {
        return res.status(400).json({ message: 'Campos obrigatórios ausentes.' });
      }
      const r = await pool.query(
        `INSERT INTO deals (user_id, pipeline_id, stage_id, contato_id, titulo, valor, owner_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [userId, pipeline_id, stage_id, contato_id || null, titulo.trim(), valor || 0, owner_id || userId]
      );
      return res.status(201).json(r.rows[0]);
    } catch (err: any) {
      log.error('FUNIS', 'Erro ao criar deal', { err: err.message });
      return res.status(500).json({ message: err.message });
    }
  });

  // ── 5. MOVER NEGÓCIO COM LOCK OTIMISTA E AUDITORIA (PATCH /api/funis/deals/:id/stage) ──
  router.patch('/deals/:id/stage', async (req: AuthRequest, res: Response) => {
    const client = await pool.connect();
    try {
      const userId = req.userId!;
      const dealId = req.params.id;
      const { stage_id, versao_anterior } = req.body as { stage_id: string; versao_anterior: number };

      if (!stage_id || versao_anterior === undefined) {
        return res.status(400).json({ message: 'stage_id e versao_anterior são obrigatórios.' });
      }

      await client.query('BEGIN');

      // Captura o estágio prévio para gerar histórico e auditar a versão
      const preRes = await client.query(
        `SELECT stage_id, versao FROM deals WHERE id = $1 AND user_id = $2`,
        [dealId, userId]
      );

      if (!preRes.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Negócio não encontrado.' });
      }

      const currentDeal = preRes.rows[0];

      // [AUDITORIA] LÓGICA: Implementação de Lock Otimista. Se a versão no banco for diferente
      // da versão que o frontend leu, significa que outro atendente moveu o card no mesmo instante.
      if (Number(currentDeal.versao) !== Number(versao_anterior)) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          message: 'Conflito de concorrência: Este cartão foi movido recentemente por outro operador. Por favor, recarregue a página.'
        });
      }

      // Checa se o estágio de destino é de ganho ou perda para transitar o status de forma atômica
      const stageRes = await client.query(
        `SELECT is_won, is_lost FROM pipeline_stages WHERE id = $1`,
        [stage_id]
      );
      const stageInfo = stageRes.rows[0];
      let status = 'aberto';
      let closedAt = null;
      if (stageInfo?.is_won) { status = 'ganho'; closedAt = new Date(); }
      if (stageInfo?.is_lost) { status = 'perdido'; closedAt = new Date(); }

      // Update atômico incrementando a versão do lock
      const upd = await client.query(
        `UPDATE deals
         SET stage_id = $1, versao = versao + 1, status = $2, closed_at = $3, updated_at = NOW()
         WHERE id = $4 AND versao = $5 AND user_id = $6
         RETURNING *`,
        [stage_id, status, closedAt, dealId, versao_anterior, userId]
      );

      if (upd.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'Erro ao atualizar. Conflito de concorrência.' });
      }

      // Registra a transição na tabela de histórico de auditoria
      await client.query(
        `INSERT INTO deal_stage_history (deal_id, from_stage_id, to_stage_id, moved_by)
         VALUES ($1, $2, $3, $4)`,
        [dealId, currentDeal.stage_id, stage_id, userId]
      );

      await client.query('COMMIT');
      return res.json(upd.rows[0]);
    } catch (err: any) {
      await client.query('ROLLBACK');
      log.error('FUNIS', 'Erro ao mover deal', { err: err.message });
      return res.status(500).json({ message: err.message });
    } finally {
      client.release();
    }
  });

  return router;
}
