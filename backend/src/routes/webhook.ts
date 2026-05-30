/**
 * webhook.ts — Receptor de eventos da Evolution API (WhatsApp)
 *
 * A Evolution API envia um POST para /webhook/evolution a cada evento
 * (mensagem recebida, mensagem enviada, status atualizado, etc.).
 *
 * Este arquivo é responsável por:
 *  1. Validar a assinatura HMAC (segurança)
 *  2. Filtrar eventos relevantes (apenas messages.upsert)
 *  3. Deduplicar mensagens (evitar processamento duplicado)
 *  4. Detectar mensagens enviadas pelo atendente → pausar IA
 *  5. Processar opt-out (palavras como "sair", "stop")
 *  6. Processar comandos de reativação ("reativar ia")
 *  7. Encaminhar para o motor de IA (processarComDebounce)
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import crypto from 'crypto';
import { processarComDebounce } from '../services/agentEngine';

/**
 * Verifica a assinatura HMAC-SHA256 enviada pela Evolution API.
 * O header x-evolution-hmac contém o HMAC do body em hexadecimal.
 *
 * timingSafeEqual é usado para evitar timing attacks — comparação
 * de strings normais vaza informação sobre quantos bytes são iguais.
 */
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

/** Estrutura do payload recebido da Evolution API no evento messages.upsert */
interface EvolutionPayload {
  event: string;       // Ex: "messages.upsert", "connection.update"
  instance: string;    // Nome da instância WhatsApp configurada na Evolution
  data: {
    key: {
      remoteJid: string;  // JID do contato: "5511999@s.whatsapp.net" ou grupo@g.us
      fromMe: boolean;    // true = mensagem enviada por nós; false = recebida
      id: string;         // ID único da mensagem (gerado pelo WhatsApp)
    };
    message?: {
      // Tipos de mensagem suportados pela Evolution API
      conversation?: string;                                     // Texto simples
      extendedTextMessage?: { text: string };                    // Texto com formatação
      imageMessage?: { caption?: string; url?: string; mimetype?: string };
      audioMessage?: { url?: string; mimetype?: string };
      videoMessage?: { caption?: string; url?: string; mimetype?: string };
      documentMessage?: { caption?: string; fileName?: string; url?: string; mimetype?: string };
      stickerMessage?: { url?: string; mimetype?: string };
      // Respostas de botões interativos
      buttonsResponseMessage?: { selectedDisplayText: string };
      listResponseMessage?: { title: string };
      templateButtonReplyMessage?: { selectedDisplayText: string };
    };
    messageTimestamp?: number;  // Unix timestamp da mensagem
    pushName?: string;          // Nome exibido do contato
    status?: string;            // "READ", "DELIVERED", etc.
  };
}

/**
 * Palavras-chave que ativam o opt-out automático.
 * O contato é marcado como opt_out=true e não recebe mais mensagens do bot.
 * Comparação feita após normalização (trim + toLowerCase).
 */
const OPT_OUT_KEYWORDS = new Set([
  'sair', 'stop', 'parar', 'cancelar', 'remover', 'não quero', 'nao quero',
]);

/**
 * Comandos que reativam a IA após uma pausa humana.
 * O atendente (ou o próprio cliente) pode digitar um desses comandos
 * para devolver o controle ao bot.
 */
const REATIVAR_COMANDOS = new Set([
  'reativar ia', 'ativar ia', 'reativar', 'atendimento finalizado',
]);

/** Extrai o texto principal da mensagem, independente do tipo */
function extrairTexto(data: EvolutionPayload['data']): string | null {
  const m = data.message;
  if (!m) return null;
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||          // Legenda da imagem (pode ser null)
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.listResponseMessage?.title ||
    m.templateButtonReplyMessage?.selectedDisplayText ||
    m.documentMessage?.caption ||
    null
  );
}

/**
 * Determina o tipo de mensagem para o motor de IA.
 * O motor usa esse campo para decidir se precisa transcrever (audio)
 * ou analisar visualmente (image) antes de processar.
 */
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

/** Extrai URL e metadados da mídia (quando presente) */
function extrairMidia(data: EvolutionPayload['data']): { url?: string; mime?: string; nome?: string } {
  const m = data.message;
  if (!m) return {};
  const src = m.imageMessage || m.audioMessage || m.videoMessage || m.documentMessage || m.stickerMessage;
  if (!src) return {};
  return { url: (src as any).url, mime: (src as any).mimetype, nome: (src as any).fileName };
}

export default function webhookRouter(pool: Pool): Router {
  const router = Router();

  /**
   * Set em memória para deduplicação rápida.
   * O mesmo messageId pode chegar múltiplas vezes devido a retentativas
   * da Evolution API — guardamos os IDs por 60s para evitar duplicatas.
   */
  const processados = new Set<string>();

  /**
   * POST /webhook/evolution
   *
   * Ponto de entrada único para todos os eventos da Evolution API.
   * Retorna 200 imediatamente (antes do processamento assíncrono) para
   * evitar timeout da Evolution e garantir entrega rápida do ACK.
   */
  router.post('/evolution', async (req: Request, res: Response) => {
    // Validar assinatura HMAC se o secret estiver configurado
    const webhookSecret = process.env.EVOLUTION_WEBHOOK_SECRET;
    if (webhookSecret && !verificarAssinaturaEvolution(req, webhookSecret)) {
      console.warn('[WEBHOOK] Assinatura inválida — requisição rejeitada');
      return res.status(401).json({ error: 'Assinatura inválida' });
    }

    // ACK imediato — processamento ocorre de forma assíncrona abaixo
    res.status(200).json({ ok: true });

    try {
      const payload = req.body as EvolutionPayload;

      // Filtrar: só processar mensagens novas (ignorar status, conexão, etc.)
      // Evolution envia MESSAGES_UPSERT (uppercase+underscore), normalizar para messages.upsert
      const eventNorm = (payload.event || '').toLowerCase().replace(/_/g, '.');
      if (eventNorm !== 'messages.upsert') return;
      if (payload.data?.status === 'READ') return; // Notificação de leitura

      const messageId = payload.data?.key?.id || '';
      const instancia  = payload.instance;
      const remoteJid  = payload.data?.key?.remoteJid || '';
      const telefone   = remoteJid.split('@')[0]; // Remove o sufixo @s.whatsapp.net
      const pushName   = payload.data?.pushName || telefone;
      const fromMe     = payload.data?.key?.fromMe === true;

      // Ignorar mensagens de grupos (JID termina em @g.us)
      if (!messageId || !telefone || remoteJid.includes('@g.us')) return;

      // ── Mensagens enviadas pelo atendente (fromMe=true) ───────────────────
      if (fromMe) {
        // Mensagens do próprio bot têm ID prefixado com 'resp_' (ver agentEngine.ts)
        // Ignorar para não criar loop infinito
        if (messageId.startsWith('resp_')) return;

        // É o atendente digitando manualmente → pausar IA para esse contato
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

      // ── Deduplicação em memória (rápida) ──────────────────────────────────
      if (processados.has(messageId)) return;
      processados.add(messageId);
      setTimeout(() => processados.delete(messageId), 60000); // Limpar após 1 min

      // ── Deduplicação no banco (persistente entre reinicializações) ─────────
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
      const texto    = extrairTexto(payload.data);
      const tipo     = extrairTipo(payload.data);
      const midia    = extrairMidia(payload.data);
      const timestamp = payload.data.messageTimestamp || Math.floor(Date.now() / 1000);

      // ── Localizar agente e user_id pela instância ─────────────────────────
      const agenteRes = await pool.query(
        `SELECT user_id FROM agentes
         WHERE evolution_instancia = $1 AND ativo = true AND user_id IS NOT NULL
         ORDER BY updated_at DESC LIMIT 1`,
        [instancia]
      );

      let userId: string | null = null;
      if (agenteRes.rows.length) {
        userId = agenteRes.rows[0].user_id;

        // Persistir a mensagem recebida no histórico WhatsApp (schema EN)
        await pool.query(
          `INSERT INTO whatsapp_messages
             (user_id, instance_name, remote_jid, message_id, from_me, message_type,
              content, media_url, media_mimetype, status, timestamp_wa)
           VALUES ($1, $2, $3, $4, false, $5, $6, $7, $8, 'received', to_timestamp($9))
           ON CONFLICT (message_id, instance_name) DO NOTHING`,
          [userId, instancia, remoteJid, messageId, tipo,
           texto || null, midia.url || null, midia.mime || null, timestamp]
        ).catch(err => console.warn('[WEBHOOK] Falha ao salvar whatsapp_messages:', err.message));

        // Manter push_name e timestamp_última_mensagem atualizados no contato
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
        return; // Não processar pela IA
      }

      // ── Comando de reativação da IA ───────────────────────────────────────
      // O atendente (ou o cliente) envia um desses textos para devolver o
      // controle ao bot após uma pausa de atendimento humano
      if (userId && REATIVAR_COMANDOS.has(textoNorm)) {
        await pool.query(
          `UPDATE dados_cliente SET atendimento_ia = 'ativo'
           WHERE user_id = $1 AND telefone ILIKE $2`,
          [userId, `%${telefone.slice(-11)}`]
        ).catch(() => {});
        console.log(`[WEBHOOK] IA reativada por comando: ${telefone}`);
        return; // Não processar a mensagem de reativação pela IA
      }

      // ── Motor IA ──────────────────────────────────────────────────────────
      // Processar apenas tipos com conteúdo útil para a IA
      // Sticker, vídeo sem legenda e documento sem legenda são descartados
      if (!texto && !['audio', 'image'].includes(tipo)) return;

      // processarComDebounce aguarda 3s por mais mensagens do mesmo contato
      // antes de chamar a OpenAI (evita múltiplas respostas para mensagens picotadas)
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
