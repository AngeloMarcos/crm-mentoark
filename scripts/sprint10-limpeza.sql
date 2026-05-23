-- ============================================================
-- SPRINT 10 — Limpeza e otimização final
-- Banco: Postgres 147.93.9.172/crm
-- Como rodar (na VPS):
--   docker exec -i crm-api psql "$DATABASE_URL" < sprint10-limpeza.sql
-- Ou bloco a bloco no pgAdmin.
-- NADA destrutivo roda por padrão — DROP está comentado.
-- ============================================================


-- ------------------------------------------------------------
-- BLOCO A — Diagnóstico dados_cliente (read-only, seguro)
-- ------------------------------------------------------------
\echo '=== BLOCO A: diagnóstico dados_cliente ==='

SELECT
  (SELECT COUNT(*) FROM dados_cliente) AS total_dados_cliente,
  (SELECT COUNT(*) FROM contatos)       AS total_contatos;

-- Registros em dados_cliente SEM correspondência em contatos
-- (match por user_id + telefone — multi-tenant)
SELECT dc.user_id, dc.telefone, dc.nomewpp, dc."Setor", dc.created_at
FROM dados_cliente dc
LEFT JOIN contatos c
  ON c.telefone = dc.telefone AND c.user_id = dc.user_id
WHERE c.id IS NULL
LIMIT 50;


-- ------------------------------------------------------------
-- BLOCO B — Backup + DROP de dados_cliente (DESATIVADO)
-- Descomente MANUALMENTE somente após revisar o Bloco A.
-- Se houver registros únicos no Bloco A, migre antes!
-- ------------------------------------------------------------
-- CREATE TABLE dados_cliente_backup_2026 AS SELECT * FROM dados_cliente;
-- DROP TABLE dados_cliente;


-- ------------------------------------------------------------
-- BLOCO C — Jobs travados na fila de disparo
-- Tabela real é disparo_logs (não disparo_fila).
-- Status 'sending' parado há >1h = job órfão.
-- ------------------------------------------------------------
\echo '=== BLOCO C: jobs travados em disparo_logs ==='

SELECT id, disparo_id, status, tentativas, telefone, updated_at
FROM disparo_logs
WHERE status = 'sending'
  AND updated_at < now() - interval '1 hour'
ORDER BY updated_at
LIMIT 50;

-- Recoloca na fila (re-tenta no próximo ciclo do worker)
UPDATE disparo_logs
SET status = 'pending',
    tentativas = tentativas + 1,
    updated_at = now()
WHERE status = 'sending'
  AND updated_at < now() - interval '1 hour';


-- ------------------------------------------------------------
-- BLOCO D — VACUUM ANALYZE
-- ATENÇÃO: VACUUM não pode rodar dentro de transação.
-- Se executar este script via `psql -f`, rode com -1 DESLIGADO
-- (padrão). Se rodar no pgAdmin, execute estas linhas
-- individualmente, NÃO dentro de um BEGIN/COMMIT.
-- ------------------------------------------------------------
\echo '=== BLOCO D: VACUUM ANALYZE ==='

VACUUM ANALYZE contatos;
VACUUM ANALYZE marketing_leads;
VACUUM ANALYZE whatsapp_messages;
VACUUM ANALYZE disparo_logs;
VACUUM ANALYZE disparos;
VACUUM ANALYZE n8n_chat_histories;
VACUUM ANALYZE documents;
VACUUM ANALYZE timeline_eventos;


-- ------------------------------------------------------------
-- BLOCO E — Estatísticas finais de saúde
-- ------------------------------------------------------------
\echo '=== BLOCO E: top 15 tabelas por tamanho ==='

SELECT
  schemaname,
  relname AS tabela,
  pg_size_pretty(pg_total_relation_size(relid)) AS tamanho_total,
  pg_size_pretty(pg_relation_size(relid))       AS tamanho_dados,
  n_live_tup AS linhas_vivas,
  n_dead_tup AS linhas_mortas
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 15;

\echo '=== Índices nunca usados (candidatos a remoção) ==='
SELECT
  schemaname,
  relname AS tabela,
  indexrelname AS indice,
  pg_size_pretty(pg_relation_size(indexrelid)) AS tamanho
FROM pg_stat_user_indexes
WHERE idx_scan = 0
  AND indexrelname NOT LIKE '%_pkey'
ORDER BY pg_relation_size(indexrelid) DESC
LIMIT 20;

\echo '=== Sprint 10 concluída ==='
