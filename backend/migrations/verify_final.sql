-- Ferramentas MCP
SELECT slug, nome, categoria FROM ai_mcp_ferramentas ORDER BY categoria, slug;

-- Colunas motor IA em agentes
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'agentes'
  AND column_name IN ('provider_id','modelo','temperatura','max_tokens','system_prompt','ativo_motor','multimodal','pausa_minutos','configuracoes')
ORDER BY column_name;

-- Índices criados
SELECT indexname, tablename FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('tarefas','whatsapp_messages','ai_conversas','kanban_colunas','equipes','equipe_membros','equipe_chat')
ORDER BY tablename, indexname;

-- Triggers ativos
SELECT trigger_name, event_object_table AS tabela, event_manipulation AS evento
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY tabela, trigger_name;

-- Contagem geral de objetos
SELECT
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE') AS tabelas,
  (SELECT COUNT(*) FROM information_schema.views WHERE table_schema='public') AS views,
  (SELECT COUNT(*) FROM pg_indexes WHERE schemaname='public') AS indices,
  (SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema='public') AS triggers;
