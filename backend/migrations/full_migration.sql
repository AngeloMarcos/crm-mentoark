-- ============================================================
-- MIGRATIONS COMPLETAS — CRM Mentoark (PostgreSQL standalone)
-- Adaptado: sem auth.uid() / sem roles Supabase
-- Idempotente — pode rodar múltiplas vezes
-- ============================================================

-- ── 001: Correções e estrutura base ─────────────────────────

DROP INDEX IF EXISTS idx_users_email;
DROP INDEX IF EXISTS idx_users_email_unique;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email ON users(email);

CREATE TABLE IF NOT EXISTS workflows (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nome        TEXT NOT NULL,
  descricao   TEXT,
  ativo       BOOLEAN NOT NULL DEFAULT true,
  nodes       JSONB NOT NULL DEFAULT '[]',
  edges       JSONB NOT NULL DEFAULT '[]',
  n8n_id      TEXT,
  n8n_url     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_workflows_user ON workflows(user_id);

-- ── 002: Histórico WhatsApp ──────────────────────────────────

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  instance_name   TEXT        NOT NULL,
  remote_jid      TEXT        NOT NULL,
  message_id      TEXT        NOT NULL,
  from_me         BOOLEAN     NOT NULL DEFAULT false,
  message_type    TEXT        NOT NULL DEFAULT 'text',
  content         TEXT,
  media_url       TEXT,
  media_mimetype  TEXT,
  quoted_id       TEXT,
  status          TEXT        NOT NULL DEFAULT 'received',
  agent_id        UUID,
  metadata        JSONB       NOT NULL DEFAULT '{}',
  timestamp_wa    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_whatsapp_message UNIQUE (message_id, instance_name)
);
CREATE INDEX IF NOT EXISTS idx_wa_messages_conversation
  ON whatsapp_messages (user_id, remote_jid, timestamp_wa DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_wa_messages_instance
  ON whatsapp_messages (user_id, instance_name, created_at DESC);

CREATE OR REPLACE FUNCTION get_conversation_history(
  p_user_id UUID, p_remote_jid TEXT,
  p_instance TEXT DEFAULT NULL, p_limit INT DEFAULT 20
) RETURNS TABLE (role TEXT, content TEXT, timestamp_wa TIMESTAMPTZ, message_type TEXT)
LANGUAGE sql STABLE AS $$
  SELECT
    CASE WHEN from_me THEN 'assistant' ELSE 'user' END,
    coalesce(content, '[' || message_type || ']'),
    timestamp_wa, message_type
  FROM whatsapp_messages
  WHERE user_id = p_user_id AND remote_jid = p_remote_jid
    AND (p_instance IS NULL OR instance_name = p_instance)
    AND content IS NOT NULL AND message_type = 'text'
  ORDER BY timestamp_wa ASC NULLS LAST LIMIT p_limit;
$$;

-- ── 003: Motor de IA ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_providers (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nome              TEXT        NOT NULL,
  slug              TEXT        NOT NULL,
  modelo            TEXT        NOT NULL,
  api_key_enc       TEXT,
  base_url          TEXT,
  suporta_visao     BOOLEAN     NOT NULL DEFAULT false,
  suporta_audio     BOOLEAN     NOT NULL DEFAULT false,
  ativo             BOOLEAN     NOT NULL DEFAULT true,
  custo_input_mtok  NUMERIC(10,6) DEFAULT 0,
  custo_output_mtok NUMERIC(10,6) DEFAULT 0,
  configuracoes     JSONB       NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_provider_user_slug UNIQUE (user_id, slug)
);

CREATE TABLE IF NOT EXISTS ai_mcp_ferramentas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT NOT NULL UNIQUE,
  nome        TEXT NOT NULL,
  descricao   TEXT NOT NULL,
  categoria   TEXT NOT NULL DEFAULT 'crm',
  parametros  JSONB NOT NULL DEFAULT '{}',
  requer_confirmacao BOOLEAN NOT NULL DEFAULT false,
  ativo       BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO ai_mcp_ferramentas (slug, nome, descricao, categoria, parametros) VALUES
('buscar_contato','Buscar Contato','Busca contato pelo WhatsApp ou nome','crm','{"type":"object","properties":{"telefone":{"type":"string"},"nome":{"type":"string"}}}'::jsonb),
('criar_contato','Criar Contato','Cria novo contato no CRM','crm','{"type":"object","required":["nome","telefone"],"properties":{"nome":{"type":"string"},"telefone":{"type":"string"},"email":{"type":"string"}}}'::jsonb),
('buscar_historico','Buscar Histórico','Últimas mensagens da conversa','crm','{"type":"object","required":["remote_jid"],"properties":{"remote_jid":{"type":"string"},"limite":{"type":"integer"}}}'::jsonb),
('criar_lead','Criar Lead','Cria lead no funil','crm','{"type":"object","required":["nome","telefone"],"properties":{"nome":{"type":"string"},"telefone":{"type":"string"},"etapa":{"type":"string"}}}'::jsonb),
('atualizar_lead','Atualizar Lead','Move lead no funil','crm','{"type":"object","required":["lead_id"],"properties":{"lead_id":{"type":"string"},"etapa":{"type":"string"},"status":{"type":"string"}}}'::jsonb),
('buscar_produtos','Buscar Imóveis','Busca imóveis no catálogo','crm','{"type":"object","properties":{"tipo":{"type":"string"},"preco_max":{"type":"number"},"quartos":{"type":"integer"}}}'::jsonb),
('criar_agendamento','Criar Agendamento','Agenda visita ou reunião','agenda','{"type":"object","required":["contato_id","data"],"properties":{"contato_id":{"type":"string"},"data":{"type":"string"}}}'::jsonb),
('registrar_pausa','Pausar IA','Pausa o atendimento automático','crm','{"type":"object","required":["remote_jid"],"properties":{"remote_jid":{"type":"string"},"motivo":{"type":"string"}}}'::jsonb)
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS ai_agente_ferramentas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agente_id       UUID NOT NULL REFERENCES agentes(id) ON DELETE CASCADE,
  ferramenta_slug TEXT NOT NULL REFERENCES ai_mcp_ferramentas(slug) ON DELETE CASCADE,
  habilitada      BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_agente_ferramenta UNIQUE (agente_id, ferramenta_slug)
);

CREATE TABLE IF NOT EXISTS ai_conversas (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agente_id       UUID,
  instance_name   TEXT        NOT NULL,
  remote_jid      TEXT        NOT NULL,
  pausa_ia        BOOLEAN     NOT NULL DEFAULT false,
  pausa_motivo    TEXT,
  pausa_ate       TIMESTAMPTZ,
  ultima_mensagem TIMESTAMPTZ,
  total_mensagens INT         NOT NULL DEFAULT 0,
  contexto_extra  JSONB       NOT NULL DEFAULT '{}',
  status          TEXT        NOT NULL DEFAULT 'ativa',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_conversa UNIQUE (user_id, instance_name, remote_jid)
);
CREATE INDEX IF NOT EXISTS idx_ai_conversas_user_jid ON ai_conversas (user_id, remote_jid);
CREATE INDEX IF NOT EXISTS idx_ai_conversas_pausa    ON ai_conversas (user_id, pausa_ia) WHERE pausa_ia = true;

CREATE TABLE IF NOT EXISTS ai_mensagens (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversa_id     UUID        NOT NULL REFERENCES ai_conversas(id) ON DELETE CASCADE,
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wa_message_id   TEXT,
  direcao         TEXT        NOT NULL,
  modalidade      TEXT        NOT NULL DEFAULT 'text',
  conteudo_raw    TEXT,
  conteudo_ia     TEXT,
  tokens_entrada  INT         DEFAULT 0,
  tokens_saida    INT         DEFAULT 0,
  custo_usd       NUMERIC(12,8) DEFAULT 0,
  latencia_ms     INT,
  provider_usado  TEXT,
  modelo_usado    TEXT,
  tool_calls      JSONB       DEFAULT '[]',
  status          TEXT        NOT NULL DEFAULT 'processado',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_mensagens_conversa ON ai_mensagens (conversa_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_uso_diario (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data            DATE        NOT NULL DEFAULT CURRENT_DATE,
  provider_slug   TEXT        NOT NULL,
  modelo          TEXT        NOT NULL,
  total_mensagens INT         NOT NULL DEFAULT 0,
  tokens_entrada  BIGINT      NOT NULL DEFAULT 0,
  tokens_saida    BIGINT      NOT NULL DEFAULT 0,
  custo_usd       NUMERIC(12,6) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_uso_diario UNIQUE (user_id, data, provider_slug, modelo)
);

CREATE TABLE IF NOT EXISTS ai_fila (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversa_id     UUID        REFERENCES ai_conversas(id) ON DELETE SET NULL,
  wa_message_id   TEXT        NOT NULL,
  instance_name   TEXT        NOT NULL,
  remote_jid      TEXT        NOT NULL,
  tipo            TEXT        NOT NULL,
  media_url       TEXT,
  media_mimetype  TEXT,
  conteudo_texto  TEXT,
  status          TEXT        NOT NULL DEFAULT 'pendente',
  tentativas      INT         NOT NULL DEFAULT 0,
  max_tentativas  INT         NOT NULL DEFAULT 3,
  erro_msg        TEXT,
  processar_apos  TIMESTAMPTZ NOT NULL DEFAULT now(),
  concluido_em    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_fila_pendente ON ai_fila (processar_apos, status)
  WHERE status IN ('pendente', 'erro');

CREATE TABLE IF NOT EXISTS ai_webhooks_log (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        REFERENCES users(id) ON DELETE SET NULL,
  instance_name TEXT,
  evento        TEXT,
  remote_jid    TEXT,
  payload       JSONB       NOT NULL DEFAULT '{}',
  processado    BOOLEAN     NOT NULL DEFAULT false,
  erro          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webhooks_log_instance ON ai_webhooks_log (instance_name, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_prompts (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nome        TEXT        NOT NULL,
  descricao   TEXT,
  conteudo    TEXT        NOT NULL,
  categoria   TEXT        DEFAULT 'geral',
  usado_em    INT         NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE agentes ADD COLUMN IF NOT EXISTS provider_id    UUID;
ALTER TABLE agentes ADD COLUMN IF NOT EXISTS modelo         TEXT;
ALTER TABLE agentes ADD COLUMN IF NOT EXISTS temperatura    NUMERIC(3,2) DEFAULT 0.7;
ALTER TABLE agentes ADD COLUMN IF NOT EXISTS max_tokens     INT DEFAULT 4096;
ALTER TABLE agentes ADD COLUMN IF NOT EXISTS system_prompt  TEXT;
ALTER TABLE agentes ADD COLUMN IF NOT EXISTS pausa_minutos  INT DEFAULT 30;
ALTER TABLE agentes ADD COLUMN IF NOT EXISTS multimodal     BOOLEAN DEFAULT true;
ALTER TABLE agentes ADD COLUMN IF NOT EXISTS ativo_motor    BOOLEAN DEFAULT false;
ALTER TABLE agentes ADD COLUMN IF NOT EXISTS configuracoes  JSONB DEFAULT '{}';

-- ── 004: Kanban e Sub-perfis ─────────────────────────────────

CREATE TABLE IF NOT EXISTS kanban_colunas (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nome       TEXT NOT NULL,
  ordem      INT  NOT NULL DEFAULT 0,
  cor        TEXT DEFAULT '#e2e8f0',
  limite_wip INT  DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kanban_colunas_user ON kanban_colunas (user_id, ordem);

CREATE TABLE IF NOT EXISTS tarefas (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  coluna_id        UUID REFERENCES kanban_colunas(id) ON DELETE SET NULL,
  titulo           TEXT NOT NULL,
  descricao        TEXT,
  resumo_ia        TEXT,
  prioridade       TEXT NOT NULL DEFAULT 'media',
  ordem            INT  NOT NULL DEFAULT 0,
  atribuido_a      UUID REFERENCES users(id) ON DELETE SET NULL,
  contato_nome     TEXT,
  contato_telefone TEXT,
  remote_jid       TEXT,
  instance_name    TEXT,
  conversa_id      TEXT,
  origem           TEXT DEFAULT 'manual',
  tags             TEXT[] DEFAULT '{}',
  data_limite      DATE,
  concluida_em     TIMESTAMPTZ,
  sub_perfil_id    UUID,
  contato_id       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tarefas_user_coluna ON tarefas (user_id, coluna_id, ordem);
CREATE INDEX IF NOT EXISTS idx_tarefas_atribuido   ON tarefas (atribuido_a) WHERE atribuido_a IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tarefas_origem      ON tarefas (user_id, origem, created_at DESC);

CREATE TABLE IF NOT EXISTS tarefa_comentarios (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tarefa_id  UUID NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conteudo   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comentarios_tarefa ON tarefa_comentarios (tarefa_id, created_at);

CREATE TABLE IF NOT EXISTS sub_perfis (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  membro_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  nome            TEXT NOT NULL,
  email           TEXT NOT NULL,
  senha_hash      TEXT,
  modulos         TEXT[] NOT NULL DEFAULT '{"kanban"}',
  avatar_cor      TEXT DEFAULT '#6366f1',
  ativo           BOOLEAN NOT NULL DEFAULT true,
  primeiro_acesso BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_subperfil_email UNIQUE (user_id, email)
);
CREATE INDEX IF NOT EXISTS idx_subperfis_membro ON sub_perfis (membro_id) WHERE membro_id IS NOT NULL;

-- ── 005: Equipe e Chat ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS equipes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome       TEXT NOT NULL,
  owner_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_equipes_owner ON equipes (owner_id);

CREATE TABLE IF NOT EXISTS equipe_membros (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipe_id     UUID NOT NULL REFERENCES equipes(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT 'membro',
  convidado_por UUID REFERENCES users(id),
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_equipe_membro UNIQUE (equipe_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_equipe_membros_equipe ON equipe_membros (equipe_id);
CREATE INDEX IF NOT EXISTS idx_equipe_membros_user   ON equipe_membros (user_id);

CREATE TABLE IF NOT EXISTS equipe_chat (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipe_id  UUID NOT NULL REFERENCES equipes(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  conteudo   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_equipe_chat ON equipe_chat (equipe_id, created_at DESC);

-- ── 006: Triggers updated_at ────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'workflows','whatsapp_messages','ai_providers','ai_conversas',
    'ai_uso_diario','ai_fila','ai_prompts',
    'tarefas','sub_perfis','equipes'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_upd ON %I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_upd BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()',
      t, t
    );
  END LOOP;
END; $$;

-- ── 007: Views úteis ────────────────────────────────────────

CREATE OR REPLACE VIEW vw_conversas_ativas AS
SELECT c.*, a.nome AS agente_nome
FROM ai_conversas c
LEFT JOIN agentes a ON a.id = c.agente_id
WHERE c.status = 'ativa';

CREATE OR REPLACE VIEW vw_ai_uso_30d AS
SELECT user_id, provider_slug, modelo,
  SUM(total_mensagens) AS total_mensagens,
  SUM(tokens_entrada)  AS tokens_entrada,
  SUM(tokens_saida)    AS tokens_saida,
  SUM(custo_usd)       AS custo_usd_total
FROM ai_uso_diario
WHERE data >= CURRENT_DATE - 30
GROUP BY user_id, provider_slug, modelo;

CREATE OR REPLACE VIEW vw_ai_fila_pendente AS
SELECT *, EXTRACT(EPOCH FROM (now() - created_at)) / 60 AS minutos_aguardando
FROM ai_fila
WHERE status IN ('pendente', 'erro')
  AND tentativas < max_tentativas
  AND processar_apos <= now()
ORDER BY processar_apos ASC;

-- ── 008: Trigger custo diário ───────────────────────────────

CREATE OR REPLACE FUNCTION fn_atualizar_uso_diario()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.direcao = 'saida' AND NEW.status = 'processado' THEN
    INSERT INTO ai_uso_diario
      (user_id, data, provider_slug, modelo, total_mensagens, tokens_entrada, tokens_saida, custo_usd)
    VALUES
      (NEW.user_id, CURRENT_DATE,
       COALESCE(NEW.provider_usado,'unknown'), COALESCE(NEW.modelo_usado,'unknown'),
       1, COALESCE(NEW.tokens_entrada,0), COALESCE(NEW.tokens_saida,0), COALESCE(NEW.custo_usd,0))
    ON CONFLICT (user_id, data, provider_slug, modelo) DO UPDATE SET
      total_mensagens = ai_uso_diario.total_mensagens + 1,
      tokens_entrada  = ai_uso_diario.tokens_entrada  + EXCLUDED.tokens_entrada,
      tokens_saida    = ai_uso_diario.tokens_saida    + EXCLUDED.tokens_saida,
      custo_usd       = ai_uso_diario.custo_usd       + EXCLUDED.custo_usd,
      updated_at      = now();
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_uso_diario ON ai_mensagens;
CREATE TRIGGER trg_uso_diario
  AFTER INSERT ON ai_mensagens
  FOR EACH ROW EXECUTE FUNCTION fn_atualizar_uso_diario();

-- ── VERIFICAÇÃO FINAL ────────────────────────────────────────

SELECT table_name,
       pg_size_pretty(pg_total_relation_size(quote_ident(table_name))) AS tamanho
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
  AND table_name IN (
    'workflows','whatsapp_messages','ai_providers','ai_mcp_ferramentas',
    'ai_agente_ferramentas','ai_conversas','ai_mensagens','ai_uso_diario',
    'ai_fila','ai_webhooks_log','ai_prompts','kanban_colunas','tarefas',
    'tarefa_comentarios','sub_perfis','equipes','equipe_membros','equipe_chat'
  )
ORDER BY table_name;

SELECT slug, nome, categoria FROM ai_mcp_ferramentas ORDER BY categoria, slug;

SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'agentes'
  AND column_name IN ('provider_id','modelo','temperatura','max_tokens','system_prompt','ativo_motor')
ORDER BY column_name;
