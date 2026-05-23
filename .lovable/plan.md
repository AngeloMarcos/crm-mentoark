Sprint 10 também é VPS-only. Vou gerar 2 arquivos em `scripts/`:

## 1. `scripts/sprint10-limpeza.sql`

Roda no Postgres `147.93.9.172/crm` via `docker exec crm-api psql $DATABASE_URL`. Dividido em **blocos comentados** — usuário descomenta o que quiser executar. Nada destrutivo roda por padrão.

### Bloco A — Diagnóstico `dados_cliente` (read-only)
```sql
SELECT COUNT(*) FROM dados_cliente;
SELECT COUNT(*) FROM contatos;

-- Registros em dados_cliente sem match em contatos (mesmo user_id + telefone)
SELECT dc.user_id, dc.telefone, dc.nomewpp, dc."Setor"
FROM dados_cliente dc
LEFT JOIN contatos c
  ON c.telefone = dc.telefone AND c.user_id = dc.user_id
WHERE c.id IS NULL
LIMIT 50;
```

### Bloco B — Backup + drop (COMENTADO)
```sql
-- CREATE TABLE dados_cliente_backup_2026 AS SELECT * FROM dados_cliente;
-- DROP TABLE dados_cliente;
```
Usuário precisa descomentar **manualmente** depois de revisar o diagnóstico.

### Bloco C — Jobs travados em `disparo_logs`
Corrige nomes errados do sprint (`disparo_fila` → `disparo_logs`, `processando` → `sending`, `atualizado_em` → `updated_at`):
```sql
-- Diagnóstico
SELECT id, disparo_id, status, tentativas, updated_at
FROM disparo_logs
WHERE status = 'sending' AND updated_at < now() - interval '1 hour'
LIMIT 50;

-- Recolocar na fila
UPDATE disparo_logs
SET status = 'pending', tentativas = tentativas + 1, updated_at = now()
WHERE status = 'sending' AND updated_at < now() - interval '1 hour';
```

### Bloco D — VACUUM ANALYZE (rodar fora de transação)
Tabelas que **existem mesmo**:
```sql
VACUUM ANALYZE contatos;
VACUUM ANALYZE marketing_leads;
VACUUM ANALYZE whatsapp_messages;
VACUUM ANALYZE disparo_logs;
VACUUM ANALYZE n8n_chat_histories;
VACUUM ANALYZE documents;
```
Documento no comentário que `VACUUM` deve ser rodado via `psql -c` separado (sem `BEGIN`).

### Bloco E — Estatísticas finais
Tamanho de cada tabela top-10, contagem de linhas, índices não usados — pra confirmar saúde do banco.

## 2. `scripts/sprint10-verificacao-final.sh`

Substitui o PASSO 5 do sprint (que assume PM2 + localhost):
```bash
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
free -h
df -h /
curl -sk -o /dev/null -w "api.mentoark: HTTP %{http_code}\n" https://api.mentoark.com.br/health
curl -sk -o /dev/null -w "n8n: HTTP %{http_code}\n" https://n8n.mentoark.com.br/healthz
curl -sk -o /dev/null -w "crm: HTTP %{http_code}\n" https://crm.mentoark.com.br
docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}'
echo "Sistema OK — Sprints 0-10 concluídas"
```

## 3. Atualizar `scripts/README.md`

Adicionar seção "Sprint 10" com como rodar:
```bash
# Diagnóstico (seguro)
docker exec -i crm-api psql "$DATABASE_URL" < scripts/sprint10-limpeza.sql

# Verificação final (na VPS)
bash scripts/sprint10-verificacao-final.sh
```

## O que NÃO vou fazer

- **Não dropo `dados_cliente`** automaticamente. Deixo comentado e instruo o usuário a confirmar primeiro com o diagnóstico.
- **Não rodo o SQL agora** — só gero arquivos; usuário aplica na VPS.
- Não toco no schema do Supabase Cloud (sprint é sobre o Postgres da VPS).

## Confirma?

Posso seguir com esses 3 arquivos, ou prefere ajustar algo (ex: incluir o DROP descomentado, adicionar outras tabelas no VACUUM, etc)?