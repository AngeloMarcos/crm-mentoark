import { Router, Response } from 'express';
import { Pool } from 'pg';
import { makeCrud } from '../crud';
import { AuthRequest } from '../middleware';

export default function disparos(pool: Pool): Router {
  const base = makeCrud(pool, 'disparos');

  // We need a fresh router to add special routes before the base CRUD catches them
  const router = Router();

  // POST /disparos/enviar — proxy seguro para Evolution (api_key nunca vai ao frontend)
  router.post('/enviar', async (req: AuthRequest, res: Response) => {
    const { telefone, texto, disparo_log_id, disparo_id } = req.body;
    if (!telefone || !texto || !disparo_log_id || !disparo_id) {
      return res.status(400).json({ message: 'telefone, texto, disparo_log_id e disparo_id são obrigatórios' });
    }

    // Validação de formato do telefone: apenas dígitos, mínimo 10 (DDI+DDD+número)
    if (!/^\d{10,15}$/.test(String(telefone))) {
      return res.status(400).json({ message: 'telefone com formato inválido — use apenas dígitos (DDI+DDD+número)' });
    }

    // Conformidade Meta: texto não pode ser vazio ou só espaços
    if (!String(texto).trim()) {
      return res.status(400).json({ message: 'texto não pode ser vazio ou conter apenas espaços em branco' });
    }

    // Conformidade Meta: limite de 4096 caracteres por mensagem
    if (String(texto).length > 4096) {
      return res.status(400).json({ message: 'texto excede o limite de 4096 caracteres permitido pela Meta' });
    }

    // Verificar opt-out: contato pode ter se descadastrado via palavra-chave
    const optOutRes = await pool.query(
      `SELECT 1 FROM opt_out_contatos WHERE user_id = $1 AND telefone = $2 LIMIT 1`,
      [req.userId, telefone]
    ).catch(() => ({ rows: [] }));
    if (optOutRes.rows.length) {
      return res.status(400).json({ message: 'contato descadastrado — opt-out registrado' });
    }

    // Marca como enviando + incremento atômico de tentativas
    await pool.query(
      `UPDATE disparo_logs SET status = 'sending', tentativas = tentativas + 1
       WHERE id = $1 AND user_id = $2`,
      [disparo_log_id, req.userId]
    ).catch(() => {});

    try {
      const evoRes = await pool.query(
        `SELECT url, api_key, instancia FROM integracoes_config
         WHERE user_id = $1 AND tipo = 'evolution' AND status IN ('ativo','conectado')
         LIMIT 1`,
        [req.userId]
      );
      if (!evoRes.rows.length) {
        await pool.query(
          `UPDATE disparo_logs SET status = 'failed', erro = $1 WHERE id = $2 AND user_id = $3`,
          ['Evolution API não configurada', disparo_log_id, req.userId]
        );
        await pool.query(
          `UPDATE disparos SET falhas = falhas + 1 WHERE id = $1 AND user_id = $2`,
          [disparo_id, req.userId]
        );
        return res.status(400).json({ message: 'Evolution API não configurada ou desconectada' });
      }
      const { url, api_key, instancia } = evoRes.rows[0];
      const baseUrl = url.replace(/\/$/, '');

      // Delay proporcional ao tamanho da mensagem — simula digitação humana
      const typingDelay = Math.min(3000, Math.max(800, texto.length * 40));

      const resp = await fetch(`${baseUrl}/message/sendText/${instancia}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: api_key },
        body: JSON.stringify({ number: telefone, text: texto, delay: typingDelay }),
      });

      if (!resp.ok) {
        const errBody = await resp.text().catch(() => '');
        const errMsg = `Evolution API ${resp.status}: ${errBody}`;
        await pool.query(
          `UPDATE disparo_logs SET status = 'failed', erro = $1 WHERE id = $2 AND user_id = $3`,
          [errMsg, disparo_log_id, req.userId]
        );
        await pool.query(
          `UPDATE disparos SET falhas = falhas + 1 WHERE id = $1 AND user_id = $2`,
          [disparo_id, req.userId]
        );
        return res.status(resp.status).json({ message: errMsg });
      }

      // Atualiza log e contador de forma atômica (sem read-modify-write)
      await pool.query(
        `UPDATE disparo_logs SET status = 'sent', enviado_at = NOW() WHERE id = $1 AND user_id = $2`,
        [disparo_log_id, req.userId]
      );
      await pool.query(
        `UPDATE disparos SET enviados = enviados + 1 WHERE id = $1 AND user_id = $2`,
        [disparo_id, req.userId]
      );

      return res.json({ ok: true });
    } catch (err: any) {
      console.error('[DISPARO/ENVIAR]', err.message);
      await pool.query(
        `UPDATE disparo_logs SET status = 'failed', erro = $1 WHERE id = $2 AND user_id = $3`,
        [err.message, disparo_log_id, req.userId]
      ).catch(() => {});
      await pool.query(
        `UPDATE disparos SET falhas = falhas + 1 WHERE id = $1 AND user_id = $2`,
        [disparo_id, req.userId]
      ).catch(() => {});
      return res.status(500).json({ message: err.message });
    }
  });

  // GET /disparos/:id/logs
  router.get('/:id/logs', async (req: AuthRequest, res: Response) => {
    try {
      const r = await pool.query(
        `SELECT * FROM disparo_logs WHERE disparo_id = $1 AND user_id = $2 ORDER BY created_at ASC`,
        [req.params.id, req.userId]
      );
      return res.json(r.rows);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // Mount all CRUD routes from base
  router.use('/', base);

  return router;
}
