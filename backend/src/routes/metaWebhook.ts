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
import { log } from '../logger';
import { processarWebhookMeta } from '../services/metaWebhookProcessor';

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
    // [AUDITORIA] BUG CORRIGIDO (Sprint 6 / H1 1.2, 2026-10-05): respondia 200 ANTES de validar a
    // assinatura e descartava o evento forjado em silêncio — quem testava a URL com assinatura
    // errada via "200 OK" e achava que estava tudo certo. Agora valida primeiro (é rápido: 1 leitura
    // da config + 1 HMAC, bem dentro dos 3s que a Meta tolera) e responde 401/404 quando não bate;
    // só depois devolve 200 e processa (o processamento continua fora do tempo de resposta — 1.3).
    let cfg: any;
    try {
      const cfgRes = await pool.query(
        `SELECT * FROM whatsapp_oficial_config WHERE id = $1 AND ativo = true`,
        [req.params.configId]
      );
      cfg = cfgRes.rows[0];
      if (!cfg) {
        log.warn('META_WEBHOOK', 'POST recebido pra config inexistente/inativa — ignorado', { configId: req.params.configId });
        return res.sendStatus(404);
      }
      if (!cfg.app_secret_enc) {
        log.warn('META_WEBHOOK', 'Config sem App Secret cadastrado — não dá pra validar assinatura, evento recusado', { configId: req.params.configId });
        return res.sendStatus(401);
      }
      const rawBody: Buffer | undefined = (req as any).rawBody;
      const assinatura = req.headers['x-hub-signature-256'] as string | undefined;
      const appSecret = decriptarSegredoMetaOficial(cfg.app_secret_enc);
      if (!rawBody || !verificarAssinaturaWebhook(appSecret, rawBody, assinatura)) {
        log.warn('META_WEBHOOK', 'Assinatura inválida — evento recusado (possível requisição forjada)', { configId: req.params.configId });
        return res.sendStatus(401);
      }
    } catch (err: any) {
      log.error('META_WEBHOOK', 'Erro ao validar evento', { err: err?.message });
      return res.sendStatus(500);
    }

    res.sendStatus(200);
    try {
      await pool.query(`UPDATE whatsapp_oficial_config SET ultimo_webhook_em = NOW() WHERE id = $1`, [cfg.id]).catch(() => {});
      // Sprint 5/6 (2026-10-05): processamento completo — todos os entry/changes, inbox idempotente,
      // status com erro/cobrança, qualidade/limite, templates, opt-out de marketing e coexistência.
      const r = await processarWebhookMeta(pool, cfg, req.body);
      log.info('META_WEBHOOK', 'Evento processado', { configId: req.params.configId, ...r });
    } catch (err: any) {
      log.error('META_WEBHOOK', 'Erro ao processar evento', { err: err?.message, stack: err?.stack });
    }
  });

  // [AUDITORIA] FIX PENDENTE (motivo: decisão de produto, mantido da fase anterior): a IA ainda não
  // responde pelo canal oficial — agentEngine.ts só envia pela Evolution; ligar exige abstrair o
  // envio (Evolution × Meta) e respeitar janela de 24h/templates.

  return router;
}
