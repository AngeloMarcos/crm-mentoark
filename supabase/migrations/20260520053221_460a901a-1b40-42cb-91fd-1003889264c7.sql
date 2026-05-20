-- Tokens OAuth por usuário (multi-tenant)
CREATE TABLE IF NOT EXISTS public.facebook_contas (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID NOT NULL UNIQUE,
  ad_account_id   TEXT NOT NULL,
  nome_conta      TEXT,
  access_token    TEXT NOT NULL,
  token_expira_em TIMESTAMPTZ,
  criado_em       TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em   TIMESTAMPTZ DEFAULT NOW()
);

-- Leads capturados via Lead Ads
CREATE TABLE IF NOT EXISTS public.marketing_leads (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID,
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

-- Cache de campanhas
CREATE TABLE IF NOT EXISTS public.facebook_campanhas (
  id              TEXT PRIMARY KEY,       -- id do Meta
  user_id         UUID,
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

-- Enable Row Level Security
ALTER TABLE public.facebook_contas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facebook_campanhas ENABLE ROW LEVEL SECURITY;

-- Create policies (allowing the authenticated user to manage their own data)
CREATE POLICY "Users can manage their own facebook accounts" 
ON public.facebook_contas 
FOR ALL 
USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own marketing leads" 
ON public.marketing_leads 
FOR ALL 
USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own facebook campaigns" 
ON public.facebook_campanhas 
FOR ALL 
USING (auth.uid() = user_id);
