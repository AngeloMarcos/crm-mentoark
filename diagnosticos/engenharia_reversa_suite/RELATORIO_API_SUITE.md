# Engenharia reversa — suite.mentoark.com.br → base da API oficial do CRM

Data: 2026-10-29 · Método: REA (`capture_browser_scenario` com Edge headless, login real) + leitura
estática dos bundles + download da especificação OpenAPI que o próprio sistema publica.

Arquivos brutos nesta pasta:

| Arquivo | O que é |
|---|---|
| `suite_openapi_publica.json` | OpenAPI 3.0 oficial do suite (`GET /docs/openapi.json`, público): 103 paths, 179 operações, 151 schemas |
| `suite_openapi_indice.txt` | Índice legível: método, path, grupo e resumo de cada operação |
| `suite_rotas_internas_tuyau.json` | As 835 rotas nomeadas do backend (inclui as internas do painel), extraídas do chunk `tuyau-*.js` |

---

## 1. O que é o sistema (observado)

- **É um white-label do CuboCRM.** Os assets de marca vêm de `files.cubocrm.com.br/tenants/56/...`, e a
  conta logada é admin do tenant "Mentoark" (11 empresas, 15 usuários, 10 módulos ativos).
  Ou seja: não temos o código, mas a API dele **já é exposta com o nosso nome** ("Mentoark API").
- Stack: **AdonisJS 6** (cookie `adonis-session`, `XSRF-TOKEN`, validação VineJS) + **Inertia.js + Vue 3**
  (headers `x-inertia`, `x-inertia-partial-data`) + **Tuyau** (cliente tipado gerado das rotas) +
  **@adonisjs/transmit** (SSE em `/__transmit/events` para tempo real).
- O painel não consome a API pública. As páginas carregam dados via Inertia (o HTML/JSON de cada rota
  traz os `props`), e a API pública `/api/*` é uma camada separada, autenticada por **`X-API-Key`**.
  O login (`POST /auth/login`) tem rate limit `x-ratelimit-limit: 20`.

## 2. Convenções da API pública que vale replicar

**Autenticação e escopos**
- Header `X-API-Key: sk_...`, com a chave gerada em Configurações → API Keys.
- A chave tem `type` (ex.: `integration`), `scopes` no formato `{ "<recurso>": ["read","create","update","delete"] }`
  e a flag `fullAccess`. Quando falta o escopo, a resposta é `403` com uma mensagem que nomeia o escopo (`messages:create`).
- A chave **age em nome de um usuário**. Se o usuário não for admin, a API só devolve o que ele enxerga.
  Uma chave sem usuário age como o dono da conta.
- `GET /api/whoami` não exige escopo e devolve `company`, `user`, `apiKey{scopes}`, `modules` e `counts`.
  É a primeira chamada de qualquer integração. Recusa sessão de navegador com `403`, porque só aceita chave.

**Formato de resposta**
- Listagem: `{ data: [...], metadata: { total, perPage, currentPage, lastPage, firstPage, firstPageUrl, lastPageUrl, nextPageUrl, previousPageUrl } }`.
  Query `page` / `perPage` (padrão 10).
- Feed com cursor, como alternativa: `cursor` → `{ nextCursor, hasMore }`.
- Detalhe/criação: `{ data: {...} }` ou o objeto direto (`201`).
- Erro: **sempre** `{ errors: [{ message }] }`. Quando o erro é acionável, vem também um `code` em snake_case
  (`window_closed`, `template_variables_missing`, `content_required`, `foreign_ref`, `unknown_chip`, `rate_limited`)
  e campos extras úteis (`missingVariables`, hora em que a janela expirou etc.).
- Status usados: 200/201/202/401/403/404/422/429.

**Filtros (padrão de query string)**
- IDs múltiplos separados por vírgula (`stage=1,2`, `ids=...`, `tags=...` + `tags_op=any|all`).
- Datas em `dd/MM/yyyy`, data única ou intervalo `início,fim` (`created_at`, `win_date`, `lost_date`...).
- `orderColumn` + `orderDirection`.
- Campos personalizados: `customfields=id:valor`, onde `*` significa "preenchido". Há o mesmo filtro para
  a pessoa e a organização vinculadas (`people_customfields`, `organization_customfields`).
- Busca por telefone normaliza as variantes do número (com/sem DDI, com/sem o nono dígito).

**Padrões de comportamento**
- **Criação assíncrona opcional**: `POST /api/deals` com `async: true` → `202 { requestId }`, consultado
  depois em `GET /api/deals/async/{requestId}` (`pending|done|failed`, expira em 48h). Serve para landing page e webhooks.
- **Validar sem gravar**: `POST /api/agents/validate`, `/api/automations/{id}/validate` e
  `/api/agents/{id}/simulate`. Útil para IA/integrações montarem configuração com segurança.
- **Rascunho → publicar**: automações têm `POST /{id}/publish` e `POST /{id}/toggle-status`.
- **Catálogos auto-descritivos**: `GET /api/agents/catalog` e `GET /api/automations/catalog` listam os nós,
  gatilhos e variáveis disponíveis, para que um cliente (ou uma LLM) monte o JSON sem adivinhar.
- **Lixeira**: `DELETE` é soft delete, revertido por `PUT /{id}/restore`.
- **Segredos nunca saem por padrão**: só aparecem `hasClientSecret`/`hasRefreshToken`, e o valor sai com `?include=secrets` no detalhe.
- **Upsert inteligente**: `POST /api/deals` aceita `peoplePhone` com máscara (normalizado no servidor),
  `organizationName` para criar ou reaproveitar a organização e `stageId` opcional (usa o 1º estágio do funil).
- **Envio de mensagem** (`POST /api/messages/send`): o destinatário pode ser `conversationId`, `peopleId` ou
  `phone` (que cria a pessoa). Respeita a janela de 24h da Meta, com `fallbackTemplateId`. `sentBy: bot|human`
  muda o efeito colateral: com `human`, a conversa é atribuída, o bot pausa por 1h e a conversa reabre.
  Tem rate limit por minuto (`429`).

## 3. Mapa de recursos (API pública do suite) × nosso CRM hoje

| Recurso suite (`/api/...`) | Equivalente no nosso backend | Situação |
|---|---|---|
| `deals` (+ async, proposals) | `kanban`, `funis`, `contatos` (status no lead) | conceito de "negociação" separado do contato **não existe** |
| `peoples` | `contatos` / `dados_cliente` | existe, sem contrato estável |
| `organizations` | — | não existe |
| `pipes`, `stages` (+ `stages-order`) | `funis`, `funil_estagios` | existe |
| `activities`, `activity-trails` | `tarefas`, `follow_ups`, `timeline_eventos` | parcial |
| `annotations` | `timeline_eventos` | parcial |
| `tags` (+ attach/detach) | `tags` (CRUD genérico) | sem attach/detach |
| `customfields` | — | não existe |
| `products`, `categories` | `produtos`, `catalogos` | existe |
| `lostreasons`, `resolution/transfer/pause-reasons` | — | não existe |
| `conversations` (+ messages) | `conversas`, `chats`, `chat_messages` | existe |
| `channels` (+ templates) | `whatsapp` / `meta-oficial` / instâncias Evolution | existe, fragmentado |
| `messages/send` | `whatsapp`, `disparos` | existe, sem contrato único |
| `message-queues` (disparo em massa + check-deals) | `disparos`, `campanhas` | existe |
| `templates` | `disparo_templates`, `respostas_rapidas` | existe |
| `agents` (+ catalog/validate/simulate/executions/folders) | `agentes`, `agent_prompts`, `agent-config`, `corridas` | existe, sem validate/simulate |
| `knowledge-bases` (+ folders) | `conhecimento`, `documents` (pgvector) | existe |
| `intents` | — | não existe |
| `automations` (+ catalog/validate/publish/executions) | `workflows` | parcial |
| `integrations`, `oauth-credentials`, `mcp-connections` | `integracoes_config`, `ai-providers`, `/mcp` | parcial |
| `forms`, `landings`, `domains` | `smart-links`, `marketing` | não existe como recurso |
| `users`, `departments` | `usuarios`, `team`, `departamentos` | existe |
| `whoami`, `me/modules` | `modulos` | **não existe** |
| **API Keys com escopo** | — (só JWT de sessão, `x-n8n-secret`, `x-mcp-key`) | **não existe — é o pré-requisito** |

## 4. Proposta de estrutura para a nossa API oficial

Inferência e design (não observado no suite):

1. **Camada separada `/v1/*`** (ou `api.mentoark.com.br/v1`) em vez de expor o `/api/*` atual.
   O `/api/*` de hoje é o backend do frontend: `makeCrud` genérico, nomes de tabela na URL, `user_id`
   implícito pelo JWT. Mudar isso quebra a interface. A camada nova é um contrato estável, montado em
   cima dos mesmos services.
2. **Fase 0 (fundação), antes de qualquer recurso:**
   - tabela `api_keys` (`id, conta_id, user_id, titulo, tipo, prefixo, hash_sha256, scopes jsonb, full_access, ativo, last_used_at, created_at`).
     A chave é exibida uma única vez (`sk_live_...`); só o hash fica gravado.
   - middleware `apiKeyAuth` (`X-API-Key`) que resolve conta+usuário e reaproveita o `tenantContextMiddleware`;
     helper `requireScope('deals:create')`.
   - envelope único `{ data, metadata }` e `{ errors:[{message}], code }`, com paginação `page/perPage`.
   - rate limit por chave (headers `x-ratelimit-*`) e `x-request-id` em toda resposta.
   - `GET /v1/whoami`, mais tela "API Keys" no frontend.
   - OpenAPI gerado do código (zod → openapi), servido em `/v1/docs`.
3. **Fase 1 (o que integrações pedem primeiro):** `peoples`, `deals` (com `async`), `pipes`/`stages`,
   `tags` attach/detach, `messages/send` (abstraindo Evolution × Meta oficial em "canal"), `conversations` read-only.
4. **Fase 2:** `activities`, `annotations`, `products`, `templates`, `message-queues`, webhooks **de saída**
   (eventos `deal.created`, `message.received`... com assinatura HMAC). O suite não expõe isso na API pública.
5. **Fase 3:** `agents` / `knowledge-bases` / `automations`, com `catalog` + `validate` + `simulate`.
   Com isso, n8n ou uma LLM configuram agentes sem risco.
6. **Primeira decisão de modelo:** separar **negociação (deal)** de **contato (people)**. Hoje o lead é as
   duas coisas. Quase toda a API do suite gira em torno de `deal ↔ people ↔ organization`.

## 5. Limites desta análise

- Só a camada pública e os nomes das rotas internas foram observados. Os bodies das rotas internas
  (Inertia) e o comportamento real de cada endpoint **não foram exercitados**, porque nenhuma chamada de
  escrita foi feita e nenhuma API key foi criada.
- O `openapi.json` é a documentação declarada pelo fornecedor. O comportamento real pode divergir.
- O suite é produto de terceiro (CuboCRM). Replicamos **convenções de design de API**, não código.
