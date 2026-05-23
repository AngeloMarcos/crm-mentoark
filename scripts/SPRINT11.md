# Sprint 11 — Workflows + Segurança real

Frontend já feito nesta sprint:
- ✅ Helper `src/lib/api-token.ts` + 12 arquivos refatorados (bug do token)
- ✅ Mocks removidos em Marketing (empty state + erro real)
- ✅ CatalogoEnvios com filtros, paginação e botão reenviar

Pendências de deploy na VPS:

## 1. Rodar SQL (pgAdmin → DB crm)
```
scripts/sprint11-schema.sql
```
Cria tabela `workflows`.

## 2. Deploy backend Workflows
```bash
sshpass -p 'Mentoark@2025' scp -o StrictHostKeyChecking=no \
  scripts/sprint11-backend-workflows.ts \
  root@147.93.9.172:/opt/crm/backend/src/routes/workflows.ts

# Editar /opt/crm/backend/src/index.ts e adicionar:
#   import { makeWorkflowsRouter } from "./routes/workflows.js";
#   app.use("/api/workflows", authMiddleware, makeWorkflowsRouter(pool));

sshpass -p 'Mentoark@2025' ssh root@147.93.9.172 \
  'cd /opt/crm/backend && docker compose build --no-cache && docker compose up -d'
```

Endpoints disponíveis depois:
- `GET /api/workflows` — lista
- `GET /api/workflows/:id` — detalhe
- `POST /api/workflows` — criar `{ nome, descricao, nodes, edges, n8n_webhook, ativo }`
- `PATCH /api/workflows/:id` — atualizar
- `DELETE /api/workflows/:id`
- `POST /api/workflows/:id/executar` — dispara webhook n8n configurado

## 3. Deploy backend Segurança
```bash
sshpass -p 'Mentoark@2025' scp -o StrictHostKeyChecking=no \
  scripts/sprint11-backend-seguranca.ts \
  root@147.93.9.172:/opt/crm/backend/src/routes/seguranca.ts

# Editar /opt/crm/backend/src/index.ts:
#   import { makeSegurancaRouter } from "./routes/seguranca.js";
#   app.use("/api/seguranca", authMiddleware, adminMiddleware, makeSegurancaRouter(pool));

# Rebuild backend (já incluso no step 2 se feito junto)
```

Endpoints:
- `GET /api/seguranca/tabelas` — lista via `pg_catalog` (substitui o hardcoded de `MapaBancoDados.tsx`)
- `GET /api/seguranca/auditoria` — roda 5 checks reais (JWT_SECRET, MASTERS env, tabelas sem user_id, refresh expirados, índices)
- `GET /api/seguranca/logins-recentes` — últimos 50 logins via `refresh_tokens`

## 4. Wire frontend (próxima sprint Lovable)
Refatorar `src/components/seguranca/MapaBancoDados.tsx` e `LoginsSessoes.tsx` pra ler dos novos endpoints em vez de arrays hardcoded. UI já está pronta — basta trocar a fonte de dados.

## 5. Frontend Workflows (próxima sprint Lovable)
Adaptar `src/pages/Workflows.tsx`:
- Sidebar com lista de workflows do usuário (`GET /api/workflows`)
- Botão "Salvar" agora chama `POST` ou `PATCH`
- Botão "Executar" chama `POST /api/workflows/:id/executar`
- Campo de configuração do `n8n_webhook` URL
