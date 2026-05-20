import { Router, Response, Request } from 'express';
import { Pool } from 'pg';
import { AuthRequest } from '../middleware';

export default function marketing(pool: Pool) {
  const protectedRouter = Router();
  const publicRouter = Router();

  // ── PROTECTED ROUTES ──────────────────────────────────────

  // GET /api/marketing/facebook/status
  protectedRouter.get("/facebook/status", async (req: AuthRequest, res: Response) => {
    try {
      const { rows } = await pool.query(
        "SELECT nome_conta, ad_account_id FROM facebook_contas WHERE user_id=$1",
        [req.userId]
      );
      if (rows.length === 0) return res.json({ conectado: false });
      res.json({ conectado: true, nome_conta: rows[0].nome_conta, ad_account_id: rows[0].ad_account_id });
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

  // GET /api/marketing/facebook/auth
  protectedRouter.get("/facebook/auth", async (req: AuthRequest, res: Response) => {
    try {
      const state = Buffer.from(JSON.stringify({ user_id: req.userId })).toString("base64");
      const url = new URL("https://www.facebook.com/v19.0/dialog/oauth");
      url.searchParams.set("client_id", process.env.FACEBOOK_APP_ID!);
      url.searchParams.set("redirect_uri", `${process.env.API_URL}/api/marketing/facebook/callback`);
      url.searchParams.set("scope", "ads_management,ads_read,leads_retrieval,pages_show_list,business_management");
      url.searchParams.set("state", state);
      res.redirect(url.toString());
    } catch (err: any) {
      res.status(500).json({ message: err.message });
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
      const { rows: [conta] } = await pool.query(
        "SELECT access_token, ad_account_id FROM facebook_contas WHERE user_id=$1", [req.userId]
      );
      if (!conta) return res.status(401).json({ error: "Meta não conectado" });

      const status = req.query.status === "ALL" ? "ACTIVE,PAUSED" : (req.query.status as string ?? "ACTIVE");
      const url = `https://graph.facebook.com/v19.0/${conta.ad_account_id}/campaigns?` +
        `fields=id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time,` +
        `insights.date_preset(last_30d){impressions,reach,clicks,ctr,cpc,spend,actions}&` +
        `effective_status=${status}&access_token=${conta.access_token}`;

      const r = await fetch(url);
      const data: any = await r.json();

      if (data.error) {
        return res.status(400).json({ error: data.error });
      }

      const campanhas = (data.data ?? []).map((c: any) => {
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
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/marketing/campanhas/:id/pausar
  protectedRouter.post("/campanhas/:id/pausar", async (req: AuthRequest, res: Response) => {
    try {
      const { rows: [conta] } = await pool.query(
        "SELECT access_token FROM facebook_contas WHERE user_id=$1", [req.userId]
      );
      if (!conta) return res.status(401).json({ error: "Meta não conectado" });

      const r = await fetch(`https://graph.facebook.com/v19.0/${req.params.id}?status=PAUSED&access_token=${conta.access_token}`, {
        method: 'POST'
      });
      const data: any = await r.json();
      if (data.error) return res.status(400).json({ error: data.error });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/marketing/campanhas/:id/reativar
  protectedRouter.post("/campanhas/:id/reativar", async (req: AuthRequest, res: Response) => {
    try {
      const { rows: [conta] } = await pool.query(
        "SELECT access_token FROM facebook_contas WHERE user_id=$1", [req.userId]
      );
      if (!conta) return res.status(401).json({ error: "Meta não conectado" });

      const r = await fetch(`https://graph.facebook.com/v19.0/${req.params.id}?status=ACTIVE&access_token=${conta.access_token}`, {
        method: 'POST'
      });
      const data: any = await r.json();
      if (data.error) return res.status(400).json({ error: data.error });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
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

  // POST /api/marketing/leads/:id/ativar-cris
  protectedRouter.post("/leads/:id/ativar-cris", async (req: AuthRequest, res: Response) => {
    try {
      const { telefone, nome, campanha } = req.body;
      const n8nWebhook = process.env.N8N_CRIS_WEBHOOK || "https://fierceparrot-n8n.cloudfy.live/webhook/cris-lead";
      await fetch(n8nWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telefone,
          nome,
          campanha,
          origem: "facebook_ads",
          mensagem_inicial: `Olá ${nome.split(" ")[0]}! Vi que você se interessou em ${campanha}. Posso te ajudar? 😊`,
        }),
      });
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
  publicRouter.get("/facebook/callback", async (req: Request, res: Response) => {
    try {
      const { code, state } = req.query as { code: string; state: string };
      if (!state) return res.status(400).send("State missing");
      const { user_id } = JSON.parse(Buffer.from(state, "base64").toString());

      const tokenRes = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?` +
        `client_id=${process.env.FACEBOOK_APP_ID}&client_secret=${process.env.FACEBOOK_APP_SECRET}` +
        `&redirect_uri=${encodeURIComponent(`${process.env.API_URL}/api/marketing/facebook/callback`)}` +
        `&code=${code}`);
      const tokenData: any = await tokenRes.json();
      
      if (tokenData.error) return res.status(400).json({ error: tokenData.error });

      const meRes = await fetch(`https://graph.facebook.com/v19.0/me?fields=name,adaccounts{name}&access_token=${tokenData.access_token}`);
      const meData: any = await meRes.json();
      const adAccount = meData.adaccounts?.data?.[0];

      await pool.query(`
        INSERT INTO facebook_contas (user_id, ad_account_id, nome_conta, access_token)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id) DO UPDATE
        SET ad_account_id=$2, nome_conta=$3, access_token=$4, atualizado_em=NOW()
      `, [user_id, adAccount?.id ?? "", meData.name, tokenData.access_token]);

      res.send(`<script>window.opener?.postMessage('meta_connected','*'); window.close();</script>`);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/marketing/webhook/leads (Verification)
  publicRouter.get("/webhook/leads", (req, res) => {
    const { "hub.mode": mode, "hub.challenge": challenge, "hub.verify_token": token } = req.query as any;
    if (mode === "subscribe" && token === "mentoark-lead-webhook") {
      return res.send(challenge);
    }
    res.status(403).send("Forbidden");
  });

  // POST /api/marketing/webhook/leads (Leads data)
  publicRouter.post("/webhook/leads", async (req, res) => {
    try {
      const { entry } = req.body;
      for (const e of entry ?? []) {
        for (const change of e.changes ?? []) {
          if (change.field !== "leadgen") continue;
          const { leadgen_id, form_id, ad_id } = change.value;
          
          const { rows } = await pool.query(
            "SELECT user_id FROM facebook_contas WHERE ad_account_id = (SELECT ad_account_id FROM facebook_campanhas WHERE id = $1 LIMIT 1)",
            [ad_id]
          );
          const user_id = rows[0]?.user_id;

          await pool.query(`
            INSERT INTO marketing_leads (user_id, meta_lead_id, campanha_id, formulario_id, status_crm)
            VALUES ($1, $2, $3, $4, 'novo')
            ON CONFLICT (meta_lead_id) DO NOTHING
          `, [user_id, leadgen_id, ad_id, form_id]);
        }
      }
      res.json({ ok: true });
    } catch (err: any) {
      console.error('Webhook error:', err);
      res.status(500).json({ message: err.message });
    }
  });

  return { protected: protectedRouter, public: publicRouter };
}
