import { Router, Response } from 'express';
import { Pool } from 'pg';
import { AuthRequest } from '../middleware';

// Default Evolution server (VPS local — disparo.mentoark.com.br)
const DEFAULT_EVO_URL = process.env.EVOLUTION_API_URL || 'https://fierceparrot-evolution.cloudfy.live';
const DEFAULT_EVO_KEY = process.env.EVOLUTION_API_KEY || 'wZKRX72nZ6sM4yQuOoS6lo76fs5fO7cV';
const WEBHOOK_URL =
  process.env.EVOLUTION_WEBHOOK_URL || 'https://api.mentoark.com.br/webhook/evolution';
const WEBHOOK_EVENTS = ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'];

function webhookPayload() {
  return {
    url: WEBHOOK_URL,
    byEvents: false,
    base64: true,
    events: WEBHOOK_EVENTS,
  };
}

// Registra (ou atualiza) o webhook da instância no Evolution.
// Idempotente — pode ser chamado várias vezes sem efeito colateral.
async function registrarWebhook(base: string, apiKey: string, instancia: string): Promise<void> {
  try {
    const res = await fetch(`${base}/webhook/set/${instancia}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: apiKey },
      body: JSON.stringify({ webhook: webhookPayload() }),
    });
    if (!res.ok) {
      // Algumas versões aceitam payload flat em vez de aninhado
      await fetch(`${base}/webhook/set/${instancia}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: apiKey },
        body: JSON.stringify(webhookPayload()),
      }).catch(() => null);
    }
  } catch (err) {
    console.warn(`[whatsapp] Falha ao registrar webhook para ${instancia}:`, (err as Error).message);
  }
}

function normalizeQr(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const b64 = raw.replace(/^data:image\/\w+;base64,/, '');
  return `data:image/png;base64,${b64}`;
}

export default function whatsappRouter(pool: Pool): Router {
  const router = Router();

  // Retorna config do agente, ou config global com nome de instância gerado
  async function getEvolutionConfig(userId: string): Promise<{
    url: string; api_key: string; instancia: string; agenteId: string | null; isGlobal: boolean;
  }> {
    // 1. Tenta buscar em integracoes_config (onde o status de conexão principal é salvo)
    const intRes = await pool.query(
      `SELECT url, api_key, instancia FROM integracoes_config 
       WHERE user_id = $1 AND tipo = 'evolution' LIMIT 1`,
      [userId]
    );

    if (intRes.rows.length) {
      const row = intRes.rows[0];
      return {
        url: row.url || DEFAULT_EVO_URL,
        api_key: row.api_key || DEFAULT_EVO_KEY,
        instancia: row.instancia || `crm_${userId.replace(/-/g, '').slice(0, 12)}`,
        agenteId: null,
        isGlobal: !row.url
      };
    }

    // 2. Fallback para Agentes
    const r = await pool.query(
      `SELECT id, evolution_server_url AS url, evolution_api_key AS api_key, evolution_instancia AS instancia
       FROM agentes
       WHERE user_id = $1 AND ativo = true
       ORDER BY updated_at DESC LIMIT 1`,
      [userId]
    );

    if (r.rows.length) {
      const row = r.rows[0];
      const url = row.url || DEFAULT_EVO_URL;
      const api_key = row.api_key || DEFAULT_EVO_KEY;
      const instancia = row.instancia || `crm_${userId.replace(/-/g, '').slice(0, 12)}`;
      return { url, api_key, instancia, agenteId: row.id, isGlobal: !row.url };
    }

    // 3. Fallback final global
    const instancia = `crm_${userId.replace(/-/g, '').slice(0, 12)}`;
    return { url: DEFAULT_EVO_URL, api_key: DEFAULT_EVO_KEY, instancia, agenteId: null, isGlobal: true };
  }

  // Salva/atualiza a config Evolution no agente do usuário
  async function saveEvolutionConfig(
    userId: string, agenteId: string | null,
    url: string, api_key: string, instancia: string
  ) {
    // 1. Sempre salvar em integracoes_config (fonte da verdade do status)
    await pool.query(
      `INSERT INTO integracoes_config (user_id, tipo, url, api_key, instancia, status, updated_at)
       VALUES ($1, 'evolution', $2, $3, $4, 'conectado', NOW())
       ON CONFLICT (user_id, tipo) DO UPDATE SET
         url = EXCLUDED.url,
         api_key = EXCLUDED.api_key,
         instancia = EXCLUDED.instancia,
         status = 'conectado',
         updated_at = NOW()`,
      [userId, url, api_key, instancia]
    );

    // 2. Sincronizar com Agente se existir
    if (agenteId) {
      await pool.query(
        `UPDATE agentes SET evolution_server_url=$1, evolution_api_key=$2, evolution_instancia=$3, updated_at=NOW()
         WHERE id=$4 AND user_id=$5`,
        [url, api_key, instancia, agenteId, userId]
      );
    } else {
      // Tentar encontrar um agente ativo para este usuário e atualizar
      await pool.query(
        `UPDATE agentes SET evolution_server_url=$1, evolution_api_key=$2, evolution_instancia=$3, updated_at=NOW()
         WHERE user_id=$4 AND ativo=true`,
        [url, api_key, instancia, userId]
      );
    }
  }

  // GET /api/whatsapp/conversas
  // Usa window function para eliminar subqueries N+1 e JOIN para enriquecer contatos
  router.get('/conversas', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;

      const r = await pool.query(
        `WITH ranked AS (
           SELECT
             m.remote_jid,
             m.instance_name,
             m.content,
             m.from_me,
             m.created_at,
             m.message_id,
             COUNT(*) OVER (PARTITION BY m.remote_jid, m.instance_name) AS total,
             ROW_NUMBER() OVER (PARTITION BY m.remote_jid, m.instance_name ORDER BY m.created_at DESC) AS rn
           FROM whatsapp_messages m
           WHERE m.user_id = $1
             AND m.remote_jid NOT LIKE '%@g.us'
         )
         SELECT
           r.phone AS session_id,
           r.instance_name AS instancia,
           r.created_at AS ultima_atividade,
           r.total::int AS total,
           r.content AS ultima_mensagem,
           CASE WHEN r.from_me THEN 'assistant' ELSE 'user' END AS ultimo_role,
           COALESCE(c.push_name, c.nome) AS push_name,
           c.nome AS nome_contato
         FROM (
           SELECT remote_jid,
                  split_part(remote_jid,'@',1) AS phone,
                  instance_name, content, from_me, created_at, total
           FROM ranked WHERE rn = 1
         ) r
         LEFT JOIN contatos c ON c.user_id = $1
           AND c.telefone LIKE '%' || RIGHT(r.phone, 11)
         ORDER BY r.created_at DESC
         LIMIT 300`,
        [userId]
      );

      const conversas = r.rows.map(row => ({
        session_id: row.session_id,
        instancia: row.instancia,
        nome: row.nome_contato || row.push_name || row.session_id,
        push_name: row.push_name || null,
        ultima_atividade: row.ultima_atividade,
        ultima_mensagem: row.ultima_mensagem || '',
        ultimo_role: row.ultimo_role,
        total: Number(row.total),
        mensagens: [],
      }));

      return res.json(conversas);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // GET /api/whatsapp/conversas/:phone
  // Usa coluna phone gerada (índice) e JOIN para status de entrega
  router.get('/conversas/:phone', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const phone = decodeURIComponent(req.params.phone).replace(/\D/g, '');
      if (!phone) return res.status(400).json({ message: 'Telefone inválido' });

      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const offset = Number(req.query.offset) || 0;

      const r = await pool.query(
        `SELECT
           m.id, m.message_id, m.from_me, m.message_type, m.content,
           m.media_url, m.media_mimetype, m.status, m.is_read,
           m.timestamp_wa, m.created_at,
           COALESCE(s.status, m.status) AS delivery_status
         FROM whatsapp_messages m
         LEFT JOIN whatsapp_message_status s
           ON s.message_id = m.message_id AND s.instance_name = m.instance_name
         WHERE m.phone = $1 AND m.user_id = $2
         ORDER BY m.created_at ASC
         LIMIT $3 OFFSET $4`,
        [phone, userId, limit, offset]
      );

      const mensagens = r.rows.map(row => ({
        id: row.id,
        message_id: row.message_id,
        role: row.from_me ? 'assistant' : 'user',
        content: row.content || '',
        push_name: null,
        tipo: row.message_type,
        midia_url: row.media_url,
        midia_mime: row.media_mimetype,
        midia_nome: null,
        status: row.delivery_status || row.status,
        is_read: row.is_read,
        created_at: row.created_at,
        timestamp_wa: row.timestamp_wa,
      }));

      return res.json(mensagens);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // GET /api/whatsapp/status/:phone — status de entrega das últimas mensagens enviadas
  router.get('/status/:phone', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const phone = decodeURIComponent(req.params.phone).replace(/\D/g, '');
      const r = await pool.query(
        `SELECT m.message_id, COALESCE(s.status, m.status) AS status, m.created_at
         FROM whatsapp_messages m
         LEFT JOIN whatsapp_message_status s
           ON s.message_id = m.message_id AND s.instance_name = m.instance_name
         WHERE m.phone = $1 AND m.user_id = $2 AND m.from_me = true
         ORDER BY m.created_at DESC LIMIT 50`,
        [phone, userId]
      );
      return res.json(r.rows);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // POST /api/whatsapp/status
  router.post('/status', async (req: AuthRequest, res: Response) => {
    try {
      const cfg = await getEvolutionConfig(req.userId!);
      const base = cfg.url.replace(/\/$/, '');

      const r = await fetch(`${base}/instance/connectionState/${cfg.instancia}`, {
        headers: { apikey: cfg.api_key },
      }).catch(() => null);

      if (!r || !r.ok) {
        return res.json({ state: 'close', instancia: cfg.instancia });
      }

      const data: any = await r.json();
      const state = data?.instance?.state || data?.state || 'close';
      const phoneNumber = data?.instance?.profileName || data?.instance?.name || '';

      return res.json({ state, phoneNumber, instancia: cfg.instancia });
    } catch (err: any) {
      return res.json({ state: 'close', instancia: null });
    }
  });

  // POST /api/whatsapp/connect — cria instância e retorna QR code
  router.post('/connect', async (req: AuthRequest, res: Response) => {
    try {
      const cfg = await getEvolutionConfig(req.userId!);
      const base = cfg.url.replace(/\/$/, '');

      // 1. Verifica estado atual
      const stateRes = await fetch(`${base}/instance/connectionState/${cfg.instancia}`, {
        headers: { apikey: cfg.api_key },
      }).catch(() => null);

      if (stateRes?.ok) {
        const stateData: any = await stateRes.json();
        const state = stateData?.instance?.state || stateData?.state || 'close';
        if (state === 'open') {
          return res.json({
            state: 'open',
            phoneNumber: stateData?.instance?.profileName || '',
            instancia: cfg.instancia,
          });
        }
      }

      // 2. Tenta conectar instância existente
      const connectRes = await fetch(`${base}/instance/connect/${cfg.instancia}`, {
        headers: { apikey: cfg.api_key },
      }).catch(() => null);

      if (connectRes?.ok) {
        const connectData: any = await connectRes.json();
        const qrRaw = connectData?.base64 || connectData?.qrcode?.base64 || null;
        // Só retorna aqui se tiver QR; se não tiver, segue para criar nova instância
        if (qrRaw) {
          await saveEvolutionConfig(req.userId!, cfg.agenteId, cfg.url, cfg.api_key, cfg.instancia);
          await registrarWebhook(base, cfg.api_key, cfg.instancia);
          return res.json({
            state: 'connecting',
            qrCode: normalizeQr(qrRaw),
            pairingCode: connectData?.pairingCode || null,
            instanceName: cfg.instancia,
            instancia: cfg.instancia,
          });
        }
      }

      // 3. Cria nova instância (webhook embutido — Evolution v2)
      const phoneNumber = (req.body?.phoneNumber as string | undefined)?.replace(/\D/g, '') || undefined;
      
      const createPayload = {
        instanceName: cfg.instancia,
        token: cfg.api_key,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
        rejectCall: false,
        groupsIgnore: true,
        alwaysOnline: true,
        readMessages: true,
        readStatus: false,
        ...(phoneNumber ? { number: phoneNumber } : {}),
        webhook: webhookPayload(),
      };

      console.log(`[WHATSAPP] Criando instância em ${base}: ${cfg.instancia}`);
      
      const createRes = await fetch(`${base}/instance/create`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          'apikey': cfg.api_key 
        },
        body: JSON.stringify(createPayload),
      });

      const created: any = await createRes.json();
      console.log(`[WHATSAPP] Resposta Evolution create:`, JSON.stringify(created).slice(0, 500));



      // Se já existe, tenta conectar
      if (!createRes.ok && (created?.message?.includes('already') || created?.message?.includes('exist'))) {
        const reconnectRes = await fetch(`${base}/instance/connect/${cfg.instancia}`, {
          headers: { apikey: cfg.api_key },
        }).catch(() => null);
        if (reconnectRes?.ok) {
          const rcData: any = await reconnectRes.json();
          const qrRaw = rcData?.base64 || rcData?.qrcode?.base64 || rcData?.code || null;
          await saveEvolutionConfig(req.userId!, cfg.agenteId, cfg.url, cfg.api_key, cfg.instancia);
          await registrarWebhook(base, cfg.api_key, cfg.instancia);
          return res.json({
            state: 'connecting',
            qrCode: normalizeQr(qrRaw),
            pairingCode: rcData?.pairingCode || rcData?.code || null,
            instanceName: cfg.instancia,
            instancia: cfg.instancia,
          });
        }
      }

      let qrCode = created?.qrcode?.base64 || created?.hash?.qrcode || null;
      let pairingCode =
        created?.qrcode?.pairingCode || created?.pairingCode || created?.hash?.pairingCode || null;

      // Se o create não retornou QR (comum no Evolution v2), busca via /connect
      if (!qrCode) {
        await new Promise(r => setTimeout(r, 1500)); // aguarda instância inicializar
        const qrRes = await fetch(`${base}/instance/connect/${cfg.instancia}`, {
          headers: { apikey: cfg.api_key },
        }).catch(() => null);
        if (qrRes?.ok) {
          const qrData: any = await qrRes.json();
          qrCode = qrData?.base64 || qrData?.qrcode?.base64 || null;
          pairingCode = pairingCode || qrData?.pairingCode || null;
        }
      }

      await saveEvolutionConfig(req.userId!, cfg.agenteId, cfg.url, cfg.api_key, cfg.instancia);
      // Garante webhook configurado mesmo se o create inline foi ignorado
      await registrarWebhook(base, cfg.api_key, cfg.instancia);

      return res.json({
        state: created?.instance?.state || 'connecting',
        qrCode: normalizeQr(qrCode),
        pairingCode,
        instanceName: cfg.instancia,
        instancia: cfg.instancia,
      });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // POST /api/whatsapp/disconnect
  router.post('/disconnect', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const cfg = await getEvolutionConfig(userId);
      const base = cfg.url.replace(/\/$/, '');
      const instancia = cfg.instancia;

      console.log(`[WHATSAPP] Desconectando instância: ${instancia} para o usuário ${userId}`);

      // 1. Tentar fazer logout (desconecta o WhatsApp da instância)
      await fetch(`${base}/instance/logout/${instancia}`, {
        method: 'DELETE',
        headers: { apikey: cfg.api_key },
      }).catch(err => console.warn(`[WHATSAPP] Erro no logout de ${instancia}:`, err.message));

      // 2. Tentar deletar a instância permanentemente da Evolution API
      const deleteRes = await fetch(`${base}/instance/delete/${instancia}`, {
        method: 'DELETE',
        headers: { apikey: cfg.api_key },
      }).catch(err => {
        console.error(`[WHATSAPP] Erro crítico ao deletar ${instancia}:`, err.message);
        return null;
      });

      if (deleteRes && !deleteRes.ok) {
        const errorText = await deleteRes.text().catch(() => 'Erro desconhecido');
        console.warn(`[WHATSAPP] Evolution retornou erro ao deletar ${instancia}: ${deleteRes.status} - ${errorText}`);
      }

      // 3. Limpar a referência da instância no banco de dados do sistema
      if (cfg.agenteId) {
        await pool.query(
          `UPDATE agentes 
           SET evolution_instancia = NULL, 
               evolution_server_url = NULL, 
               evolution_api_key = NULL,
               updated_at = NOW() 
           WHERE id = $1 AND user_id = $2`,
          [cfg.agenteId, userId]
        );
      }

      // 4. Também limpar em integracoes_config para garantir (G1/B3)
      await pool.query(
        `DELETE FROM integracoes_config 
         WHERE user_id = $1 AND instancia = $2 AND tipo = 'evolution'`,
        [userId, instancia]
      );

      return res.json({ ok: true, message: 'Instância desconectada e removida com sucesso' });
    } catch (err: any) {
      console.error('[WHATSAPP] Erro ao processar disconnect:', err);
      return res.status(500).json({ message: err.message });
    }
  });

  // POST /api/whatsapp/sync-history — importa mensagens da Evolution para whatsapp_messages
  router.post('/sync-history', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const instanciaParam = (req.body?.instancia as string | undefined)?.trim();
      const cfg = await getEvolutionConfig(userId);
      const instancia = instanciaParam || cfg.instancia;
      const base = cfg.url.replace(/\/$/, '');

      // Buscar mensagens com paginação via /chat/findMessages
      // (findChats pode falhar em algumas versões da Evolution — usamos findMessages diretamente)
      const PAGE_SIZE = 500;
      const messages: any[] = [];
      let page = 1;
      let totalPages = 1;

      do {
        const msgsRes = await fetch(`${base}/chat/findMessages/${instancia}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: cfg.api_key },
          body: JSON.stringify({ where: {}, limit: PAGE_SIZE, page }),
        });
        if (!msgsRes.ok) {
          const t = await msgsRes.text().catch(() => '');
          if (messages.length === 0) {
            return res.status(502).json({ message: `Evolution messages ${msgsRes.status}: ${t.slice(0, 200)}` });
          }
          break; // Se já temos mensagens, continua com o que tem
        }
        const msgsJson: any = await msgsRes.json();
        const records: any[] = msgsJson?.messages?.records || msgsJson?.records || (Array.isArray(msgsJson) ? msgsJson : []);
        messages.push(...records);
        totalPages = msgsJson?.messages?.pages || 1;
        page++;
      } while (page <= totalPages && messages.length < 10000);

      const chats: any[] = []; // findChats omitido — não necessário para importação

      let inseridos = 0;
      for (const m of messages) {
        try {
          const key = m.key || {};
          const remoteJid: string = key.remoteJid || m.remoteJid || '';
          if (!remoteJid || remoteJid.endsWith('@g.us')) continue;
          // message_id = WhatsApp message ID (key.id); fallback para id interno da Evolution
          const messageId = key.id || m.id || `${remoteJid}_${m.messageTimestamp}`;
          const fromMe = !!key.fromMe;
          const ts = Number(m.messageTimestamp || Math.floor(Date.now() / 1000));
          const msgContent = m.message || {};
          const msgType: string = m.messageType || (
            msgContent.imageMessage ? 'image'
            : msgContent.audioMessage ? 'audio'
            : msgContent.videoMessage ? 'video'
            : msgContent.documentMessage ? 'document'
            : msgContent.stickerMessage ? 'sticker'
            : 'text'
          );
          const content =
            msgContent.conversation ||
            msgContent.extendedTextMessage?.text ||
            msgContent.imageMessage?.caption ||
            msgContent.videoMessage?.caption ||
            msgContent.documentMessage?.caption ||
            null;

          const result = await pool.query(
            `INSERT INTO whatsapp_messages
               (user_id, instance_name, remote_jid, message_id, from_me, message_type,
                content, status, timestamp_wa)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8, to_timestamp($9))
             ON CONFLICT (message_id, instance_name) DO NOTHING`,
            [userId, instancia, remoteJid, messageId, fromMe, msgType,
             content, fromMe ? 'sent' : 'received', ts]
          );
          if (result.rowCount && result.rowCount > 0) inseridos++;
        } catch (err: any) {
          console.warn('[SYNC] msg skip:', err.message);
        }
      }

      return res.json({ chats: chats.length, messages: messages.length, inseridos });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // POST /api/whatsapp/send — envia mensagem manual (texto ou mídia)
  router.post('/send', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const {
        phone, text, instancia: instanciaParam,
        mediaUrl, mediaType, mediaCaption, mediaFilename,
      } = req.body as {
        phone: string; text?: string; instancia?: string;
        mediaUrl?: string; mediaType?: 'image' | 'audio' | 'video' | 'document';
        mediaCaption?: string; mediaFilename?: string;
      };

      // Validar número de telefone (formato internacional)
      const phoneClean = (phone || '').replace(/\D/g, '');
      if (!phoneClean || phoneClean.length < 10 || phoneClean.length > 15) {
        return res.status(400).json({ message: 'Número de telefone inválido' });
      }
      if (!text && !mediaUrl) {
        return res.status(400).json({ message: 'text ou mediaUrl são obrigatórios' });
      }

      const cfg = await getEvolutionConfig(userId);
      const instancia = instanciaParam || cfg.instancia;
      const base = cfg.url.replace(/\/$/, '');

      let evolutionResp: any;
      let msgType = 'text';

      if (mediaUrl && mediaType) {
        // Envio de mídia
        msgType = mediaType;
        const mediaEndpoints: Record<string, string> = {
          image: 'sendMedia',
          video: 'sendMedia',
          document: 'sendMedia',
          audio: 'sendMedia',
        };
        const endpoint = mediaEndpoints[mediaType] || 'sendMedia';
        const mediaPayload: any = {
          number: phoneClean,
          mediatype: mediaType,
          media: mediaUrl,
          delay: 1200,
        };
        if (mediaCaption) mediaPayload.caption = mediaCaption;
        if (mediaFilename) mediaPayload.fileName = mediaFilename;

        const r = await fetch(`${base}/message/${endpoint}/${instancia}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: cfg.api_key },
          body: JSON.stringify(mediaPayload),
        });
        if (!r.ok) {
          const err = await r.text().catch(() => r.status.toString());
          return res.status(502).json({ message: `Evolution ${r.status}: ${err.slice(0, 200)}` });
        }
        evolutionResp = await r.json().catch(() => ({}));
      } else {
        // Envio de texto
        const r = await fetch(`${base}/message/sendText/${instancia}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: cfg.api_key },
          body: JSON.stringify({ number: phoneClean, text, delay: 1200 }),
        });
        if (!r.ok) {
          const err = await r.text().catch(() => r.status.toString());
          return res.status(502).json({ message: `Evolution ${r.status}: ${err.slice(0, 200)}` });
        }
        evolutionResp = await r.json().catch(() => ({}));
      }

      const messageId = evolutionResp?.key?.id || `manual_${Date.now()}`;
      const content = text || mediaCaption || null;

      await pool.query(
        `INSERT INTO whatsapp_messages
           (user_id, instance_name, remote_jid, message_id, from_me, message_type,
            content, media_url, status, timestamp_wa)
         VALUES ($1, $2, $3, $4, true, $5, $6, $7, 'sent', NOW())
         ON CONFLICT (message_id, instance_name) DO NOTHING`,
        [userId, instancia, `${phoneClean}@s.whatsapp.net`,
         messageId, msgType, content, mediaUrl || null]
      ).catch(err => console.warn('[SEND] Falha ao salvar:', err.message));

      return res.json({ ok: true, messageId });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // DELETE /api/whatsapp/instances/:name — remove instância na Evolution e desvincula do agente
  router.delete('/instances/:name', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const name = req.params.name;
      const cfg = await getEvolutionConfig(userId);
      const base = cfg.url.replace(/\/$/, '');

      await fetch(`${base}/instance/logout/${name}`, {
        method: 'DELETE',
        headers: { apikey: cfg.api_key },
      }).catch(() => null);

      await fetch(`${base}/instance/delete/${name}`, {
        method: 'DELETE',
        headers: { apikey: cfg.api_key },
      }).catch(() => null);

      await pool.query(
        `UPDATE agentes SET evolution_instancia=NULL WHERE user_id=$1 AND evolution_instancia=$2`,
        [userId, name]
      );

      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  return router;
}

