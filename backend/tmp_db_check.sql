-- Verificação 1: 10 tabelas novas
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN (
  'respostas_rapidas','tags','funil_estagios','listas',
  'chamadas','timeline_eventos','tarefas','dados_cliente',
  'chat_messages','follow_ups'
)
ORDER BY table_name;

-- Verificação 2: colunas SLA no agentes
SELECT column_name FROM information_schema.columns
WHERE table_name = 'agentes' AND column_name LIKE 'sla_%'
ORDER BY column_name;
