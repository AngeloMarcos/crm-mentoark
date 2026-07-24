# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Antes de qualquer coisa, leia `STATUS.md`** — painel de status atual de todos os serviços e pendências abertas.

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
| grafana.mentoark.com.br | `grafana` (+ `loki`, `alloy`, sem domínio próprio) | `/opt/observability/docker-compose.yml` |

**Homologação** (ambiente de teste antes de produção — sempre validar aqui primeiro):

| Domínio | Container | Compose |
|---------|-----------|---------|
| homolog.mentoark.com.br | `crm-homolog` | `/opt/crm-homolog/docker-compose.yml` |
| api-homolog.mentoark.com.br | `crm-api-homolog` | `/opt/crm-homolog/backend/docker-compose.yml` |

Banco: `crm_hml` (mesmo Postgres da VPS, schema isolado — sem FK/replicação com `crm`). A
Evolution de homolog é um servidor **próprio e externo** desde 2026-07-22
(`fierceparrot-evolution.cloudfy.live`), não compartilha instância com produção.

PostgreSQL: `147.93.9.172:5432` / db `crm` / user `mentoark`. Imagem `pgvector/pgvector:pg16` (extensões `pgcrypto` + `vector`).

MySQL (`147.93.9.172:3306`, imagem `mysql:8.0`, `/opt/mysql/docker-compose.yml`) é compartilhado com o Evolution API (rede `mysql_default`) — não faz parte do banco do CRM.

**Outros projetos na mesma VPS (não são do CRM — não mexer sem necessidade):** `pdv_prod` (pdv.mentoark.com.br, `/opt/pdv/prod/docker-compose.yml`), `hemoclinic_prod` (hemoclinic.mentoark.com.br, `/opt/hemoclinic/prod/docker-compose.yml`), `portainer` (portainer.mentoark.com.br, `/opt/portainer/docker-compose.yml`). Ver `diagnosticos/INVENTARIO_VPS.md` para detalhes completos de todos os containers da VPS.

### Deploy — método recomendado: `scripts/deploy.sh`

**Use isto em vez de montar comandos `scp`/`ssh` na mão.** Existe pra evitar exatamente a
classe de erro já ocorrida em produção: apontar pro diretório errado (`/opt/crm` é
**produção**; homologação é **`/opt/crm-homolog`**, containers `crm-homolog`/`crm-api-homolog`),
ou tentar `git pull` num desses diretórios (**nenhum dos dois é um clone git limpo** — todo
deploy real sempre foi via arquivo copiado direto, um `git pull` ali tende a conflitar).
O script builda local primeiro (nunca copia código que não compila), copia só os arquivos
passados, rebuilda só o(s) serviço(s) afetado(s), e valida sozinho no final (`/health` +
grep por `ERROR` nos últimos logs).

```bash
# Homologação (sempre teste aqui primeiro)
scripts/deploy.sh homolog backend/src/routes/ARQUIVO.ts src/pages/ARQUIVO.tsx

# Produção — exige --confirm explícito, de propósito (não é pra ser um acidente de copy/paste)
scripts/deploy.sh prod --confirm backend/src/routes/ARQUIVO.ts
```

Requer chave SSH já configurada para `root@147.93.9.172` (`~/.ssh/config`) — sem isso, trocar
por `sshpass -p 'Mentoark@2025' ssh/scp ...` nos mesmos comandos internos do script.

<details>
<summary>Comandos manuais equivalentes (só se o script não servir pro seu caso)</summary>

```bash
# Frontend — produção
scp /root/mentoark-vision/src/pages/ARQUIVO.tsx root@147.93.9.172:/opt/crm/src/pages/ARQUIVO.tsx
ssh root@147.93.9.172 'cd /opt/crm && docker compose build --no-cache crm && docker compose up -d crm'

# Backend — produção
scp /root/mentoark-vision/backend/src/routes/ARQUIVO.ts root@147.93.9.172:/opt/crm/backend/src/routes/ARQUIVO.ts
ssh root@147.93.9.172 'cd /opt/crm/backend && docker compose build --no-cache crm-api && docker compose up -d crm-api'

# Backend — homologação (repare no diretório e no nome do serviço, DIFERENTES de produção)
scp backend/src/routes/ARQUIVO.ts root@147.93.9.172:/opt/crm-homolog/backend/src/routes/ARQUIVO.ts
ssh root@147.93.9.172 'cd /opt/crm-homolog/backend && docker compose build --no-cache crm-api-homolog && docker compose up -d crm-api-homolog'
```
</details>

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
