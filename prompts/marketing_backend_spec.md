# Backend Spec — Marketing Digital (VPS Node.js)

## Arquivo: `backend/src/routes/marketing.ts`

### Endpoints a implementar

| Método | Rota | Função |
|--------|------|--------|
| GET  | `/api/marketing/facebook/status`           | Verifica se conta Meta está conectada |
| GET  | `/api/marketing/facebook/auth`             | Inicia OAuth Meta (redireciona) |
| GET  | `/api/marketing/facebook/callback`         | Recebe code OAuth e salva token |
| POST | `/api/marketing/facebook/desconectar`      | Remove token salvo |
| POST | `/api/marketing/projecao`                  | Cálculo de projeção (pode enriquecer com dados reais da conta) |
| GET  | `/api/marketing/campanhas`                 | Lista campanhas da conta Meta |
| POST | `/api/marketing/campanhas/:id/pausar`      | Pausa campanha no Meta |
| POST | `/api/marketing/campanhas/:id/reativar`    | Reativa campanha no Meta |
| GET  | `/api/marketing/leads`                     | Lista leads captados (tabela local) |
| POST | `/api/marketing/leads/:id/ativar-cris`     | Aciona n8n → Cris para o lead |
| POST | `/api/marketing/webhook/leads`             | Recebe leads do Meta (Lead Ads webhook) |

---

## Banco de dados — novas tabelas

```sql
-- Tokens OAuth por usuário (multi-tenant)
CREATE TABLE facebook_contas (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID REFERENCES usuarios(id),
  ad_account_id   TEXT NOT NULL,
  nome_conta      TEXT,
  access_token    TEXT NOT NULL,       -- criptografado
  token_expira_em TIMESTAMPTZ,
  criado_em       TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em   TIMESTAMPTZ DEFAULT NOW()
);

-- Leads capturados via Lead Ads
CREATE TABLE marketing_leads (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID REFERENCES usuarios(id),
  meta_lead_id    TEXT UNIQUE,
  nome            TEXT,
  telefone        TEXT,
  email           TEXT,
  campanha        TEXT,
  campanha_id     TEXT,
  formulario_id   TEXT,
  plataforma      TEXT DEFAULT 'facebook',
  dados_extras    JSONB DEFAULT '{}',
  status_crm      TEXT DEFAULT 'novo',  -- novo | no_crm | cris_ativada | em_atendimento
  capturado_em    TIMESTAMPTZ DEFAULT NOW()
);

-- Cache de campanhas (atualizado periodicamente)
CREATE TABLE facebook_campanhas (
  id              TEXT PRIMARY KEY,       -- id do Meta
  user_id         UUID REFERENCES usuarios(id),
  nome            TEXT,
  status          TEXT,
  objetivo        TEXT,
  plataforma      TEXT,
  orcamento_diario NUMERIC,
  orcamento_total  NUMERIC,
  inicio          DATE,
  fim             DATE,
  metricas        JSONB DEFAULT '{}',     -- impressoes, alcance, cliques, leads, gasto
  atualizado_em   TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Implementação dos endpoints principais

### 1. OAuth — Iniciar conexão

```typescript
// GET /api/marketing/facebook/auth
router.get("/facebook/auth", authMiddleware, (req, res) => {
  const state = Buffer.from(JSON.stringify({ user_id: req.user.id })).toString("base64");
  const url = new URL("https://www.facebook.com/v19.0/dialog/oauth");
  url.searchParams.set("client_id", process.env.FACEBOOK_APP_ID!);
  url.searchParams.set("redirect_uri", `${process.env.API_URL}/api/marketing/facebook/callback`);
  url.searchParams.set("scope", "ads_management,ads_read,leads_retrieval,pages_show_list,business_management");
  url.searchParams.set("state", state);
  res.redirect(url.toString());
});
```

### 2. OAuth — Callback

```typescript
// GET /api/marketing/facebook/callback
router.get("/facebook/callback", async (req, res) => {
  const { code, state } = req.query as { code: string; state: string };
  const { user_id } = JSON.parse(Buffer.from(state, "base64").toString());

  // Trocar code por access_token
  const tokenRes = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?` +
    `client_id=${process.env.FACEBOOK_APP_ID}&client_secret=${process.env.FACEBOOK_APP_SECRET}` +
    `&redirect_uri=${encodeURIComponent(`${process.env.API_URL}/api/marketing/facebook/callback`)}` +
    `&code=${code}`);
  const tokenData = await tokenRes.json();

  // Buscar nome da conta
  const meRes = await fetch(`https://graph.facebook.com/v19.0/me?fields=name,adaccounts{name}&access_token=${tokenData.access_token}`);
  const meData = await meRes.json();
  const adAccount = meData.adaccounts?.data?.[0];

  // Salvar no banco
  await pool.query(`
    INSERT INTO facebook_contas (user_id, ad_account_id, nome_conta, access_token)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (user_id) DO UPDATE
    SET ad_account_id=$2, nome_conta=$3, access_token=$4, atualizado_em=NOW()
  `, [user_id, adAccount?.id ?? "", meData.name, tokenData.access_token]);

  // Fecha a popup e recarrega o pai
  res.send(`<script>window.opener?.postMessage('meta_connected','*'); window.close();</script>`);
});
```

### 3. Status da conta

```typescript
// GET /api/marketing/facebook/status
router.get("/facebook/status", authMiddleware, async (req, res) => {
  const { rows } = await pool.query(
    "SELECT nome_conta, ad_account_id FROM facebook_contas WHERE user_id=$1",
    [req.user.id]
  );
  if (rows.length === 0) return res.json({ conectado: false });
  res.json({ conectado: true, nome_conta: rows[0].nome_conta, ad_account_id: rows[0].ad_account_id });
});
```

### 4. Listar campanhas

```typescript
// GET /api/marketing/campanhas
router.get("/campanhas", authMiddleware, async (req, res) => {
  const { rows: [conta] } = await pool.query(
    "SELECT access_token, ad_account_id FROM facebook_contas WHERE user_id=$1", [req.user.id]
  );
  if (!conta) return res.status(401).json({ error: "Meta não conectado" });

  const status = req.query.status === "ALL" ? "ACTIVE,PAUSED" : (req.query.status as string ?? "ACTIVE");
  const url = `https://graph.facebook.com/v19.0/${conta.ad_account_id}/campaigns?` +
    `fields=id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time,` +
    `insights.date_preset(last_30d){impressions,reach,clicks,ctr,cpc,spend,actions}&` +
    `effective_status=${status}&access_token=${conta.access_token}`;

  const r = await fetch(url);
  const data = await r.json();

  // Normalizar dados
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
});
```

### 5. Webhook de Lead Ads

```typescript
// GET /api/marketing/webhook/leads — verificação do Meta
router.get("/webhook/leads", (req, res) => {
  const { "hub.mode": mode, "hub.challenge": challenge, "hub.verify_token": token } = req.query as any;
  if (mode === "subscribe" && token === "mentoark-lead-webhook") {
    return res.send(challenge);
  }
  res.status(403).send("Forbidden");
});

// POST /api/marketing/webhook/leads — recebe leads
router.post("/webhook/leads", async (req, res) => {
  const { entry } = req.body;
  for (const e of entry ?? []) {
    for (const change of e.changes ?? []) {
      if (change.field !== "leadgen") continue;
      const { leadgen_id, page_id, form_id, ad_id } = change.value;

      // Buscar dados do lead pela API Meta
      // (requer token de página — buscar da tabela facebook_contas onde ad_account corresponde)
      // Simplificado: salvar apenas o id por enquanto e enriquecer depois
      await pool.query(`
        INSERT INTO marketing_leads (meta_lead_id, campanha_id, formulario_id, status_crm)
        VALUES ($1, $2, $3, 'novo')
        ON CONFLICT (meta_lead_id) DO NOTHING
      `, [leadgen_id, ad_id, form_id]);

      // Acionar Cris automaticamente (via n8n)
      // await acionarCris({ leadgen_id, form_id });
    }
  }
  res.json({ ok: true });
});
```

### 6. Ativar Cris para um lead

```typescript
// POST /api/marketing/leads/:id/ativar-cris
router.post("/leads/:id/ativar-cris", authMiddleware, async (req, res) => {
  const { telefone, nome, campanha } = req.body;
  
  // Chamar webhook n8n que aciona a Cris
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

  // Atualizar status no banco
  await pool.query(
    "UPDATE marketing_leads SET status_crm='cris_ativada' WHERE id=$1",
    [req.params.id]
  );

  res.json({ ok: true });
});
```

---

## Variáveis de ambiente a adicionar no VPS

```env
FACEBOOK_APP_ID=your_app_id
FACEBOOK_APP_SECRET=your_app_secret
N8N_CRIS_WEBHOOK=https://fierceparrot-n8n.cloudfy.live/webhook/cris-lead
API_URL=https://api.mentoark.com.br
```

---

## Notas importantes

1. **App Meta**: Criar app em https://developers.facebook.com com tipo "Business" e adicionar produto "Marketing API" e "Webhooks"
2. **Token de Longa Duração**: Trocar o token curto pelo longo via `GET /oauth/access_token?grant_type=fb_exchange_token`
3. **Webhook n8n para leads de Ads**: Criar um fluxo separado ou adaptar o webhook `/cris` para receber o campo `origem: "facebook_ads"` e personalizar a mensagem inicial da Cris
4. **CORS**: Adicionar `https://crm.mentoark.com.br` no `CORS_ORIGIN` do backend para o OAuth callback funcionar
