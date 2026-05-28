-- =============================================
-- Placeholder for AI Conversations (referenced by tasks)
-- =============================================
CREATE TABLE IF NOT EXISTS ai_conversas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  contato_id  UUID REFERENCES contatos(id) ON DELETE CASCADE,
  titulo      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_conversas TO authenticated, service_role;
ALTER TABLE public.ai_conversas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own conversations" ON ai_conversas FOR ALL TO authenticated USING (user_id = auth.uid());

-- =============================================
-- SUB-PERFIS (acesso restrito por módulo)
-- =============================================
CREATE TABLE IF NOT EXISTS sub_perfis (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,  -- quem criou (admin/gerente)
  membro_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,          -- usuário vinculado
  nome          TEXT NOT NULL,
  email         TEXT NOT NULL,
  senha_temp    TEXT,                        -- senha inicial (hash bcrypt), apagar após 1º login
  avatar_cor    TEXT DEFAULT '#6366f1',      -- cor do avatar
  modulos       TEXT[] NOT NULL DEFAULT '{}', -- ex: ['kanban','mensagens','leads']
  ativo         BOOLEAN NOT NULL DEFAULT true,
  primeiro_acesso BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_subperfil_email UNIQUE (user_id, email)
);

-- =============================================
-- COLUNAS DO KANBAN
-- =============================================
CREATE TABLE IF NOT EXISTS kanban_colunas (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nome       TEXT NOT NULL,
  ordem      INT  NOT NULL DEFAULT 0,
  cor        TEXT DEFAULT '#e2e8f0',
  limite_wip INT  DEFAULT NULL,              -- Work In Progress limit (NULL = sem limite)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_coluna_ordem UNIQUE (user_id, ordem)
);

-- =============================================
-- TAREFAS (cards do Kanban)
-- =============================================
-- We drop the existing empty table to recreate it with the new schema
DROP TABLE IF EXISTS tarefas CASCADE;

CREATE TABLE IF NOT EXISTS tarefas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  coluna_id       UUID NOT NULL REFERENCES kanban_colunas(id) ON DELETE RESTRICT,
  titulo          TEXT NOT NULL,
  descricao       TEXT,
  resumo_ia       TEXT,                      -- resumo gerado automaticamente pela IA
  prioridade      TEXT NOT NULL DEFAULT 'media',  -- baixa | media | alta | urgente
  ordem           INT  NOT NULL DEFAULT 0,   -- posição dentro da coluna
  atribuido_a     UUID REFERENCES auth.users(id) ON DELETE SET NULL,  -- membro responsável
  sub_perfil_id   UUID REFERENCES sub_perfis(id) ON DELETE SET NULL,
  contato_id      UUID REFERENCES contatos(id) ON DELETE SET NULL,
  conversa_id     UUID REFERENCES ai_conversas(id) ON DELETE SET NULL,
  lead_id         UUID,
  tags            TEXT[] DEFAULT '{}',
  data_limite     DATE,
  concluida_em    TIMESTAMPTZ,
  criada_por      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  origem          TEXT DEFAULT 'manual',     -- manual | ia | whatsapp | sistema
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================
-- COMENTÁRIOS NAS TAREFAS
-- =============================================
CREATE TABLE IF NOT EXISTS tarefa_comentarios (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tarefa_id  UUID NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conteudo   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================
-- ÍNDICES
-- =============================================
CREATE INDEX IF NOT EXISTS idx_tarefas_user_coluna  ON tarefas (user_id, coluna_id, ordem);
CREATE INDEX IF NOT EXISTS idx_tarefas_atribuido     ON tarefas (atribuido_a) WHERE atribuido_a IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tarefas_contato       ON tarefas (contato_id) WHERE contato_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_subperfis_membro      ON sub_perfis (membro_id) WHERE membro_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_comentarios_tarefa    ON tarefa_comentarios (tarefa_id, created_at);

-- =============================================
-- RLS (multi-tenant)
-- =============================================
ALTER TABLE sub_perfis         ENABLE ROW LEVEL SECURITY;
ALTER TABLE kanban_colunas     ENABLE ROW LEVEL SECURITY;
ALTER TABLE tarefas            ENABLE ROW LEVEL SECURITY;
ALTER TABLE tarefa_comentarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY sp_owner ON sub_perfis
  FOR ALL TO authenticated USING (user_id = auth.uid() OR membro_id = auth.uid());

CREATE POLICY kc_owner ON kanban_colunas
  FOR ALL TO authenticated USING (user_id = auth.uid());

CREATE POLICY t_owner ON tarefas
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR atribuido_a = auth.uid());

CREATE POLICY tc_owner ON tarefa_comentarios
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR tarefa_id IN (
    SELECT id FROM tarefas WHERE user_id = auth.uid() OR atribuido_a = auth.uid()
  ));

GRANT SELECT,INSERT,UPDATE,DELETE ON
  sub_perfis, kanban_colunas, tarefas, tarefa_comentarios
TO authenticated, service_role;

-- Trigger updated_at
CREATE TRIGGER trg_subperfis_upd  BEFORE UPDATE ON sub_perfis  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_tarefas_upd    BEFORE UPDATE ON tarefas      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_ai_conversas_upd BEFORE UPDATE ON ai_conversas FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();