-- ============================================================
-- MIGRATION: Multi-Tenant Security Hardening
-- Execute no pgAdmin: 147.93.9.172:5432 / db crm
-- ============================================================

-- ── 1. Garantir tabela de deduplicação de webhooks ───────────
CREATE TABLE IF NOT EXISTS webhook_mensagens_processadas (
  id          TEXT PRIMARY KEY,
  instancia   TEXT,
  telefone    TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webhook_proc_created
  ON webhook_mensagens_processadas(created_at);

-- ── 2. Índices de performance multi-tenant ───────────────────
-- n8n_chat_histories
CREATE INDEX IF NOT EXISTS idx_n8n_chat_uid_session
  ON n8n_chat_histories(user_id, session_id);
CREATE INDEX IF NOT EXISTS idx_n8n_chat_uid_created
  ON n8n_chat_histories(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_n8n_chat_session_created
  ON n8n_chat_histories(session_id, created_at ASC);

-- agent_prompts
CREATE INDEX IF NOT EXISTS idx_agent_prompts_uid_ativo
  ON agent_prompts(user_id, ativo);

-- agentes
CREATE INDEX IF NOT EXISTS idx_agentes_uid_ativo
  ON agentes(user_id, ativo);
CREATE INDEX IF NOT EXISTS idx_agentes_instancia_uid
  ON agentes(evolution_instancia, user_id) WHERE evolution_instancia IS NOT NULL;

-- contatos
CREATE INDEX IF NOT EXISTS idx_contatos_uid_status
  ON contatos(user_id, status);
CREATE INDEX IF NOT EXISTS idx_contatos_uid_telefone
  ON contatos(user_id, telefone);

-- conhecimento
CREATE INDEX IF NOT EXISTS idx_conhecimento_uid_tipo
  ON conhecimento(user_id, tipo);

-- disparo_logs
CREATE INDEX IF NOT EXISTS idx_disparo_logs_uid_status
  ON disparo_logs(user_id, status);

-- integracoes_config
CREATE INDEX IF NOT EXISTS idx_integracoes_uid_tipo
  ON integracoes_config(user_id, tipo);

-- catalogos / produtos
CREATE INDEX IF NOT EXISTS idx_catalogos_uid_ativo
  ON catalogos(user_id, ativo);
CREATE INDEX IF NOT EXISTS idx_produtos_uid_catalogo
  ON produtos(user_id, catalogo_id);

-- galeria_imagens
CREATE INDEX IF NOT EXISTS idx_galeria_uid_created
  ON galeria_imagens(user_id, created_at DESC);

-- ── 3. DIAGNÓSTICO: Registros com user_id NULL ───────────────
-- Resultado esperado: 0 em todas as linhas
SELECT 'chat_messages'       AS tabela, COUNT(*) AS nulls FROM chat_messages       WHERE user_id IS NULL
UNION ALL
SELECT 'chats',                          COUNT(*) FROM chats                        WHERE user_id IS NULL
UNION ALL
SELECT 'dados_cliente',                  COUNT(*) FROM dados_cliente               WHERE user_id IS NULL
UNION ALL
SELECT 'n8n_chat_histories',             COUNT(*) FROM n8n_chat_histories           WHERE user_id IS NULL
UNION ALL
SELECT 'agent_prompts',                  COUNT(*) FROM agent_prompts               WHERE user_id IS NULL
UNION ALL
SELECT 'agentes',                        COUNT(*) FROM agentes                     WHERE user_id IS NULL
UNION ALL
SELECT 'conhecimento',                   COUNT(*) FROM conhecimento                WHERE user_id IS NULL
UNION ALL
SELECT 'contatos',                       COUNT(*) FROM contatos                    WHERE user_id IS NULL
UNION ALL
SELECT 'integracoes_config',             COUNT(*) FROM integracoes_config          WHERE user_id IS NULL;

-- ── 4. DIAGNÓSTICO: Tabelas existentes ───────────────────────
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN (
  'disparos','campanhas','disparo_logs','listas','tarefas','chamadas',
  'timeline_eventos','agentes','conhecimento','integracoes_config',
  'catalogos','produtos','produto_imagens','dados_cliente',
  'chat_messages','chats','contatos','agent_prompts',
  'documents','n8n_chat_histories','galeria_imagens',
  'user_modulos','users','webhook_mensagens_processadas'
)
ORDER BY table_name;

-- ── 5. DIAGNÓSTICO: Instâncias Evolution duplicadas ──────────
-- Se retornar linhas, dois tenants estão usando a mesma instância (CRÍTICO)
SELECT evolution_instancia, COUNT(*) AS qtd, array_agg(user_id::text) AS users
FROM agentes
WHERE evolution_instancia IS NOT NULL AND evolution_instancia <> ''
  AND ativo = true
GROUP BY evolution_instancia
HAVING COUNT(*) > 1;

-- ── 6. DIAGNÓSTICO: Dados por usuário ────────────────────────
SELECT
  u.email,
  u.role,
  u.created_at::date AS criado_em,
  (SELECT COUNT(*) FROM contatos        c WHERE c.user_id = u.id) AS contatos,
  (SELECT COUNT(*) FROM agentes         a WHERE a.user_id = u.id) AS agentes,
  (SELECT COUNT(*) FROM agent_prompts  ap WHERE ap.user_id = u.id) AS prompts,
  (SELECT COUNT(*) FROM conhecimento    k WHERE k.user_id = u.id) AS conhecimentos,
  (SELECT COUNT(*) FROM n8n_chat_histories h WHERE h.user_id = u.id) AS msgs_historico,
  (SELECT COUNT(*) FROM integracoes_config ic WHERE ic.user_id = u.id) AS integracoes,
  (SELECT COUNT(*) FROM catalogos       cat WHERE cat.user_id = u.id) AS catalogos
FROM users u
ORDER BY u.created_at;

-- ── 7. Auto-limpeza de webhook_mensagens_processadas ─────────
-- Remove registros com mais de 48h (evitar crescimento infinito da tabela)
DELETE FROM webhook_mensagens_processadas
WHERE created_at < NOW() - INTERVAL '48 hours';
