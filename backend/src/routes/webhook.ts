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
import fs from 'fs';
import { processarComDebounce, botMessageIds, botSentTexts } from '../services/agentEngine';

function wlog(tag: string, msg: string) {
  const line = `[${new Date().toISOString()}] [${tag}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync('/opt/crm/backend/log_geral.txt', line + '\n'); } catch {}
}

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
      // Correção 1 — normalizar evento removendo qualquer separador (_, ., /) e caixa
      const eventClean = (payload.event || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const _rj = payload.data?.key?.remoteJid || '';
      const _mid = payload.data?.key?.id || '';
      wlog('WEBHOOK_IN', `event="${payload.event}" clean="${eventClean}" instance="${payload.instance}" jid="${_rj}" mid="${_mid}" fromMe=${payload.data?.key?.fromMe}`);

      if (eventClean === 'messagesupdate') {
        await handleStatusUpdate(payload);
        return;
      }

      // Aceita 'messagesupsert' (cobre MESSAGES_UPSERT, messages.upsert, messages_upsert etc.)
      if (eventClean !== 'messagesupsert') {
        wlog('WEBHOOK_DROP', `evento ignorado: "${eventClean}"`);
        return;
      }

      // Ignorar notificações de status sem conteúdo de mensagem
      const dataStatus = payload.data?.status;
      if (dataStatus === 'READ' || dataStatus === 'PLAYED' || dataStatus === 'DELIVERY_ACK') {
        wlog('WEBHOOK_DROP', `status-only (${dataStatus}) mid=${_mid}`);
        return;
      }

      const remoteJid = payload.data?.key?.remoteJid || '';
      if (!remoteJid) { wlog('WEBHOOK_DROP', `remoteJid vazio mid=${_mid}`); return; }
      if (!remoteJid.includes('@')) { wlog('WEBHOOK_DROP', `remoteJid sem @: "${remoteJid}"`); return; }
      const isGroup = remoteJid.endsWith('@g.us');

      const messageId = payload.data?.key?.id || '';
      if (!messageId) { wlog('WEBHOOK_DROP', `messageId vazio jid=${remoteJid}`); return; }


      const instancia  = payload.instance;
      const telefone   = remoteJid.split('@')[0]; // phone ou groupId
      // Em grupos o remetente real fica em key.participant
      const participant = payload.data?.key?.participant;
      const senderJid  = isGroup ? (participant || '') : remoteJid;
      const senderPhone = senderJid.split('@')[0];
      const pushName   = payload.data?.pushName || (isGroup ? senderPhone : telefone);
      const fromMe     = payload.data?.key?.fromMe === true;

      // ── Lookup unificado: agent_configs (fonte principal) → agentes (legado) ──
      let userId: string | null = null;
      let palavraReativar = 'atendimento finalizado'; // valor padrão

      // 1. agent_configs — busca por evolution_instancia ou nome_agente, obtém palavra_reativar junto
      const cfgRes = await pool.query(
        `SELECT user_id, palavra_reativar
         FROM agent_configs
         WHERE (LOWER(evolution_instancia) = LOWER($1) OR LOWER(nome_agente) = LOWER($1))
           AND ativo = true
         LIMIT 1`,
        [instancia]
      ).catch(() => ({ rows: [] as any[] }));

      if (cfgRes.rows.length) {
        userId = cfgRes.rows[0].user_id;
        palavraReativar = (cfgRes.rows[0].palavra_reativar || palavraReativar).toLowerCase();
      }

      // 2. Fallback legado: tabela agentes (migração gradual)
      if (!userId) {
        const agtRes = await pool.query(
          `SELECT user_id FROM agentes
           WHERE (LOWER(evolution_instancia) = LOWER($1) OR LOWER(nome) = LOWER($1))
             AND ativo = true AND user_id IS NOT NULL
           ORDER BY updated_at DESC LIMIT 1`,
          [instancia]
        ).catch(() => ({ rows: [] as any[] }));
        if (agtRes.rows.length) userId = agtRes.rows[0].user_id;
      }

      // 3. Fallback final: prefixo UUID no nome da instância (ex: crm_435ee4720fc3)
      if (!userId && instancia.startsWith('crm_')) {
        const prefixo = instancia.slice(4);
        const uRes = await pool.query(
          `SELECT id FROM users WHERE replace(id::text, '-', '') LIKE $1 LIMIT 1`,
          [`${prefixo}%`]
        ).catch(() => ({ rows: [] as any[] }));
        if (uRes.rows.length) userId = uRes.rows[0].id;
      }

      wlog('WEBHOOK', `userId=${userId} | instancia="${instancia}" | palavraReativar="${palavraReativar}"`);

      // ── Mensagens do atendente (fromMe=true) → pausar IA ou reativar ─────────
      if (fromMe) {
        // Proteção multicamada contra falso-positivo humano
        // (cobre atrasos de rede: o ID pode chegar depois do botMessageIds já ter sido limpo)
        if (messageId.startsWith('resp_') || messageId.startsWith('manual_')) {
          wlog('WEBHOOK_ANTILOOP', `Prefixo de bot detectado — ignorando: ${messageId}`);
          return;
        }
        if (botMessageIds.has(messageId)) {
          wlog('WEBHOOK_ANTILOOP', `ID de bot no registro — antiloop: ${messageId}`);
          return;
        }
        const textoFromMeAntiloop = extrairTexto(payload.data);
        if (textoFromMeAntiloop) {
          const tk1 = `${telefone}:${textoFromMeAntiloop}`;
          const tk2 = `${telefone}:${textoFromMeAntiloop.trim()}`;
          if (botSentTexts.has(tk1) || botSentTexts.has(tk2)) {
            wlog('WEBHOOK_ANTILOOP', `Conteúdo de bot detectado — antiloop por texto: ${messageId}`);
            return;
          }
        }
        // Proteção extra: mensagens muito recentes (< 5s) com ID no padrão WA real (3EB...) e timestamp recente
        // são provavelmente ecos do bot; verificar no banco se já temos esse messageId como from_me=true
        const jaExisteBot = await pool.query(
          `SELECT 1 FROM whatsapp_messages WHERE message_id = $1 AND from_me = true LIMIT 1`,
          [messageId]
        ).catch(() => ({ rows: [] }));
        if (jaExisteBot.rows.length) {
          wlog('WEBHOOK_ANTILOOP', `Mensagem de bot já salva no banco — ignorando: ${messageId}`);
          return;
        }
        if (isGroup) return;

        if (userId) {
          const textoFromMe = extrairTexto(payload.data);
          const textoNormFromMe = (textoFromMe || '').trim().toLowerCase();
          const tipo  = extrairTipo(payload.data);
          const ts    = payload.data.messageTimestamp || Math.floor(Date.now() / 1000);
          const tsVal = ts > 1e10 ? Math.floor(ts / 1000) : ts;

          // palavraReativar já foi obtida no lookup principal (acima)
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
              `INSERT INTO dados_cliente (user_id, telefone, atendimento_ia, pausa_timestamp)
               VALUES ($1, $2, 'pause', NOW())
               ON CONFLICT (user_id, telefone) DO UPDATE
                 SET atendimento_ia = 'pause', pausa_timestamp = NOW()`,
              [userId, telefone]
            ).catch(() =>
              // fallback sem UPSERT caso não exista constraint única
              pool.query(
                `UPDATE dados_cliente SET atendimento_ia = 'pause', pausa_timestamp = NOW()
                 WHERE user_id = $1 AND telefone ILIKE $2`,
                [userId, `%${telefone.slice(-11)}`]
              ).catch(() => {})
            );

            console.log(`[WEBHOOK HUMAN INTERVENTION] ${telefone} → IA pausada | msg: "${(textoFromMe || '').slice(0, 60)}"`);
          }

          await pool.query(
            `INSERT INTO whatsapp_messages
               (user_id, instance_name, remote_jid, message_id, from_me, message_type, content, status, timestamp_wa)
             VALUES ($1, $2, $3, $4, true, $5, $6, 'sent', to_timestamp($7))
             ON CONFLICT (message_id, instance_name) DO NOTHING`,
            [userId, instancia, remoteJid, messageId, tipo, textoFromMe || null, tsVal]
          ).catch(err => console.error('[WEBHOOK INSERT fromMe whatsapp_messages]:', err.message));
        }
        return;
      }

      // ── Deduplicação em memória (escopo por instância) ───────────────────────
      const memKey = `${instancia}:${messageId}`;
      if (processados.has(memKey)) { wlog('WEBHOOK_DROP', `dedup memória ${memKey}`); return; }
      processados.add(memKey);
      setTimeout(() => processados.delete(memKey), 60000);

      // ── Deduplicação no banco (escopo por instância) ─────────────────────────
      const jaExiste = await pool.query(
        'SELECT id FROM webhook_mensagens_processadas WHERE message_id = $1 AND instancia = $2',
        [messageId, instancia]
      );
      if (jaExiste.rows.length) { wlog('WEBHOOK_DROP', `dedup banco mid=${messageId} inst=${instancia}`); return; }

      await pool.query(
        'INSERT INTO webhook_mensagens_processadas (message_id, instancia) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [messageId, instancia]
      ).catch(err => console.error('[WEBHOOK INSERT webhook_mensagens_processadas]:', err.message));


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

              // Foto de perfil via Evolution API — usa agent_configs como fonte
              const cfgEvo = await pool.query(
                `SELECT evolution_server_url AS url, evolution_api_key AS api_key
                 FROM agent_configs WHERE user_id = $1 AND ativo = true LIMIT 1`,
                [userId]
              ).catch(() => ({ rows: [] as any[] }));
              const evoUrl = (cfgEvo.rows[0]?.url || process.env.EVOLUTION_API_URL || 'https://disparo.mentoark.com.br').replace(/\/$/, '');
              const evoKey = cfgEvo.rows[0]?.api_key || process.env.EVOLUTION_API_KEY || '';

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

          try {
            const cfgOptOut = await pool.query(
              `SELECT COALESCE(evolution_server_url, $2) AS url,
                      COALESCE(evolution_api_key,    $3) AS api_key,
                      COALESCE(evolution_instancia,  $4) AS inst
               FROM agentes
               WHERE user_id = $1 AND ativo = true
               ORDER BY updated_at DESC LIMIT 1`,
              [
                userId,
                process.env.EVOLUTION_API_URL || 'https://disparo.mentoark.com.br',
                process.env.EVOLUTION_API_KEY || '',
                instancia,
              ]
            ).catch(() => ({ rows: [] as any[] }));

            if (cfgOptOut.rows.length) {
              const { url, api_key, inst } = cfgOptOut.rows[0];
              const base = (url || '').trim().replace(/\/+$/, '');
              await fetch(`${base}/message/sendText/${inst}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', apikey: api_key },
                body: JSON.stringify({
                  number: telefone,
                  text: 'Você foi removido da nossa lista. Para se reinscrever, envie *reativar*.',
                  delay: 1000,
                }),
              }).catch(() => {});
            }
          } catch {}

          console.log(`[WEBHOOK] Opt-out confirmado: ${telefone}`);
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
        wlog('WEBHOOK_REJECT', `NENHUM userId para instância: "${instancia}" — mensagem descartada`);
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
