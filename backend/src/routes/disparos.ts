import { Router, Response } from 'express';
import { Pool } from 'pg';
import { makeCrud } from '../crud';
import { AuthRequest } from '../middleware';

// ── Rate limiting: 1 mensagem por segundo por user_id ─────────────────────────
const lastSentAt = new Map<string, number>();
// Exportado apenas para reset em testes
export const _lastSentAt = lastSentAt;

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizarTelefone(raw: string): string | null {
  // Aceita dígitos, +, espaço e hífen — qualquer outro char invalida
  if (/[^\d+\s\-]/.test(raw)) return null;
  const digits = raw.replace(/[+\s\-]/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  return digits;
}

function dentroDaJanela(): boolean {
  // Horário de Brasília (America/Sao_Paulo). Permite 08:00–21:00.
  const sp = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const h = sp.getHours();
  const m = sp.getMinutes();
  if (h < 8) return false;
  if (h > 21) return false;
  if (h === 21 && m > 0) return false; // 21:01+ bloqueado
  return true;
}

export default function disparos(pool: Pool): Router {
  const base = makeCrud(pool, 'disparos');
  const router = Router();

  // ── POST /disparos/opt-out ─────────────────────────────────────────────────
  router.post('/opt-out', async (req: AuthRequest, res: Response) => {
    const { telefone } = req.body;
    if (!telefone) return res.status(400).json({ message: 'telefone é obrigatório' });

    const digits = normalizarTelefone(String(telefone));
    const suffix = (digits ?? String(telefone).replace(/\D/g, '')).slice(-11);

    await pool.query(
      `UPDATE contatos SET opt_out = true, updated_at = NOW()
       WHERE user_id = $1 AND telefone ILIKE $2`,
      [req.userId, `%${suffix}`]
    ).catch(() => {});

    await pool.query(
      `INSERT INTO disparo_optouts (user_id, telefone, motivo) VALUES ($1, $2, 'usuario_solicitou')`,
      [req.userId, digits ?? telefone]
    ).catch(() => {});

    return res.json({ ok: true });
  });

  // ── POST /disparos/enviar ──────────────────────────────────────────────────
  router.post('/enviar', async (req: AuthRequest, res: Response) => {
    const { telefone, texto, disparo_log_id, disparo_id } = req.body;

    // 1. Campos obrigatórios
    if (!telefone || !texto || !disparo_log_id || !disparo_id) {
      return res.status(400).json({
        message: 'telefone, texto, disparo_log_id e disparo_id são obrigatórios',
      });
    }

    // 2. Normalizar e validar telefone (dígitos, +, espaço, hífen — 10-15 dígitos)
    const telefoneNorm = normalizarTelefone(String(telefone));
    if (!telefoneNorm) {
      return res.status(400).json({
        message: 'telefone com formato inválido — aceitos: dígitos, +, espaço e hífen (10-15 dígitos)',
      });
    }

    // 3. Texto não pode ser vazio ou só espaços
    if (!String(texto).trim()) {
      return res.status(400).json({
        message: 'texto não pode ser vazio ou conter apenas espaços em branco',
      });
    }

    // 4. Limite Meta: 4096 caracteres
    if (String(texto).length > 4096) {
      return res.status(400).json({
        message: 'texto excede o limite de 4096 caracteres permitido pela Meta',
      });
    }

    // 5. Janela de envio: 08:00–21:00 (horário de Brasília)
    if (!dentroDaJanela()) {
      await pool.query(
        `UPDATE disparo_logs SET status = 'scheduled', erro = $1
         WHERE id = $2 AND user_id = $3`,
        ['Fora da janela de envio permitida (08h–21h, horário de Brasília)', disparo_log_id, req.userId]
      ).catch(() => {});
      return res.status(400).json({
        message: 'Fora da janela de envio permitida (08h–21h, horário de Brasília)',
      });
    }

    // 6. Opt-out: verificar contatos.opt_out ANTES do rate limit (resposta rápida)
    const optOutCheck = await pool.query(
      `SELECT opt_out FROM contatos WHERE user_id = $1 AND telefone ILIKE $2 LIMIT 1`,
      [req.userId, `%${telefoneNorm.slice(-11)}`]
    ).catch(() => ({ rows: [] as any[] }));

    if (optOutCheck.rows[0]?.opt_out === true) {
      await pool.query(
        `UPDATE disparo_logs SET status = 'optout',
         erro = 'Contato optou por não receber mensagens'
         WHERE id = $1 AND user_id = $2`,
        [disparo_log_id, req.userId]
      ).catch(() => {});
      return res.status(403).json({ message: 'Contato optou por não receber mensagens' });
    }

    // 7. Rate limiting: máx 1 msg/s por user_id
    const userId = req.userId!;
    const now = Date.now();
    const last = lastSentAt.get(userId) ?? 0;
    if (now - last < 1000) {
      res.set('Retry-After', '1');
      return res.status(429).json({
        message: 'Limite de 1 mensagem por segundo atingido — tente novamente em instantes',
      });
    }

    // Marca como enviando + incremento atômico de tentativas
    await pool.query(
      `UPDATE disparo_logs SET status = 'sending', tentativas = tentativas + 1
       WHERE id = $1 AND user_id = $2`,
      [disparo_log_id, userId]
    ).catch(() => {});

    try {
      const evoRes = await pool.query(
        `SELECT url, api_key, instancia FROM integracoes_config
         WHERE user_id = $1 AND tipo = 'evolution' AND status IN ('ativo','conectado')
         LIMIT 1`,
        [userId]
      );
      if (!evoRes.rows.length) {
        await pool.query(
          `UPDATE disparo_logs SET status = 'failed', erro = $1
           WHERE id = $2 AND user_id = $3`,
          ['Evolution API não configurada', disparo_log_id, userId]
        );
        await pool.query(
          `UPDATE disparos SET falhas = falhas + 1 WHERE id = $1 AND user_id = $2`,
          [disparo_id, userId]
        );
        return res.status(400).json({ message: 'Evolution API não configurada ou desconectada' });
      }

      const { url, api_key, instancia } = evoRes.rows[0];
      const baseUrl = url.replace(/\/$/, '');

      // 8. Personalização: substituir {{nome}} e {{telefone}} no texto
      const contatoRes = await pool.query(
        `SELECT nome FROM contatos WHERE user_id = $1 AND telefone ILIKE $2 LIMIT 1`,
        [userId, `%${telefoneNorm.slice(-11)}`]
      ).catch(() => ({ rows: [] as any[] }));
      const primeiroNome = (contatoRes.rows[0]?.nome ?? 'você').split(' ')[0];
      const textoFinal = String(texto)
        .replace(/\{\{nome\}\}/gi, primeiroNome)
        .replace(/\{\{telefone\}\}/gi, telefoneNorm);

      // 9. Delay variado anti-spam (simula digitação humana sem padrão fixo)
      const minDelay = Math.max(1000, textoFinal.length * 30);
      const maxDelay = Math.floor(minDelay * 1.8);
      const typingDelay = Math.floor(Math.random() * (maxDelay - minDelay) + minDelay);

      // Registra timestamp para rate limit antes de chamar a API externa
      lastSentAt.set(userId, Date.now());

      const resp = await fetch(`${baseUrl}/message/sendText/${instancia}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: api_key },
        body: JSON.stringify({ number: telefoneNorm, text: textoFinal, delay: typingDelay }),
      });

      if (!resp.ok) {
        const errBody = await resp.text().catch(() => '');
        const errMsg = `Evolution API ${resp.status}: ${errBody}`;
        await pool.query(
          `UPDATE disparo_logs SET status = 'failed', erro = $1 WHERE id = $2 AND user_id = $3`,
          [errMsg, disparo_log_id, userId]
        );
        await pool.query(
          `UPDATE disparos SET falhas = falhas + 1 WHERE id = $1 AND user_id = $2`,
          [disparo_id, userId]
        );
        return res.status(resp.status).json({ message: errMsg });
      }

      await pool.query(
        `UPDATE disparo_logs SET status = 'sent', enviado_at = NOW()
         WHERE id = $1 AND user_id = $2`,
        [disparo_log_id, userId]
      );
      await pool.query(
        `UPDATE disparos SET enviados = enviados + 1 WHERE id = $1 AND user_id = $2`,
        [disparo_id, userId]
      );

      return res.json({ ok: true });
    } catch (err: any) {
      console.error('[DISPARO/ENVIAR]', err.message);
      await pool.query(
        `UPDATE disparo_logs SET status = 'failed', erro = $1 WHERE id = $2 AND user_id = $3`,
        [err.message, disparo_log_id, userId]
      ).catch(() => {});
      await pool.query(
        `UPDATE disparos SET falhas = falhas + 1 WHERE id = $1 AND user_id = $2`,
        [disparo_id, userId]
      ).catch(() => {});
      return res.status(500).json({ message: err.message });
    }
  });

  // ── GET /disparos/:id/logs ─────────────────────────────────────────────────
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

  router.use('/', base);
  return router;
}
