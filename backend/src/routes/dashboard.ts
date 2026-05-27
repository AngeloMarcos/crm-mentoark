import { Router, Response } from 'express';
import { Pool } from 'pg';
import { AuthRequest } from '../middleware';

export default function dashboard(pool: Pool): Router {
  const router = Router();

  router.get('/', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      
      // Busca se o usuário é membro de alguma equipe
      const equipeRes = await pool.query(
        `SELECT role FROM equipe_membros WHERE user_id = $1 LIMIT 1`,
        [userId]
      );
      const isMembro = equipeRes.rowCount > 0 && equipeRes.rows[0].role === 'membro';

      if (isMembro) {
        // Se é membro, o resumo deve ser baseado apenas nos leads atribuídos a ele
        const r = await pool.query(
          `SELECT 
            COUNT(*) as total_leads,
            COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE) as novos_hoje,
            COUNT(*) FILTER (WHERE status = 'convertido') as convertidos,
            COUNT(*) FILTER (WHERE status = 'em_atendimento') as em_atendimento
           FROM contatos 
           WHERE atribuido_a = $1`,
          [userId]
        );
        return res.json(r.rows[0] ?? { user_id: userId, total_leads: 0, novos_hoje: 0, convertidos: 0, em_atendimento: 0 });
      }

      const r = await pool.query(
        'SELECT * FROM dashboard_resumo WHERE user_id = $1',
        [userId]
      );
      return res.json(r.rows[0] ?? { user_id: userId, total_leads: 0, novos_hoje: 0, convertidos: 0, em_atendimento: 0 });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  return router;
}
