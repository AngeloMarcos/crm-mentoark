-- ============================================================
-- Migration: O que faltava no Supabase
-- 1. Colunas faltantes em tarefas (webhook n8n/Kanban)
-- 2. Tabela ai_providers (motor de IA)
-- 3. Tabela ai_uso_diario (dashboard de uso)
-- 4. Tabela whatsapp_instances (conexão simplificada QR)
-- ============================================================

-- ── 1. TAREFAS — colunas para o webhook n8n/Kanban ──────────
-- Campos enviados pelo n8n quando cria card automaticamente

ALTER TABLE public.tarefas
  ADD COLUMN IF NOT EXISTS contato_nome     TEXT,
  ADD COLUMN IF NOT EXISTS contato_telefone TEXT,
  ADD COLUMN IF NOT EXISTS remote_jid       TEXT,
  ADD COLUMN IF NOT EXISTS instance_name    TEXT;

-- Tornar coluna_id nullable (VPS permite null; Supabase estava NOT NULL)
ALTER TABLE public.tarefas
  ALTER COLUMN coluna_id DROP NOT NULL;

-- ── 2. AI_PROVIDERS ─────────────────────────────────────────
-- Configurações de providers de IA por usuário (Claude, OpenAI, Gemini)

CREATE TABLE IF NOT EXISTS public.ai_providers (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nome              TEXT        NOT NULL,
  slug              TEXT        NOT NULL,  -- 'claude' | 'openai' | 'gemini'
  modelo            TEXT        NOT NULL,
  api_key_enc       TEXT        NOT NULL,  -- AES-256-CBC criptografada pelo backend
  base_url          TEXT,
  suporta_visao     BOOLEAN     NOT NULL DEFAULT false,
  suporta_audio     BOOLEAN     NOT NULL DEFAULT false,
  custo_input_mtok  NUMERIC(10,6),
  custo_output_mtok NUMERIC(10,6),
  ativo             BOOLEAN     NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_ai_provider_user_slug UNIQUE (user_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_ai_providers_user ON public.ai_providers(user_id);

ALTER TABLE public.ai_providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_providers_owner ON public.ai_providers
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_providers TO authenticated;
GRANT ALL ON public.ai_providers TO service_role;

-- Trigger updated_at
CREATE TRIGGER trg_ai_providers_upd
  BEFORE UPDATE ON public.ai_providers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 3. AI_USO_DIARIO ─────────────────────────────────────────
-- Registro diário de uso e custo por provider/modelo

CREATE TABLE IF NOT EXISTS public.ai_uso_diario (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_slug    TEXT        NOT NULL,
  modelo           TEXT        NOT NULL,
  data             DATE        NOT NULL DEFAULT CURRENT_DATE,
  total_mensagens  INTEGER     NOT NULL DEFAULT 0,
  tokens_entrada   BIGINT      NOT NULL DEFAULT 0,
  tokens_saida     BIGINT      NOT NULL DEFAULT 0,
  custo_usd        NUMERIC(12,6) NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_uso_diario UNIQUE (user_id, provider_slug, modelo, data)
);

CREATE INDEX IF NOT EXISTS idx_ai_uso_user_data
  ON public.ai_uso_diario(user_id, data DESC);

ALTER TABLE public.ai_uso_diario ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_uso_owner ON public.ai_uso_diario
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_uso_diario TO authenticated;
GRANT ALL ON public.ai_uso_diario TO service_role;

CREATE TRIGGER trg_ai_uso_diario_upd
  BEFORE UPDATE ON public.ai_uso_diario
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- View: uso dos últimos 30 dias
CREATE OR REPLACE VIEW public.vw_ai_uso_30d AS
SELECT
  user_id,
  provider_slug,
  modelo,
  SUM(total_mensagens)::int     AS total_mensagens,
  SUM(tokens_entrada)::bigint   AS tokens_entrada,
  SUM(tokens_saida)::bigint     AS tokens_saida,
  SUM(custo_usd)                AS custo_usd
FROM public.ai_uso_diario
WHERE data >= CURRENT_DATE - 30
GROUP BY user_id, provider_slug, modelo;

GRANT SELECT ON public.vw_ai_uso_30d TO authenticated, service_role;

-- ── 4. WHATSAPP_INSTANCES ────────────────────────────────────
-- Instâncias WhatsApp conectadas por usuário (fluxo QR simplificado)
-- O cliente só vê nome + número; URL/API Key ficam no backend (.env)

CREATE TABLE IF NOT EXISTS public.whatsapp_instances (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nome            TEXT        NOT NULL,                    -- "Vendas", "Suporte"
  numero          TEXT,                                    -- +5511999999999 (mascarado no front)
  instance_name   TEXT        NOT NULL,                    -- slug gerado pelo backend
  status          TEXT        NOT NULL DEFAULT 'pendente', -- pendente | conectado | desconectado | erro
  qr_code         TEXT,                                    -- base64 do QR (temporário)
  pairing_code    TEXT,                                    -- código de pareamento (temporário)
  qr_expires_at   TIMESTAMPTZ,                             -- QR expira em 60s
  conectado_em    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_instance_name UNIQUE (instance_name),
  CONSTRAINT uq_user_nome     UNIQUE (user_id, nome)
);

CREATE INDEX IF NOT EXISTS idx_wa_instances_user
  ON public.whatsapp_instances(user_id, status);

ALTER TABLE public.whatsapp_instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY wa_instances_owner ON public.whatsapp_instances
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_instances TO authenticated;
GRANT ALL ON public.whatsapp_instances TO service_role;

CREATE TRIGGER trg_wa_instances_upd
  BEFORE UPDATE ON public.whatsapp_instances
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 5. AGENTES — coluna provider_id ─────────────────────────
-- Ligar agente ao provider de IA configurado

ALTER TABLE public.agentes
  ADD COLUMN IF NOT EXISTS provider_id UUID REFERENCES public.ai_providers(id) ON DELETE SET NULL;

-- ── 6. VERIFICAÇÃO FINAL ─────────────────────────────────────
-- Rodar para confirmar que tudo foi criado:

SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'ai_providers', 'ai_uso_diario', 'whatsapp_instances',
    'tarefas', 'equipes', 'equipe_membros', 'kanban_colunas',
    'sub_perfis', 'tarefa_comentarios'
  )
ORDER BY tablename;
