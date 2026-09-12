/**
 * metaWebhook.ts — Receptor de eventos da WhatsApp Business Platform oficial (Meta Cloud API).
 *
 * [AUDITORIA] LÓGICA (Sprint Estruturar API Oficial, 2026-09-06): rota PÚBLICA (montada antes do
 * `authMiddleware` em index.ts, mesmo padrão de routes/webhook.ts pra Evolution) — a Meta chama
 * essa URL diretamente, sem JWT nosso. Segurança real vem de dois lugares: (1) o handshake de
 * verificação (`GET`, `hub.verify_token` tem que bater com o gerado por este sistema e colado
 * pelo operador no dashboard da Meta) confirma a URL antes da Meta começar a mandar eventos;
 * (2) toda entrega de evento (`POST`) é assinada com HMAC-SHA256 (`X-Hub-Signature-256`) usando
 * o App Secret — verificado em `verificarAssinaturaWebhook()` (metaCloudApi.ts) antes de
 * processar qualquer coisa do corpo.
 *
 * URL por `configId` (`whatsapp_oficial_config.id`, um UUID) — não por instância/nome como a
 * Evolution, porque cada conta pode ter seu próprio Meta App/WABA configurado independentemente;
 * não precisa resolver "de quem é essa mensagem" varrendo todo mundo, o próprio path já diz.
 *
 * Fase atual (primeira estrutura, ainda sem resposta automática): só recebe, valida assinatura,
 * loga e grava a mensagem em `whatsapp_messages` (marcada com `instance_name =
 * 'meta_oficial:<phone_number_id>'`, pra nunca colidir com nome de instância Evolution) — não
 * chama agentEngine.ts nem envia resposta nenhuma ainda. Conectar isso ao motor de IA é a
 * próxima fase, depois de confirmar (com a conta real do usuário) que a entrega básica funciona.
 */
import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { verificarAssinaturaWebhook, decriptarSegredoMetaOficial } from '../services/metaCloudApi';
import { withTenantContext } from '../db';
import { log } from '../logger';

export default function metaWebhookRouter(pool: Pool): Router {
  const router = Router();

  // GET /webhook/meta/:configId — handshake de verificação (Meta chama isso UMA VEZ, ao salvar
  // a URL no dashboard, e de novo sempre que o operador clicar "Verificar e salvar" lá).
  router.get('/:configId', async (req: Request, res: Response) => {
    try {
      const mode = req.query['hub.mode'];
      const token = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];

      const cfg = await pool.query(
        `SELECT verify_token FROM whatsapp_oficial_config WHERE id = $1`,
        [req.params.configId]
      );
      if (!cfg.rows.length) return res.status(404).send('Config não encontrada');

      if (mode === 'subscribe' && token === cfg.rows[0].verify_token) {
        log.info('META_WEBHOOK', 'Handshake de verificação OK', { configId: req.params.configId });
        return res.status(200).send(challenge);
      }
      log.warn('META_WEBHOOK', 'Handshake de verificação falhou — token não confere', { configId: req.params.configId });
      return res.sendStatus(403);
    } catch (err: any) {
      log.error('META_WEBHOOK', 'Erro no handshake de verificação', { err: err?.message });
      return res.sendStatus(500);
    }
  });

  // POST /webhook/meta/:configId — eventos de verdade (mensagem recebida, status de entrega,
  // status de aprovação de template).
  router.post('/:configId', async (req: Request, res: Response) => {
    // [AUDITORIA] LÓGICA: responde 200 JÁ NO INÍCIO, antes de processar — mesma convenção que
    // integrações com webhook da Meta recomendam (evita a Meta reenviar o mesmo evento em loop
    // por timeout enquanto processamos; qualquer falha de processamento vira só log, não afeta
    // a entrega em si). O corpo já foi lido (`req.rawBody`, capturado no `express.json({verify})`
    // de index.ts) antes deste handler rodar, então responder cedo não perde nada.
    res.sendStatus(200);
    try {
      const cfgRes = await pool.query(
        `SELECT * FROM whatsapp_oficial_config WHERE id = $1 AND ativo = true`,
        [req.params.configId]
      );
      const cfg = cfgRes.rows[0];
      if (!cfg) {
        log.warn('META_WEBHOOK', 'POST recebido pra config inexistente/inativa — ignorado', { configId: req.params.configId });
        return;
      }
      if (!cfg.app_secret_enc) {
        log.warn('META_WEBHOOK', 'Config sem App Secret cadastrado — não dá pra validar assinatura, evento ignorado por segurança', { configId: req.params.configId });
        return;
      }

      const rawBody: Buffer | undefined = (req as any).rawBody;
      const assinatura = req.headers['x-hub-signature-256'] as string | undefined;
      const appSecret = decriptarSegredoMetaOficial(cfg.app_secret_enc);
      if (!rawBody || !verificarAssinaturaWebhook(appSecret, rawBody, assinatura)) {
        log.warn('META_WEBHOOK', 'Assinatura inválida — evento descartado (possível requisição forjada)', { configId: req.params.configId });
        return;
      }

      const entradas: any[] = req.body?.entry || [];
      for (const entrada of entradas) {
        for (const mudanca of entrada.changes || []) {
          const valor = mudanca.value || {};
          const mensagens: any[] = valor.messages || [];
          for (const msg of mensagens) {
            await processarMensagemRecebida(pool, cfg, msg, valor);
          }
          // status de entrega/leitura (sent/delivered/read/failed) e status de aprovação de
          // template (message_template_status_update) chegam aqui também, em `valor.statuses`/
          // como um `field` diferente — não processados ainda nesta primeira fase (só log).
          if (valor.statuses?.length) {
            log.info('META_WEBHOOK', 'Status de mensagem recebido (ainda não processado)', {
              configId: req.params.configId, total: valor.statuses.length,
            });
          }
        }
      }
    } catch (err: any) {
      log.error('META_WEBHOOK', 'Erro ao processar evento', { err: err?.message, stack: err?.stack });
    }
  });

  async function processarMensagemRecebida(pool: Pool, cfg: any, msg: any, valor: any): Promise<void> {
    const de: string = msg.from; // dígitos puros, sem @s.whatsapp.net (formato diferente da Evolution)
    const tipo: string = msg.type; // 'text' | 'image' | 'audio' | 'video' | 'document' | ...
    const texto: string | null = msg.text?.body || null;
    const pushName: string | null = valor.contacts?.[0]?.profile?.name || null;
    const instanceName = `meta_oficial:${cfg.phone_number_id}`;

    log.info('META_WEBHOOK', 'Mensagem recebida via API Oficial', {
      userId: cfg.user_id, de, tipo, temTexto: !!texto,
    });

    // [AUDITORIA] LÓGICA: grava em whatsapp_messages com o MESMO formato de remote_jid que a
    // Evolution usa (`<digitos>@s.whatsapp.net`) — WhatsAppInterface.tsx/GET /conversas nunca
    // precisam saber que esta mensagem veio de um canal diferente, só o `instance_name` distinto
    // marca a procedência (útil pra filtrar/depurar depois). withTenantContext necessário pro
    // piloto de RLS em whatsapp_messages, mesmo motivo já documentado em webhook.ts/agentEngine.ts.
    await withTenantContext({ userId: cfg.user_id, isAdmin: false }, client => client.query(
      `INSERT INTO whatsapp_messages
         (user_id, instance_name, remote_jid, message_id, from_me, message_type, content, status, timestamp_wa, push_name)
       VALUES ($1,$2,$3,$4,false,$5,$6,'received',to_timestamp($7),$8)
       ON CONFLICT (message_id, instance_name) DO NOTHING`,
      [
        cfg.user_id, instanceName, `${de}@s.whatsapp.net`, msg.id,
        tipo === 'text' ? 'text' : tipo,
        texto,
        Number(msg.timestamp) || Math.floor(Date.now() / 1000),
        pushName,
      ]
    )).catch(err => log.error('META_WEBHOOK', 'Falha ao gravar mensagem recebida', { err: err?.message }));

    // [AUDITORIA] FIX PENDENTE (motivo: decisão de produto — próxima fase desta sprint, só depois
    // de confirmar recebimento básico funcionando contra a conta real do usuário): nenhuma
    // resposta automática ainda. agentEngine.ts hoje só sabe responder via Evolution
    // (enviarResposta/enviarRespostaVoz chamam a Evolution direto) — conectar este canal ao motor
    // de IA exige abstrair o envio por trás de uma interface comum (Evolution vs Meta Oficial),
    // não só chamar enviarTextoMetaOficial isolado daqui.
  }

  return router;
}
