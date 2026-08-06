import { Router, Response } from 'express';
import { Pool } from 'pg';
import { makeCrud } from '../crud';
import { AuthRequest } from '../middleware';
import { log } from '../logger';
import { enviarCorridaParaSistemaCliente } from '../services/corridasService';

// [AUDITORIA] LÓGICA: CRUD padrão (listar fila, editar campos, descartar via PUT status=
// 'cancelada') vem de makeCrud(pool, 'corridas') — só o envio de verdade pro sistema do
// cliente (POST /:id/confirmar) precisa de rota própria, porque envolve uma chamada HTTP
// externa (enviarCorridaParaSistemaCliente, compartilhada com a ferramenta de IA
// `criar_corrida` em mcp/tools.ts).
export default function corridas(pool: Pool): Router {
  const base = makeCrud(pool, 'corridas');
  const router = Router();

  // POST /api/corridas/:id/confirmar
  // Body opcional: { origem, destino, horario_solicitado, nome_passageiro, observacoes }
  // — quando enviado, sobrescreve os campos extraídos pela IA antes de disparar o envio
  // (usado pelo botão "Confirmar e enviar" da tela Corridas Pendentes, com ou sem edição).
  router.post('/:id/confirmar', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ message: 'Usuário não autenticado' });

      const atual = await pool.query(
        `SELECT * FROM corridas WHERE id = $1 AND user_id = $2`,
        [req.params.id, userId]
      );
      if (!atual.rows.length) return res.status(404).json({ message: 'Corrida não encontrada' });
      if (atual.rows[0].status === 'enviada') {
        return res.status(409).json({ message: 'Esta corrida já foi enviada ao sistema do cliente.' });
      }

      const { origem, destino, horario_solicitado, nome_passageiro, observacoes } = req.body || {};
      const houveEdicao = [origem, destino, horario_solicitado, nome_passageiro, observacoes]
        .some(v => v !== undefined);

      const upd = await pool.query(
        `UPDATE corridas SET
           origem              = COALESCE($1, origem),
           destino             = COALESCE($2, destino),
           horario_solicitado  = COALESCE($3, horario_solicitado),
           nome_passageiro     = COALESCE($4, nome_passageiro),
           observacoes         = COALESCE($5, observacoes),
           origem_extracao     = CASE WHEN $6 THEN 'manual' ELSE origem_extracao END,
           status              = 'confirmada',
           updated_at          = NOW()
         WHERE id = $7 AND user_id = $8
         RETURNING *`,
        [
          origem ?? null, destino ?? null, horario_solicitado ?? null,
          nome_passageiro ?? null, observacoes ?? null,
          houveEdicao, req.params.id, userId,
        ]
      );
      const corridaConfirmada = upd.rows[0];

      const resultado = await enviarCorridaParaSistemaCliente(pool, userId, {
        id: corridaConfirmada.id,
        telefone: corridaConfirmada.telefone,
        nome_passageiro: corridaConfirmada.nome_passageiro,
        origem: corridaConfirmada.origem,
        destino: corridaConfirmada.destino,
        horario_solicitado: corridaConfirmada.horario_solicitado,
        observacoes: corridaConfirmada.observacoes,
        created_at: corridaConfirmada.created_at,
      });

      const final = await pool.query(
        `SELECT * FROM corridas WHERE id = $1 AND user_id = $2`,
        [req.params.id, userId]
      );

      if (!resultado.enviado) {
        return res.status(502).json({
          message: resultado.motivo || 'Falha ao enviar corrida para o sistema do cliente',
          corrida: final.rows[0],
        });
      }
      return res.json({ ok: true, corrida: final.rows[0] });

    } catch (err: any) {
      log.error('CORRIDAS', 'Erro ao confirmar/enviar corrida', { err: err.message, stack: err.stack });
      res.status(500).json({ message: err.message });
    }
  });

  router.use('/', base);
  return router;
}
