-- ============================================================
-- SPRINT 11 — TABELA WORKFLOWS + ENDPOINTS SEGURANÇA
-- Rodar no pgAdmin (147.93.9.172 / db: crm)
-- ============================================================

-- 1) Tabela workflows (persistência do builder visual)
CREATE TABLE IF NOT EXISTS public.workflows (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,
  nome        text NOT NULL,
  descricao   text,
  nodes       jsonb NOT NULL DEFAULT '[]'::jsonb,
  edges       jsonb NOT NULL DEFAULT '[]'::jsonb,
  ativo       boolean NOT NULL DEFAULT false,
  n8n_webhook text,                     -- URL do webhook n8n que executa este workflow
  ultima_exec timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflows_user ON public.workflows(user_id);
CREATE INDEX IF NOT EXISTS idx_workflows_ativo ON public.workflows(user_id, ativo);

-- 2) Verificação
SELECT 'workflows criada' AS status, COUNT(*) AS registros FROM public.workflows;
