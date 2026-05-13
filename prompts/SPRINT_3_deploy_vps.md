# SPRINT 3 — Deploy VPS + Configurar Variáveis de Ambiente

## Contexto
VPS: `147.93.9.172`
SSH: `sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172`
Backend: `/opt/crm/backend/` (container Docker `crm-api`)
Frontend: `/opt/crm/` (container Docker `crm`)

---

## O Que Foi Alterado (precisa de deploy)

Os seguintes arquivos do backend foram modificados nesta sessão:

| Arquivo | O que mudou |
|---|---|
| `backend/src/middleware.ts` | Guard `payload.sub` obrigatório no JWT |
| `backend/src/crud.ts` | Guards 401 em GET /:id e PUT / |
| `backend/src/index.ts` | Proteção N8N_CATALOG_SECRET + import whatsappRouter |
| `backend/src/routes/mcp.ts` | MCP_SECRET obrigatório + filtro user_id no histórico |
| `backend/src/routes/usuarios.ts` | adminMiddleware em GET /user_roles |
| `backend/src/services/agentEngine.ts` | user_id IS NOT NULL na lookup de agente |
| `backend/src/routes/whatsapp.ts` | **NOVO** — rota WhatsApp criada (Sprint 1) |

---

## PASSO 1 — Adicionar variáveis de ambiente no VPS

Conectar ao VPS e editar o `.env` do backend:

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  "cat /opt/crm/backend/.env"
```

Verificar quais variáveis já existem. Então adicionar as que faltam:

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 << 'EOF'
# Gerar segredos aleatórios
MCP_SECRET=$(openssl rand -hex 32)
N8N_CATALOG_SECRET=$(openssl rand -hex 24)

# Verificar se já existem
grep -q "MCP_SECRET" /opt/crm/backend/.env && echo "MCP_SECRET já existe" || echo "MCP_SECRET=$MCP_SECRET" >> /opt/crm/backend/.env
grep -q "N8N_CATALOG_SECRET" /opt/crm/backend/.env && echo "N8N_CATALOG_SECRET já existe" || echo "N8N_CATALOG_SECRET=$N8N_CATALOG_SECRET" >> /opt/crm/backend/.env

echo "=== .env atual (sem senhas) ==="
grep -v "PASSWORD\|SECRET\|KEY\|TOKEN\|HASH" /opt/crm/backend/.env
EOF
```

---

## PASSO 2 — Copiar arquivos modificados para o VPS

```bash
# middleware.ts
sshpass -p 'Mentoark@2025' scp -o StrictHostKeyChecking=no \
  backend/src/middleware.ts \
  root@147.93.9.172:/opt/crm/backend/src/middleware.ts

# crud.ts
sshpass -p 'Mentoark@2025' scp -o StrictHostKeyChecking=no \
  backend/src/crud.ts \
  root@147.93.9.172:/opt/crm/backend/src/crud.ts

# index.ts
sshpass -p 'Mentoark@2025' scp -o StrictHostKeyChecking=no \
  backend/src/index.ts \
  root@147.93.9.172:/opt/crm/backend/src/index.ts

# mcp.ts
sshpass -p 'Mentoark@2025' scp -o StrictHostKeyChecking=no \
  backend/src/routes/mcp.ts \
  root@147.93.9.172:/opt/crm/backend/src/routes/mcp.ts

# usuarios.ts
sshpass -p 'Mentoark@2025' scp -o StrictHostKeyChecking=no \
  backend/src/routes/usuarios.ts \
  root@147.93.9.172:/opt/crm/backend/src/routes/usuarios.ts

# agentEngine.ts
sshpass -p 'Mentoark@2025' scp -o StrictHostKeyChecking=no \
  backend/src/services/agentEngine.ts \
  root@147.93.9.172:/opt/crm/backend/src/services/agentEngine.ts

# whatsapp.ts (NOVO — criar o diretório já existe)
sshpass -p 'Mentoark@2025' scp -o StrictHostKeyChecking=no \
  backend/src/routes/whatsapp.ts \
  root@147.93.9.172:/opt/crm/backend/src/routes/whatsapp.ts
```

---

## PASSO 3 — Build e restart do container backend

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'cd /opt/crm/backend && docker compose build --no-cache && docker compose up -d'
```

Aguardar e verificar:

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'docker logs crm-api --tail=30'
```

Deve mostrar: `API running on port 3000`

---

## PASSO 4 — Executar migration SQL no banco

Conectar ao banco via psql no VPS:

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'PGPASSWORD=Mentoark@2025 psql -h 147.93.9.172 -U mentoark -d crm -f /dev/stdin' << 'SQLEOF'

-- 1. Tabela de deduplicação de webhooks
CREATE TABLE IF NOT EXISTS webhook_mensagens_processadas (
  id TEXT PRIMARY KEY,
  instancia TEXT,
  telefone TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webhook_proc_created
  ON webhook_mensagens_processadas(created_at);

-- 2. Índices de performance multi-tenant
CREATE INDEX IF NOT EXISTS idx_n8n_chat_uid_session ON n8n_chat_histories(user_id, session_id);
CREATE INDEX IF NOT EXISTS idx_n8n_chat_uid_created ON n8n_chat_histories(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agentes_instancia_uid ON agentes(evolution_instancia, user_id) WHERE evolution_instancia IS NOT NULL;

-- 3. Verificar integridade (resultado esperado: 0 em todas as linhas)
SELECT 'n8n_chat_histories' AS tabela, COUNT(*) AS registros_sem_user_id
FROM n8n_chat_histories WHERE user_id IS NULL
UNION ALL
SELECT 'agentes', COUNT(*) FROM agentes WHERE user_id IS NULL
UNION ALL
SELECT 'agent_prompts', COUNT(*) FROM agent_prompts WHERE user_id IS NULL
UNION ALL
SELECT 'conhecimento', COUNT(*) FROM conhecimento WHERE user_id IS NULL;

-- 4. Dados por usuário (diagnóstico final)
SELECT u.email, u.role,
  (SELECT COUNT(*) FROM contatos c WHERE c.user_id = u.id) AS contatos,
  (SELECT COUNT(*) FROM agentes a WHERE a.user_id = u.id) AS agentes,
  (SELECT COUNT(*) FROM n8n_chat_histories h WHERE h.user_id = u.id) AS historico
FROM users u ORDER BY u.created_at;

SQLEOF
```

---

## PASSO 5 — Verificar saúde da API

```bash
# Health check
curl -s https://api.mentoark.com.br/health

# Testar endpoint protegido (deve retornar 401)
curl -s https://api.mentoark.com.br/api/agentes

# Testar endpoint público catalogo/n8n sem secret (deve retornar 401 se N8N_CATALOG_SECRET estiver configurado)
curl -s "https://api.mentoark.com.br/api/catalogo/n8n/qualquer-uuid"

# Testar novo endpoint WhatsApp (deve retornar 401 sem token)
curl -s https://api.mentoark.com.br/api/whatsapp/conversas
```

Respostas esperadas:
- `/health` → `{"status":"ok","db":"connected"}`
- Os demais → `{"message":"Token não fornecido"}` (401)

---

## PASSO 6 — (Opcional) Deploy frontend se WhatsApp.tsx foi alterado

Se o Sprint 1 foi aplicado e `src/pages/WhatsApp.tsx` e `src/services/evolutionService.ts` foram alterados:

```bash
# Copiar arquivos frontend alterados
sshpass -p 'Mentoark@2025' scp -o StrictHostKeyChecking=no \
  src/pages/WhatsApp.tsx \
  root@147.93.9.172:/opt/crm/src/pages/WhatsApp.tsx

sshpass -p 'Mentoark@2025' scp -o StrictHostKeyChecking=no \
  src/services/evolutionService.ts \
  root@147.93.9.172:/opt/crm/src/services/evolutionService.ts

# Rebuild frontend
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'cd /opt/crm && docker compose build --no-cache crm && docker compose up -d crm'
```

---

## Checklist Final

- [ ] `.env` do VPS tem `MCP_SECRET` e `N8N_CATALOG_SECRET`
- [ ] Todos os 7 arquivos copiados para o VPS
- [ ] `docker compose build && up` do backend executado sem erro
- [ ] `docker logs crm-api` mostra `API running on port 3000`
- [ ] `curl /health` retorna `ok`
- [ ] SQL executado — resultado da query 3 mostra 0 NULLs
- [ ] Login no CRM funciona normalmente
- [ ] Aba WhatsApp carrega conversas reais (se Sprint 1 foi feito)
