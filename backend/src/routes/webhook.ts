import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { processarMensagem } from '../services/agentEngine';

// Tipos do payload da Evolution API
interface EvolutionPayload {
  event: string;
  instance: string;
  data: {
    key: {
      remoteJid: string;
      fromMe: boolean;
      id: string;
    };
    message?: {
      conversation?: string;
      extendedTextMessage?: { text: string };
      imageMessage?: { caption?: string };
      audioMessage?: object;
      documentMessage?: { caption?: string; fileName?: string };
      buttonsResponseMessage?: { selectedDisplayText: string };
      listResponseMessage?: { title: string };
      templateButtonReplyMessage?: { selectedDisplayText: string };
    };
    messageTimestamp?: number;
    pushName?: string;
    status?: string;
  };
}

function extrairTexto(data: EvolutionPayload['data']): string | null {
  const m = data.message;
  if (!m) return null;
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.listResponseMessage?.title ||
    m.templateButtonReplyMessage?.selectedDisplayText ||
    m.documentMessage?.caption ||
    null
  );
}

export default function webhookRouter(pool: Pool): Router {
  const router = Router();

  // Set de IDs processados em memória (fallback extra para deduplicação)
  const processados = new Set<string>();

  // POST /webhook/evolution
  router.post('/evolution', async (req: Request, res: Response) => {
    // Responde imediatamente (Evolution exige resposta rápida < 3s)
    res.status(200).json({ ok: true });

    try {
      const payload = req.body as EvolutionPayload;

      // Só processar mensagens recebidas (não as enviadas pelo próprio bot)
      if (payload.event !== 'messages.upsert') return;
      if (payload.data?.key?.fromMe === true) return;
      if (payload.data?.status === 'READ') return;

      const messageId = payload.data?.key?.id;
      const instancia = payload.instance;
      const remoteJid = payload.data?.key?.remoteJid || '';
      const telefone = remoteJid.split('@')[0];

      if (!messageId || !telefone || remoteJid.includes('@g.us')) return;

      // 1. Deduplicação em memória
      if (processados.has(messageId)) return;
      processados.add(messageId);
      setTimeout(() => processados.delete(messageId), 60000); // Limpa após 1 min

      // 2. Deduplicação no banco
      const jaExiste = await pool.query(
        'SELECT id FROM webhook_mensagens_processadas WHERE id = $1',
        [messageId]
      );
      if (jaExiste.rows.length) return;

      await pool.query(
        'INSERT INTO webhook_mensagens_processadas (id, instancia, telefone) VALUES ($1, $2, $3)',
        [messageId, instancia, telefone]
      );

      // 3. Extrair texto
      const texto = extrairTexto(payload.data);
      if (!texto) return;

      // 4. Chamar motor do agente (assíncrono)
      processarMensagem(pool, {
        instancia,
        messageId,
        telefone,
        pushName: payload.data.pushName || telefone,
        texto,
        timestamp: payload.data.messageTimestamp || Math.floor(Date.now() / 1000),
      }).catch(err => {
        console.error(`[WEBHOOK] Erro ao processar mensagem ${messageId}:`, err);
      });

    } catch (err) {
      console.error('[WEBHOOK] Erro crítico no receptor:', err);
    }
  });

  return router;
}
