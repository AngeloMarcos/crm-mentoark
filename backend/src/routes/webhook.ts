/**
 * webhook.ts — Receptor de eventos da Evolution API (WhatsApp)
 *
 * Recebe POST /webhook/evolution (autenticado por EVOLUTION_WEBHOOK_SECRET via
 * header HMAC opcional ou ?key= na URL — ver verificarAssinaturaEvolution/verificarChaveQuery).
 * Resolve o dono (userId) da instância que disparou o evento em 4 níveis de fallback,
 * nesta ordem: agent_configs → agentes → prefixo UUID (crm_<12-hex>) → integracoes_config.
 * Sem userId, a mensagem é descartada (log [WEBHOOK_REJECT]).
 * [AUDITORIA] FIX APLICADO (2026-07-21): havia um 5º fallback ("primeiro admin cadastrado")
 * que atribuía QUALQUER instância não resolvida a uma conta de cliente real — vazamento de
 * dados entre tenants confirmado em produção (3 mensagens de teste antigas atribuídas à
 * conta de uma cliente real). Removido; instância não resolvida agora só descarta a
 * mensagem, nunca atribui a um usuário arbitrário. Ver diagnosticos/AUDITORIA_LOG.md.
 * Também trata MESSAGES_UPDATE (status de entrega/leitura) e MESSAGES_DELETE.
 *
 * [AUDITORIA] LÓGICA: cabeçalho reescrito em 2026-07 — a versão anterior citava uma
 * tabela "whatsapp_instances" que não existe mais no código (a lógica real usa
 * agent_configs/agentes), ficara desatualizado de um refactor anterior.
 *
 * [AUDITORIA] BUG (achado C da revisão externa/Google AI Studio): toda busca por telefone
 * neste arquivo usa `telefone ILIKE $N` com parâmetro `%${telefone.slice(-11)}` — curinga no
 * início da string impede o Postgres de usar índice B-Tree em `telefone`, forçando full table
 * scan em toda mensagem recebida. Piora conforme a base de contatos cresce. Ocorrências atuais
 * (linhas aproximadas, conferir na íntegra pois deslocam com futuras edições): 509, 514, 520,
 * 542 (bloco de pausa/reativação de IA por mensagem fromMe), 670, 749 (upsert de contato/foto
 * de perfil), 767, 805, 810 (opt-out e reativação por comando de texto).
 * [AUDITORIA] FIX PENDENTE (motivo: exige migração de dados, não só código — normalizar a
 * coluna `telefone` para formato E.164 antes de trocar `ILIKE '%...'` por igualdade exata
 * `=`; decisão do usuário sobre quando rodar essa migração em produção, dado o volume de
 * linhas existentes em `contatos`/`dados_cliente`).
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import crypto from 'crypto';
import fs from 'fs';
import { processarComDebounce, botMessageIds, botSentTexts } from '../services/agentEngine';
import { log } from '../logger';

// [AUDITORIA] FIX APLICADO (achado D da revisão externa/Google AI Studio): fs.appendFileSync
// bloqueava o event loop a cada chamada (todo webhook recebido, update de status, descarte)
// — sob tráfego alto isso degradaria a latência de TODA a API, não só desta rota. Trocado
// por fs.appendFile assíncrono (fire-and-forget, erro de escrita em log auxiliar é ignorável).
// [AUDITORIA] LÓGICA: este arquivo plano parece redundante com log.info() (grava o mesmo
// conteúdo em dois destinos) — não removido porque pode haver script/monitoramento externo
// lendo log_geral.txt especificamente; confirmar com o usuário antes de remover essa escrita.
function wlog(tag: string, msg: string) {
  // [AUDITORIA] LÓGICA: Formata a linha de log no padrão clássico com timestamp ISO e tag.
  const line = `[${new Date().toISOString()}] [${tag}] ${msg}`;
  log.info(tag, msg);
  // [AUDITORIA] LÓGICA: Realiza a gravação assíncrona no disco, sem reter a execução da thread principal.
  fs.appendFile('/opt/crm/backend/log_geral.txt', line + '\n', () => {});
}

// [AUDITORIA] LÓGICA: Valida a assinatura de segurança HMAC SHA-256 enviada no cabeçalho x-evolution-hmac.
function verificarAssinaturaEvolution(req: Request, secret: string): boolean {
  const assinaturaRecebida = req.headers['x-evolution-hmac'] as string;
  if (!assinaturaRecebida) return false;
  const body = JSON.stringify(req.body);
  const hmac = crypto.createHmac('sha256', secret).update(body).digest('hex');
  try {
    // [AUDITORIA] LÓGICA:timingSafeEqual evita ataques de temporização (Timing Attacks) ao comparar hashes de tamanho igual.
    return crypto.timingSafeEqual(Buffer.from(assinaturaRecebida, 'hex'), Buffer.from(hmac, 'hex'));
  } catch {
    return false;
  }
}

// [AUDITORIA] LÓGICA: Validação de segurança via Query Parameter (?key=) na URL do Webhook.
// Evolution API (community) não calcula HMAC do corpo — o único jeito real de
// autenticar o webhook global é um segredo estático embutido na própria URL
// configurada em WEBHOOK_GLOBAL_URL (?key=...). O HMAC acima fica como opção
// mais forte, caso o header algum dia seja enviado por uma integração customizada.
function verificarChaveQuery(req: Request, secret: string): boolean {
  const chaveRecebida = req.query.key as string | undefined;
  if (!chaveRecebida) return false;
  const a = Buffer.from(chaveRecebida);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// [AUDITORIA] LÓGICA: Tipagem estrutural do payload esperado da Evolution API para garantir a consistência de leitura das propriedades.
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

// [AUDITORIA] LÓGICA: Dicionário em Set para busca O(1) de palavras-chave que disparam a desativação da automação (opt-out).
const OPT_OUT_KEYWORDS = new Set([
  'sair', 'stop', 'parar', 'cancelar', 'remover', 'não quero', 'nao quero',
]);

// [AUDITORIA] LÓGICA: Dicionário em Set para busca rápida de comandos que reativam o bot de inteligência artificial.
const REATIVAR_COMANDOS = new Set([
  'reativar ia', 'ativar ia', 'reativar', 'atendimento finalizado',
]);

// [AUDITORIA] BUG: função escrita para validar o formato do remoteJid mas nunca chamada —
// o código real (linha do handler POST /evolution) só verifica `remoteJid.includes('@')`,
// uma checagem bem mais fraca que deixaria passar JIDs em formato inesperado (ex: futuros
// sufixos do WhatsApp ainda não cobertos por essa regex, ou um payload malformado).
// [AUDITORIA] FIX PENDENTE (motivo: mudança de comportamento de filtragem em produção sem
// teste manual — se a regex não cobrir 100% dos formatos de JID que a Evolution realmente
// envia hoje (ex: listas de transmissão "@broadcast", canais "@newsletter"), passar a usar
// isValidJid() no lugar de `includes('@')` derrubaria mensagens legítimas em silêncio, o que
// é pior que o risco atual. Próxima sessão: confirmar com logs reais quais sufixos de JID
// aparecem em produção antes de trocar a validação, ou remover a função se decidido que não
// vale o risco.
// [AUDITORIA] ATUALIZAÇÃO (achado E da revisão externa/Google AI Studio): além do ponto acima,
// a regex candidata abaixo (`/^\d+@(s\.whatsapp\.net|g\.us|lid)$/`) está ela mesma incorreta
// para grupos — JIDs de grupo (@g.us) frequentemente têm um hífen no meio (ex:
// "120363190000000000-1620000000@g.us"), não são só dígitos. Se algum dia esta função for
// ativada, essa regex específica descartaria grupos legítimos — não usar como está, precisa
// permitir hífen na parte antes do "@" para @g.us antes de cogitar ativação.
function isValidJid(jid: string): boolean {
  return /^\d+@(s\.whatsapp\.net|g\.us|lid)$/.test(jid);
}

// [AUDITORIA] LÓGICA: Extrai texto legível de múltiplos formatos de mensagens de mídia e respostas interativas do WhatsApp.
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

// [AUDITORIA] LÓGICA: Mapeia a assinatura da mensagem recebida para uma taxonomia simplificada do banco (text, image, audio, etc.).
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

// [AUDITORIA] LÓGICA: Extrai metadados de arquivos binários associados às mensagens recebidas da Evolution API.
function extrairMidia(data: EvolutionPayload['data']): { url?: string; mime?: string; nome?: string } {
  const m = data.message;
  if (!m) return {};
  const src = m.imageMessage || m.audioMessage || m.videoMessage || m.documentMessage || m.stickerMessage;
  if (!src) return {};
  return { url: (src as any).url, mime: (src as any).mimetype, nome: (src as any).fileName };
}

export default function webhookRouter(pool: Pool): Router {
  const router = Router();

  // [AUDITORIA] LÓGICA: Criação preventiva da tabela de dedup no banco de dados para evitar rejections no primeiro webhook.
  pool.query(`
    CREATE TABLE IF NOT EXISTS webhook_mensagens_processadas (
      id SERIAL PRIMARY KEY,
      message_id TEXT NOT NULL,
      instancia TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});

  const processados = new Set<string>();

  // [AUDITORIA] LÓGICA: Manipula eventos `messages.update` para refletir recibos de entrega (DELIVERY_ACK) e leitura (READ).
  async function handleStatusUpdate(payload: EvolutionPayload): Promise<void> {
    // [AUDITORIA] FIX APLICADO (achado da revisão externa/Google AI Studio, rodada 2 - 2026-07-10):
    // as queries abaixo usam payload.instance sem checar presença — payload malformado sem esse
    // campo faria as queries falharem silenciosamente (mascarado pelos .catch(() => {})) em vez
    // de simplesmente não processar o evento. Guarda defensiva explícita no início da função.
    if (!payload?.instance) return;
    const updates = payload.data?.update;
    if (!Array.isArray(updates)) return;

    for (const upd of updates) {
      // [AUDITORIA] BUG (achado 3 da revisão externa/Google AI Studio, sprint seguinte à
      // Sprint 4): um item null/undefined no array `updates` (payload malformado da Evolution)
      // lançaria TypeError ao acessar `.id`/`.status`, interrompendo o loop e perdendo as
      // atualizações de status seguintes no mesmo lote (erro só silenciado pelo catch externo
      // do handler, sem processar o resto do array).
      // [AUDITORIA] FIX APLICADO: guarda defensiva no início do loop.
      if (!upd || typeof upd !== 'object') continue;
      const messageId = (upd as any).id || payload.data?.key?.id;
      const status = (upd as any).status || upd.status;
      if (!messageId || !status) continue;

      // [AUDITORIA] LÓGICA: Registra a atualização bruta de status (sent, delivery, read, etc) com UPSERT por instância.
      await pool.query(
        `INSERT INTO whatsapp_message_status (message_id, instance_name, status, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (message_id, instance_name) DO UPDATE
           SET status = EXCLUDED.status, updated_at = NOW()`,
        [messageId, payload.instance, status]
      ).catch(() => {});

      // [AUDITORIA] FIX APLICADO: além das strings literais 'READ'/'PLAYED', normaliza os códigos
      // numéricos do enum oficial WebMessageInfo.Status do Baileys/WhatsApp (verificado no proto
      // fonte: ERROR=0, PENDING=1, SERVER_ACK=2, DELIVERY_ACK=3, READ=4, PLAYED=5). Importante:
      // é 4=READ e 5=PLAYED, NÃO 3 — 3 é só DELIVERY_ACK (entregue, não necessariamente lido);
      // tratar 3 como leitura marcaria mensagens apenas entregues como lidas incorretamente.
      const isReadStatus = status === 'READ' || status === 'PLAYED'
        || status === 4 || status === '4'
        || status === 5 || status === '5';

      if (isReadStatus) {
        await pool.query(
          `UPDATE whatsapp_messages SET is_read = true
           WHERE message_id = $1 AND instance_name = $2`,
          [messageId, payload.instance]
        ).catch(() => {});
      }
    }
  }

  // [AUDITORIA] LÓGICA: Marca como excluídas (soft-delete) mensagens locais do CRM que foram
  // revogadas/excluídas pelo usuário no aplicativo móvel.
  // [AUDITORIA] FIX APLICADO (2026-07-21): DELETE físico trocado por soft-delete
  // (deleted_at) — evita perda irreversível de dados, ver AUDITORIA_LOG.md.
  async function handleMessageDelete(payload: EvolutionPayload): Promise<void> {
    // [AUDITORIA] FIX APLICADO (achado da revisão externa/Google AI Studio, rodada 2 - 2026-07-10):
    // mesmo caso de handleStatusUpdate acima — payload.instance sem checagem de presença.
    if (!payload?.instance) return;
    const key = payload.data?.key;
    if (!key?.id) return;

    await pool.query(
      `UPDATE whatsapp_messages SET deleted_at = NOW() WHERE message_id = $1 AND instance_name = $2`,
      [key.id, payload.instance]
    ).catch(() => {});
  }

  // [AUDITORIA] LÓGICA — RASTREIO "mensagens não atualizam na tela" (2026-07-08):
  // Teste ao vivo feito nesta sessão: com a instância crm_435ee4720fc3 conectada (status "open",
  // número +55 11 97957-9548), uma mensagem de WhatsApp real foi enviada para esse número. Nenhum
  // evento `messages.upsert` chegou a este handler (confirmado via `docker logs -f crm-api | grep
  // WH:` rodando durante o teste, e via SELECT em whatsapp_messages — nenhuma linha nova). Eventos
  // de metadata (chats.upsert, presence.update, contacts.update) da MESMA instância CHEGARAM
  // normalmente, autenticados com sucesso, então a rota/auth deste arquivo está funcionando.
  //
  // CAUSA RAIZ ENCONTRADA — não é código deste arquivo nem de nenhuma camada do CRM: nos logs
  // brutos do container `evolution` (não do crm-api), o processamento interno do evento
  // messages.upsert lança uma exceção ANTES de disparar o webhook:
  //   PrismaClientKnownRequestError em io.updateChatUnreadMessages (dist/main.js:285) chamado a
  //   partir de `messages.upsert` (dist/main.js:245) — "Error querying the database: Named and
  //   positional parameters mixed in one statement" (Prisma code P2010), numa query MySQL que o
  //   Evolution roda internamente para atualizar contagem de não-lidas do chat.
  // Ou seja: o Evolution API v2.3.7 (evoapicloud/evolution-api, atualizado nesta sessão) trava
  // internamente ao processar QUALQUER mensagem recebida antes mesmo de despachar o webhook — o
  // POST /webhook/evolution deste arquivo NUNCA é chamado pra mensagens reais recebidas nesta
  // versão+provider (mysql). Nenhuma correção possível neste arquivo, nem em nenhum arquivo do
  // CRM, resolve isso — o bug está no código interno do Evolution API, não no nosso.
  // [AUDITORIA] FIX PENDENTE (motivo: mudança de infraestrutura fora do escopo desta auditoria de
  // código — instrução explícita desta sessão foi "não fazer deploy, só commits locais"): opções a
  // avaliar numa próxima sessão/com confirmação do usuário: (a) trocar DATABASE_PROVIDER de mysql
  // para postgresql no compose do Evolution (usar o Postgres que o próprio CRM já roda) — pode
  // contornar o bug se for específico do driver MySQL do Prisma; (b) fixar uma tag de imagem mais
  // antiga/estável do evoapicloud/evolution-api em vez de :latest, já que essa parece ser uma
  // regressão recente da lib; (c) reportar o bug upstream no repo do Evolution API. Nenhuma dessas
  // ações foi tomada nesta sessão por serem mudanças de infra, não de código.
  //
  // RECONFIRMADO AO VIVO em 2026-07-10 (Sprint 2, mesmo teste repetido): mensagem real
  // enviada de fora para 5511979579548 (crm_435ee4720fc3, "open"). Capturado em tempo
  // real via `docker logs -f evolution` durante o teste: o MESMO stack trace
  // PrismaClientKnownRequestError P2010 dispara repetidamente (várias vezes por
  // segundo, não só na mensagem de teste — sugere que toda atualização de status/
  // recibo passa por esse mesmo código quebrado), sempre logo após "Update not read
  // messages <jid>" e sempre antes do WebhookController disparar chats.update/
  // contacts.update (que chegam normais ao crm-api) — nunca messages.upsert. Ainda não
  // corrigido, mesma causa raiz, nenhuma das 3 opções abaixo foi tentada.
  //
  // SPRINT 3 (2026-07-10) — TESTADO E DESCARTADO: hipótese de que `DATABASE_SAVE_DATA_CHATS=false`
  // (env var do Evolution que controla se ele persiste chats/contador de não-lidas na própria base)
  // pularia o trecho de código que crasha, já que o CRM não depende dessa tabela interna do
  // Evolution. Aplicado em /opt/evolution/docker-compose.yml, container reiniciado, instância
  // reconectou normalmente ("open"). Testado com mensagem real de fora: MESMO stack trace P2010
  // continuou disparando, idêntico, mesma frequência — a variável não afeta esse code path.
  // Revertido imediatamente (backup em docker-compose.yml.bak-sprint3-20260710 na VPS),
  // confirmado reconectado. Também descoberto nesta sessão: esse bug em `Chat.unreadMessages` já
  // foi reportado em outras versões do Evolution (2.1.0, 2.2.0) rodando em PostgreSQL — ou seja,
  // NÃO é exclusivo do MySQL nem da v2.3.7, então as opções (a) trocar DATABASE_PROVIDER e (b)
  // fixar versão antiga têm garantia baixa de resolver, podem só trocar o código do erro. Opção
  // (c) reportar/rastrear issue upstream (Evolution API GitHub) passa a ser a mais indicada antes
  // de mais tentativas de configuração local. Nenhuma das 3 opções foi aplicada em definitivo.
  router.post('/evolution', async (req: Request, res: Response) => {
    // ── TRACE 0: chegou no servidor ──────────────────────────────────────────
    const traceId = Date.now().toString(36);
    log.info('WEBHOOK', 'ENTRADA POST /webhook/evolution', { traceId });
    log.info('WEBHOOK', 'Headers recebidos', {
      traceId,
      contentType: req.headers['content-type'],
      bodyKeys: Object.keys(req.body || {}),
    });

    // [AUDITORIA] LÓGICA: Garante que o segredo de autenticação está devidamente populado nas variáveis de ambiente.
    const webhookSecret = process.env.EVOLUTION_WEBHOOK_SECRET;
    if (!webhookSecret) {
      log.error('WEBHOOK', 'EVOLUTION_WEBHOOK_SECRET não configurado — rejeitando requisição', { traceId });
      return res.status(401).json({ error: 'Webhook secret não configurado no servidor' });
    }
    // [AUDITORIA] LÓGICA: Aceita autenticação via assinatura HMAC no header ou token estático de segurança via query URL.
    const ok = verificarAssinaturaEvolution(req, webhookSecret) || verificarChaveQuery(req, webhookSecret);
    log.info('WEBHOOK', 'Autenticação verificada', { traceId, valida: ok });
    if (!ok) {
      log.warn('WEBHOOK', 'Autenticação inválida — rejeitando', { traceId });
      return res.status(401).json({ error: 'Autenticação inválida' });
    }

    // [AUDITORIA] LÓGICA: Retorna status 200 OK imediatamente para a Evolution API liberar a conexão e evitar retries.
    res.status(200).json({ ok: true });

    try {
      const payload = req.body as EvolutionPayload;
      const eventClean = (payload.event || '').toLowerCase().replace(/[^a-z0-9]/g, '');

      log.info('WEBHOOK', 'Evento recebido', {
        traceId,
        evento: payload.event,
        eventClean,
        instance: payload.instance,
      });
      log.info('WEBHOOK', 'Dados da mensagem', {
        traceId,
        jid: payload.data?.key?.remoteJid,
        fromMe: payload.data?.key?.fromMe,
        msgId: payload.data?.key?.id,
        pushName: payload.data?.pushName,
      });
      log.info('WEBHOOK', 'Texto extraído', {
        traceId,
        texto: String(payload.data?.message?.conversation || payload.data?.message?.extendedTextMessage?.text || '').slice(0, 80),
      });

      // [AUDITORIA] LÓGICA: Desvia o payload para processamento especializado se for atualização de metadados.
      if (eventClean === 'messagesupdate') {
        log.info('WEBHOOK', '→ handleStatusUpdate', { traceId });
        await handleStatusUpdate(payload);
        return;
      }

      // [AUDITORIA] LÓGICA: Desvia para deleção física no banco de dados.
      if (eventClean === 'messagesdelete') {
        log.info('WEBHOOK', '→ handleMessageDelete', { traceId });
        await handleMessageDelete(payload);
        return;
      }
      if (eventClean !== 'messagesupsert') {
        log.info('WEBHOOK', 'IGNORADO evento não é messagesupsert', { traceId, eventClean });
        return;
      }

      // [AUDITORIA] BUG: esta checagem descartava QUALQUER messages.upsert com data.status
      // em READ/PLAYED/DELIVERY_ACK, mesmo quando o payload trazia uma mensagem recebida de
      // verdade (fromMe:false, com texto real em data.message) — confirmado ao vivo em
      // 2026-07-13: duas mensagens reais de teste ("Oi" e outra) chegaram com texto extraído
      // corretamente no log ("Texto extraído") mas foram descartadas por este early-return
      // logo em seguida, nunca persistidas em whatsapp_messages. data.status aparentemente é
      // populado pela Evolution v2.3.7 mesmo em mensagens recebidas (não só nas enviadas pela
      // própria conta, onde a checagem faz sentido — status de entrega só existe pra mensagem
      // que a conta enviou).
      // [AUDITORIA] FIX APLICADO: restringido a fromMe:true, único caso em que "status-only,
      // sem conteúdo" é uma suposição válida.
      const dataStatus = payload.data?.status;
      const fromMeStatusCheck = payload.data?.key?.fromMe === true;
      if (fromMeStatusCheck && (dataStatus === 'READ' || dataStatus === 'PLAYED' || dataStatus === 'DELIVERY_ACK')) {
        wlog('WEBHOOK_DROP', `status-only (${dataStatus}) instance=${payload.instance}`);
        return;
      }

      // [AUDITORIA] LÓGICA: Valida e sanitiza o remetente JID (remoteJid).
      const remoteJid = payload.data?.key?.remoteJid || '';
      log.info('WEBHOOK', 'remoteJid resolvido', { traceId, remoteJid });
      if (!remoteJid) { wlog('WEBHOOK_DROP', `remoteJid vazio instance=${payload.instance}`); return; }
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
      // [AUDITORIA] LÓGICA: agent_configs guarda no máximo 1 instância ativa por usuário
      // (UNIQUE(user_id)) — é a config "oficial" escrita por syncEvolution() em integracoes.ts
      // quando o usuário conecta pela tela de Integrações. agentes permite várias instâncias
      // por usuário (UNIQUE(user_id, evolution_instancia)) e é quem carrega n8n_webhook_url.
      // Por isso agent_configs vem primeiro (é a fonte "canônica" de 1:1), mas só agentes
      // consegue resolver o roteamento N8N — daí o lookup extra de n8nWebhookUrl logo abaixo
      // mesmo quando o userId já veio de agent_configs.
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
        log.info('WEBHOOK', 'USERID via agent_configs', { traceId, userId });
      } else {
        log.info('WEBHOOK', 'agent_configs: nenhum resultado', { traceId, instancia });
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
          log.info('WEBHOOK', 'USERID via agentes', { traceId, userId, temN8n: !!n8nWebhookUrl });
        } else {
          log.info('WEBHOOK', 'agentes: nenhum resultado', { traceId });
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
          log.info('WEBHOOK', 'n8n_webhook_url resolvido via agentes', { traceId, n8nWebhookUrl });
        }
      }

      // 3. Fallback: prefixo UUID na instância (ex: crm_435ee4720fc3)
      if (!userId && instancia.startsWith('crm_')) {
        // [AUDITORIA] FIX APLICADO: remove curingas do operador LIKE (% e _) do prefixo antes de
        // usá-lo na query. Sem isso, um `instancia` malicioso/malformado com esses caracteres
        // poderia alargar o casamento do LIKE e resolver o userId errado (payload já autenticado
        // pelo segredo do webhook, mas isso reduz ainda mais a superfície de erro/abuso).
        const prefixo = instancia.slice(4).replace(/[%_]/g, '');
        const uRes = await pool.query(
          `SELECT id FROM users WHERE replace(id::text, '-', '') LIKE $1 LIMIT 1`,
          [`${prefixo}%`]
        ).catch(() => ({ rows: [] as any[] }));
        if (uRes.rows.length) {
          userId = uRes.rows[0].id;
          log.info('WEBHOOK', 'USERID via prefixo UUID', { traceId, userId });
        } else {
          log.info('WEBHOOK', 'prefixo UUID: nenhum resultado', { traceId, prefixo });
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
          log.info('WEBHOOK', 'USERID via integracoes_config', { traceId, userId });
        } else {
          log.info('WEBHOOK', 'integracoes_config: nenhum resultado', { traceId, instancia });
        }
      }

      // [AUDITORIA] FIX APLICADO (2026-07-21): fallback #5 (atribuir ao primeiro admin
      // cadastrado) removido — causava vazamento de dados entre tenants (mensagens de uma
      // instância não resolvida apareciam na conta de um cliente real qualquer, só por ele
      // ser o admin mais antigo). Instância não resolvida agora só loga e descarta.
      if (!userId) {
        log.error('WEBHOOK', 'FATAL: nenhum userId encontrado para instância — mensagem descartada', { traceId, instancia });
        // [AUDITORIA] FIX APLICADO (2026-07-21): faltava o `return` — o log já dizia "mensagem
        // descartada" mas a execução continuava e chamava processarComDebounce()/agentEngine.ts
        // com userId vazio, reabrindo por outro caminho o mesmo risco de cross-tenant que o
        // fallback #5 (removido acima) causava. Ver diagnosticos/AUDITORIA_LOG.md.
        return;
      }

      log.info('WEBHOOK', 'Resolução final', { traceId, userId, fromMe, isGroup });

      // ── UPSERT antecipado de contato — garante que contatos novos existam antes de qualquer branch ──
      // [AUDITORIA] LÓGICA: Garante a criação de registros mínimos na tabela de contatos de forma não-bloqueante (sem await).
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
        ).catch(err => log.warn('WEBHOOK', 'Erro ao upsert contato antecipado', { traceId, err: err.message }));
      }

      // ── Mensagens do atendente (fromMe=true) → pausar IA ou reativar ─────────
      // [AUDITORIA] LÓGICA: Lida com ecossistema de anti-loop de mensagens disparadas por automações ou bots internos.
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
          // [AUDITORIA] LÓGICA: Se o atendente enviou a palavra-chave configurada para reativação, libera o bot de IA novamente.
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
            log.info('WEBHOOK', 'IA reativada (palavra_reativar)', { traceId, telefone });
          } else {
            // [AUDITORIA] LÓGICA: Intervenção Humana detectada. Pausa a automação de IA para permitir atendimento manual.
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
            ).catch(async () => {
              // fallback sem UPSERT caso não exista constraint única
              await pool.query(
                `UPDATE dados_cliente SET atendimento_ia = 'pause', pausa_timestamp = NOW()
                 WHERE user_id = $1 AND telefone ILIKE $2`,
                [userId, `%${telefone.slice(-11)}`]
              ).catch(() => {});
            });

            log.info('WEBHOOK', 'Intervenção humana — IA pausada', {
              traceId,
              telefone,
              msg: (textoFromMe || '').slice(0, 60),
            });
          }

          // [AUDITORIA] LÓGICA: Persiste a mensagem enviada pelo atendente na tabela principal para controle de histórico do chat.
          await pool.query(
            `INSERT INTO whatsapp_messages
               (user_id, instance_name, remote_jid, message_id, from_me, message_type, content, status, timestamp_wa)
             VALUES ($1, $2, $3, $4, true, $5, $6, 'sent', to_timestamp($7))
             ON CONFLICT (message_id, instance_name) DO NOTHING`,
            [userId, instancia, remoteJid, messageId, tipo, textoFromMe || null, tsVal]
          ).catch(err => log.error('WEBHOOK', 'Erro ao inserir mensagem fromMe', { traceId, err: err.message }));
        } else {
          // [AUDITORIA] BUG: mensagens fromMe=true de uma instância sem userId resolvido eram
          // descartadas em silêncio (sem log), diferente do fluxo de mensagens recebidas (que loga
          // [WEBHOOK_REJECT]). Isso dificultava diagnosticar "instância órfã" quando o primeiro
          // sinal observável era justamente uma mensagem enviada pelo atendente.
          // [AUDITORIA] FIX APLICADO: log adicionado, mesmo padrão usado no fluxo de recebidas.
          wlog('WEBHOOK_REJECT', `NENHUM userId para instância (mensagem fromMe): "${instancia}" — descartada`);
        }
        return;
      }

      // ── Deduplicação em memória (escopo por instância) ───────────────────────
      const dedupKey = `${instancia}:${messageId}`;
      if (processados.has(dedupKey)) { wlog('WEBHOOK_DROP', `dedup memória mid=${messageId} inst=${instancia}`); return; }
      processados.add(dedupKey);
      // [AUDITORIA] FIX PENDENTE (achado da revisão externa/Google AI Studio, rodada 2 - 2026-07-10;
      // motivo: otimização, não bug — um setTimeout individual por mensagem pode acumular sob
      // volume alto de mensagens, já que cada um vive isolado por 60s até disparar. Não é urgente
      // hoje; só compensa refatorar pra uma janela rolante com um único setInterval quando o
      // volume de mensagens crescer a ponto disso se tornar um problema real de memória).
      setTimeout(() => processados.delete(dedupKey), 60000);
      // [AUDITORIA] BUG: a checagem original filtrava só por message_id, ignorando a coluna
      // "instancia" (que o INSERT logo abaixo grava). Na prática as IDs geradas pelo WhatsApp
      // são efetivamente únicas globalmente, então o risco real é baixíssimo, mas a checagem
      // ficava inconsistente com o schema (que existe justamente para permitir esse escopo) e
      // com os message_id sintéticos ("resp_"/"manual_") usados para respostas do bot, que têm
      // mais chance de colidir entre instâncias diferentes.
      // [AUDITORIA] FIX APLICADO: escopo por instancia adicionado ao SELECT, espelhando o INSERT
      // logo abaixo. Mudança estritamente mais restritiva (só deixa passar o que antes seria
      // incorretamente tratado como duplicata de outra instância) — sem risco de regressão.
      //
      // [AUDITORIA] BUG (severidade potencialmente ALTA — precisa verificação em produção): esta
      // query selecionava `id`, mas a tabela webhook_mensagens_processadas tem DUAS definições
      // conflitantes de schema no código: o CREATE TABLE logo no topo deste arquivo (linha ~145)
      // declara `id SERIAL PRIMARY KEY, ..., created_at`, enquanto backend/src/migrations.ts
      // (a migration que de fato roda — confirmado via runMigrations importado em index.ts)
      // declara `message_id TEXT PRIMARY KEY, instancia, criado_em` — SEM coluna `id`. Pior:
      // `app.use('/webhook', webhookRouter(pool))` (index.ts linha ~118) executa ANTES de
      // `runMigrations(pool)` (index.ts linha ~438) — ou seja, é uma condição de corrida entre
      // dois `CREATE TABLE IF NOT EXISTS` decidindo qual schema "vence" na primeira vez que a
      // tabela é criada. Se a versão de migrations.ts venceu (schema sem `id`), a query original
      // `SELECT id FROM ...` lançaria erro de SQL ("column id does not exist") em TODA mensagem
      // recebida, sem try/catch próprio — o erro subiria pro catch-all no fim do handler,
      // abortando o processamento antes mesmo do INSERT em whatsapp_messages. Isso explicaria um
      // sintoma muito mais fundamental que os já corrigidos nesta sessão (rede/webhook auth): NENHUMA
      // mensagem real chegaria a ser salva, mesmo com toda a infra corrigida.
      // [AUDITORIA] FIX APLICADO: troquei `SELECT id` por `SELECT 1` — funciona igual em ambos os
      // schemas possíveis, já que só precisamos saber SE existe linha, não o valor de uma coluna
      // específica. Também adicionei `.catch()` para não deixar esse SELECT (que é só uma
      // otimização de dedup — a proteção real é o `ON CONFLICT DO NOTHING` do INSERT logo abaixo)
      // derrubar o processamento inteiro da mensagem em caso de qualquer erro futuro de schema.
      // [AUDITORIA] FIX PENDENTE (motivo: precisa confirmar em produção): rodar na VPS
      // `docker exec -i postgres psql -U mentoark -d crm -c "\d webhook_mensagens_processadas"`
      // para ver o schema real. Se a coluna for `criado_em` (sem `id`), o CREATE TABLE deste
      // arquivo (linha ~145) está descrevendo um schema que nunca existiu de verdade e vale
      // atualizá-lo ou removê-lo para não confundir; se for `created_at`+`id`, o oposto.
      const jaExiste = await pool.query(
        'SELECT 1 FROM webhook_mensagens_processadas WHERE message_id = $1 AND instancia = $2',
        [messageId, instancia]
      ).catch(() => ({ rows: [] as any[] }));
      if (jaExiste.rows.length) return;

      // [AUDITORIA] LÓGICA: Insere o ID único do webhook no banco de dados para evitar reprocessamento por retries da rede.
      await pool.query(
        'INSERT INTO webhook_mensagens_processadas (message_id, instancia) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [messageId, instancia]
      ).catch(err => log.error('WEBHOOK', 'Erro ao inserir webhook_mensagens_processadas', { traceId, err: err.message }));

      // ── Extrair dados ─────────────────────────────────────────────────────────
      const texto    = extrairTexto(payload.data);
      const tipo     = extrairTipo(payload.data);
      const midia    = extrairMidia(payload.data);
      const ts       = payload.data.messageTimestamp || Math.floor(Date.now() / 1000);
      const tsVal    = ts > 1e10 ? Math.floor(ts / 1000) : ts;

      // [AUDITORIA] LÓGICA (achado 2 da revisão externa/Google AI Studio, sprint seguinte à
      // Sprint 4 — verificado, FALSO POSITIVO): a revisão apontou que o bloco de upsert de
      // contato + fetch de foto de perfil (linhas ~670-770) rodaria mesmo sem userId resolvido,
      // já que a checagem `if (!userId) { wlog('WEBHOOK_REJECT', ...); return; }` só aparece
      // mais abaixo (seção "Motor IA"). Na prática NÃO é um bug: todo o bloco de persistência
      // (INSERT whatsapp_messages + upsert de contato + fetch de foto) já está aninhado dentro
      // deste `if (userId)` — se userId for null/undefined, nada disso executa, nenhuma query
      // nem request HTTP é disparada. A checagem redundante mais abaixo é só o log/return
      // explícito do caminho "Motor IA" para instância órfã, não a única proteção. A revisão
      // externa perdeu esse contexto de indentação/escopo por só receber o texto colado, sem
      // ver o aninhamento real. Nenhuma mudança de código aqui — registrado pra não reabrir essa
      // dúvida numa sprint futura.
      // ── Persistir mensagem recebida ───────────────────────────────────────────
      if (userId) {
        const pushNameFinal = isGroup
          ? (pushName ? `${pushName} (grupo)` : senderPhone)
          : pushName || null;

        log.info('WEBHOOK', 'INSERT whatsapp_messages', {
          traceId, userId, instancia, jid: remoteJid, msgId: messageId, tipo,
          texto: (texto || '').slice(0, 60),
        });

        // [AUDITORIA] LÓGICA: Registra a mensagem recebida de cliente final na tabela do histórico do chat no CRM.
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
          log.error('WEBHOOK', 'ERRO INSERT whatsapp_messages', { traceId, err: err.message });
          return { rowCount: -1 };
        });
        log.info('WEBHOOK', 'INSERT RESULT (0=duplicata, 1=novo, -1=erro)', {
          traceId, rowCount: (insertResult as any).rowCount,
        });

        // ── UPSERT de contato (apenas para contatos individuais, não grupos) ─────
        if (!isGroup) {
          // [AUDITORIA] LÓGICA: Processa metadados do contato e imagem de perfil de forma paralela assíncrona (IIFE não-bloqueante).
          void (async () => {
            try {
              const suffix = `%${telefone.slice(-11)}`;
              const nomeFinal = pushName || telefone;

              // [AUDITORIA] LÓGICA: Atualiza o contato existente caso já esteja presente na base do CRM.
              const upd = await pool.query(
                `UPDATE contatos
                 SET push_name          = COALESCE($1, push_name),
                     nome               = CASE WHEN nome = telefone THEN $1 ELSE nome END,
                     ultima_mensagem_em = NOW()
                 WHERE user_id = $2 AND telefone ILIKE $3
                 RETURNING profile_pic_url`,
                [pushName || null, userId, suffix]
              );

              // [AUDITORIA] LÓGICA: Se o contato não existia na base do CRM, insere um registro inicial.
              if (!upd.rowCount) {
                // [AUDITORIA] BUG (achado A da revisão externa/Google AI Studio): condição de
                // corrida com o upsert antecipado logo no início do handler. Se duas mensagens
                // do mesmo contato novo chegarem próximas, ambas podem ver rowCount=0 no UPDATE
                // acima e colidir aqui neste INSERT sem ON CONFLICT — um dos dois falhava em
                // silêncio via `.catch(() => {})`.
                // [AUDITORIA] FIX APLICADO: adicionado ON CONFLICT (user_id, telefone) DO NOTHING,
                // espelhando o padrão já usado no upsert antecipado. Mudança pequena e isolada,
                // reversível, não altera comportamento fora do cenário de corrida.
                await pool.query(
                  `INSERT INTO contatos (user_id, nome, telefone, push_name, origem, status, ultima_mensagem_em, atendente_pausou_ia)
                   VALUES ($1, $2, $3, $4, 'WhatsApp', 'novo', NOW(), false)
                   ON CONFLICT (user_id, telefone) DO NOTHING`,
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

              // [AUDITORIA] BUG (achado B da revisão externa/Google AI Studio): fetch nativo do
              // Node não tem timeout padrão — se a Evolution travar/ficar lenta, essas conexões
              // ficavam penduradas indefinidamente, esgotando o pool de conexões de saída sob
              // volume alto.
              // [AUDITORIA] FIX APLICADO: AbortController com timeout de 5s em ambas as chamadas.
              let picUrl: string | null = null;
              try {
                const controller1 = new AbortController();
                const timer1 = setTimeout(() => controller1.abort(), 5000);
                try {
                  const r = await fetch(`${evoUrl}/chat/fetchProfilePictureUrl/${instancia}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', apikey: evoKey },
                    body: JSON.stringify({ number: telefone }),
                    signal: controller1.signal,
                  });
                  if (r.ok) {
                    const d: any = await r.json().catch(() => ({}));
                    picUrl = d?.profilePictureUrl || d?.url || d?.picture || null;
                  }
                } finally {
                  clearTimeout(timer1);
                }
              } catch {}

              // [AUDITORIA] LÓGICA: Fallback caso o endpoint principal de URL de imagem de perfil falhe ou não seja suportado.
              if (!picUrl) {
                try {
                  const controller2 = new AbortController();
                  const timer2 = setTimeout(() => controller2.abort(), 5000);
                  try {
                    const r = await fetch(`${evoUrl}/fetchProfilePicture/${instancia}?number=${telefone}`, {
                      headers: { apikey: evoKey },
                      signal: controller2.signal,
                    });
                    if (r.ok) {
                      const d: any = await r.json().catch(() => ({}));
                      picUrl = d?.profilePictureUrl || d?.url || d?.picture || null;
                    }
                  } finally {
                    clearTimeout(timer2);
                  }
                } catch {}
              }

              // [AUDITORIA] LÓGICA: Se conseguiu obter a URL da imagem de perfil, persiste em ambas as colunas mapeadas no banco.
              if (picUrl) {
                await pool.query(
                  `UPDATE contatos SET profile_pic_url = $1, foto_perfil = $1 WHERE user_id = $2 AND telefone ILIKE $3`,
                  [picUrl, userId, suffix]
                ).catch(() => {});
                log.info('WEBHOOK', 'Foto de perfil atualizada', { traceId, telefone });
              }
            } catch (e: any) {
              log.warn('WEBHOOK', 'Falha ao upsert contato', { traceId, err: e.message });
            }
          })();
        }
      }

      // ── Opt-out e reativação (apenas para contatos individuais) ──────────────
      const textoNorm = (texto || '').trim().toLowerCase();
      if (!isGroup && userId) {
        // [AUDITORIA] LÓGICA: Se o cliente enviar palavras de parada, adiciona-o à lista negra e envia a confirmação do desligamento.
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
              // [AUDITORIA] BUG (achado da revisão externa/Google AI Studio, Sprint 6): este
              // fetch rodava com `await` direto no corpo do handler, sem timeout — se a
              // Evolution travasse exatamente nesse momento, a requisição do webhook ficava
              // presa esperando resposta. Volume baixo comparado ao roteamento N8N (Sprint 5),
              // mas mesmo vetor de risco.
              // [AUDITORIA] FIX APLICADO: terceiro lugar do arquivo a receber o mesmo padrão de
              // AbortController com timeout (5s) — mesmo usado no fetch de foto de perfil
              // (Sprint 4) e no roteamento N8N (Sprint 5).
              const optOutController = new AbortController();
              const optOutTimer = setTimeout(() => optOutController.abort(), 5000);
              await fetch(`${base}/message/sendText/${evoInst}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', apikey: evoApiKey },
                body: JSON.stringify({ number: telefone, text: 'Você foi removido da nossa lista. Para se reinscrever, envie "reativar".' }),
                signal: optOutController.signal,
              })
                .catch(() => {})
                .finally(() => clearTimeout(optOutTimer));
            }
          } catch {}
          log.info('WEBHOOK', 'Opt-out', { traceId, telefone });
          return;
        }

        // [AUDITORIA] LÓGICA: Se o cliente mandar reativar por texto, desbloqueia o contato e o bot de IA para novas interações automáticas.
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
          log.info('WEBHOOK', 'IA reativada', { traceId, telefone });
          return;
        }
      }

      // ── Motor IA (apenas para contatos individuais) ───────────────────────────
      if (!userId) {
        wlog('WEBHOOK_REJECT', `NENHUM userId para instância: "${instancia}" — mensagem descartada`);
        return;
      }
      if (!texto && !['audio', 'image', 'video', 'document'].includes(tipo)) {
        wlog('WEBHOOK_DROP', `sem texto e sem mídia tipo=${tipo} mid=${messageId} jid=${remoteJid}`);
        return;
      }

      // Rota N8N: se agente tem n8n_webhook_url configurado, encaminha para lá.
      // [AUDITORIA] FIX APLICADO (achado da revisão externa/Google AI Studio, rodada 2 - 2026-07-10):
      // este bloco rodava DEPOIS do `if (isGroup) return;` abaixo, então mensagens de grupo
      // nunca chegavam ao N8N do usuário — mesmo quando a intenção era só auditoria/enriquecimento
      // via N8N, sem disparar a IA. Movido para antes do descarte de grupo: agora grupo com
      // n8n_webhook_url configurado é encaminhado normalmente (e sai por aqui, sem tocar a IA);
      // grupo sem N8N configurado continua caindo no `if (isGroup) return;` como antes.
      if (n8nWebhookUrl) {
        log.info('WEBHOOK', 'Roteando para N8N', { traceId, n8nWebhookUrl, isGroup });
        // [AUDITORIA] BUG (achado 1 da revisão externa/Google AI Studio, sprint seguinte à
        // Sprint 4): mesmo problema já corrigido no achado B da Sprint 4 (fetch nativo do Node
        // sem timeout), mas aqui é mais grave — n8nWebhookUrl é configurado por qualquer usuário
        // (agentes.n8n_webhook_url), então uma instância N8N lenta/instável de UM usuário pode
        // prender sockets de saída e degradar a recepção de webhook pra todo mundo.
        // [AUDITORIA] FIX APLICADO: mesmo padrão do achado B (Sprint 4) — AbortController com
        // timeout, aqui 8s (N8N processa workflows, tende a ser mais lento que a Evolution).
        const n8nController = new AbortController();
        const n8nTimer = setTimeout(() => n8nController.abort(), 8000);
        fetch(n8nWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instancia, messageId, telefone, pushName, texto, tipo,
            midiaUrl: midia.url || null, timestamp: tsVal, userId, remoteJid, isGroup,
          }),
          signal: n8nController.signal,
        })
          .catch(err => log.error('WEBHOOK', 'Erro ao encaminhar para N8N', { traceId, err: err.message }))
          .finally(() => clearTimeout(n8nTimer));
        return;
      }

      // Grupos não disparam IA automaticamente (só chega aqui se não há N8N configurado)
      if (isGroup) {
        log.info('WEBHOOK', 'Grupo — mensagem salva, IA não processada', { traceId, telefone });
        return;
      }

      // [AUDITORIA] LÓGICA: Direciona a mensagem processada para a fila de debounce e engine de IA (processarComDebounce).
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
      }).catch(err => log.error('WEBHOOK', `Erro ao processar ${messageId}`, { traceId, err: err.message || String(err) }));

    } catch (err: any) {
      log.error('WEBHOOK', 'Erro crítico', { traceId, err: err?.message, stack: err?.stack });
    }
  });

  return router;
}