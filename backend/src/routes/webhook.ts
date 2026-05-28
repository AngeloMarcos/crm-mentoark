import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import crypto from 'crypto';
import { processarComDebounce } from '../services/agentEngine';

function verificarAssinaturaEvolution(req: Request, secret: string): boolean {
  const assinaturaRecebida = req.headers['x-evolution-hmac'] as string;
  if (!assinaturaRecebida) return false;
  const body = JSON.stringify(req.body);
  const hmac = crypto.createHmac('sha256', secret).update(body).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(assinaturaRecebida, 'hex'), Buffer.from(hmac, 'hex'));
  } catch {
    return false;
  }
}

interface EvolutionPayload {
  event: string;
  instance: string;
  data: {
    key: { remoteJid: string; fromMe: boolean; id: string };
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

const OPT_OUT_KEYWORDS = new Set([
  'sair', 'stop', 'parar', 'cancelar', 'remover', 'não quero', 'nao quero',
]);

const REATIVAR_COMANDOS = new Set([
  'reativar ia', 'ativar ia', 'reativar', 'atendimento finalizado',
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
  const src = m.imageMessage || m.audioMessage || m.videoMessage || m.documentMessage || m.stickerMessage;
  if (!src) return {};
  return { url: (src as any).url, mime: (src as any).mimetype, nome: (src as any).fileName };
}

export default function webhookRouter(pool: Pool): Router {
  const router = Router();
  const processados = new Set<string>();

  router.post('/evolution', async (req: Request, res: Response) => {
    const webhookSecret = process.env.EVOLUTION_WEBHOOK_SECRET;
    if (webhookSecret && !verificarAssinaturaEvolution(req, webhookSecret)) {
      console.warn('[WEBHOOK] Assinatura inválida — requisição rejeitada');
      return res.status(401).json({ error: 'Assinatura inválida' });
    }

    res.status(200).json({ ok: true });

    try {
      const payload = req.body as EvolutionPayload;
      if (payload.event !== 'messages.upsert') return;
      if (payload.data?.status === 'READ') return;

      const messageId = payload.data?.key?.id || '';
      const instancia = payload.instance;
      const remoteJid = payload.data?.key?.remoteJid || '';
      const telefone = remoteJid.split('@')[0];
      const pushName = payload.data?.pushName || telefone;
      const fromMe = payload.data?.key?.fromMe === true;

      if (!messageId || !telefone || remoteJid.includes('@g.us')) return;

      // ── Mensagem enviada pelo atendente (fromMe) → pausa humana ───────────
      if (fromMe) {
        // Ignorar respostas do próprio bot (prefixo resp_)
        if (messageId.startsWith('resp_')) return;

        // É o atendente enviando manualmente → pausar IA
        const aR = await pool.query(
          `SELECT user_id FROM agentes
           WHERE evolution_instancia = $1 AND ativo = true LIMIT 1`,
          [instancia]
        ).catch(() => ({ rows: [] as any[] }));

        if (aR.rows[0]?.user_id) {
          await pool.query(
            `UPDATE dados_cliente SET atendimento_ia = 'pause'
             WHERE user_id = $1 AND telefone ILIKE $2`,
            [aR.rows[0].user_id, `%${telefone.slice(-11)}`]
          ).catch(() => {});
          console.log(`[WEBHOOK] IA pausada por intervenção humana: ${telefone}`);
        }
        return;
      }

      // ── Deduplicação ──────────────────────────────────────────────────────
      if (processados.has(messageId)) return;
      processados.add(messageId);
      setTimeout(() => processados.delete(messageId), 60000);

      const jaExiste = await pool.query(
        'SELECT id FROM webhook_mensagens_processadas WHERE message_id = $1',
        [messageId]
      );
      if (jaExiste.rows.length) return;

      await pool.query(
        'INSERT INTO webhook_mensagens_processadas (message_id, instancia) VALUES ($1, $2)',
        [messageId, instancia]
      );

      // ── Extrair dados da mensagem ─────────────────────────────────────────
      const texto = extrairTexto(payload.data);
      const tipo = extrairTipo(payload.data);
      const midia = extrairMidia(payload.data);
      const timestamp = payload.data.messageTimestamp || Math.floor(Date.now() / 1000);

      // ── Encontrar agente e user_id ────────────────────────────────────────
      const agenteRes = await pool.query(
        `SELECT user_id FROM agentes
         WHERE evolution_instancia = $1 AND ativo = true AND user_id IS NOT NULL
         ORDER BY updated_at DESC LIMIT 1`,
        [instancia]
      );

      let userId: string | null = null;
      if (agenteRes.rows.length) {
        userId = agenteRes.rows[0].user_id;

        // Salvar mensagem recebida (schema novo EN)
        await pool.query(
          `INSERT INTO whatsapp_messages
             (user_id, instance_name, remote_jid, message_id, from_me, message_type,
              content, media_url, media_mimetype, status, timestamp_wa)
           VALUES ($1, $2, $3, $4, false, $5, $6, $7, $8, 'received', to_timestamp($9))
           ON CONFLICT (message_id, instance_name) DO NOTHING`,
          [userId, instancia, remoteJid, messageId, tipo,
           texto || null, midia.url || null, midia.mime || null, timestamp]
        ).catch(err => console.warn('[WEBHOOK] Falha ao salvar whatsapp_messages:', err.message));

        // Atualizar push_name e timestamp no contato
        await pool.query(
          `UPDATE contatos
           SET push_name = COALESCE($1, push_name),
               ultima_mensagem_em = NOW(), updated_at = NOW()
           WHERE user_id = $2 AND telefone ILIKE $3`,
          [pushName || null, userId, `%${telefone.slice(-11)}`]
        ).catch(() => {});
      }

      // ── Opt-out ───────────────────────────────────────────────────────────
      const textoNorm = (texto || '').trim().toLowerCase();
      if (userId && OPT_OUT_KEYWORDS.has(textoNorm)) {
        await pool.query(
          `UPDATE contatos SET opt_out = true, updated_at = NOW()
           WHERE user_id = $1 AND telefone ILIKE $2`,
          [userId, `%${telefone.slice(-11)}`]
        ).catch(() => {});
        await pool.query(
          `INSERT INTO disparo_optouts (user_id, telefone, motivo) VALUES ($1, $2, $3)`,
          [userId, telefone, textoNorm]
        ).catch(() => {});
        console.log(`[WEBHOOK] Opt-out registrado: ${telefone}`);
        return;
      }

      // ── Reativação da IA por comando ──────────────────────────────────────
      if (userId && REATIVAR_COMANDOS.has(textoNorm)) {
        await pool.query(
          `UPDATE dados_cliente SET atendimento_ia = 'ativo'
           WHERE user_id = $1 AND telefone ILIKE $2`,
          [userId, `%${telefone.slice(-11)}`]
        ).catch(() => {});
        console.log(`[WEBHOOK] IA reativada por comando: ${telefone}`);
        return;
      }

      // ── Motor IA (sempre — sem n8n) ───────────────────────────────────────
      // Processar apenas texto e mídia suportada (ignorar sticker, video, document sem texto)
      if (!texto && !['audio', 'image'].includes(tipo)) return;

      processarComDebounce(pool, {
        instancia,
        messageId,
        telefone,
        pushName,
        texto,
        tipo,
        midiaUrl: midia.url || undefined,
        timestamp,
      }).catch(err => console.error(`[WEBHOOK] Erro ao processar ${messageId}:`, err));

    } catch (err) {
      console.error('[WEBHOOK] Erro crítico no receptor:', err);
    }
  });

  return router;
}
