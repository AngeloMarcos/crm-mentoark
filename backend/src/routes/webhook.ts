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
  
  async function handleMessageDelete(payload: EvolutionPayload): Promise<void> {
    const key = payload.data?.key;
    if (!key?.id) return;
    
    await pool.query(
      `DELETE FROM whatsapp_messages WHERE message_id = $1 AND instance_name = $2`,
      [key.id, payload.instance]
    ).catch(() => {});
  }
    // ── TRACE 0: chegou no servidor ──────────────────────────────────────────
    const traceId = Date.now().toString(36);
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`[WH:${traceId}] ENTRADA POST /webhook/evolution`);
    console.log(`[WH:${traceId}] headers.content-type="${req.headers['content-type']}" | body_keys="${Object.keys(req.body || {}).join(',')}"`);

    const webhookSecret = process.env.EVOLUTION_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error(`[WH:${traceId}] EVOLUTION_WEBHOOK_SECRET não configurado — rejeitando requisição`);
      return res.status(401).json({ error: 'Webhook secret não configurado no servidor' });
    }
    const ok = verificarAssinaturaEvolution(req, webhookSecret);
    console.log(`[WH:${traceId}] ASSINATURA válida=${ok}`);
    if (!ok) {
      console.warn(`[WH:${traceId}] Assinatura inválida — rejeitando`);
      return res.status(401).json({ error: 'Assinatura inválida' });
    }

    res.status(200).json({ ok: true });

    try {
      const payload = req.body as EvolutionPayload;
      const eventClean = (payload.event || '').toLowerCase().replace(/[^a-z0-9]/g, '');

      console.log(`[WH:${traceId}] EVENTO="${payload.event}" clean="${eventClean}" instance="${payload.instance}"`);
      console.log(`[WH:${traceId}] DATA jid="${payload.data?.key?.remoteJid}" fromMe=${payload.data?.key?.fromMe} msgId="${payload.data?.key?.id}" pushName="${payload.data?.pushName}"`);
      console.log(`[WH:${traceId}] TEXTO="${String(payload.data?.message?.conversation || payload.data?.message?.extendedTextMessage?.text || '').slice(0, 80)}"`);

      if (eventClean === 'messagesupdate') {
        console.log(`[WH:${traceId}] → handleStatusUpdate`);
        await handleStatusUpdate(payload);
        return;
      }

      if (eventClean === 'messagesdelete') {
        console.log(`[WH:${traceId}] → handleMessageDelete`);
        await handleMessageDelete(payload);
        return;
      }
      if (eventClean !== 'messagesupsert') {
        console.log(`[WH:${traceId}] IGNORADO evento não é messagesupsert (é "${eventClean}")`);
        return;
      }

      const dataStatus = payload.data?.status;
      if (dataStatus === 'READ' || dataStatus === 'PLAYED' || dataStatus === 'DELIVERY_ACK') {
        wlog('WEBHOOK_DROP', `status-only (${dataStatus}) instance=${payload.instance}`);
        return;
      }

      const remoteJid = payload.data?.key?.remoteJid || '';
      console.log(`[WH:${traceId}] remoteJid="${remoteJid}"`);
      if (!remoteJid) { wlog('WEBHOOK_DROP', `remoteJid vazio mid=${_mid} instance=${payload.instance}`); return; }
      if (!remoteJid.includes('@')) { wlog('WEBHOOK_DROP', `remoteJid sem @: "${remoteJid}" instance=${payload.instance}`); return; }
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

      // ── Lookup unificado: agent_configs → agentes → prefixo → integracoes_config → admin ──
      let userId: string | null = null;
      let palavraReativar = 'atendimento finalizado';
      let n8nWebhookUrl: string | null = null;

      // 1. agent_configs
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
        console.log(`[WH:${traceId}] USERID via agent_configs: ${userId}`);
      } else {
        console.log(`[WH:${traceId}] agent_configs: nenhum resultado para instancia="${instancia}"`);
      }

      // 2. Fallback legado: tabela agentes (também captura n8n_webhook_url)
      if (!userId) {
        const agtRes = await pool.query(
          `SELECT user_id, n8n_webhook_url FROM agentes
           WHERE (LOWER(evolution_instancia) = LOWER($1) OR LOWER(nome) = LOWER($1))
             AND ativo = true AND user_id IS NOT NULL
           ORDER BY updated_at DESC LIMIT 1`,
          [instancia]
        ).catch(() => ({ rows: [] as any[] }));
        if (agtRes.rows.length) {
          userId = agtRes.rows[0].user_id;
          n8nWebhookUrl = agtRes.rows[0].n8n_webhook_url || null;
          console.log(`[WH:${traceId}] USERID via agentes: ${userId} | n8n: ${n8nWebhookUrl ? 'SIM' : 'NÃO'}`);
        } else {
          console.log(`[WH:${traceId}] agentes: nenhum resultado`);
        }
      }
      // Também verifica n8n_webhook_url se userId já foi resolvido via agent_configs
      if (userId && !n8nWebhookUrl) {
        const n8nRes = await pool.query(
          `SELECT n8n_webhook_url FROM agentes
           WHERE user_id = $1 AND (LOWER(evolution_instancia) = LOWER($2) OR evolution_instancia IS NULL)
             AND ativo = true AND n8n_webhook_url IS NOT NULL
           ORDER BY updated_at DESC LIMIT 1`,
          [userId, instancia]
        ).catch(() => ({ rows: [] as any[] }));
        if (n8nRes.rows.length) {
          n8nWebhookUrl = n8nRes.rows[0].n8n_webhook_url;
          console.log(`[WH:${traceId}] n8n_webhook_url via agentes: ${n8nWebhookUrl}`);
        }
      }

      // 3. Fallback: prefixo UUID na instância (ex: crm_435ee4720fc3)
      if (!userId && instancia.startsWith('crm_')) {
        const prefixo = instancia.slice(4);
        const uRes = await pool.query(
          `SELECT id FROM users WHERE replace(id::text, '-', '') LIKE $1 LIMIT 1`,
          [`${prefixo}%`]
        ).catch(() => ({ rows: [] as any[] }));
        if (uRes.rows.length) {
          userId = uRes.rows[0].id;
          console.log(`[WH:${traceId}] USERID via prefixo UUID: ${userId}`);
        } else {
          console.log(`[WH:${traceId}] prefixo UUID "${prefixo}%": nenhum resultado`);
        }
      }

      // 4. Fallback: integracoes_config
      if (!userId) {
        const icRes = await pool.query(
          `SELECT user_id FROM integracoes_config
           WHERE LOWER(instancia) = LOWER($1) AND tipo = 'evolution'
           LIMIT 1`,
          [instancia]
        ).catch(() => ({ rows: [] as any[] }));
        if (icRes.rows.length) {
          userId = icRes.rows[0].user_id;
          console.log(`[WH:${traceId}] USERID via integracoes_config: ${userId}`);
        } else {
          console.log(`[WH:${traceId}] integracoes_config: nenhum resultado para instancia="${instancia}"`);
        }
      }

      // 5. Fallback: admin do sistema
      if (!userId) {
        const adminRes = await pool.query(
          `SELECT id FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1`
        ).catch(() => ({ rows: [] as any[] }));
        if (adminRes.rows.length) {
          userId = adminRes.rows[0].id;
          console.log(`[WH:${traceId}] USERID via admin-fallback: ${userId}`);
        } else {
          console.log(`[WH:${traceId}] FATAL: nenhum userId encontrado para instancia="${instancia}"`);
        }
      }

      console.log(`[WH:${traceId}] RESOLUCAO FINAL userId=${userId} | fromMe=${fromMe} | isGroup=${isGroup}`);

      // ── UPSERT antecipado de contato — garante que contatos novos existam antes de qualquer branch ──
      if (userId && !isGroup && remoteJid) {
        const suffixEarly = `%${telefone.slice(-11)}`;
        const nomeEarly = pushName || telefone;
        pool.query(
          `INSERT INTO contatos (user_id, nome, telefone, push_name, origem, status, ultima_mensagem_em, atendente_pausou_ia)
           VALUES ($1, $2, $3, $4, 'WhatsApp', 'novo', NOW(), false)
           ON CONFLICT (user_id, telefone) DO UPDATE
             SET push_name = COALESCE(EXCLUDED.push_name, contatos.push_name),
                 nome = CASE WHEN contatos.nome = contatos.telefone THEN EXCLUDED.nome ELSE contatos.nome END,
                 ultima_mensagem_em = NOW()`,
          [userId, nomeEarly, telefone, pushName || null]
        ).catch(err => console.warn('[WEBHOOK UPSERT_CONTATO_EARLY]:', err.message));
      }

      // ── Mensagens do atendente (fromMe=true) → pausar IA ou reativar ─────────
      if (fromMe) {
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
      const dedupKey = `${instancia}:${messageId}`;
      if (processados.has(dedupKey)) { wlog('WEBHOOK_DROP', `dedup memória mid=${messageId} inst=${instancia}`); return; }
      processados.add(dedupKey);
      setTimeout(() => processados.delete(dedupKey), 60000);
      const jaExiste = await pool.query(
        'SELECT id FROM webhook_mensagens_processadas WHERE message_id = $1',
        [messageId]
      );
      if (jaExiste.rows.length) return;

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
        const pushNameFinal = isGroup
          ? (pushName ? `${pushName} (grupo)` : senderPhone)
          : pushName || null;

        console.log(`[WH:${traceId}] INSERT whatsapp_messages userId=${userId} instancia="${instancia}" jid="${remoteJid}" msgId="${messageId}" tipo="${tipo}" texto="${(texto||'').slice(0,60)}"`);

        const insertResult = await pool.query(
          `INSERT INTO whatsapp_messages
             (user_id, instance_name, remote_jid, message_id, from_me, message_type,
              content, media_url, media_mimetype, push_name, status, timestamp_wa)
           VALUES ($1, $2, $3, $4, false, $5, $6, $7, $8, $9, 'received', to_timestamp($10))
           ON CONFLICT (message_id, instance_name) DO NOTHING`,
          [userId, instancia, remoteJid, messageId, tipo,
           texto || null, midia.url || null, midia.mime || null,
           pushNameFinal, tsVal]
        ).catch(err => {
          console.error(`[WH:${traceId}] ERRO INSERT whatsapp_messages:`, err.message);
          return { rowCount: -1 };
        });
        console.log(`[WH:${traceId}] INSERT RESULT rowCount=${(insertResult as any).rowCount} (0=duplicata, 1=novo, -1=erro)`);

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
                 WHERE user_id = $2 AND telefone ILIKE $3
                 RETURNING profile_pic_url`,
                [pushName || null, userId, suffix]
              );

              if (!upd.rowCount) {
                await pool.query(
                  `INSERT INTO contatos (user_id, nome, telefone, push_name, origem, status, ultima_mensagem_em, atendente_pausou_ia)
                   VALUES ($1, $2, $3, $4, 'WhatsApp', 'novo', NOW(), false)`,
                  [userId, nomeFinal, telefone, pushName || null]
                ).catch(() => {});
              } else if (upd.rows[0]?.profile_pic_url) {
                return; // foto já salva — não chamar Evolution API
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
          // Enviar confirmação via Evolution (busca config do agente)
          try {
            const cfgOptOut = await pool.query(
              `SELECT COALESCE(evolution_server_url, $2) AS url,
                      COALESCE(evolution_api_key, $3)    AS api_key,
                      COALESCE(evolution_instancia, $4)  AS instancia
               FROM agentes
               WHERE user_id = $1 AND ativo = true
               ORDER BY updated_at DESC LIMIT 1`,
              [userId,
               process.env.EVOLUTION_API_URL || 'https://disparo.mentoark.com.br',
               process.env.EVOLUTION_API_KEY || '',
               instancia]
            ).catch(() => ({ rows: [] as any[] }));
            if (cfgOptOut.rows.length) {
              const { url: evoUrl, api_key: evoApiKey, instancia: evoInst } = cfgOptOut.rows[0];
              const base = (evoUrl || '').trim().replace(/\/+$/, '');
              await fetch(`${base}/message/sendText/${evoInst}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', apikey: evoApiKey },
                body: JSON.stringify({ number: telefone, text: 'Você foi removido da nossa lista. Para se reinscrever, envie "reativar".' }),
              }).catch(() => {});
            }
          } catch {}
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
        wlog('WEBHOOK_REJECT', `NENHUM userId para instância: "${instancia}" — mensagem descartada`);
        return;
      }
      // Grupos não disparam IA automaticamente
      if (isGroup) {
        console.log(`[WEBHOOK] Grupo ${telefone} — mensagem salva, IA não processada`);
        return;
      }
      if (!texto && !['audio', 'image', 'video', 'document'].includes(tipo)) {
        wlog('WEBHOOK_DROP', `sem texto e sem mídia tipo=${tipo} mid=${messageId} jid=${remoteJid}`);
        return;
      }

      // Rota N8N: se agente tem n8n_webhook_url configurado, encaminha para lá
      if (n8nWebhookUrl) {
        console.log(`[WEBHOOK] Roteando para N8N: ${n8nWebhookUrl}`);
        fetch(n8nWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instancia, messageId, telefone, pushName, texto, tipo,
            midiaUrl: midia.url || null, timestamp: tsVal, userId, remoteJid,
          }),
        }).catch(err => console.error(`[WEBHOOK] Erro ao encaminhar para N8N: ${err.message}`));
        return;
      }

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
