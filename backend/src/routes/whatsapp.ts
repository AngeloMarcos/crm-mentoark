/**
 * whatsapp.ts — Todas as rotas REST de WhatsApp usadas pelo frontend (montadas em /api/whatsapp).
 *
 * Cobre: listar/ler conversas e mensagens, enviar texto/mídia, pausar/reativar IA por contato,
 * conectar/desconectar instância na Evolution API (com QR code), sincronizar histórico, buscar
 * fotos de perfil, e registrar o webhook da instância na Evolution (registrarWebhook/webhookInner).
 * getEvolutionConfig()/saveEvolutionConfig() são a fonte de verdade da config Evolution (url,
 * api_key, instancia) usada por toda ação de saída — ver [AUDITORIA] BUG logo abaixo sobre a
 * relação (inconsistente) dessas funções com a tabela agent_configs.
 */
import { Router, Response } from 'express';
import { Pool } from 'pg';
import { AuthRequest } from '../middleware';
import { evolutionFetch, sanitizeEvolutionUrl } from '../utils/resilientFetch';
import { log } from '../logger';

// Default Evolution server (VPS local — disparo.mentoark.com.br)
const DEFAULT_EVO_URL = process.env.EVOLUTION_API_URL || 'https://disparo.mentoark.com.br';
const DEFAULT_EVO_KEY = process.env.EVOLUTION_API_KEY || 'mentoark2025evolutionkey';
// A Evolution API não calcula HMAC do corpo — o webhook.ts autentica via
// segredo estático na própria URL (?key=...), então toda URL registrada aqui
// precisa incluir esse segredo, senão o endpoint rejeita com 401.
const WEBHOOK_URL = (() => {
  const base = process.env.EVOLUTION_WEBHOOK_URL || 'https://api.mentoark.com.br/webhook/evolution';
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET;
  if (!secret) return base;
  return `${base}${base.includes('?') ? '&' : '?'}key=${secret}`;
})();
const WEBHOOK_EVENTS = ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'MESSAGES_DELETE', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'];

// Objeto interno do webhook (usado em instance/create e /webhook/set)
function webhookInner(enabled = true) {
  return {
    enabled,
    url: WEBHOOK_URL,
    webhookByEvents: false,
    webhookBase64: false,
    events: WEBHOOK_EVENTS,
  };
}

// Registra (ou atualiza) o webhook da instância no Evolution.
// Evolution v2 exige formato { webhook: {...} } no endpoint /webhook/set.
// Idempotente — pode ser chamado várias vezes sem efeito colateral.
async function registrarWebhook(base: string, apiKey: string, instancia: string, enabled = true): Promise<void> {
  const cleanBase = sanitizeEvolutionUrl(base);
  try {
    const res = await evolutionFetch(`${cleanBase}/webhook/set/${instancia}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: apiKey },
      body: JSON.stringify({ webhook: webhookInner(enabled) }),
    });
    const body = await res.json().catch(() => ({}));
    const actualEnabled = (body as any)?.webhook?.enabled ?? (body as any)?.enabled;
    log.info('WHATSAPP', 'webhook atualizado', { action: enabled ? 'registrado' : 'removido', instancia, actualEnabled });
  } catch (err) {
    log.warn('WHATSAPP', 'Falha ao gerenciar webhook', { instancia, err: (err as Error).message });
  }
}

function normalizeQr(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const b64 = raw.replace(/^data:image\/\w+;base64,/, '');
  return `data:image/png;base64,${b64}`;
}

export default function whatsappRouter(pool: Pool): Router {
  // Cache em memória para evitar race conditions simultâneas no mesmo processo
  const connectingUsers = new Set<string>();
  const router = Router();

  // Retorna config do agente, ou config global com nome de instância gerado
  // [AUDITORIA] LÓGICA: esta função (e sua irmã saveEvolutionConfig logo abaixo) é a fonte de
  // verdade para TODA ação de saída (send, connect, status, disconnect) desta rota — mas ela só
  // olha integracoes_config e agentes, em NENHUM momento consulta agent_configs.
  // [AUDITORIA] BUG: webhook.ts (mensagens recebidas) resolve o userId consultando agent_configs
  // PRIMEIRO, antes de agentes/integracoes_config/prefixo UUID. Ou seja, existem dois caminhos de
  // configuração da instância Evolution que nunca se enxergam: quem conecta pela tela que grava em
  // agent_configs (syncEvolution() em integracoes.ts) fica com um cfg.instancia diferente do que
  // getEvolutionConfig() calcula aqui (cai no fallback "stableInstancia" computado do userId, que
  // pode não ser o nome real da instância). Isso pode fazer /send, /connect, /evo/status e
  // /disconnect operarem sobre uma instância errada ou inexistente para esses usuários, e explica
  // por que encontramos uma linha órfã em agent_configs (instancia="teste") que /disconnect e
  // DELETE /instances/:name nunca limpam (só apagam integracoes_config e agentes).
  // [AUDITORIA] FIX PENDENTE (motivo: decisão de produto + múltiplos arquivos): não dá para
  // decidir sozinho qual tabela deveria ser a fonte canônica sem entender todos os consumidores de
  // agent_configs (usado também fora do módulo WhatsApp, ex: configuração do agente de IA) e sem
  // saber se algum usuário real depende hoje do valor gravado só em agent_configs.
  //
  // [AUDITORIA] QUERY EXECUTADA EM 2026-07-08 (overlap agent_configs x integracoes_config x
  // agentes, em produção): resultado — HÁ divergência real, mas só para 1 usuário:
  //   user_id=435ee472-0fc3-4015-995a-ae6e1c80606d (mentoark@gmail.com)
  //   agent_configs.evolution_instancia = 'teste'          ← órfã/errada
  //   integracoes_config.instancia      = 'crm_435ee4720fc3' ← correta
  //   agentes.evolution_instancia       = 'crm_435ee4720fc3' ← correta
  // Nenhum outro usuário tem agent_configs.evolution_instancia preenchido, então não há caso de
  // "só existe em agent_configs, sem integracoes_config/agentes correspondente" — a pergunta original
  // (overlap real) tem resposta NÃO: todo usuário com valor em agent_configs também tem o valor
  // certo em agentes/integracoes_config. CONCLUSÃO: para este usuário, getEvolutionConfig() (que
  // não lê agent_configs) já retorna a instancia CORRETA via integracoes_config (prioridade 1 desta
  // função) — não é a causa de "/send etc. na instância errada" para ele. O lookup de userId em
  // webhook.ts também não é afetado: falha em agent_configs (prioridade 1 lá, por causa do valor
  // 'teste') mas resolve certo via agentes (prioridade 2, ver webhook.ts). Ou seja, essa divergência
  // é real e vale limpar por higiene, mas NÃO é a causa raiz do bug "mensagens não atualizam na
  // tela" investigado nesta sessão — descartada como causa antes de tocar em getEvolutionConfig().
  // Ação de baixo risco ainda pendente (não aplicada — é escrita em produção, requer confirmação):
  // `UPDATE agent_configs SET evolution_instancia = 'crm_435ee4720fc3' WHERE user_id =
  // '435ee472-0fc3-4015-995a-ae6e1c80606d';` para eliminar a linha órfã.
  async function getEvolutionConfig(userId: string): Promise<{
    url: string; api_key: string; instancia: string; agenteId: string | null; isGlobal: boolean; stableInstancia: string;
  }> {
    const stableInstancia = `crm_${userId.replace(/-/g, '').slice(0, 12)}`;
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
        instancia: row.instancia || stableInstancia,
        agenteId: null,
        isGlobal: !row.url,
        stableInstancia
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
      const instancia = row.instancia || stableInstancia;
      return { url, api_key, instancia, agenteId: row.id, isGlobal: !row.url, stableInstancia };
    }

    // 3. Fallback final global
    return { url: DEFAULT_EVO_URL, api_key: DEFAULT_EVO_KEY, instancia: stableInstancia, agenteId: null, isGlobal: true, stableInstancia };
  }

  // Salva/atualiza a config Evolution no agente do usuário
  async function saveEvolutionConfig(
    userId: string, agenteId: string | null,
    url: string, api_key: string, instancia: string
  ) {
    // Remove configs com instância diferente — garante 1 instância ativa por usuário
    await pool.query(
      `DELETE FROM integracoes_config WHERE user_id=$1 AND tipo='evolution' AND instancia!=$2`,
      [userId, instancia]
    );
    // Atualiza registro existente; se não existir, insere novo
    const upd = await pool.query(
      `UPDATE integracoes_config SET url=$2, api_key=$3, status='conectado', updated_at=NOW()
       WHERE user_id=$1 AND tipo='evolution' AND instancia=$4`,
      [userId, url, api_key, instancia]
    );
    if (!upd.rowCount) {
      await pool.query(
        `INSERT INTO integracoes_config (user_id, tipo, nome, url, api_key, instancia, status, updated_at)
         VALUES ($1, 'evolution', 'WhatsApp', $2, $3, $4, 'conectado', NOW())`,
        [userId, url, api_key, instancia]
      );
    }

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

  // ── Helpers internos de foto de perfil ──────────────────────────────────────
  async function buscarFotoEvo(base: string, apiKey: string, instancia: string, phone: string): Promise<string | null> {
    // Tenta POST (Evolution v2)
    try {
      const r = await fetch(`${base}/chat/fetchProfilePictureUrl/${instancia}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: apiKey },
        body: JSON.stringify({ number: phone }),
      });
      if (r.ok) {
        const d: any = await r.json().catch(() => ({}));
        const url = d?.profilePictureUrl || d?.url || d?.picture || null;
        if (url) return url;
      }
    } catch {}
    // Tenta GET (Evolution v1 fallback)
    try {
      const r = await fetch(`${base}/fetchProfilePicture/${instancia}?number=${phone}`, {
        headers: { apikey: apiKey },
      });
      if (r.ok) {
        const d: any = await r.json().catch(() => ({}));
        return d?.profilePictureUrl || d?.url || d?.picture || null;
      }
    } catch {}
    return null;
  }

  async function salvarFotoContato(userId: string, phone: string, picUrl: string, pushName?: string | null): Promise<void> {
    const suffix = `%${phone.slice(-11)}`;
    await pool.query(
      `UPDATE contatos SET foto_perfil = $1, profile_pic_url = $1${pushName ? ', push_name = COALESCE($4, push_name)' : ''}
       WHERE user_id = $2 AND telefone ILIKE $3`,
      pushName ? [picUrl, userId, suffix, pushName] : [picUrl, userId, suffix]
    ).catch(() => {});
  }

  // GET /api/whatsapp/profile-pic/:phone — busca foto de perfil on-demand
  router.get('/profile-pic/:phone', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const phone = decodeURIComponent(req.params.phone).replace(/\D/g, '');
      if (!phone) return res.status(400).json({ message: 'phone inválido' });

      // Checa se já existe no banco
      const row = await pool.query(
        `SELECT nome, push_name, foto_perfil, profile_pic_url FROM contatos
         WHERE user_id = $1 AND telefone ILIKE $2 LIMIT 1`,
        [userId, `%${phone.slice(-11)}`]
      );
      const c = row.rows[0];
      const existingPic = c?.foto_perfil || c?.profile_pic_url;
      const pushName = c?.push_name || c?.nome || null;

      if (existingPic) {
        return res.json({ foto_perfil: existingPic, push_name: pushName });
      }

      // Busca na Evolution API
      const cfg = await getEvolutionConfig(userId);
      const base = cfg.url.replace(/\/$/, '');
      const picUrl = await buscarFotoEvo(base, cfg.api_key, cfg.instancia, phone);

      if (picUrl) await salvarFotoContato(userId, phone, picUrl, pushName);

      return res.json({ foto_perfil: picUrl, push_name: pushName });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // POST /api/whatsapp/sync-profiles — sincroniza fotos de todos os contatos
  router.post('/sync-profiles', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;

      // Todos os telefones únicos que enviaram mensagens
      const phonesRes = await pool.query(
        `SELECT DISTINCT split_part(remote_jid, '@', 1) AS phone
         FROM whatsapp_messages
         WHERE user_id = $1 AND remote_jid NOT LIKE '%@g.us'
         LIMIT 200`,
        [userId]
      );

      const cfg = await getEvolutionConfig(userId);
      const base = cfg.url.replace(/\/$/, '');

      let sincronizados = 0;
      for (const row of phonesRes.rows) {
        const phone = row.phone;
        try {
          const picUrl = await buscarFotoEvo(base, cfg.api_key, cfg.instancia, phone);
          if (picUrl) {
            await salvarFotoContato(userId, phone, picUrl);
            sincronizados++;
          }
        } catch {}
        await new Promise(r => setTimeout(r, 150)); // respeita rate limit
      }

      return res.json({ sincronizados, total: phonesRes.rows.length });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // [AUDITORIA] LÓGICA — RASTREIO "mensagens não atualizam" (Camada 2, 2026-07-08): esta query
  // filtra só por `m.user_id = $1` (linha ~325), sem filtro de instance_name — confirmado que uma
  // eventual divergência de nome de instância (ver [AUDITORIA] em getEvolutionConfig, mais acima
  // neste arquivo) NÃO impede uma mensagem de aparecer aqui, desde que o webhook tenha gravado o
  // user_id certo. `rn=1` sempre pega a mensagem mais recente por telefone (ORDER BY created_at
  // DESC), então uma mensagem nova inserida em whatsapp_messages apareceria nesta resposta na
  // consulta seguinte, sem qualquer cache/staleness nesta camada. Testado via curl direto nesta
  // sessão (ver relatório) — a rota funciona corretamente para o histórico existente; não foi
  // possível confirmar com uma mensagem NOVA porque a Camada 0 (Evolution API em si, fora de
  // qualquer arquivo do CRM) não chegou a gravar nenhuma mensagem de teste no banco — ver
  // [AUDITORIA] no topo do handler POST /evolution em backend/src/routes/webhook.ts.
  router.get('/conversas', async (req: AuthRequest, res: Response) => {
    log.info('WHATSAPP', 'request recebida', { method: req.method, path: req.path, userId: req.userId, query: req.query });
    try {
      const userId = req.userId!;
      const showArchived = req.query.archived === 'true';

      // PARTITION BY phone (não por instância) — evita duplicatas quando o mesmo
      // número existiu em duas instâncias diferentes
      const r = await pool.query(
        `WITH ranked AS (
           SELECT
             split_part(m.remote_jid,'@',1) AS phone,
             m.instance_name,
             m.content,
             m.from_me,
             m.created_at,
             m.message_id,
             m.remote_jid LIKE '%@g.us' AS is_group,
             m.push_name AS last_sender,
             COUNT(*) OVER (PARTITION BY split_part(m.remote_jid,'@',1)) AS total,
             ROW_NUMBER() OVER (
               PARTITION BY split_part(m.remote_jid,'@',1)
               ORDER BY m.created_at DESC
             ) AS rn
           FROM whatsapp_messages m
           WHERE m.user_id = $1
         ),
         contato_unico AS (
           SELECT DISTINCT ON (RIGHT(telefone, 11))
             RIGHT(telefone, 11) AS sufixo,
             COALESCE(push_name, nome) AS push_name,
             COALESCE(nome, push_name) AS nome_contato,
             COALESCE(profile_pic_url) AS profile_pic_url,
             is_pinned,
             is_archived,
             muted_until
           FROM contatos
           WHERE user_id = $1 AND telefone IS NOT NULL
           ORDER BY RIGHT(telefone, 11), updated_at DESC NULLS LAST
         )
         SELECT
           r.phone AS session_id,
           r.instance_name AS instancia,
           r.created_at AS ultima_atividade,
           r.total::int AS total,
           r.content AS ultima_mensagem,
           r.is_group,
           r.last_sender,
           CASE WHEN r.from_me THEN 'assistant' ELSE 'user' END AS ultimo_role,
           cu.push_name,
           cu.nome_contato,
           cu.profile_pic_url,
           COALESCE(cu.is_pinned, false) AS is_pinned,
           COALESCE(cu.is_archived, false) AS is_archived,
           cu.muted_until
         FROM ranked r
         LEFT JOIN contato_unico cu ON cu.sufixo = RIGHT(r.phone, 11) AND NOT r.is_group
         WHERE r.rn = 1
           AND COALESCE(cu.is_archived, false) = $2
         ORDER BY cu.is_pinned DESC NULLS LAST, r.created_at DESC
         LIMIT 300`,
        [userId, showArchived]
      );

      const conversas = r.rows.map(row => {
        const isGroup = row.is_group;
        // Nome: para grupos usa "Grupo XXXX" se não tiver nome; para contatos usa nome do CRM
        const nomeFormatado = isGroup
          ? `Grupo ${row.session_id.split('-')[0]?.slice(-4) ?? row.session_id.slice(-8)}`
          : (row.nome_contato || row.push_name || row.session_id.replace(/^55/, '').replace(/(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3'));
        return {
          session_id: row.session_id,
          instancia: row.instancia,
          is_group: isGroup,
          nome: nomeFormatado,
          push_name: isGroup ? (row.last_sender || null) : (row.push_name || null),
          profile_pic_url: row.profile_pic_url || null,
          ultima_atividade: row.ultima_atividade,
          ultima_mensagem: row.ultima_mensagem || '',
          ultimo_role: row.ultimo_role,
          total: Number(row.total),
          is_pinned: row.is_pinned || false,
          is_archived: row.is_archived || false,
          muted_until: row.muted_until || null,
          mensagens: [],
        };
      });

      return res.json(conversas);
    } catch (err: any) {
      log.error('WHATSAPP conversas', 'Erro ao buscar conversas', { err: err?.message, stack: err?.stack });
      return res.status(500).json({ message: err.message });
    }
  });

  // GET /api/whatsapp/conversas/:phone
  // [AUDITORIA] LÓGICA — Camada 2 (mensagens de uma conversa específica): filtra por
  // `split_part(remote_jid,'@',1) = $1 AND user_id = $2`, sem cache/staleness — qualquer linha
  // nova em whatsapp_messages para esse telefone+usuário aparece na próxima chamada. Mesma
  // conclusão da rota /conversas acima: código correto, não reproduzível com dado novo nesta
  // sessão porque a mensagem de teste nunca chegou ao banco (causa raiz é upstream, no Evolution).
  router.get('/conversas/:phone', async (req: AuthRequest, res: Response) => {
    log.info('WHATSAPP', 'request recebida', { method: req.method, path: req.path, userId: req.userId, params: req.params });
    try {
      const userId = req.userId!;
      // Aceita tanto "5511..." (com DDI) quanto "11..." (sem DDI) — remove tudo exceto dígitos
      const phone = decodeURIComponent(req.params.phone).replace(/\D/g, '');
      if (!phone || phone.length < 8) return res.status(400).json({ message: 'Telefone inválido' });

      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const offset = Number(req.query.offset) || 0;

      // Busca por sufixo do número + nome do remetente via JOIN com users
      const r = await pool.query(
        `SELECT
           m.id, m.message_id, m.from_me, m.message_type, m.content,
           m.media_url, m.media_mimetype, m.status, m.push_name,
           m.timestamp_wa, m.created_at, m.is_read,
           COALESCE(s.status, m.status) AS delivery_status,
           u.display_name AS sender_name
         FROM whatsapp_messages m
         LEFT JOIN whatsapp_message_status s
           ON s.message_id = m.message_id AND s.instance_name = m.instance_name
         LEFT JOIN users u ON u.id = m.sent_by_user_id
         WHERE split_part(m.remote_jid, '@', 1) = $1
           AND m.user_id = $2
         ORDER BY COALESCE(m.timestamp_wa, m.created_at) ASC
         LIMIT $3 OFFSET $4`,
        [phone, userId, limit, offset]
      );

      const mensagens = r.rows.map(row => ({
        id: row.id,
        message_id: row.message_id,
        role: row.from_me ? 'assistant' : 'user',
        content: row.content || '',
        push_name: row.push_name || null,
        tipo: row.message_type,
        midia_url: row.media_url,
        midia_mime: row.media_mimetype,
        midia_nome: null,
        status: row.delivery_status || row.status,
        is_read: row.is_read ?? false,
        sender_name: row.sender_name || null,
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
         WHERE split_part(m.remote_jid, '@', 1) = $1 AND m.user_id = $2 AND m.from_me = true
         ORDER BY m.created_at DESC LIMIT 50`,
        [phone, userId]
      );
      return res.json(r.rows);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // GET /api/whatsapp/ia-status/:phone — lê se IA está pausada para esse contato
  router.get('/ia-status/:phone', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const phone = decodeURIComponent(req.params.phone).replace(/\D/g, '');
      const r = await pool.query(
        `SELECT atendente_pausou_ia, nome, push_name
         FROM contatos
         WHERE user_id = $1 AND telefone ILIKE $2
         LIMIT 1`,
        [userId, `%${phone.slice(-11)}`]
      );
      const pausada = r.rows.length > 0 ? (r.rows[0].atendente_pausou_ia === true) : false;
      return res.json({ pausada, contato: r.rows[0] || null });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // POST /api/whatsapp/ia-toggle — pausa ou reativa IA para um contato manualmente
  router.post('/ia-toggle', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const { phone, pausar } = req.body as { phone: string; pausar: boolean };
      if (!phone) return res.status(400).json({ message: 'phone obrigatório' });
      const phoneClean = phone.replace(/\D/g, '');
      const suffix = `%${phoneClean.slice(-11)}`;

      // 1. Tenta UPDATE em contato existente
      const upd = await pool.query(
        `UPDATE contatos SET atendente_pausou_ia = $1
         WHERE user_id = $2 AND telefone ILIKE $3`,
        [pausar, userId, suffix]
      );

      // 2. Se nenhuma linha afetada, cria o contato (número ainda não tem cadastro)
      if (!upd.rowCount) {
        await pool.query(
          `INSERT INTO contatos (user_id, nome, telefone, origem, status, atendente_pausou_ia)
           VALUES ($1, $2, $3, 'WhatsApp', 'novo', $4)`,
          [userId, phoneClean, phoneClean, pausar]
        ).catch(() => {}); // ignora se criado por race condition
      }

      // 3. Atualiza dados_cliente também (sem travar em erro)
      await pool.query(
        `UPDATE dados_cliente SET atendimento_ia = $1
         WHERE user_id = $2 AND telefone ILIKE $3`,
        [pausar ? 'pause' : 'ativo', userId, suffix]
      ).catch(() => {});

      return res.json({ ok: true, pausada: pausar });
    } catch (err: any) {
      log.error('IA-TOGGLE', 'Erro', { err: err?.message, stack: err?.stack });
      return res.status(500).json({ message: err.message });
    }
  });

  // PATCH /api/whatsapp/contato/:phone — edita nome do contato
  router.patch('/contato/:phone', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const phone = decodeURIComponent(req.params.phone).replace(/\D/g, '');
      const { nome } = req.body as { nome: string };
      if (!nome?.trim()) return res.status(400).json({ message: 'nome é obrigatório' });

      const r = await pool.query(
        `UPDATE contatos SET nome = $1
         WHERE user_id = $2 AND telefone ILIKE $3
         RETURNING id, nome, telefone, push_name, profile_pic_url`,
        [nome.trim(), userId, `%${phone.slice(-11)}`]
      );

      if (!r.rowCount) {
        // Contato não existe, cria
        const ins = await pool.query(
          `INSERT INTO contatos (user_id, nome, telefone, origem, status, atendente_pausou_ia)
           VALUES ($1, $2, $3, 'WhatsApp', 'novo', false)
           RETURNING id, nome, telefone, push_name, profile_pic_url`,
          [userId, nome.trim(), phone]
        );
        return res.json(ins.rows[0]);
      }
      return res.json(r.rows[0]);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // GET /api/whatsapp/logs-ia — últimas interações do motor de IA
  router.get('/logs-ia', async (req: AuthRequest, res: Response) => {
    try {
      const r = await pool.query(
        `SELECT session_id AS telefone, message, created_at, instancia
         FROM n8n_chat_histories
         WHERE user_id = $1
         ORDER BY created_at DESC LIMIT 100`,
        [req.userId]
      );
      return res.json(r.rows.map((row: any) => {
        const m = typeof row.message === 'string'
          ? JSON.parse(row.message) : row.message;
        return {
          telefone: row.telefone,
          role: m.role || m.type || 'unknown',
          content: (m.content || m.text || '').slice(0, 300),
          created_at: row.created_at,
          instancia: row.instancia,
        };
      }));
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // GET /api/whatsapp/debug-agente — diagnóstico completo de configuração
  router.get('/debug-agente', async (req: AuthRequest, res: Response) => {
    try {
      const agentes = await pool.query(
        `SELECT id, nome, evolution_instancia, evolution_server_url, ativo
         FROM agentes WHERE user_id = $1`,
        [req.userId]
      );
      const integracoes = await pool.query(
        `SELECT instancia, url, status, updated_at
         FROM integracoes_config WHERE user_id = $1 AND tipo = 'evolution'`,
        [req.userId]
      );
      const ultimaMensagem = await pool.query(
        `SELECT created_at, instance_name FROM whatsapp_messages
         WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [req.userId]
      );
      const provider = await pool.query(
        `SELECT nome, slug, modelo, ativo FROM ai_providers
         WHERE user_id = $1 AND ativo = true LIMIT 1`,
        [req.userId]
      );
      const agentConfig = await pool.query(
        `SELECT nome_agente, modelo_llm, ativo,
                (prompt_sistema IS NOT NULL AND prompt_sistema != '') AS tem_prompt
         FROM agent_configs WHERE user_id = $1 AND ativo = true LIMIT 1`,
        [req.userId]
      );
      return res.json({
        agentes: agentes.rows,
        integracoes: integracoes.rows,
        ultima_mensagem: ultimaMensagem.rows[0] || null,
        provider: provider.rows[0] || null,
        agent_config: agentConfig.rows[0] || null,
      });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // GET /api/whatsapp/contatos-search — busca contatos CRM para nova conversa
  router.get('/contatos-search', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const q = ((req.query.q as string) || '').trim();
      if (!q) return res.json([]);
      const r = await pool.query(
        `SELECT id, nome, telefone, push_name, status
         FROM contatos
         WHERE user_id = $1
           AND (nome ILIKE $2 OR telefone ILIKE $2 OR push_name ILIKE $2)
           AND telefone IS NOT NULL AND telefone <> ''
         ORDER BY nome ASC LIMIT 20`,
        [userId, `%${q}%`]
      );
      return res.json(r.rows);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // GET /api/whatsapp/media — proxy autenticado para mídias da Evolution API (áudio, vídeo, doc)
  router.get('/media', async (req: AuthRequest, res: Response) => {
    try {
      const mediaUrl = (req.query.url as string || '').trim();
      if (!mediaUrl || !/^https?:\/\//.test(mediaUrl)) {
        return res.status(400).json({ message: 'url inválida' });
      }

      const cfg = await getEvolutionConfig(req.userId!);

      // Tenta buscar com apikey primeiro; se falhar, tenta sem auth (URL pública)
      let mediaRes = await fetch(mediaUrl, {
        headers: { apikey: cfg.api_key },
      }).catch(() => null);

      if (!mediaRes || !mediaRes.ok) {
        mediaRes = await fetch(mediaUrl).catch(() => null);
      }

      if (!mediaRes || !mediaRes.ok) {
        return res.status(502).json({ message: 'Mídia não disponível' });
      }

      const contentType = mediaRes.headers.get('content-type') || 'application/octet-stream';
      const contentLength = mediaRes.headers.get('content-length');

      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.setHeader('Accept-Ranges', 'bytes');
      if (contentLength) res.setHeader('Content-Length', contentLength);

      const buf = await mediaRes.arrayBuffer();
      return res.send(Buffer.from(buf));
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // POST /api/whatsapp/status — Verifica status da conexão na Evolution
  router.post('/status', async (req: AuthRequest, res: Response) => {
    try {
      const cfg = await getEvolutionConfig(req.userId!);
      const base = cfg.url.replace(/\/$/, '');
      
      // Permite sobrescrever a instância para diagnósticos específicos (ex: TesteInstancias)
      const instancia = (req.body?.instancia as string | undefined) || cfg.instancia;

      const r = await fetch(`${base}/instance/connectionState/${instancia}`, {
        headers: { apikey: cfg.api_key },
      }).catch(() => null);

      if (!r) {
        return res.json({ state: 'close', instancia: instancia });
      }

      // Tratamento explícito de 401 (API Key inválida ou instância deslogada forçadamente)
      if (r.status === 401) {
        log.warn('WHATSAPP', 'Evolution retornou 401 para instância', { instancia });
        return res.json({ 
          state: 'unauthorized', 
          message: 'Sessão expirada ou API Key inválida. Por favor, reconecte.',
          instancia: instancia 
        });
      }

      if (!r.ok) {
        return res.json({ state: 'close', instancia: instancia });
      }

      const data: any = await r.json();
      const state = data?.instance?.state || data?.state || data?.status || 'close';
      const phoneNumber = data?.instance?.profileName || data?.instance?.number || data?.instance?.owner || '';

      // Re-registra webhook toda vez que a instância está conectada
      if (state === 'open' || state === 'connected' || state === 'CONNECTED') {
        registrarWebhook(base, cfg.api_key, instancia).catch(() => {});
      }

      return res.json({ state, phoneNumber, instancia: instancia });
    } catch (err: any) {
      return res.json({ state: 'close', instancia: null, error: err.message });
    }
  });

  // POST /api/whatsapp/register-webhook — força re-registro do webhook na Evolution
  router.post('/register-webhook', async (req: AuthRequest, res: Response) => {
    try {
      const cfg = await getEvolutionConfig(req.userId!);
      const base = cfg.url.replace(/\/$/, '');
      await registrarWebhook(base, cfg.api_key, cfg.instancia);
      return res.json({ ok: true, instancia: cfg.instancia, webhookUrl: WEBHOOK_URL });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // POST /api/whatsapp/connect — cria instância e retorna QR code
  router.post('/connect', async (req: AuthRequest, res: Response) => {
    const userId = req.userId!;
    const lockKey = `connect:${userId}`;

    if (connectingUsers.has(lockKey)) {
      return res.status(429).json({ message: 'Conexão em andamento. Aguarde 30s e tente novamente se necessário.' });
    }

    connectingUsers.add(lockKey);
    const timeout = setTimeout(() => connectingUsers.delete(lockKey), 30_000);

    try {
      const cfg = await getEvolutionConfig(userId);
      const base = cfg.url.replace(/\/$/, '');

      // 1. Limpeza de instâncias duplicadas/antigas na Evolution API
      // Lista todas as instâncias e remove qualquer uma que contenha o ID do usuário mas não seja a atual
      // [AUDITORIA] BUG (relacionado ao achado em getEvolutionConfig acima): esta limpeza compara
      // pelo nome exato `name !== cfg.stableInstancia`, mas cfg.instancia (o que o resto da função
      // usa para checar estado/conectar) pode ser DIFERENTE de cfg.stableInstancia quando vem de
      // integracoes_config/agentes com um nome histórico não-padrão. Nesse cenário, toda chamada a
      // /connect apagaria a instância "oficial" atual (por não bater com stableInstancia) e criaria
      // uma nova em seguida — um ciclo de delete+recreate a cada connect. Isso é consistente com um
      // comportamento observado ao vivo nesta VPS (instanceId da Evolution mudando repetidamente
      // entre verificações consecutivas, no mesmo dia desta auditoria).
      // [AUDITORIA] FIX PENDENTE (motivo: precisa correlacionar com logs reais antes de mexer):
      // não tenho confirmação de que isso realmente disparou no incidente observado (pode ter sido
      // outra causa, como o crash loop do container Evolution que já foi corrigido separadamente).
      // Próxima sessão: reproduzir chamando /connect duas vezes seguidas para um usuário cujo
      // integracoes_config.instancia não siga o padrão crm_<12-hex> e confirmar se a instância é
      // mesmo deletada; só então decidir o fix (ex: só deletar duplicatas que também estejam
      // desconectadas, ou nunca deletar a que está em cfg.instancia independente do nome).
      try {
        const listRes = await fetch(`${base}/instance/fetchInstances`, {
          headers: { apikey: cfg.api_key },
        }).catch(() => null);

        if (listRes?.ok) {
          const instances: any[] = await listRes.json();
          const userIdShort = userId.replace(/-/g, '').slice(0, 12);
          for (const inst of instances) {
            const name = inst.instanceName || inst.name;
            // Se o nome contém nosso padrão de ID de usuário mas NÃO é a instância oficial (estável)
            if (name && name.includes(userIdShort) && name !== cfg.stableInstancia) {
              log.info('WHATSAPP', 'Removendo instância duplicada/antiga', { name });
              // Remove webhook da duplicata antes de deletar
              await registrarWebhook(base, cfg.api_key, name, false).catch(() => {});
              await fetch(`${base}/instance/delete/${name}`, {
                method: 'DELETE',
                headers: { apikey: cfg.api_key },
              }).catch(() => {});
            }
          }
        }
      } catch (err) {
        log.warn('WHATSAPP', 'Erro ao listar/limpar instâncias', { err: (err as Error).message });
      }

      // 2. Verifica estado da instância oficial
      const stateRes = await fetch(`${base}/instance/connectionState/${cfg.instancia}`, {
        headers: { apikey: cfg.api_key },
      }).catch(() => null);

      if (stateRes?.status === 401) {
        log.warn('WHATSAPP', '401 durante connect — API Key inválida ou instância órfã', { instancia: cfg.instancia });
        return res.json({ 
          state: 'unauthorized', 
          message: 'API Key da Evolution inválida ou sessão expirada. Clique em Reconectar.',
          instancia: cfg.instancia 
        });
      }

      if (stateRes?.ok) {
        const stateData: any = await stateRes.json();
        const state = stateData?.instance?.state || stateData?.state || stateData?.status || 'close';
        if (state === 'open' || state === 'CONNECTED' || state === 'connected') {
          // Só consideramos 'open' se tiver número/perfil vinculado
          const hasPhone = !!(stateData?.instance?.profileName || stateData?.instance?.number || stateData?.instance?.owner || stateData?.instance?.profile);
          
          if (hasPhone) {
            await registrarWebhook(base, cfg.api_key, cfg.instancia);
            await saveEvolutionConfig(userId, cfg.agenteId, cfg.url, cfg.api_key, cfg.instancia);
            return res.json({
              state: 'open',
              phoneNumber: stateData?.instance?.profileName || stateData?.instance?.number || stateData?.instance?.owner || '',
              instancia: cfg.instancia,
            });
          } else {
            log.info('WHATSAPP', "Instância está em 'open' mas sem conta vinculada (owner missing). Tratando como unauthorized.", { instancia: cfg.instancia });
            return res.json({ 
              state: 'unauthorized', 
              message: 'Instância sem conta do WhatsApp vinculada. Por favor, reconecte escanendo o QR.',
              instancia: cfg.instancia 
            });
          }
        }
      }

      // 3. Tenta conectar ou criar
      const phoneNumber = (req.body?.phoneNumber as string | undefined)?.replace(/\D/g, '') || undefined;
      
      const createPayload = {
        instanceName: cfg.stableInstancia,
        token: cfg.api_key,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
        rejectCall: false,
        groupsIgnore: true,
        alwaysOnline: true,
        readMessages: true,
        readStatus: false,
        ...(phoneNumber ? { number: phoneNumber } : {}),
        webhook: webhookInner(),
      };

      log.info('WHATSAPP', 'Criando/Conectando instância', { instancia: cfg.stableInstancia });
      
      const createRes = await fetch(`${base}/instance/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': cfg.api_key },
        body: JSON.stringify(createPayload),
      });

      const created: any = await createRes.json();
      
      // Se já existe, tenta conectar para obter QR
      if (!createRes.ok && (created?.message?.includes('already') || created?.message?.includes('exist') || created?.message?.includes('conflict'))) {
        const connectRes = await fetch(`${base}/instance/connect/${cfg.instancia}`, {
          headers: { apikey: cfg.api_key },
        }).catch(() => null);
        
        if (connectRes?.ok) {
          const rcData: any = await connectRes.json();
          const qrRaw = rcData?.base64 || rcData?.qrcode?.base64 || rcData?.code || null;
          await saveEvolutionConfig(userId, cfg.agenteId, cfg.url, cfg.api_key, cfg.stableInstancia);
          await registrarWebhook(base, cfg.api_key, cfg.stableInstancia);
          return res.json({
            state: 'connecting',
            qrCode: normalizeQr(qrRaw),
            pairingCode: rcData?.pairingCode || rcData?.code || null,
            instanceName: cfg.stableInstancia,
            instancia: cfg.stableInstancia,
          });
        }
      }

      let qrCode = created?.qrcode?.base64 || created?.hash?.qrcode || null;
      let pairingCode = created?.qrcode?.pairingCode || created?.pairingCode || created?.hash?.pairingCode || null;

      // Evolution v2 polling se QR não veio no create
      if (!qrCode && createRes.ok) {
        for (let attempt = 0; attempt < 5 && !qrCode; attempt++) {
          await new Promise(r => setTimeout(r, 2000));
          const qrRes = await fetch(`${base}/instance/connect/${cfg.instancia}`, {
            headers: { apikey: cfg.api_key },
          }).catch(() => null);
          if (qrRes?.ok) {
            const qrData: any = await qrRes.json();
            qrCode = qrData?.base64 || qrData?.qrcode?.base64 || null;
            pairingCode = pairingCode || qrData?.pairingCode || null;
          }
        }
      }

      await saveEvolutionConfig(userId, cfg.agenteId, cfg.url, cfg.api_key, cfg.stableInstancia);
      await registrarWebhook(base, cfg.api_key, cfg.stableInstancia);

      return res.json({
        state: (qrCode || created?.qrcode?.base64) ? 'connecting' : (created?.instance?.state || created?.state || 'connecting'),
        qrCode: normalizeQr(qrCode),
        qrPending: !qrCode,
        pairingCode,
        instanceName: cfg.stableInstancia,
        instancia: cfg.stableInstancia,
      });
    } catch (err: any) {
      log.error('WHATSAPP connect', 'Erro', { err: err?.message, stack: err?.stack });
      return res.status(500).json({ message: err.message });
    } finally {
      clearTimeout(timeout);
      connectingUsers.delete(lockKey);
    }
  });

  // GET /api/whatsapp/poll-qr — polling leve para aguardar QR gerado pelo Baileys
  router.get('/poll-qr', async (req: AuthRequest, res: Response) => {
    try {
      const cfg = await getEvolutionConfig(req.userId!);
      const base = cfg.url.replace(/\/$/, '');

      const stateRes = await fetch(`${base}/instance/connectionState/${cfg.instancia}`, {
        headers: { apikey: cfg.api_key },
      }).catch(() => null);
      const stateData: any = stateRes?.ok ? await stateRes.json() : {};
      const state = stateData?.instance?.state || stateData?.state || 'close';

      if (state === 'open') {
        return res.json({ state: 'open', qrCode: null, qrPending: false });
      }

      const qrRes = await fetch(`${base}/instance/connect/${cfg.instancia}`, {
        headers: { apikey: cfg.api_key },
      }).catch(() => null);

      if (qrRes?.ok) {
        const qrData: any = await qrRes.json();
        const qrCode = qrData?.base64 || qrData?.qrcode?.base64 || null;
        const pairingCode = qrData?.pairingCode || null;
        return res.json({
          state,
          qrCode: normalizeQr(qrCode),
          qrPending: !qrCode,
          pairingCode,
          instancia: cfg.instancia,
        });
      }

      return res.json({ state, qrCode: null, qrPending: true });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // POST /api/whatsapp/disconnect — Desconexão total e limpeza de estado
  router.post('/disconnect', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const cfg = await getEvolutionConfig(userId);
      const base = cfg.url.replace(/\/$/, '');
      const instancia = cfg.instancia;

      log.info('WHATSAPP', 'Desconexão total iniciada', { userId, instancia });

      // 1. Tentar remover webhook, logout e delete na Evolution API
      // Remove webhook primeiro para evitar eventos residuais
      await registrarWebhook(base, cfg.api_key, instancia, false).catch(() => {});

      // Logout desconecta a conta do WhatsApp
      await fetch(`${base}/instance/logout/${instancia}`, {
        method: 'DELETE',
        headers: { apikey: cfg.api_key },
      }).catch(err => log.warn('WHATSAPP', 'Erro no logout', { instancia, err: err.message }));

      // Delete remove a instância completamente do servidor Evolution
      const deleteRes = await fetch(`${base}/instance/delete/${instancia}`, {
        method: 'DELETE',
        headers: { apikey: cfg.api_key },
      }).catch(err => {
        log.error('WHATSAPP', 'Erro ao deletar instância na Evolution', { instancia, err: err.message });
        return null;
      });

      if (deleteRes && !deleteRes.ok) {
        const errorText = await deleteRes.text().catch(() => 'Erro desconhecido');
        log.warn('WHATSAPP', 'Evolution retornou erro ao deletar instância', { instancia, status: deleteRes.status, errorText });
      }

      // 2. Limpeza profunda no Banco de Dados (Postgres)
      // Removemos todo o histórico de mensagens e estados para evitar "estado sujo" ao reconectar
      log.info('WHATSAPP', 'Limpando registros do BD', { userId });
      
      const queries = [
        // Remove mensagens do chat
        pool.query(`DELETE FROM whatsapp_messages WHERE user_id = $1`, [userId]),
        // Remove status de entrega
        pool.query(`DELETE FROM whatsapp_message_status WHERE instance_name = $1`, [instancia]),
        // Remove deduplicação de webhook para esta instância
        pool.query(`DELETE FROM webhook_mensagens_processadas WHERE instancia = $1`, [instancia]),
        // Remove histórico de logs da IA (n8n_chat_histories)
        pool.query(`DELETE FROM n8n_chat_histories WHERE user_id = $1`, [userId]),
        // Limpa configurações de integração (integracoes_config)
        pool.query(`DELETE FROM integracoes_config WHERE user_id = $1 AND tipo = 'evolution'`, [userId]),
        // Reseta o status da IA nos contatos e dados_cliente para o padrão (Ativa)
        pool.query(`UPDATE contatos SET atendente_pausou_ia = false WHERE user_id = $1`, [userId]),
        pool.query(`UPDATE dados_cliente SET atendimento_ia = 'ativo' WHERE user_id = $1`, [userId]),
        // Limpa referências em TODOS os agentes do usuário (independente de agenteId)
        pool.query(
          `UPDATE agentes 
           SET evolution_instancia = NULL, 
               evolution_server_url = NULL, 
               evolution_api_key = NULL, 
               updated_at = NOW() 
           WHERE user_id = $1`,
          [userId]
        )
      ];

      await Promise.allSettled(queries);

      return res.json({ 
        ok: true, 
        message: 'WhatsApp desconectado, instância removida e estado limpo com sucesso.' 
      });
    } catch (err: any) {
      log.error('WHATSAPP', 'Erro fatal no disconnect', { err: err?.message, stack: err?.stack });
      return res.status(500).json({ message: err.message });
    }
  });

  // POST /api/whatsapp/sync-history — importa mensagens da Evolution para whatsapp_messages
  router.post('/sync-history', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const cfg = await getEvolutionConfig(userId);
      const instancia = cfg.instancia;
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
          log.warn('SYNC', 'msg skip', { err: err.message });
        }
      }

      return res.json({ chats: chats.length, messages: messages.length, inseridos });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // POST /api/whatsapp/send — envia mensagem manual (texto ou mídia)
  router.post('/send', async (req: AuthRequest, res: Response) => {
    const userId = req.userId!;
    log.info('DEBUG SEND', 'Payload recebido do Lovable', { body: req.body });
    log.info('DEBUG SEND', 'userId', { userId });
    try {
      const {
        phone, text,
        mediaUrl, mediaType, mediaCaption, mediaFilename,
      } = req.body as {
        phone: string; text?: string;
        mediaUrl?: string; mediaType?: 'image' | 'audio' | 'video' | 'document';
        mediaCaption?: string; mediaFilename?: string;
      };

      // Normaliza o telefone — remove tudo exceto dígitos
      const phoneClean = (phone || '').replace(/\D/g, '');
      if (!phoneClean || phoneClean.length < 8 || phoneClean.length > 15) {
        log.warn('DEBUG SEND', 'telefone inválido', { phone });
        return res.status(400).json({ message: `Número de telefone inválido: "${phone}"` });
      }
      if (!text && !mediaUrl) {
        return res.status(400).json({ message: 'text ou mediaUrl são obrigatórios' });
      }

      const cfg = await getEvolutionConfig(userId);
      log.info('DEBUG SEND', 'Instância encontrada para o usuário', {
        instancia: cfg.instancia,
        url: cfg.url,
        isGlobal: cfg.isGlobal,
        agenteId: cfg.agenteId,
        tokenPresente: !!cfg.api_key,
      });

      const instancia = cfg.instancia;
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
        };
        if (mediaCaption) mediaPayload.caption = mediaCaption;
        if (mediaFilename) mediaPayload.fileName = mediaFilename;

        const targetUrl = `${base}/message/${endpoint}/${cfg.instancia}`;
        log.info('DEBUG SEND', 'Disparando para Evolution', { targetUrl, tokenPresente: !!cfg.api_key });
        let evoRes: globalThis.Response;
        try {
          evoRes = await evolutionFetch(targetUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: cfg.api_key },
            body: JSON.stringify(mediaPayload),
          });
        } catch (err: any) {
          log.info('DEBUG SEND', 'Erro cru ao chamar Evolution API (mídia)', { err: err.message });
          return res.status(502).json({ message: `Sem resposta da Evolution API: ${err.message}` });
        }
        if (!evoRes.ok) {
          const errText = await evoRes.text().catch(() => String(evoRes.status));

          if (evoRes.status === 404 || errText.includes('does not exist') || errText.includes('instance not found')) {
            log.info('SEND', 'Instância não existe ou está deslogada na Evolution — solicitando reconexão manual', { instancia });
            return res.status(401).json({
              message: 'Sessão do WhatsApp expirada ou não encontrada. Por favor, reconecte.',
              reconnect_required: true,
              instancia,
            });
          } else if (errText.includes('presenceSubscribe') || errText.includes('Cannot read properties of undefined')) {
            // Socket Baileys ainda inicializando — retry após 3s
            log.info('SEND', 'presenceSubscribe — socket não pronto, aguardando 3s e reenviando...');
            await new Promise(r => setTimeout(r, 3000));
            const retry = await evolutionFetch(targetUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', apikey: cfg.api_key },
              body: JSON.stringify(mediaPayload),
            }).catch(() => null);
            if (!retry?.ok) {
              return res.status(503).json({ message: 'WhatsApp ainda inicializando. Tente novamente em alguns segundos.' });
            }
            evolutionResp = await retry.json().catch(() => ({}));
          } else {
            log.error('DEBUG SEND', 'Evolution mídia falhou', { status: evoRes.status, body: errText.slice(0, 400) });
            return res.status(502).json({ message: `Evolution ${evoRes.status}: ${errText.slice(0, 200)}` });
          }
        }
        evolutionResp = evolutionResp ?? await evoRes.json().catch(() => ({}));
      } else {
        // Envio de texto
        const targetUrl = `${base}/message/sendText/${cfg.instancia}`;
        log.info('DEBUG SEND', 'Disparando para Evolution', { targetUrl, tokenPresente: !!cfg.api_key });
        let evoRes: globalThis.Response;
        try {
          evoRes = await evolutionFetch(targetUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: cfg.api_key },
            body: JSON.stringify({ number: phoneClean, text }),
          });
        } catch (err: any) {
          log.info('DEBUG SEND', 'Erro cru ao chamar Evolution API (texto)', { err: err.message });
          return res.status(502).json({ message: `Sem resposta da Evolution API: ${err.message}` });
        }
        if (!evoRes.ok) {
          const errText = await evoRes.text().catch(() => String(evoRes.status));

          if (evoRes.status === 404 || errText.includes('does not exist') || errText.includes('instance not found')) {
            log.info('SEND', 'Instância não existe ou está deslogada na Evolution — solicitando reconexão manual', { instancia });
            return res.status(401).json({
              message: 'Sessão do WhatsApp expirada ou não encontrada. Por favor, reconecte.',
              reconnect_required: true,
              instancia,
            });
          } else if (errText.includes('presenceSubscribe') || errText.includes('Cannot read properties of undefined')) {
            // Socket Baileys ainda inicializando — retry após 3s
            log.info('SEND', 'presenceSubscribe — socket não pronto, aguardando 3s e reenviando...');
            await new Promise(r => setTimeout(r, 3000));
            const retry = await evolutionFetch(targetUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', apikey: cfg.api_key },
              body: JSON.stringify({ number: phoneClean, text }),
            }).catch(() => null);
            if (!retry?.ok) {
              return res.status(503).json({ message: 'WhatsApp ainda inicializando. Tente novamente em alguns segundos.' });
            }
            evolutionResp = await retry.json().catch(() => ({}));
          } else {
            log.error('DEBUG SEND', 'Evolution texto falhou', { status: evoRes.status, body: errText.slice(0, 400) });
            return res.status(502).json({ message: `Evolution ${evoRes.status}: ${errText.slice(0, 200)}` });
          }
        } else {
          evolutionResp = await evoRes.json().catch(() => ({}));
        }
        log.info('DEBUG SEND', 'Evolution respondeu ok', { messageId: evolutionResp?.key?.id });
      }

      const messageId = evolutionResp?.key?.id || `manual_${Date.now()}`;
      const content = text || mediaCaption || null;

      await pool.query(
        `INSERT INTO whatsapp_messages
           (user_id, sent_by_user_id, instance_name, remote_jid, message_id, from_me, message_type,
            content, media_url, status, timestamp_wa)
         VALUES ($1, $2, $3, $4, $5, true, $6, $7, $8, 'sent', NOW())
         ON CONFLICT (message_id, instance_name) DO NOTHING`,
        [userId, userId, instancia, `${phoneClean}@s.whatsapp.net`,
         messageId, msgType, content, mediaUrl || null]
      ).catch(err => log.warn('SEND', 'Falha ao salvar', { err: err.message }));

      return res.json({ ok: true, messageId });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // DELETE /api/whatsapp/instances/:name — remove instância na Evolution e limpa estado do agente
  router.delete('/instances/:name', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const name = req.params.name;
      const cfg = await getEvolutionConfig(userId);
      const base = cfg.url.replace(/\/$/, '');

      // 1. Evolution Cleanup
      // Remove webhook primeiro
      await registrarWebhook(base, cfg.api_key, name, false).catch(() => {});

      await fetch(`${base}/instance/logout/${name}`, {
        method: 'DELETE',
        headers: { apikey: cfg.api_key },
      }).catch(() => null);

      await fetch(`${base}/instance/delete/${name}`, {
        method: 'DELETE',
        headers: { apikey: cfg.api_key },
      }).catch(() => null);

      // 2. DB Cleanup (Sincronizado com o fluxo de /disconnect)
      await Promise.allSettled([
        pool.query(`DELETE FROM whatsapp_messages WHERE user_id = $1`, [userId]),
        pool.query(`DELETE FROM whatsapp_message_status WHERE instance_name = $1`, [name]),
        pool.query(`DELETE FROM webhook_mensagens_processadas WHERE instancia = $1`, [name]),
        pool.query(`DELETE FROM n8n_chat_histories WHERE user_id = $1`, [userId]),
        pool.query(`DELETE FROM integracoes_config WHERE user_id = $1 AND tipo = 'evolution'`, [userId]),
        pool.query(`UPDATE contatos SET atendente_pausou_ia = false WHERE user_id = $1`, [userId]),
        pool.query(`UPDATE dados_cliente SET atendimento_ia = 'ativo' WHERE user_id = $1`, [userId]),
        pool.query(
          `UPDATE agentes 
           SET evolution_instancia = NULL, 
               evolution_server_url = NULL, 
               evolution_api_key = NULL, 
               updated_at = NOW() 
           WHERE user_id = $1`,
          [userId]
        )
      ]);

      return res.json({ ok: true, message: 'Instância removida e estado limpo.' });
    } catch (err: any) {
      log.error('WHATSAPP', 'Erro ao deletar instância via DELETE', { err: err?.message, stack: err?.stack });
      return res.status(500).json({ message: err.message });
    }
  });

  // ── Proxy para Evolution API — resolve CORS, lê config do banco ─────────────

  // POST /api/whatsapp/evo/test — valida conexão usando config do banco
  // Aceita url+api_key no body para testar antes de salvar (opcional)
  router.post('/evo/test', async (req: AuthRequest, res: Response) => {
    try {
      const bodyUrl    = (req.body?.url    as string | undefined)?.trim();
      const bodyApiKey = (req.body?.api_key as string | undefined)?.trim();

      // Usa parâmetros do body se fornecidos (teste antes de salvar)
      // Caso contrário lê da tabela integracoes_config (fonte de verdade)
      let url = bodyUrl;
      let api_key = bodyApiKey;
      if (!url || !api_key) {
        const cfg = await getEvolutionConfig(req.userId!);
        url     = cfg.url;
        api_key = cfg.api_key;
      }
      if (!url || !api_key) return res.status(400).json({ message: 'Configure a URL e API Key em Conectores primeiro.' });

      const base = url.replace(/\/$/, '');
      const r = await fetch(`${base}/instance/fetchInstances`, { headers: { apikey: api_key } });
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        return res.status(r.status).json({ message: `Evolution retornou HTTP ${r.status}`, detail: txt.slice(0, 300) });
      }
      const instances = (await r.json().catch(() => [])) as any[];
      return res.json({ ok: true, instances: Array.isArray(instances) ? instances : [] });
    } catch (err: any) {
      return res.status(502).json({ message: `Sem resposta do servidor Evolution: ${err.message}` });
    }
  });

  // POST /api/whatsapp/evo/connect — conecta instância usando config salva no banco
  router.post('/evo/connect', async (req: AuthRequest, res: Response) => {
    try {
      // Lê tudo do banco — nenhum parâmetro sensível vem do body
      const cfg = await getEvolutionConfig(req.userId!);
      const base = cfg.url.replace(/\/$/, '');
      const key  = cfg.api_key;

      if (!base || !key) return res.status(400).json({ message: 'Configure URL e API Key em Conectores antes de conectar.' });

      // Idempotency: segunda chamada paralela retorna 'connecting' em vez de criar nova instância
      const lockKey = `connect:${req.userId!}`;
      if (connectingUsers.has(lockKey)) {
        return res.json({ state: 'connecting', instancia: cfg.instancia });
      }
      connectingUsers.add(lockKey);
      setTimeout(() => connectingUsers.delete(lockKey), 30_000);

      // 1. Verificar se já está conectado
      const stateR = await fetch(`${base}/instance/connectionState/${cfg.instancia}`, { headers: { apikey: key } }).catch(() => null);
      if (stateR?.status === 401) {
        return res.json({ state: 'unauthorized', instancia: cfg.instancia });
      }
      if (stateR?.ok) {
        const sd: any = await stateR.json();
        const state = sd?.instance?.state || sd?.state || 'close';
        if (state === 'open') {
          await registrarWebhook(base, key, cfg.instancia);
          return res.json({ state: 'open', instancia: cfg.instancia });
        }
      }

      // 2. Tentar conectar instância existente
      const connR = await fetch(`${base}/instance/connect/${cfg.instancia}`, { headers: { apikey: key } }).catch(() => null);
      if (connR?.ok) {
        const cd: any = await connR.json();
        const qrRaw = cd?.base64 || cd?.qrcode?.base64 || cd?.code || null;
        if (qrRaw) {
          await registrarWebhook(base, key, cfg.instancia);
          return res.json({ state: 'connecting', qrCode: normalizeQr(qrRaw), pairingCode: cd?.pairingCode || null, instancia: cfg.instancia });
        }
      }

      // 3. Criar nova instância (primeira vez)
      const createR = await fetch(`${base}/instance/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: key },
        body: JSON.stringify({
          instanceName: cfg.instancia, qrcode: true, integration: 'WHATSAPP-BAILEYS',
          groupsIgnore: true, alwaysOnline: true, readMessages: true,
          webhook: webhookInner(),
        }),
      });
      const created: any = await createR.json().catch(() => ({}));

      await new Promise(r => setTimeout(r, 1500));
      const qrR = await fetch(`${base}/instance/connect/${cfg.instancia}`, { headers: { apikey: key } }).catch(() => null);
      const qd: any = qrR?.ok ? await qrR.json().catch(() => ({})) : {};
      const qrCode = created?.qrcode?.base64 || qd?.base64 || qd?.code || null;
      await registrarWebhook(base, key, cfg.instancia);

      return res.json({ state: 'connecting', qrCode: normalizeQr(qrCode), pairingCode: qd?.pairingCode || null, instancia: cfg.instancia });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // GET /api/whatsapp/evo/status — verifica estado da instância usando config do banco
  // Aceita ?instancia= para checar uma instância específica (usado pelo painel multi-instância)
  router.get('/evo/status', async (req: AuthRequest, res: Response) => {
    try {
      const cfg      = await getEvolutionConfig(req.userId!);
      const instancia = (req.query['instancia'] as string | undefined) || cfg.instancia;
      if (!cfg.url || !cfg.api_key) return res.json({ state: 'nao_configurado' });
      const base = cfg.url.replace(/\/$/, '');
      const r    = await fetch(`${base}/instance/connectionState/${instancia}`, { headers: { apikey: cfg.api_key } }).catch(() => null);
      if (!r) return res.json({ state: 'close', instancia });
      if (r.status === 401) return res.json({ state: 'unauthorized', instancia });
      if (!r.ok) return res.json({ state: 'close', instancia });
      const d: any = await r.json();
      return res.json({ state: d?.instance?.state || d?.state || 'close', instancia });
    } catch (err: any) {
      return res.status(502).json({ message: err.message });
    }
  });

  // GET /api/whatsapp/search?q=texto — busca em mensagens
  router.get('/search', async (req: AuthRequest, res: Response) => {
    const userId = req.userId!;
    const q = ((req.query.q as string) || '').trim();
    if (!q || q.length < 2) return res.json([]);
    const r = await pool.query(
      `SELECT m.id, m.content, m.timestamp_wa, m.created_at, m.from_me,
               split_part(m.remote_jid,'@',1) AS phone,
               COALESCE(c.nome, c.push_name, split_part(m.remote_jid,'@',1)) AS contact_name,
               COALESCE(c.foto_perfil, c.profile_pic_url) AS profile_pic
        FROM whatsapp_messages m
        LEFT JOIN contatos c ON c.user_id = m.user_id
          AND c.telefone ILIKE '%' || RIGHT(split_part(m.remote_jid,'@',1), 11)
        WHERE m.user_id = $1 AND m.content ILIKE $2
          AND m.remote_jid NOT LIKE '%@g.us'
        ORDER BY m.created_at DESC LIMIT 50`,
      [userId, `%${q}%`]
    );
    return res.json(r.rows);
  });

  // DELETE /api/whatsapp/messages/:id — apaga mensagem local e opcionalmente no Evolution
  router.delete('/messages/:id', async (req: AuthRequest, res: Response) => {
    const userId = req.userId!;
    const id = req.params.id;
    const { forEveryone, instancia, remoteJid } = req.body as any;
    await pool.query(
      `DELETE FROM whatsapp_messages WHERE (id::text = $1 OR message_id = $1) AND user_id = $2`,
      [id, userId]
    ).catch(() => {});
    if (forEveryone && instancia && remoteJid) {
      const cfg = await getEvolutionConfig(userId);
      const base = cfg.url.replace(/\/$/, '');
      await fetch(`${base}/chat/deleteMessage/${instancia}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', apikey: cfg.api_key },
        body: JSON.stringify({ remoteJid, messageId: id }),
      }).catch(() => {});
    }
    return res.json({ ok: true });
  });

  // PATCH /api/whatsapp/conversas/:phone/read — marca mensagens como lidas
  router.patch('/conversas/:phone/read', async (req: AuthRequest, res: Response) => {
    const userId = req.userId!;
    const phone = decodeURIComponent(req.params.phone).replace(/\D/g, '');
    await pool.query(
      `UPDATE whatsapp_messages SET is_read = true
       WHERE user_id = $1 AND split_part(remote_jid,'@',1) = $2 AND from_me = false`,
      [userId, phone]
    ).catch(() => {});
    return res.json({ ok: true });
  });

  // POST /api/whatsapp/chat-prefs/:phone — pin, archive, mute de conversa
  router.post('/chat-prefs/:phone', async (req: AuthRequest, res: Response) => {
    const userId = req.userId!;
    const phone = decodeURIComponent(req.params.phone).replace(/\D/g, '');
    const { pinned, archived, muted_until } = req.body as any;
    const setParts: string[] = [];
    const vals: any[] = [userId, `%${phone.slice(-11)}`];
    if (pinned !== undefined)      { setParts.push(`is_pinned = $${vals.length + 1}`);    vals.push(pinned); }
    if (archived !== undefined)    { setParts.push(`is_archived = $${vals.length + 1}`);  vals.push(archived); }
    if (muted_until !== undefined) { setParts.push(`muted_until = $${vals.length + 1}`);  vals.push(muted_until); }
    if (!setParts.length) return res.json({ ok: true });
    await pool.query(
      `UPDATE contatos SET ${setParts.join(', ')}, updated_at = NOW()
       WHERE user_id = $1 AND telefone ILIKE $2`,
      vals
    ).catch(() => {});
    return res.json({ ok: true });
  });

  return router;
}

