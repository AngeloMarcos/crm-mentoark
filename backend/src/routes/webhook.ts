import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { processarMensagem } from '../services/agentEngine';

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
      imageMessage?: { caption?: string; url?: string; mimetype?: string };
      audioMessage?: { url?: string; mimetype?: string };
      videoMessage?: { caption?: string; url?: string; mimetype?: string };
      documentMessage?: { caption?: string; fileName?: string; url?: string; mimetype?: string };
      stickerMessage?: { url?: string; mimetype?: string };
      buttonsResponseMessage?: { selectedDisplayText: string };
      listResponseMessage?: { title: string };
      templateButtonReplyMessage?: { selectedDisplayText: string };
    };
    messageTimestamp?: number;
    pushName?: string;
    status?: string;
  };
}

// Palavras-chave de opt-out (comparação case-insensitive após trim)
const OPT_OUT_KEYWORDS = new Set([
  'sair', 'stop', 'parar', 'cancelar', 'remover', 'não quero', 'nao quero',
]);

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

function extrairTipo(data: EvolutionPayload['data']): string {
  const m = data.message;
  if (!m) return 'text';
  if (m.imageMessage) return 'image';
  if (m.audioMessage) return 'audio';
  if (m.videoMessage) return 'video';
  if (m.documentMessage) return 'document';
  if (m.stickerMessage) return 'sticker';
  return 'text';
}

function extrairMidia(data: EvolutionPayload['data']): { url?: string; mime?: string; nome?: string } {
  const m = data.message;
  if (!m) return {};
  const src =
    m.imageMessage ||
    m.audioMessage ||
    m.videoMessage ||
    m.documentMessage ||
    m.stickerMessage;
  if (!src) return {};
  return {
    url: (src as any).url,
    mime: (src as any).mimetype,
    nome: (src as any).fileName,
  };
}

export default function webhookRouter(pool: Pool): Router {
  const router = Router();

  const processados = new Set<string>();

  router.post('/evolution', async (req: Request, res: Response) => {
    res.status(200).json({ ok: true });

    try {
      const payload = req.body as EvolutionPayload;

      if (payload.event !== 'messages.upsert') return;
      if (payload.data?.key?.fromMe === true) return;
      if (payload.data?.status === 'READ') return;

      const messageId = payload.data?.key?.id;
      const instancia = payload.instance;
      const remoteJid = payload.data?.key?.remoteJid || '';
      const telefone = remoteJid.split('@')[0];
      const pushName = payload.data?.pushName || telefone;

      if (!messageId || !telefone || remoteJid.includes('@g.us')) return;

      // Deduplicação em memória
      if (processados.has(messageId)) return;
      processados.add(messageId);
      setTimeout(() => processados.delete(messageId), 60000);

      // Deduplicação no banco
      const jaExiste = await pool.query(
        'SELECT id FROM webhook_mensagens_processadas WHERE message_id = $1',
        [messageId]
      );
      if (jaExiste.rows.length) return;

      await pool.query(
        'INSERT INTO webhook_mensagens_processadas (message_id, instancia) VALUES ($1, $2)',
        [messageId, instancia]
      );

      // Extrair dados da mensagem
      const texto = extrairTexto(payload.data);
      const tipo = extrairTipo(payload.data);
      const midia = extrairMidia(payload.data);
      const timestamp = payload.data.messageTimestamp || Math.floor(Date.now() / 1000);

      // Encontrar user_id e n8n_webhook_url pela instância
      const agenteRes = await pool.query(
        `SELECT user_id, n8n_webhook_url FROM agentes
         WHERE evolution_instancia = $1 AND ativo = true AND user_id IS NOT NULL
         ORDER BY updated_at DESC LIMIT 1`,
        [instancia]
      );

      let userId: string | null = null;
      let n8nWebhookUrl: string | null = null;

      if (agenteRes.rows.length) {
        userId = agenteRes.rows[0].user_id;
        n8nWebhookUrl = agenteRes.rows[0].n8n_webhook_url || null;

        // Salvar na tabela whatsapp_messages
        await pool.query(
          `INSERT INTO whatsapp_messages
             (id, user_id, instancia, session_id, remote_jid, from_me, push_name, tipo,
              conteudo, midia_url, midia_mime, midia_nome, status, timestamp_unix)
           VALUES ($1, $2, $3, $4, $5, false, $6, $7, $8, $9, $10, $11, 'received', $12)
           ON CONFLICT (id) DO NOTHING`,
          [
            messageId, userId, instancia, telefone, remoteJid,
            pushName, tipo,
            texto || null, midia.url || null, midia.mime || null, midia.nome || null,
            timestamp,
          ]
        );

        // Atualizar push_name e timestamp no contato
        await pool.query(
          `UPDATE contatos
           SET push_name = COALESCE($1, push_name),
               ultima_mensagem_em = NOW(),
               updated_at = NOW()
           WHERE user_id = $2 AND telefone ILIKE $3`,
          [pushName || null, userId, `%${telefone.slice(-11)}`]
        );
      }

      // Só processar se houver texto
      if (!texto) return;

      // ── Detecção automática de opt-out ─────────────────────────────────────
      const textoNorm = texto.trim().toLowerCase();
      if (userId && OPT_OUT_KEYWORDS.has(textoNorm)) {
        // Marcar opt-out na tabela contatos (campo oficial)
        await pool.query(
          `UPDATE contatos SET opt_out = true, updated_at = NOW()
           WHERE user_id = $1 AND telefone ILIKE $2`,
          [userId, `%${telefone.slice(-11)}`]
        ).catch(err => console.warn('[WEBHOOK] Falha ao marcar opt-out em contatos:', err.message));

        // Registrar log em disparo_optouts
        await pool.query(
          `INSERT INTO disparo_optouts (user_id, telefone, motivo) VALUES ($1, $2, $3)`,
          [userId, telefone, textoNorm]
        ).catch(() => {});

        console.log(`[WEBHOOK] Opt-out registrado: ${telefone} via "${textoNorm}"`);

        // Enviar mensagem de confirmação via Evolution
        const evoConf = await pool.query(
          `SELECT url, api_key, instancia AS inst FROM integracoes_config
           WHERE user_id = $1 AND tipo = 'evolution' AND status IN ('ativo','conectado') LIMIT 1`,
          [userId]
        ).catch(() => ({ rows: [] as any[] }));

        if (evoConf.rows.length) {
          const { url: evoUrl, api_key: evoKey, inst: evoInst } = evoConf.rows[0];
          fetch(`${evoUrl.replace(/\/$/, '')}/message/sendText/${evoInst}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: evoKey },
            body: JSON.stringify({
              number: telefone,
              text: 'Você foi removido da nossa lista. Não receberá mais mensagens. Para reativar, entre em contato conosco.',
              delay: 1000,
            }),
          }).catch(err =>
            console.warn('[WEBHOOK] Falha ao enviar confirmação de opt-out:', err.message)
          );
        }

        return; // Não encaminhar para n8n/agentEngine
      }

      // ── Roteamento: n8n (primário) ou agentEngine (fallback) ───────────────
      if (n8nWebhookUrl) {
        fetch(n8nWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            telefone,
            pushName,
            texto,
            instancia,
            messageId,
            timestamp,
            user_id: userId,
          }),
        }).catch(err => {
          console.error(`[WEBHOOK] Erro ao chamar n8n (${n8nWebhookUrl}):`, err.message);
        });
      } else {
        processarMensagem(pool, {
          instancia,
          messageId,
          telefone,
          pushName,
          texto,
          timestamp,
        }).catch(err => {
          console.error(`[WEBHOOK] Erro ao processar mensagem ${messageId}:`, err);
        });
      }

    } catch (err) {
      console.error('[WEBHOOK] Erro crítico no receptor:', err);
    }
  });

  return router;
}
