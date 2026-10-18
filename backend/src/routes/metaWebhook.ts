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

  // ── Sprint 6 do maturador (2026-10-18): webhook ÚNICO do app da MentoArk (Tech Provider) ──────
  // Números cadastrados pelo Embedded Signup não têm app próprio: a Meta entrega os eventos de todos
  // eles numa URL só, configurada uma vez no app, assinada com o App Secret da MentoArk. Cada change é
  // roteado para a config pelo `metadata.phone_number_id` (ou pelo WABA id do entry). Registrado ANTES
  // de '/:configId' para "app" não ser lido como id de config.
  router.get('/app', (req: Request, res: Response) => {
    const esperado = process.env.META_WEBHOOK_VERIFY_TOKEN;
    if (esperado && req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === esperado) {
      log.info('META_WEBHOOK', 'Handshake do webhook do app OK');
      return res.status(200).send(req.query['hub.challenge']);
    }
    log.warn('META_WEBHOOK', 'Handshake do webhook do app falhou', { configurado: !!esperado });
    return res.sendStatus(403);
  });

  router.post('/app', async (req: Request, res: Response) => {
    const segredo = process.env.FACEBOOK_APP_SECRET;
    const rawBody: Buffer | undefined = (req as any).rawBody;
    if (!segredo || !rawBody || !verificarAssinaturaWebhook(segredo, rawBody, req.headers['x-hub-signature-256'] as string | undefined)) {
      log.warn('META_WEBHOOK', 'Webhook do app: assinatura inválida ou App Secret ausente — recusado');
      return res.sendStatus(401);
    }
    res.sendStatus(200);
    try {
      // Agrupa os changes por config (um entry pode trazer mais de um número da mesma WABA).
      const porConfig = new Map<string, { cfg: any; entry: any[] }>();
      for (const entry of req.body?.entry || []) {
        for (const change of entry?.changes || []) {
          const phoneId = change?.value?.metadata?.phone_number_id ? String(change.value.metadata.phone_number_id) : null;
          const r = await pool.query(
            `SELECT * FROM whatsapp_oficial_config
             WHERE ativo AND ((phone_number_id = $1 AND $1 IS NOT NULL) OR ($1 IS NULL AND waba_id = $2))
             ORDER BY (phone_number_id = $1) DESC NULLS LAST LIMIT 1`,
            [phoneId, String(entry?.id || '')]
          );
          const cfg = r.rows[0];
          if (!cfg) { log.warn('META_WEBHOOK', 'Webhook do app: número/WABA sem config ativa', { phoneId, wabaId: entry?.id, campo: change?.field }); continue; }
          const g = porConfig.get(cfg.id) ?? { cfg, entry: [] };
          g.entry.push({ ...entry, changes: [change] });
          porConfig.set(cfg.id, g);
        }
      }
      for (const { cfg, entry } of porConfig.values()) {
        await pool.query(`UPDATE whatsapp_oficial_config SET ultimo_webhook_em = NOW() WHERE id = $1`, [cfg.id]).catch(() => {});
        const r = await processarWebhookMeta(pool, cfg, { object: req.body?.object, entry });
        log.info('META_WEBHOOK', 'Evento do app processado', { configId: cfg.id, ...r });
      }
    } catch (err: any) {
      log.error('META_WEBHOOK', 'Erro ao processar evento do app', { err: err?.message, stack: err?.stack });
    }
  });

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
