import { Router, Response, Request } from 'express';
import { Pool } from 'pg';
import crypto from 'crypto';
import { AuthRequest } from '../middleware';
import { log } from '../logger';

import { encriptarSegredoMetaOficial, verificarAssinaturaWebhook } from '../services/metaCloudApi';
// getContaMeta / GRAPH_URL moram em services/metaAds.ts desde a Sprint M1 (2026-10-06) —
// reaproveitados pela atribuição de anúncio (services/atribuicaoAnuncio.ts) e pelo Lead Ads.
import { GRAPH_VERSION, GRAPH_URL, getContaMeta, graphRequest } from '../services/metaAds';
import { processarLeadgen } from '../services/leadAds';
import { atribuicoesDoContato } from '../services/atribuicaoAnuncio';

async function salvarContaMeta(
  pool: Pool, userId: string, token: string, tipo: 'oauth' | 'system_user',
  expiraEm: Date | null, nome: string | null, adAccountId: string | null,
) {
  await pool.query(`
    INSERT INTO facebook_contas (user_id, ad_account_id, nome_conta, access_token, access_token_enc, tipo_token, token_expira_em)
    VALUES ($1, $2, $3, NULL, $4, $5, $6)
    ON CONFLICT (user_id) DO UPDATE
    SET ad_account_id=$2, nome_conta=$3, access_token=NULL, access_token_enc=$4,
        tipo_token=$5, token_expira_em=$6, atualizado_em=NOW()
  `, [userId, adAccountId, nome, encriptarSegredoMetaOficial(token), tipo, expiraEm]);
}

/** Lista todas as contas de anúncio que o token enxerga (próprias + compartilhadas via BM). */
async function listarContasAnuncio(token: string) {
  const rows = await graphInsights(
    `${GRAPH_URL}/me/adaccounts?fields=id,name,account_status,currency,business{name}&limit=200`, token, 5
  );
  return rows.map((a: any) => ({
    id: String(a.id),
    nome: a.name ?? a.id,
    status: Number(a.account_status) === 1 ? 'ativa' : 'inativa',
    moeda: a.currency ?? null,
    business: a.business?.name ?? null,
  }));
}

/** Resposta padrão para erro da Graph API (190 = token expirado/revogado). */
function respostaErroGraph(res: Response, err: any) {
  if (err?.graph) {
    const msg = err.graph.code === 190
      ? "Sessão da Meta expirada ou revogada. Reconecte a conta na aba Conta Meta."
      : err.graph.message;
    return res.status(400).json({ error: { message: msg, code: err.graph.code } });
  }
  return res.status(500).json({ error: { message: err?.name === "AbortError" ? "A Meta demorou demais para responder." : err?.message } });
}

async function graphPost(url: string, token: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
    const data: any = await r.json();
    if (data.error) throw Object.assign(new Error(data.error.message || 'Erro na Graph API'), { graph: data.error });
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function graphFetch(url: string, token: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const r = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      signal: controller.signal,
    });
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Busca todas as páginas de um endpoint /insights (limite de segurança: 10 páginas). */
async function graphInsights(url: string, token: string, maxPages = 10): Promise<any[]> {
  const rows: any[] = [];
  let next: string | undefined = url;
  for (let i = 0; next && i < maxPages; i++) {
    const data: any = await graphFetch(next, token);
    if (data.error) {
      throw Object.assign(new Error(data.error.message || 'Erro na Graph API'), { graph: data.error });
    }
    rows.push(...(data.data ?? []));
    next = data.paging?.next;
  }
  return rows;
}

type ActionHit = { valor: number; tipo: string | null };

function actionValue(actions: any[] | undefined, ...tipos: string[]): ActionHit {
  for (const tipo of tipos) {
    const a = actions?.find((x: any) => x.action_type === tipo);
    if (a && Number(a.value) > 0) return { valor: Number(a.value), tipo };
  }
  return { valor: 0, tipo: null };
}

const ACT_MENSAGEM = 'onsite_conversion.messaging_conversation_started_7d';

/**
 * "Resultados" na Meta depende do objetivo da campanha. Aqui mapeamos o objetivo
 * para o(s) tipo(s) de ação equivalente(s); o primeiro que tiver valor > 0 vence.
 */
function calcResultado(row: any, objetivo: string): ActionHit {
  const acts = row.actions;
  switch ((objetivo || '').toUpperCase()) {
    case 'OUTCOME_LEADS':
    case 'LEAD_GENERATION':
      return actionValue(acts, 'lead', 'leadgen_grouped', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead', ACT_MENSAGEM);
    case 'OUTCOME_ENGAGEMENT':
    case 'MESSAGES':
    case 'POST_ENGAGEMENT':
    case 'PAGE_LIKES':
      return actionValue(acts, ACT_MENSAGEM, 'post_engagement', 'page_engagement');
    case 'OUTCOME_TRAFFIC':
    case 'LINK_CLICKS': {
      const hit = actionValue(acts, 'landing_page_view', 'link_click');
      return hit.valor > 0 ? hit : { valor: Number(row.inline_link_clicks ?? 0), tipo: 'inline_link_clicks' };
    }
    case 'OUTCOME_SALES':
    case 'CONVERSIONS':
    case 'PRODUCT_CATALOG_SALES':
      return actionValue(acts, 'purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase', 'lead');
    case 'OUTCOME_AWARENESS':
    case 'BRAND_AWARENESS':
    case 'REACH':
      return { valor: Number(row.reach ?? 0), tipo: 'reach' };
    case 'OUTCOME_APP_PROMOTION':
    case 'APP_INSTALLS':
      return actionValue(acts, 'mobile_app_install');
    case 'VIDEO_VIEWS':
      return actionValue(acts, 'video_view');
    default:
      return actionValue(acts, 'lead', ACT_MENSAGEM, 'purchase', 'link_click');
  }
}

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function eachDay(since: string, until: string): string[] {
  const out: string[] = [];
  const cur = new Date(`${since}T00:00:00Z`);
  const end = new Date(`${until}T00:00:00Z`);
  while (cur <= end) {
    out.push(isoDate(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

export default function marketing(pool: Pool) {
  const protectedRouter = Router();
  const publicRouter = Router();

  // ── PROTECTED ROUTES ──────────────────────────────────────

  // GET /api/marketing/facebook/status
  protectedRouter.get("/facebook/status", async (req: AuthRequest, res: Response) => {
    try {
      const { rows } = await pool.query(
        `SELECT nome_conta, ad_account_id, tipo_token, token_expira_em
         FROM facebook_contas
         WHERE user_id=$1 AND (access_token_enc IS NOT NULL OR access_token IS NOT NULL)`,
        [req.userId]
      );
      if (rows.length === 0) return res.json({ conectado: false });
      const c = rows[0];
      const expiraEm: Date | null = c.token_expira_em;
      const diasRestantes = expiraEm ? Math.floor((expiraEm.getTime() - Date.now()) / 86_400_000) : null;
      res.json({
        conectado: !(expiraEm && expiraEm.getTime() <= Date.now()),
        expirado: !!(expiraEm && expiraEm.getTime() <= Date.now()),
        nome_conta: c.nome_conta,
        ad_account_id: c.ad_account_id || null,
        tipo_token: c.tipo_token || 'oauth',
        token_expira_em: expiraEm,
        dias_restantes: diasRestantes,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/marketing/projecao
  protectedRouter.post("/projecao", async (req: AuthRequest, res: Response) => {
    try {
      // Basic implementation of projection calculation logic
      const inputs = req.body;
      // In a real scenario, we would use inputs and potentially account history
      // to calculate the result. For now, returning a success status or dummy data
      // that the frontend expects.
      res.json({ 
        orcamentoTotal: (inputs.orcamentoDiario || 0) * (inputs.duracaoDias || 0),
        alcanceTotal: Math.round((inputs.orcamentoDiario || 0) * 100),
        impressoesTotal: Math.round((inputs.orcamentoDiario || 0) * 200),
        cliquesTotal: Math.round((inputs.orcamentoDiario || 0) * 5),
        ctr: 2.5,
        cpc: 1.5,
        leadsTotal: Math.round((inputs.orcamentoDiario || 0) / 10),
        cpl: 10,
        cplBenchmark: 12,
        viabilidade: "boa",
        leadsPorSemana: [5, 10, 15, 20],
        distribuicaoPlataforma: inputs.plataforma === 'ambos' ? { facebook: 0.6, instagram: 0.4 } : null,
        sugestoes: ["Aumente o orçamento para melhores resultados"],
        fonte: "api"
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/marketing/facebook/auth → { url }
  // [AUDITORIA] BUG CORRIGIDO (Sprint Conexão Meta Ads, 2026-10-03): antes fazia `res.redirect`
  // e o frontend abria esta rota direto num popup (`window.open`) — popup não manda o header
  // `Authorization`, então a rota (protegida) sempre respondia 401 e NINGUÉM conseguia conectar.
  // Agora devolve a URL em JSON; o frontend busca com Bearer e só então abre o popup na Meta.
  protectedRouter.get("/facebook/auth", async (req: AuthRequest, res: Response) => {
    try {
      if (!process.env.FACEBOOK_APP_ID || !process.env.API_URL) {
        return res.status(503).json({ message: "Login com Facebook ainda não configurado no servidor (FACEBOOK_APP_ID/API_URL). Use a opção de token de Usuário do Sistema." });
      }
      // Gerar nonce aleatório — armazena na sessão do usuário (via banco)
      const nonce = crypto.randomBytes(16).toString('hex');

      // Salvar nonce no banco com TTL de 10 minutos
      await pool.query(`
        INSERT INTO oauth_state (user_id, nonce, expires_at)
        VALUES ($1, $2, NOW() + INTERVAL '10 minutes')
        ON CONFLICT (user_id) DO UPDATE SET nonce=$2, expires_at=NOW() + INTERVAL '10 minutes'
      `, [req.userId, nonce]);

      const state = Buffer.from(JSON.stringify({ user_id: req.userId, nonce })).toString("base64");
      const url = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
      url.searchParams.set("client_id", process.env.FACEBOOK_APP_ID!);
      url.searchParams.set("redirect_uri", `${process.env.API_URL}/api/marketing/facebook/callback`);
      // pages_read_engagement + pages_manage_metadata (Sprint M1): listar páginas e inscrevê-las no
      // webhook `leadgen`; ads_management: pausar/reativar campanha.
      url.searchParams.set("scope", "ads_management,ads_read,leads_retrieval,pages_show_list,pages_read_engagement,pages_manage_metadata,business_management");
      url.searchParams.set("state", state);
      res.json({ url: url.toString() });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/marketing/facebook/token { access_token }
  // Conexão por token de Usuário do Sistema (Business Manager → Usuários do sistema → Gerar
  // token). Não depende de App Review da Meta e o token não expira — caminho recomendado pra
  // agência que gerencia contas de clientes compartilhadas com o próprio BM.
  protectedRouter.post("/facebook/token", async (req: AuthRequest, res: Response) => {
    try {
      const token = String(req.body?.access_token ?? "").trim();
      if (token.length < 50 || /\s/.test(token)) {
        return res.status(400).json({ error: { message: "Token inválido. Copie o token completo gerado no Business Manager." } });
      }
      const me = await graphFetch(`${GRAPH_URL}/me?fields=id,name`, token);
      if (me.error) {
        return res.status(400).json({ error: { message: `A Meta recusou o token: ${me.error.message}`, code: me.error.code } });
      }
      const contas = await listarContasAnuncio(token);
      if (!contas.length) {
        return res.status(400).json({ error: { message: "Token válido, mas sem nenhuma conta de anúncios atribuída. No Business Manager, atribua as contas de anúncio a este usuário do sistema e gere o token com a permissão ads_read." } });
      }
      const selecionada = contas.length === 1 ? contas[0].id : null;
      await salvarContaMeta(pool, req.userId!, token, 'system_user', null, me.name ?? null, selecionada);
      log.info('MARKETING', 'Conta Meta conectada via token de usuário do sistema', { userId: req.userId, contas: contas.length });
      res.json({ ok: true, nome: me.name, contas, ad_account_id: selecionada });
    } catch (err: any) {
      log.error('MARKETING', 'Erro ao salvar token Meta', { err: err?.message });
      respostaErroGraph(res, err);
    }
  });

  // GET /api/marketing/facebook/contas → contas de anúncio disponíveis para o token salvo
  protectedRouter.get("/facebook/contas", async (req: AuthRequest, res: Response) => {
    try {
      const conta = await getContaMeta(pool, req.userId);
      if (!conta) return res.status(401).json({ error: { message: "Meta não conectado" } });
      const contas = await listarContasAnuncio(conta.token);
      res.json({ contas, selecionada: conta.ad_account_id });
    } catch (err: any) {
      log.error('MARKETING', 'Erro ao listar contas de anúncio', { err: err?.message });
      respostaErroGraph(res, err);
    }
  });

  // POST /api/marketing/facebook/conta { ad_account_id } → troca a conta de anúncios ativa
  protectedRouter.post("/facebook/conta", async (req: AuthRequest, res: Response) => {
    try {
      const adAccountId = String(req.body?.ad_account_id ?? "");
      if (!/^act_\d+$/.test(adAccountId)) {
        return res.status(400).json({ error: { message: "ad_account_id inválido." } });
      }
      const conta = await getContaMeta(pool, req.userId);
      if (!conta) return res.status(401).json({ error: { message: "Meta não conectado" } });
      // Só aceita conta que o token realmente enxerga — impede apontar pra conta de terceiro.
      const contas = await listarContasAnuncio(conta.token);
      const alvo = contas.find(c => c.id === adAccountId);
      if (!alvo) return res.status(403).json({ error: { message: "Esta conta de anúncios não está acessível com o token conectado." } });
      await pool.query(
        `UPDATE facebook_contas SET ad_account_id=$2, atualizado_em=NOW() WHERE user_id=$1`,
        [req.userId, adAccountId]
      );
      res.json({ ok: true, ad_account_id: adAccountId, nome: alvo.nome });
    } catch (err: any) {
      log.error('MARKETING', 'Erro ao selecionar conta de anúncios', { err: err?.message });
      respostaErroGraph(res, err);
    }
  });

  // POST /api/marketing/facebook/desconectar
  protectedRouter.post("/facebook/desconectar", async (req: AuthRequest, res: Response) => {
    try {
      await pool.query("DELETE FROM facebook_contas WHERE user_id=$1", [req.userId]);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/marketing/campanhas
  protectedRouter.get("/campanhas", async (req: AuthRequest, res: Response) => {
    try {
      const conta = await getContaMeta(pool, req.userId);
      if (!conta) return res.status(401).json({ error: { message: "Meta não conectado" } });
      if (!conta.ad_account_id) return res.status(400).json({ error: { message: "Selecione uma conta de anúncios na aba Conta Meta." } });

      const STATUS_OK = new Set(["ACTIVE", "PAUSED", "ARCHIVED"]);
      const pedidos = req.query.status === "ALL" ? ["ACTIVE", "PAUSED"]
        : String(req.query.status ?? "ACTIVE").split(",").filter(s => STATUS_OK.has(s));
      const url = `${GRAPH_URL}/${conta.ad_account_id}/campaigns?limit=200&` +
        `fields=id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time,` +
        `insights.date_preset(last_30d){impressions,reach,clicks,ctr,cpc,spend,actions}&` +
        `effective_status=${encodeURIComponent(JSON.stringify(pedidos.length ? pedidos : ["ACTIVE"]))}`;

      const rows = await graphInsights(url, conta.token, 5);

      const campanhas = rows.map((c: any) => {
        const ins = c.insights?.data?.[0] ?? {};
        const leads = ins.actions?.find((a: any) => a.action_type === "lead")?.value ?? 0;
        return {
          id: c.id, nome: c.name, status: c.status, objetivo: c.objective,
          plataforma: "ambos",
          orcamentoDiario: Number(c.daily_budget ?? 0) / 100,
          orcamentoTotal:  Number(c.lifetime_budget ?? 0) / 100,
          inicio: c.start_time, fim: c.stop_time,
          impressoes: Number(ins.impressions ?? 0),
          alcance:    Number(ins.reach ?? 0),
          cliques:    Number(ins.clicks ?? 0),
          ctr:        Number(ins.ctr ?? 0),
          cpc:        Number(ins.cpc ?? 0),
          gastoTotal: Number(ins.spend ?? 0),
          leads:      Number(leads),
          cpl:        Number(leads) > 0 ? Number(ins.spend ?? 0) / Number(leads) : 0,
          origem: "real",
        };
      });

      res.json({ campanhas });
    } catch (err: any) {
      log.error('MARKETING', 'Erro ao listar campanhas da Meta', { err: err?.message });
      respostaErroGraph(res, err);
    }
  });

  // POST /api/marketing/campanhas/:id/pausar | /reativar
  const alterarStatusCampanha = (novoStatus: 'PAUSED' | 'ACTIVE') => async (req: AuthRequest, res: Response) => {
    try {
      if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: { message: "ID de campanha inválido." } });
      const conta = await getContaMeta(pool, req.userId);
      if (!conta) return res.status(401).json({ error: { message: "Meta não conectado" } });
      await graphPost(`${GRAPH_URL}/${req.params.id}?status=${novoStatus}`, conta.token);
      res.json({ ok: true });
    } catch (err: any) {
      log.error('MARKETING', 'Erro ao alterar status de campanha da Meta', { err: err?.message, novoStatus });
      respostaErroGraph(res, err);
    }
  };
  protectedRouter.post("/campanhas/:id/pausar", alterarStatusCampanha('PAUSED'));
  protectedRouter.post("/campanhas/:id/reativar", alterarStatusCampanha('ACTIVE'));

  // GET /api/marketing/insights?since=YYYY-MM-DD&until=YYYY-MM-DD&campaign_id=123
  // Métricas agregadas da conta Meta Ads (cards + série diária do gráfico de Performance).
  protectedRouter.get("/insights", async (req: AuthRequest, res: Response) => {
    try {
      const conta = await getContaMeta(pool, req.userId);
      if (!conta) return res.status(401).json({ error: { message: "Meta não conectado" } });
      if (!conta.ad_account_id) {
        return res.status(400).json({ error: { message: "Selecione uma conta de anúncios na aba Conta Meta." } });
      }

      // Período (padrão: últimos 7 dias; máximo 90)
      const hoje = isoDate(new Date());
      const seteDias = isoDate(new Date(Date.now() - 6 * 86_400_000));
      const since = DATA_RE.test(String(req.query.since ?? "")) ? String(req.query.since) : seteDias;
      const until = DATA_RE.test(String(req.query.until ?? "")) ? String(req.query.until) : hoje;
      if (since > until) return res.status(400).json({ error: { message: "Período inválido: início maior que o fim." } });
      const dias = eachDay(since, until);
      if (dias.length > 90) return res.status(400).json({ error: { message: "Período máximo: 90 dias." } });

      const campaignId = String(req.query.campaign_id ?? "");
      if (campaignId && !/^\d+$/.test(campaignId)) {
        return res.status(400).json({ error: { message: "campaign_id inválido." } });
      }

      const params = new URLSearchParams();
      params.set("time_range", JSON.stringify({ since, until }));
      if (campaignId) {
        params.set("filtering", JSON.stringify([{ field: "campaign.id", operator: "EQUAL", value: campaignId }]));
      }
      const base = `${GRAPH_URL}/${conta.ad_account_id}/insights`;

      // A) Totais do período no nível da conta (alcance/frequência únicos, sem dupla contagem)
      const totaisUrl = `${base}?${params}&level=account&limit=1&fields=` +
        `impressions,reach,frequency,spend,cpm,inline_link_clicks,inline_link_click_ctr,actions,account_currency`;
      // B) Série diária por campanha (resultados dependem do objetivo de cada campanha)
      const serieUrl = `${base}?${params}&level=campaign&time_increment=1&limit=500&fields=` +
        `campaign_id,campaign_name,objective,impressions,reach,spend,inline_link_clicks,actions`;

      const [totaisRows, serieRows] = await Promise.all([
        graphInsights(totaisUrl, conta.token),
        graphInsights(serieUrl, conta.token),
      ]);

      // Série diária (preenche dias sem entrega com zero para o gráfico ficar contínuo)
      const porDia = new Map<string, { gasto: number; impressoes: number; cliquesLink: number; resultados: number }>();
      for (const d of dias) porDia.set(d, { gasto: 0, impressoes: 0, cliquesLink: 0, resultados: 0 });

      const campanhas = new Map<string, string>();
      let resultadosTotal = 0;
      for (const row of serieRows) {
        const dia = porDia.get(row.date_start);
        const { valor } = calcResultado(row, row.objective);
        resultadosTotal += valor;
        if (row.campaign_id) campanhas.set(row.campaign_id, row.campaign_name);
        if (!dia) continue;
        dia.gasto       += Number(row.spend ?? 0);
        dia.impressoes  += Number(row.impressions ?? 0);
        dia.cliquesLink += Number(row.inline_link_clicks ?? 0);
        dia.resultados  += valor;
      }

      const serie = dias.map((data) => {
        const d = porDia.get(data)!;
        return {
          data,
          gasto: Number(d.gasto.toFixed(2)),
          impressoes: d.impressoes,
          cliquesLink: d.cliquesLink,
          resultados: d.resultados,
          cpm: d.impressoes > 0 ? Number(((d.gasto / d.impressoes) * 1000).toFixed(2)) : 0,
          ctrLink: d.impressoes > 0 ? Number(((d.cliquesLink / d.impressoes) * 100).toFixed(2)) : 0,
          custoPorResultado: d.resultados > 0 ? Number((d.gasto / d.resultados).toFixed(2)) : 0,
        };
      });

      const t = totaisRows[0] ?? {};
      const impressoes  = Number(t.impressions ?? 0);
      const cliquesLink = Number(t.inline_link_clicks ?? 0);
      const gasto       = Number(t.spend ?? 0);

      res.json({
        periodo: { since, until },
        moeda: t.account_currency || "BRL",
        totais: {
          impressoes,
          cliquesLink,
          ctrLink: impressoes > 0 ? (cliquesLink / impressoes) * 100 : 0,
          cpm: impressoes > 0 ? (gasto / impressoes) * 1000 : Number(t.cpm ?? 0),
          visualizacoesSite: actionValue(t.actions, "landing_page_view").valor,
          frequencia: Number(t.frequency ?? 0),
          alcance: Number(t.reach ?? 0),
          gasto,
          resultados: resultadosTotal,
          custoPorResultado: resultadosTotal > 0 ? gasto / resultadosTotal : 0,
        },
        serie,
        campanhas: Array.from(campanhas, ([id, nome]) => ({ id, nome })),
      });
    } catch (err: any) {
      log.error('MARKETING', 'Erro ao buscar insights da Meta', { err: err?.message });
      respostaErroGraph(res, err);
    }
  });

  // GET /api/marketing/leads
  protectedRouter.get("/leads", async (req: AuthRequest, res: Response) => {
    try {
      const limit = req.query.limit || 50;
      const { rows } = await pool.query(
        "SELECT * FROM marketing_leads WHERE user_id=$1 ORDER BY capturado_em DESC LIMIT $2",
        [req.userId, limit]
      );
      res.json({ leads: rows });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Sprint M1: páginas inscritas no Lead Ads ─────────────────────────────
  // GET /api/marketing/facebook/paginas → páginas que o token enxerga + se já recebem leads
  protectedRouter.get("/facebook/paginas", async (req: AuthRequest, res: Response) => {
    try {
      const conta = await getContaMeta(pool, req.userId);
      if (!conta) return res.status(401).json({ error: { message: "Meta não conectado" } });
      const pags = await graphInsights(`${GRAPH_URL}/me/accounts?fields=id,name,tasks&limit=100`, conta.token, 3);
      const { rows } = await pool.query(`SELECT page_id, inscrito_leadgen FROM meta_paginas WHERE user_id = $1`, [req.userId]);
      const inscritas = new Set(rows.filter(r => r.inscrito_leadgen).map(r => r.page_id));
      res.json({
        paginas: pags.map((p: any) => ({
          id: String(p.id), nome: p.name ?? p.id, inscrita: inscritas.has(String(p.id)),
          // Inscrever no webhook exige a tarefa MANAGE (ou ADVERTISE) na página.
          podeInscrever: !Array.isArray(p.tasks) || p.tasks.includes('MANAGE') || p.tasks.includes('ADVERTISE'),
        })),
      });
    } catch (err: any) {
      log.error('LEAD_ADS', 'Erro ao listar páginas', { err: err?.message });
      respostaErroGraph(res, err);
    }
  });

  // POST /api/marketing/facebook/paginas/:pageId/inscrever | /desinscrever
  const alterarInscricaoPagina = (inscrever: boolean) => async (req: AuthRequest, res: Response) => {
    try {
      const pageId = String(req.params.pageId);
      if (!/^\d+$/.test(pageId)) return res.status(400).json({ error: { message: "ID de página inválido." } });
      const conta = await getContaMeta(pool, req.userId);
      if (!conta) return res.status(401).json({ error: { message: "Meta não conectado" } });
      // O token da página só vem por /me/accounts — e isso também prova que o usuário tem acesso a ela.
      const pags = await graphInsights(`${GRAPH_URL}/me/accounts?fields=id,name,access_token&limit=100`, conta.token, 3);
      const pag = pags.find((p: any) => String(p.id) === pageId);
      if (!pag?.access_token) return res.status(403).json({ error: { message: "Esta página não está acessível com o token conectado." } });

      const r = await graphRequest(
        `${GRAPH_URL}/${pageId}/subscribed_apps${inscrever ? '?subscribed_fields=leadgen' : ''}`,
        pag.access_token, inscrever ? 'POST' : 'DELETE'
      );
      if (r?.error) return respostaErroGraph(res, { graph: r.error });

      await pool.query(
        `INSERT INTO meta_paginas (user_id, page_id, nome, page_token_enc, inscrito_leadgen)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, page_id) DO UPDATE SET nome = EXCLUDED.nome, page_token_enc = EXCLUDED.page_token_enc,
           inscrito_leadgen = EXCLUDED.inscrito_leadgen, atualizado_em = NOW()`,
        [req.userId, pageId, pag.name ?? null, encriptarSegredoMetaOficial(pag.access_token), inscrever]
      );
      log.info('LEAD_ADS', inscrever ? 'Página inscrita no leadgen' : 'Página desinscrita do leadgen', { userId: req.userId, pageId });
      res.json({ ok: true, inscrita: inscrever });
    } catch (err: any) {
      log.error('LEAD_ADS', 'Erro ao alterar inscrição da página', { err: err?.message });
      respostaErroGraph(res, err);
    }
  };
  protectedRouter.post("/facebook/paginas/:pageId/inscrever", alterarInscricaoPagina(true));
  protectedRouter.post("/facebook/paginas/:pageId/desinscrever", alterarInscricaoPagina(false));

  // GET /api/marketing/atribuicoes?contato_id=UUID → de quais anúncios o contato veio
  protectedRouter.get("/atribuicoes", async (req: AuthRequest, res: Response) => {
    try {
      const contatoId = String(req.query.contato_id ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(contatoId)) return res.status(400).json({ error: { message: "contato_id inválido." } });
      const r = await atribuicoesDoContato(pool, req.userId!, contatoId);
      if (!r) return res.status(404).json({ error: { message: "Contato não encontrado." } });
      res.json(r);
    } catch (err: any) {
      log.error('ATRIBUICAO', 'Erro ao listar atribuições do contato', { err: err?.message });
      res.status(500).json({ error: { message: err?.message } });
    }
  });

  // POST /api/marketing/leads/:id/ativar-cris
  protectedRouter.post("/leads/:id/ativar-cris", async (req: AuthRequest, res: Response) => {
    try {
      const { telefone, nome, campanha } = req.body;
      const n8nWebhook = process.env.N8N_CRIS_WEBHOOK || "https://fierceparrot-n8n.cloudfy.live/webhook/cris-lead";
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      await fetch(n8nWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          telefone,
          nome,
          campanha,
          origem: "facebook_ads",
          mensagem_inicial: `Olá ${nome.split(" ")[0]}! Vi que você se interessou em ${campanha}. Posso te ajudar? 😊`,
        }),
      }).finally(() => clearTimeout(timer));
      await pool.query(
        "UPDATE marketing_leads SET status_crm='cris_ativada' WHERE id=$1 AND user_id=$2",
        [req.params.id, req.userId]
      );
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── PUBLIC ROUTES ─────────────────────────────────────────

  // GET /api/marketing/facebook/callback
  // [AUDITORIA] FIX APLICADO (Sprint Conexão Meta Ads, 2026-10-03): (1) troca o token curto
  // (~1-2h) que o OAuth devolve pelo token longo (~60 dias) via `fb_exchange_token` e grava a
  // validade em `token_expira_em` — antes guardava o curto e a conexão "morria" em ~1h sem aviso;
  // (2) não escolhe mais `adaccounts[0]` às cegas: com 1 conta seleciona sozinha, com várias deixa
  // em branco e a tela pede pro usuário escolher; (3) sempre devolve uma página que avisa o
  // opener (sucesso OU erro) em vez de JSON cru dentro do popup.
  const CRM_ORIGIN = process.env.CRM_ORIGIN || 'https://crm.mentoark.com.br';
  const paginaPopup = (ok: boolean, mensagem: string) => `<!doctype html><meta charset="utf-8">
    <body style="font-family:sans-serif;padding:24px">${ok ? 'Conta conectada. Pode fechar esta janela.' : 'Não foi possível conectar.'}
    <script>
      window.opener?.postMessage(${JSON.stringify({ tipo: 'meta_oauth', ok, mensagem }).replace(/</g, '\\u003c')}, ${JSON.stringify(CRM_ORIGIN)});
      ${ok ? 'window.close();' : ''}
    </script></body>`;

  publicRouter.get("/facebook/callback", async (req: Request, res: Response) => {
    try {
      const { code, state, error_description } = req.query as { code?: string; state?: string; error_description?: string };
      if (!code) return res.status(400).send(paginaPopup(false, error_description || "Autorização cancelada no Facebook."));
      if (!state) return res.status(400).send(paginaPopup(false, "State ausente."));

      let parsed: any;
      try { parsed = JSON.parse(Buffer.from(state, "base64").toString()); } catch { parsed = {}; }
      const { user_id, nonce } = parsed;
      if (!user_id || !nonce) return res.status(400).send(paginaPopup(false, "State inválido."));

      // Verificar nonce no banco para evitar CSRF
      const { rows: stateRows } = await pool.query(`
        SELECT user_id FROM oauth_state
        WHERE user_id = $1 AND nonce = $2 AND expires_at > NOW()
      `, [user_id, nonce]);

      if (!stateRows.length) {
        return res.status(403).send(paginaPopup(false, "Sessão de conexão expirada. Tente conectar novamente."));
      }

      // Limpar nonce usado
      await pool.query('DELETE FROM oauth_state WHERE user_id = $1', [user_id]);

      const appId = process.env.FACEBOOK_APP_ID!;
      const appSecret = process.env.FACEBOOK_APP_SECRET!;
      const redirectUri = `${process.env.API_URL}/api/marketing/facebook/callback`;

      // 1) code → token curto
      const curto = await graphFetch(`${GRAPH_URL}/oauth/access_token?` + new URLSearchParams({
        client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code,
      }), '');
      if (curto.error || !curto.access_token) {
        log.error('MARKETING', 'OAuth Meta: falha ao trocar code por token', { err: curto.error?.message });
        return res.status(400).send(paginaPopup(false, curto.error?.message || "A Meta não devolveu o token."));
      }

      // 2) token curto → token longo (~60 dias). Se falhar, segue com o curto mas registra no log.
      let token: string = curto.access_token;
      let expiraEm: Date | null = curto.expires_in ? new Date(Date.now() + Number(curto.expires_in) * 1000) : null;
      const longo = await graphFetch(`${GRAPH_URL}/oauth/access_token?` + new URLSearchParams({
        grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: curto.access_token,
      }), '');
      if (longo.access_token) {
        token = longo.access_token;
        expiraEm = new Date(Date.now() + Number(longo.expires_in || 60 * 86_400) * 1000);
      } else {
        log.warn('MARKETING', 'OAuth Meta: não foi possível obter token de longa duração', { err: longo.error?.message });
      }

      const me = await graphFetch(`${GRAPH_URL}/me?fields=id,name`, token);
      const contas = await listarContasAnuncio(token).catch(() => []);
      const selecionada = contas.length === 1 ? contas[0].id : null;

      await salvarContaMeta(pool, user_id, token, 'oauth', expiraEm, me?.name ?? null, selecionada);
      log.info('MARKETING', 'Conta Meta conectada via OAuth', { userId: user_id, contas: contas.length, expiraEm });

      res.send(paginaPopup(true, contas.length > 1 ? "Escolha a conta de anúncios." : "Conta conectada."));
    } catch (err: any) {
      log.error('MARKETING', 'Erro no callback OAuth da Meta', { err: err?.message });
      res.status(500).send(paginaPopup(false, "Erro inesperado ao conectar. Tente novamente."));
    }
  });

  // GET /api/marketing/webhook/leads (Verification)
  publicRouter.get("/webhook/leads", (req, res) => {
    const { "hub.mode": mode, "hub.challenge": challenge, "hub.verify_token": token } = req.query as any;
    const WEBHOOK_VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN || 'mentoark-lead-webhook';
    if (mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN) {
      return res.send(challenge);
    }
    res.status(403).send("Forbidden");
  });

  // POST /api/marketing/webhook/leads (Leads data)
  // [AUDITORIA] BUG CORRIGIDO (Sprint M1, 2026-10-06): (1) procurava o dono em `facebook_campanhas`,
  // tabela que nada preenche → user_id nulo → INSERT falhava (marketing_leads.user_id é NOT NULL) →
  // 500 → a Meta reenviava para sempre e nenhum lead entrava; (2) não validava a assinatura (qualquer
  // um podia injetar lead); (3) não buscava os dados do formulário. Agora: assinatura X-Hub-Signature-256
  // com FACEBOOK_APP_SECRET, 200 imediato, e services/leadAds.ts roteia pelo page_id (meta_paginas),
  // busca o lead na Graph e cria o contato.
  publicRouter.post("/webhook/leads", async (req: Request, res: Response) => {
    const appSecret = process.env.FACEBOOK_APP_SECRET;
    if (!appSecret) {
      log.warn('LEAD_ADS', 'Webhook recebido mas FACEBOOK_APP_SECRET não configurado — evento recusado');
      return res.sendStatus(503);
    }
    const rawBody: Buffer | undefined = (req as any).rawBody;
    if (!rawBody || !verificarAssinaturaWebhook(appSecret, rawBody, req.headers['x-hub-signature-256'] as string | undefined)) {
      log.warn('LEAD_ADS', 'Assinatura inválida — evento recusado');
      return res.sendStatus(401);
    }
    res.sendStatus(200);
    try {
      for (const e of req.body?.entry ?? []) {
        for (const change of e.changes ?? []) {
          if (change.field !== "leadgen") continue;
          await processarLeadgen(pool, { page_id: e.id, ...change.value });
        }
      }
    } catch (err: any) {
      log.error('LEAD_ADS', 'Erro ao processar webhook de leads', { err: err?.message, stack: err?.stack });
    }
  });

  return { protected: protectedRouter, public: publicRouter };
}
