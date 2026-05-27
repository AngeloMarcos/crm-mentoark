
# Plano: Equipe + Chat Interno (pessoas, perfis, permissões, grupos)

Transformar o `/chat-equipe` (hoje single-user) num sistema completo de colaboração: cadastrar **pessoas** da equipe, definir **perfis** (cargo + foto + bio), aplicar **permissões** granulares por módulo e organizar em **grupos** que viram canais de chat.

---

## 1. Modelo de Dados (Postgres — SQL fornecido para você rodar)

### `team_members` — pessoas da equipe
| campo | tipo | descrição |
|---|---|---|
| id | uuid pk | |
| owner_id | uuid | dono do workspace |
| user_id | uuid | usuário vinculado (após aceitar convite) |
| email | text | usado antes do aceite |
| nome | text | |
| cargo | text | ex: SDR, Closer, Gerente |
| bio | text | |
| avatar_url | text | |
| status | text | `convidado` \| `ativo` \| `inativo` |
| convite_token, convite_expira_at | | |

### `team_roles` — perfis de permissão (preset + custom)
- `id uuid`, `owner_id uuid`, `nome text` (ex: "Admin", "Closer", "Suporte"), `cor text`, `is_system bool`
- Presets criados automaticamente: **Owner**, **Admin**, **Agente**, **Viewer**.

### `team_role_permissions` — permissões da role
- `role_id uuid`, `modulo text`, `acao text` (`view`|`create`|`edit`|`delete`|`manage`)
- Módulos: `leads`, `funil`, `whatsapp`, `disparos`, `campanhas`, `integracoes`, `equipe`, `chat`, `relatorios`, `configuracoes`.
- PK composta (role_id, modulo, acao).

### `team_member_roles` — pessoa ↔ role (N:N)
- `member_id`, `role_id`.

### `team_groups` — grupos/departamentos (também viram canal de chat)
- `id uuid`, `owner_id uuid`, `nome text`, `descricao text`, `cor text`, `icone text`
- `tipo text` — `departamento` (gestão) \| `canal` (só chat) \| `ambos`
- `privacidade text` — `publico` \| `privado`

### `team_group_members` — quem está no grupo
- `group_id`, `member_id`, `papel text` (`lider`|`membro`), `last_read_at timestamptz`

### `team_channels` — canais de chat
- Todo grupo cria 1 canal automático. Além disso:
- `id`, `owner_id`, `group_id null` (null = DM ou canal solto), `nome`, `tipo` (`grupo`|`direto`|`geral`).

### `team_messages` — mensagens do chat
- `id`, `channel_id`, `owner_id`, `sender_member_id`, `conteudo`, `tipo` (`texto`|`imagem`|`arquivo`|`audio`|`sistema`), `midia_url`, `midia_nome`, `reply_to`, `editado_at`, `deletado_at`, `created_at`.
- Índice em `(channel_id, created_at desc)`.

Todas as queries filtram por `owner_id` derivado do JWT.

---

## 2. Backend (`backend/src/routes/`)

### `team.ts` — pessoas
```
POST   /api/team/members              convidar (email, nome, cargo, roles[], groups[])
GET    /api/team/members              listar
PATCH  /api/team/members/:id          editar perfil/status/roles/groups
DELETE /api/team/members/:id          soft delete
POST   /auth/accept-invite            aceitar (token + senha) → cria user + ativa
```

### `roles.ts` — perfis e permissões
```
GET    /api/team/roles                lista (presets + custom)
POST   /api/team/roles                cria role custom
PATCH  /api/team/roles/:id            renomeia / muda cor
DELETE /api/team/roles/:id            (bloqueia is_system)
PUT    /api/team/roles/:id/permissions  substitui matriz de permissões
```

### `groups.ts` — grupos
```
GET    /api/team/groups
POST   /api/team/groups               cria (auto-cria channel)
PATCH  /api/team/groups/:id
DELETE /api/team/groups/:id
POST   /api/team/groups/:id/members   adiciona pessoa(s)
DELETE /api/team/groups/:id/members/:memberId
```

### `chat.ts` — canais e mensagens
```
GET    /api/team/channels                              visíveis ao user
POST   /api/team/channels/direct                       cria/abre DM com {memberId}
GET    /api/team/channels/:id/messages?before=&limit=  paginado
POST   /api/team/channels/:id/messages
PATCH  /api/team/messages/:id
DELETE /api/team/messages/:id
POST   /api/team/channels/:id/read
GET    /api/team/stream                                SSE: message.new/edit/delete, presence
```

### Middleware `requirePermission(modulo, acao)`
Aplicado nas rotas existentes (leads, disparos, etc) — busca permissões consolidadas do member e bloqueia com 403.

---

## 3. Frontend

### Novas páginas
- **`/equipe`** — abas: **Pessoas**, **Perfis**, **Grupos**.
  - *Pessoas*: tabela (avatar, nome, cargo, perfis [chips], grupos [chips], status). Botão "Convidar pessoa" → modal (email, nome, cargo, selecionar perfis, selecionar grupos). Editar pessoa → drawer com foto/bio/cargo + multi-select de perfis e grupos.
  - *Perfis*: lista de roles + matriz de permissões (módulos × ações) editável em grid; botão "Novo perfil".
  - *Grupos*: cards (cor + ícone + nº membros). Criar/editar grupo → modal com nome, descrição, cor, ícone, privacidade, membros, "Criar canal de chat" (default on).
- **`/convite/:token`** — aceitar convite (definir senha, confirmar nome/avatar).

### Refator `/chat-equipe`
Layout 3 colunas (drawer no mobile):
- **Esquerda**: busca + seção **Canais** (lista grupos com canal + canal `#geral`) + seção **Mensagens diretas** (membros com status online). Badge de não lidos.
- **Centro**: timeline do canal — avatar + nome + cargo, agrupamento por autor, edição inline, reply, "digitando…", scroll infinito, anexos (reaproveita galeria), `@menção` com autocomplete dos members do canal.
- **Direita** (toggle): detalhes — descrição do grupo, membros (com perfis), adicionar pessoas.

### Hooks
- `usePermissions()` — carrega permissões do user logado, expõe `can(modulo, acao)`. Esconde itens da sidebar e botões conforme.
- `useTeamChat(channelId)` — REST + SSE merge, expõe `send/edit/remove/markRead/typing`.

### Sidebar
- Novo item **Equipe** (visível se `can('equipe','view')`).
- Badge no item **Chat de Equipe** somando mensagens não lidas.

---

## 4. Permissões padrão (presets)

| Módulo | Owner | Admin | Agente | Viewer |
|---|---|---|---|---|
| equipe (gerenciar) | ✅ manage | ✅ manage | ❌ | ❌ |
| leads / funil / whatsapp / disparos | ✅ all | ✅ all | view+create+edit | view |
| campanhas / integrações | ✅ all | ✅ all | view | view |
| configurações | ✅ all | edit | ❌ | ❌ |
| chat | ✅ all | ✅ all | ✅ send | view |

Owner é imutável (sempre o criador do workspace).

---

## 5. Convite & Onboarding
Link `https://crm.mentoark.com.br/convite/<token>` (7 dias). Ao abrir: se email já tem conta → vincula; se não → cria user + define senha. Após aceite, vira `team_member.status='ativo'` e ganha acesso conforme roles atribuídos.

---

## 6. Entrega faseada
1. **Fase 1 — Fundação**: tabelas `team_members`, `team_roles`, `team_role_permissions`, `team_member_roles`. Rotas e tela `/equipe` (abas Pessoas + Perfis). Convite + aceite. Middleware de permissão aplicado nas rotas críticas.
2. **Fase 2 — Grupos**: `team_groups`, `team_group_members`, aba Grupos na `/equipe`, criação automática de canal por grupo.
3. **Fase 3 — Chat real**: `team_channels`, `team_messages`, refator do ChatEquipe com canais + DMs + histórico paginado.
4. **Fase 4 — Realtime & UX**: SSE (mensagens + presença + typing), `last_read_at` + badges de não lidos, menções, anexos.
5. **Fase 5 — Extras**: busca em mensagens, threads, notificações no navegador.

---

## Detalhes técnicos
- SQL de cada fase entregue pronto para rodar no pgAdmin (`147.93.9.172/crm`).
- Backend: novos arquivos em `backend/src/routes/` + registro em `src/index.ts`; SSE in-memory por processo (1 réplica atual basta).
- Frontend: usa o `api` client existente; SSE via `EventSource` autenticado por `?access_token=`.
- Nada muda no Supabase do Lovable — persistência 100% no Postgres próprio.

Confirma o escopo? Se sim, começo pela **Fase 1** (pessoas + perfis + permissões + convite).
