# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Produto

CRM + IA para automação comercial via WhatsApp. Stack: React/Vite/TypeScript (frontend) + Express.js/TypeScript (backend) + PostgreSQL 16 + pgvector.

---

## Comandos

### Frontend (`/root/mentoark-vision/`)

```bash
npm run dev          # servidor de desenvolvimento (Vite, porta 5173)
npm run build        # build de produção para /dist
npm run lint         # ESLint
npm run test         # vitest run (uma vez)
npm run test:watch   # vitest interativo
```

### Backend (`/root/mentoark-vision/backend/`)

```bash
npm run dev    # tsx watch src/index.ts (hot reload)
npm run build  # tsc → dist/
npm run start  # node dist/index.js (produção)
```

---

## Arquitetura

### Frontend → Backend

O arquivo `src/integrations/api/client.ts` **não usa o Database real** — é um cliente HTTP customizado que espelha a interface do `@api/api-js` e encaminha todas as chamadas para `api.mentoark.com.br`. Todos os componentes e páginas importam `api` deste arquivo e usam `.from("tabela").select()` / `.insert()` etc., mas as chamadas vão para o backend Express próprio.

Tokens JWT são armazenados no localStorage com as chaves `crm_access_token`, `crm_refresh_token`, `crm_user`. A variável de ambiente que configura o endpoint é `VITE_API_URL`.

O `src/integrations/lovable/index.ts` é um stub vazio — não é utilizado.

### Backend Express

Rotas simples usam a factory `makeCrud(pool, "tabela")` em `src/crud.ts`, que gera automaticamente GET/POST/PATCH/DELETE com filtragem por `user_id`, paginação, e filtros via query string (`campo_in`, `campo_gte`, `campo_lte`). Rotas com lógica especial ficam em `src/routes/`.

Todas as rotas em `/api/*` exigem `Authorization: Bearer <token>` (JWT HS256). As rotas em `/auth/*` são públicas.

### Auth

`src/hooks/useAuth.tsx` expõe `AuthProvider` e `useAuth()`. O role do usuário (`admin` | `user`) vem embutido no JWT — sem chamada extra ao banco. `ProtectedRoute` aceita `requireAdmin` para restringir páginas administrativas (ex: `/usuarios`).

### Banco de Dados

PostgreSQL 16 com pgvector. Tabelas críticas para a IA:
- `agent_prompts` — n8n busca `WHERE user_id=$1 AND ativo=true LIMIT 1`
- `conhecimento` — base RAG com tipos `personalidade/negocio/faq/objecao/script`
- `documents` — chunks com `embedding vector(1536)` para busca semântica via pgvector

---

## VPS de Produção

| Item | Valor |
|------|-------|
| IP | `147.93.9.172` |
| Acesso | `sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172` |
| Rede Docker | `proxy` (externa, criada manualmente) |

**Regra crítica Traefik:** containers em múltiplas redes Docker **devem** ter o label `traefik.docker.network=proxy`, caso contrário o Traefik usa o IP errado e retorna Gateway Timeout.

### Serviços e Domínios

| Domínio | Container | Compose |
|---------|-----------|---------|
| crm.mentoark.com.br | `crm` | `/opt/crm/docker-compose.yml` |
| api.mentoark.com.br | `crm-api` | `/opt/crm/backend/docker-compose.yml` |
| n8n.mentoark.com.br | `n8n` | `/opt/n8n/docker-compose.yml` |
| disparo.mentoark.com.br | `evolution` | `/opt/evolution/docker-compose.yml` |
| pgadmin.mentoark.com.br | `pgadmin` | `/opt/postgres/docker-compose.yml` |

PostgreSQL: `147.93.9.172:5432` / db `crm` / user `mentoark`. Imagem `pgvector/pgvector:pg16` (extensões `pgcrypto` + `vector`).

### Deploy — Frontend

```bash
# Copiar arquivo alterado e rebuildar
sshpass -p 'Mentoark@2025' scp -o StrictHostKeyChecking=no \
  /root/mentoark-vision/src/pages/ARQUIVO.tsx \
  root@147.93.9.172:/opt/crm/src/pages/ARQUIVO.tsx

sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'cd /opt/crm && docker compose build --no-cache crm && docker compose up -d crm'
```

### Deploy — Backend

```bash
sshpass -p 'Mentoark@2025' scp -o StrictHostKeyChecking=no \
  /root/mentoark-vision/backend/src/routes/ARQUIVO.ts \
  root@147.93.9.172:/opt/crm/backend/src/routes/ARQUIVO.ts

sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'cd /opt/crm/backend && docker compose build --no-cache && docker compose up -d'
```

### Adicionar novo container

```yaml
# Template de labels Traefik (obrigatório para HTTPS automático)
labels:
  - traefik.enable=true
  - traefik.docker.network=proxy
  - traefik.http.routers.NOME.rule=Host(`sub.mentoark.com.br`)
  - traefik.http.routers.NOME.entrypoints=websecure
  - traefik.http.routers.NOME.tls.certresolver=letsencrypt
  - traefik.http.services.NOME.loadbalancer.server.port=PORTA
networks:
  - proxy
```

Criar DNS A record `sub` → `147.93.9.172` antes de subir o container.

---

## Git

Remote usa HTTPS sem token armazenado. Usar `scp` direto para VPS ao invés de `git push`.

```bash
git config --global user.email "angelobispofilho@gmail.com"
git config --global user.name "Angelo Marcos"
```
