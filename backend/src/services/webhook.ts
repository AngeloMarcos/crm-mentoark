/**
 * webhook.ts — Receptor de eventos da Evolution API (WhatsApp)
 *
 * Melhorias v3:
 * - Lookup de agente único com fallbacks (integracoes_config, whatsapp_instances, prefixo UUID)
 * - Validação de JID e filtragem de grupos antes de qualquer DB op
 * - Tratamento de MESSAGES_UPDATE para status de entrega/leitura
 * - Melhor logging e tratamento de erros
 */

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
    key: {
      remoteJid: string;
      fromMe: boolean;
      id: string;
      participant?: string; // remetente real em mensagens de grupo
    };
    message?: {
      conversation?: string;
      extendedTextMessage?: { text: string };
      imageMessage?: { caption?: string; url?: string; mimetype?: string };
      audioMessage?: { url?: string; mimetype?: string; seconds?: number };
      videoMessage?: { caption?: string; url?: string; mimetype?: string; seconds?: number };
      documentMessage?: { caption?: string; fileName?: string; url?: string; mimetype?: string };
      stickerMessage?: { url?: string; mimetype?: string };
      buttonsResponseMessage?: { selectedDisplayText: string };
      listResponseMessage?: { title: string };
      templateButtonReplyMessage?: { selectedDisplayText: string };
    };
    update?: { status: string }[];
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

function isValidJid(jid: string): boolean {
  return /^\d+@(s\.whatsapp\.net|g\.us|lid)$/.test(jid);
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
    m.videoMessage?.caption ||
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

  // Garantir que a tabela de deduplicação existe mesmo antes do primeiro webhook
  pool.query(`
    CREATE TABLE IF NOT EXISTS webhook_mensagens_processadas (
      id SERIAL PRIMARY KEY,
      message_id TEXT NOT NULL,
      instancia TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});

  const processados = new Set<string>();

  async function handleStatusUpdate(payload: EvolutionPayload): Promise<void> {
    const updates = payload.data?.update;
    if (!Array.isArray(updates)) return;

    for (const upd of updates) {
      const messageId = (upd as any).id || payload.data?.key?.id;
      const status = (upd as any).status || upd.status;
      if (!messageId || !status) continue;

      await pool.query(
        `INSERT INTO whatsapp_message_status (message_id, instance_name, status, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (message_id, instance_name) DO UPDATE
           SET status = EXCLUDED.status, updated_at = NOW()`,
        [messageId, payload.instance, status]
      ).catch(() => {});

      if (status === 'READ' || status === 'PLAYED') {
        await pool.query(
          `UPDATE whatsapp_messages SET is_read = true
           WHERE message_id = $1 AND instance_name = $2`,
          [messageId, payload.instance]
        ).catch(() => {});
      }
    }
  }

  router.post('/evolution', async (req: Request, res: Response) => {
    const webhookSecret = process.env.EVOLUTION_WEBHOOK_SECRET;
    if (webhookSecret && !verificarAssinaturaEvolution(req, webhookSecret)) {
      console.warn('[WEBHOOK] Assinatura inválida — requisição rejeitada');
      return res.status(401).json({ error: 'Assinatura inválida' });
    }

    res.status(200).json({ ok: true });

    try {
      const payload = req.body as EvolutionPayload;
      const eventNorm = (payload.event || '').toLowerCase().replace(/_/g, '.');

      if (eventNorm === 'messages.update') {
        await handleStatusUpdate(payload);
        return;
      }

      if (eventNorm !== 'messages.upsert') return;

      // Ignorar notificações de status sem conteúdo de mensagem
      const dataStatus = payload.data?.status;
      if (dataStatus === 'READ' || dataStatus === 'PLAYED' || dataStatus === 'DELIVERY_ACK') return;

      const remoteJid = payload.data?.key?.remoteJid || '';

      // Log para diagnóstico — nunca perder mensagens silenciosamente
      console.log(`[WEBHOOK] remoteJid recebido: "${remoteJid}" | event: ${eventNorm} | instance: ${payload.instance}`);
      if (!remoteJid) return;
      if (!remoteJid.includes('@')) return;
      // Aceitar grupos (@g.us) e contatos individuais (@s.whatsapp.net / @lid)
      const isGroup = remoteJid.endsWith('@g.us');

      const messageId = payload.data?.key?.id || '';
      if (!messageId) return;

      const instancia  = payload.instance;
      const telefone   = remoteJid.split('@')[0]; // phone ou groupId
      // Em grupos o remetente real fica em key.participant
      const participant = payload.data?.key?.participant;
      const senderJid  = isGroup ? (participant || '') : remoteJid;
      const senderPhone = senderJid.split('@')[0];
      const pushName   = payload.data?.pushName || (isGroup ? senderPhone : telefone);
      const fromMe     = payload.data?.key?.fromMe === true;

      // ── Busca agente UMA VEZ com fallbacks ───────────────────────────────────
      const agenteRes = await pool.query(
        `SELECT user_id, id as agente_id FROM agentes
         WHERE evolution_instancia = $1 AND ativo = true AND user_id IS NOT NULL
         ORDER BY updated_at DESC LIMIT 1`,
        [instancia]
      );

      let userId: string | null = null;
      let temAgente = false;

      if (agenteRes.rows.length) {
        userId = agenteRes.rows[0].user_id;
        temAgente = true;
      } else {
        // Fallback 1: integracoes_config
        const ic = await pool.query(
          `SELECT user_id FROM integracoes_config
           WHERE instancia = $1 AND tipo = 'evolution' AND user_id IS NOT NULL
           ORDER BY updated_at DESC LIMIT 1`,
          [instancia]
        ).catch(() => ({ rows: [] as any[] }));

        if (ic.rows.length) {
          userId = ic.rows[0].user_id;
        } else {
          // Fallback 2: whatsapp_instances
          const wi = await pool.query(
            `SELECT user_id FROM whatsapp_instances WHERE instance_name = $1 LIMIT 1`,
            [instancia]
          ).catch(() => ({ rows: [] as any[] }));

          if (wi.rows.length) {
            userId = wi.rows[0].user_id;
          } else if (instancia.startsWith('crm_')) {
            // Fallback 3: prefixo UUID no nome da instância
            const prefixo = instancia.slice(4);
            const u = await pool.query(
              `SELECT id FROM users
               WHERE replace(id::text, '-', '') LIKE $1 OR id::text LIKE $2 LIMIT 1`,
              [`${prefixo}%`, `${prefixo}%`]
            ).catch(() => ({ rows: [] as any[] }));
            if (u.rows.length) userId = u.rows[0].id;
          }
        }
      }

      // Log de diagnóstico de mapeamento
      console.log(`[WEBHOOK] userId=${userId} | temAgente=${temAgente} | instancia="${instancia}"`);
      if (userId && !temAgente) {
        const agentesDoUser = await pool.query(
          `SELECT nome, evolution_instancia, ativo FROM agentes WHERE user_id = $1`,
          [userId]
        ).catch(() => ({ rows: [] as any[] }));
        console.log(`[WEBHOOK] Agentes do user:`, JSON.stringify(agentesDoUser.rows));
      }

      // ── Mensagens do atendente (fromMe=true) → pausar IA ou reativar ─────────
      if (fromMe) {
        // Ignorar respostas do próprio bot e mensagens de grupo
        if (messageId.startsWith('resp_') || messageId.startsWith('manual_')) return;
        if (isGroup) return; // não processar fromMe em grupos

        if (userId) {
          const textoFromMe = extrairTexto(payload.data);
          const textoNormFromMe = (textoFromMe || '').trim().toLowerCase();
          const tipo  = extrairTipo(payload.data);
          const ts    = payload.data.messageTimestamp || Math.floor(Date.now() / 1000);
          const tsVal = ts > 1e10 ? Math.floor(ts / 1000) : ts;

          // Buscar palavra_reativar dinâmica do agent_configs
          const cfgReativar = await pool.query(
            `SELECT palavra_reativar FROM agent_configs
             WHERE user_id = $1 AND ativo = true LIMIT 1`,
            [userId]
          ).catch(() => ({ rows: [] as any[] }));
          const palavraReativar = (cfgReativar.rows[0]?.palavra_reativar || 'Atendimento finalizado').toLowerCase();

          if (textoNormFromMe === palavraReativar) {
            await pool.query(
              `UPDATE dados_cliente SET atendimento_ia = 'ativo'
               WHERE user_id = $1 AND telefone ILIKE $2`,
              [userId, `%${telefone.slice(-11)}`]
            ).catch(() => {});
            await pool.query(
              `UPDATE contatos SET atendente_pausou_ia = false, updated_at = NOW()
               WHERE user_id = $1 AND telefone ILIKE $2`,
              [userId, `%${telefone.slice(-11)}`]
            ).catch(() => {});
            console.log(`[WEBHOOK] IA reativada (palavra_reativar): ${telefone}`);
          } else {
            pool.query(
              `UPDATE contatos SET atendente_pausou_ia = true WHERE user_id = $1 AND telefone ILIKE $2`,
              [userId, `%${telefone.slice(-11)}`]
            ).then(async (r: any) => {
              if (!r.rowCount) {
                await pool.query(
                  `INSERT INTO contatos (user_id, nome, telefone, push_name, origem, status, atendente_pausou_ia)
                   VALUES ($1, $2, $3, $4, 'WhatsApp', 'novo', true)`,
                  [userId, telefone, telefone, pushName || null]
                ).catch(() => {});
              }
            }).catch(() => {});

            await pool.query(
              `UPDATE dados_cliente SET atendimento_ia = 'pause'
               WHERE user_id = $1 AND telefone ILIKE $2`,
              [userId, `%${telefone.slice(-11)}`]
            ).catch(() => {});

            console.log(`[WEBHOOK] Humano enviou para ${telefone} — IA pausada`);
          }

          await pool.query(
            `INSERT INTO whatsapp_messages
               (user_id, instance_name, remote_jid, message_id, from_me, message_type, content, status, timestamp_wa)
             VALUES ($1, $2, $3, $4, true, $5, $6, 'sent', to_timestamp($7))
             ON CONFLICT (message_id, instance_name) DO NOTHING`,
            [userId, instancia, remoteJid, messageId, tipo, textoFromMe || null, tsVal]
          ).catch(() => {});
        }
        return;
      }

      // ── Deduplicação em memória ───────────────────────────────────────────────
      if (processados.has(messageId)) return;
      processados.add(messageId);
      setTimeout(() => processados.delete(messageId), 60000);

      // ── Deduplicação no banco ─────────────────────────────────────────────────
      const jaExiste = await pool.query(
        'SELECT id FROM webhook_mensagens_processadas WHERE message_id = $1',
        [messageId]
      );
      if (jaExiste.rows.length) return;

      await pool.query(
        'INSERT INTO webhook_mensagens_processadas (message_id, instancia) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [messageId, instancia]
      ).catch(() => {});

      // ── Extrair dados ─────────────────────────────────────────────────────────
      const texto    = extrairTexto(payload.data);
      const tipo     = extrairTipo(payload.data);
      const midia    = extrairMidia(payload.data);
      const ts       = payload.data.messageTimestamp || Math.floor(Date.now() / 1000);
      const tsVal    = ts > 1e10 ? Math.floor(ts / 1000) : ts;

      // ── Persistir mensagem recebida ───────────────────────────────────────────
      if (userId) {
        // Em grupos guarda o remetente real (participant) no push_name
        const pushNameFinal = isGroup
          ? (pushName ? `${pushName} (grupo)` : senderPhone)
          : pushName || null;

        await pool.query(
          `INSERT INTO whatsapp_messages
             (user_id, instance_name, remote_jid, message_id, from_me, message_type,
              content, media_url, media_mimetype, push_name, status, timestamp_wa)
           VALUES ($1, $2, $3, $4, false, $5, $6, $7, $8, $9, 'received', to_timestamp($10))
           ON CONFLICT (message_id, instance_name) DO NOTHING`,
          [userId, instancia, remoteJid, messageId, tipo,
           texto || null, midia.url || null, midia.mime || null,
           pushNameFinal, tsVal]
        ).catch(err => console.warn('[WEBHOOK] Falha ao salvar mensagem:', err.message));

        // ── UPSERT de contato (apenas para contatos individuais, não grupos) ─────
        if (!isGroup) {
          void (async () => {
            try {
              const suffix = `%${telefone.slice(-11)}`;
              const nomeFinal = pushName || telefone;

              const upd = await pool.query(
                `UPDATE contatos
                 SET push_name          = COALESCE($1, push_name),
                     nome               = CASE WHEN nome = telefone THEN $1 ELSE nome END,
                     ultima_mensagem_em = NOW()
                 WHERE user_id = $2 AND telefone ILIKE $3`,
                [pushName || null, userId, suffix]
              );

              if (!upd.rowCount) {
                await pool.query(
                  `INSERT INTO contatos (user_id, nome, telefone, push_name, origem, status, ultima_mensagem_em, atendente_pausou_ia)
                   VALUES ($1, $2, $3, $4, 'WhatsApp', 'novo', NOW(), false)`,
                  [userId, nomeFinal, telefone, pushName || null]
                ).catch(() => {});
              }

              // Foto de perfil via Evolution API
              const cfg = await pool.query(
                `SELECT url, api_key FROM integracoes_config WHERE user_id=$1 AND tipo='evolution' LIMIT 1`,
                [userId]
              );
              const evoUrl = (cfg.rows[0]?.url || process.env.EVOLUTION_API_URL || 'https://fierceparrot-evolution.cloudfy.live').replace(/\/$/, '');
              const evoKey = cfg.rows[0]?.api_key || process.env.EVOLUTION_API_KEY || '';

              let picUrl: string | null = null;
              try {
                const r = await fetch(`${evoUrl}/chat/fetchProfilePictureUrl/${instancia}`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', apikey: evoKey },
                  body: JSON.stringify({ number: telefone }),
                });
                if (r.ok) {
                  const d: any = await r.json().catch(() => ({}));
                  picUrl = d?.profilePictureUrl || d?.url || d?.picture || null;
                }
              } catch {}

              if (!picUrl) {
                try {
                  const r = await fetch(`${evoUrl}/fetchProfilePicture/${instancia}?number=${telefone}`, {
                    headers: { apikey: evoKey },
                  });
                  if (r.ok) {
                    const d: any = await r.json().catch(() => ({}));
                    picUrl = d?.profilePictureUrl || d?.url || d?.picture || null;
                  }
                } catch {}
              }

              if (picUrl) {
                await pool.query(
                  `UPDATE contatos SET profile_pic_url = $1, foto_perfil = $1 WHERE user_id = $2 AND telefone ILIKE $3`,
                  [picUrl, userId, suffix]
                ).catch(() => {});
                console.log(`[WEBHOOK] Foto de perfil atualizada para ${telefone}`);
              }
            } catch (e: any) {
              console.warn('[WEBHOOK] Falha ao upsert contato:', e.message);
            }
          })();
        }
      }

      // ── Opt-out e reativação (apenas para contatos individuais) ──────────────
      const textoNorm = (texto || '').trim().toLowerCase();
      if (!isGroup && userId) {
        if (OPT_OUT_KEYWORDS.has(textoNorm)) {
          await pool.query(
            `UPDATE contatos SET opt_out = true, updated_at = NOW()
             WHERE user_id = $1 AND telefone ILIKE $2`,
            [userId, `%${telefone.slice(-11)}`]
          ).catch(() => {});
          await pool.query(
            `INSERT INTO disparo_optouts (user_id, telefone, motivo) VALUES ($1, $2, $3)`,
            [userId, telefone, textoNorm]
          ).catch(() => {});
          console.log(`[WEBHOOK] Opt-out: ${telefone}`);
          return;
        }

        if (REATIVAR_COMANDOS.has(textoNorm)) {
          await pool.query(
            `UPDATE dados_cliente SET atendimento_ia = 'ativo'
             WHERE user_id = $1 AND telefone ILIKE $2`,
            [userId, `%${telefone.slice(-11)}`]
          ).catch(() => {});
          await pool.query(
            `UPDATE contatos SET atendente_pausou_ia = false, updated_at = NOW()
             WHERE user_id = $1 AND telefone ILIKE $2`,
            [userId, `%${telefone.slice(-11)}`]
          ).catch(() => {});
          console.log(`[WEBHOOK] IA reativada: ${telefone}`);
          return;
        }
      }

      // ── Motor IA (apenas para contatos individuais) ───────────────────────────
      if (!userId) {
        console.warn(`[WEBHOOK] Nenhum userId encontrado para instância: ${instancia}`);
        return;
      }
      // Grupos não disparam IA automaticamente
      if (isGroup) {
        console.log(`[WEBHOOK] Grupo ${telefone} — mensagem salva, IA não processada`);
        return;
      }
      if (!texto && !['audio', 'image', 'video', 'document'].includes(tipo)) return;

      processarComDebounce(pool, {
        instancia,
        messageId,
        telefone,
        pushName,
        texto,
        tipo,
        midiaUrl: midia.url || undefined,
        timestamp: tsVal,
        userId: userId || undefined,
      }).catch(err => console.error(`[WEBHOOK] Erro ao processar ${messageId}:`, err));

    } catch (err) {
      console.error('[WEBHOOK] Erro crítico:', err);
    }
  });

  return router;
}
