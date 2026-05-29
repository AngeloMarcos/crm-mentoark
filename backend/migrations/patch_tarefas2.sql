-- Patch 2: colunas restantes em tarefas usadas pelo Kanban
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS ordem       INT  NOT NULL DEFAULT 0;
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS resumo_ia   TEXT;
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS criada_por  UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ NOT NULL DEFAULT now();

-- Índice com ordem
CREATE INDEX IF NOT EXISTS idx_tarefas_kanban ON tarefas (user_id, coluna_id, ordem);

-- Verificação final das 18 tabelas
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
