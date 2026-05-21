# Prompt Lovable — Painel de Segurança: Panorama Completo

## Objetivo
Criar a página **`/seguranca`** (rota protegida por `adminMiddleware`) que serve como
painel central de segurança do CRM MentoArk. O admin visualiza e gerencia tudo
relacionado a acessos, usuários, módulos, banco de dados e configurações de segurança.

Referência visual: painel de segurança do Vercel, Linear ou Notion — monocromático,
denso de informação, sem cores excessivas, sem emojis.

---

## Contexto técnico — arquitetura atual

### Autenticação
- **Frontend**: Supabase Auth → `access_token` JWT repassado a cada request
- **Backend**: `authMiddleware` verifica o JWT com `JWT_SECRET`, extrai `sub` (userId), `role` e `email`
- **Admin**: `role === "admin"` no JWT **ou** email presente no array `MASTERS`
- **MCP**: autenticação separada via header `x-mcp-key: MCP_SECRET`

### Multi-tenancy
- Todos os dados isolados por `user_id` — enforçado no `crud.ts` (factory) e em cada router especializado
- Todo `SELECT`, `INSERT`, `UPDATE`, `DELETE` via `makeCrud()` inclui `WHERE user_id = $userId`
- Tabelas sem isolamento (`SHARED_TABLES`): atualmente vazia — nenhuma tabela global no momento
- **Uploads públicos**: `/uploads/*` servido estático sem JWT

### Controle de módulos (RBAC leve)
- Tabela `user_modulos (user_id, modulo, ativo)`
- Módulos: dashboard, leads, contatos, discagem, funil, whatsapp, disparos, campanhas,
  workflows, integracoes, agentes, catalogo, cerebro, galeria, docs, usuarios
- Admins recebem todos automaticamente; usuários comuns consultam a tabela
- Frontend: `hasModulo(key)` oculta itens da sidebar

---

## Página `src/pages/Seguranca.tsx` — 4 abas

### Aba 1 — Usuários & Acessos

```
GET /api/usuarios → lista todos os usuários
GET /api/modulos/usuario/:userId → módulos ativos de cada usuário
```

**Layout:**
- Tabela com colunas: Avatar/Nome · Email · Role (badge: admin / usuário) · Módulos ativos (count) · Último login · Ações
- Ao clicar em um usuário → expande inline mostrando grid de toggles de módulos (16 módulos, checkbox por módulo)
- Toggle chama `POST /api/modulos/usuario/:userId/toggle` com `{ modulo, ativo: boolean }`
- Filtro por role (todos / admin / usuário)
- Busca por nome ou email

**Cards de resumo no topo:**
| Métrica | Fonte |
|---------|-------|
| Total de usuários | contagem da lista |
| Admins | users com role=admin |
| Módulos padrão habilitados | 7 |
| Módulos premium bloqueados | por usuário selecionado |

---

### Aba 2 — Banco de Dados & Multi-tenant

Exibe o "mapa" das tabelas e como o isolamento funciona.

**Seção: Tabelas protegidas por user_id**

Lista estática das tabelas com descrição e status:

| Tabela | Isolamento | Nível |
|--------|-----------|-------|
| contatos | user_id | ✓ Protegida |
| leads | user_id | ✓ Protegida |
| agentes | user_id | ✓ Protegida |
| galeria_midias | user_id | ✓ Protegida |
| catalogos | user_id | ✓ Protegida |
| produtos | user_id | ✓ Protegida |
| conhecimento | user_id | ✓ Protegida |
| integracoes_config | user_id | ✓ Protegida |
| campanhas | user_id | ✓ Protegida |
| user_modulos | user_id | ✓ Protegida |
| n8n_chat_histories | user_id | ✓ Protegida |
| disparo_logs | user_id | ✓ Protegida |
| uploads (arquivos) | público | ⚠ Sem auth |

**Seção: Endpoints públicos (sem JWT)**

```
GET  /health           — Health check
POST /auth/*           — Login / registro / refresh
POST /webhook/*        — Webhooks n8n / Evolution
POST /mcp              — MCP Client (auth via x-mcp-key)
GET  /uploads/*        — Arquivos estáticos (sem autenticação)
GET  /api/catalogo/n8n/:userId  — Catálogo para n8n (auth via x-n8n-secret)
POST /api/marketing/facebook/callback  — OAuth callback Meta
POST /api/marketing/facebook/webhook   — Leads webhook Meta
```

**Seção: Endpoints admin-only**
```
GET    /api/modulos/lista
GET    /api/modulos/usuario/:userId
PUT    /api/modulos/usuario/:userId
POST   /api/modulos/usuario/:userId/toggle
GET    /api/usuarios/*
```

**Seção: Estatísticas do banco** (chama `GET /api/dashboard/resumo` ou similar)
- Total de registros por tabela — mostrar como barras horizontais simples

---

### Aba 3 — Logins & Sessões

**Card: Configuração de autenticação**

| Item | Status |
|------|--------|
| Provider | Supabase Auth (email + senha) |
| JWT Secret | Configurado no backend (env JWT_SECRET) |
| Token expiry | Supabase default (1h access / 7d refresh) |
| Role no JWT | Campo `role` no app_metadata |
| Admin emails fixos | angelobispofilho@gmail.com, mentoark@gmail.com |

**Card: Checklist de segurança** — cada item com ✓ verde ou ⚠ amarelo ou ✗ vermelho:

```
✓  JWT verificado em todos os endpoints /api/*
✓  user_id extraído do token (não do body)
✓  Multi-tenant enforçado no CRUD factory
✓  Admin role verificado via adminMiddleware
✓  CORS restrito a domínios conhecidos
✓  MCP protegido por chave separada (x-mcp-key)
✓  Bulk delete requer pelo menos 1 filtro
⚠  Uploads servidos sem autenticação (qualquer URL é pública)
⚠  Emails admin hardcoded em modulos.ts (MASTERS array)
⚠  Rate limiting não configurado na API
⚠  /api/catalogo/n8n aberto se N8N_CATALOG_SECRET não estiver no .env
```

**Botão "Ver logs de autenticação"** — abre modal mostrando os últimos eventos
do Supabase Auth (chama `GET /api/usuarios/logs` se implementado, senão exibe mensagem
"Disponível após configurar o Supabase Audit Log").

---

### Aba 4 — Chaves & Integrações

**Seção: Chaves de API do sistema**

| Chave | Descrição | Status |
|-------|-----------|--------|
| JWT_SECRET | Assina os tokens do backend | ✓ Configurado |
| MCP_SECRET | Autenticação do MCP Client n8n | ✓ Configurado |
| N8N_CATALOG_SECRET | Protege endpoint do catálogo para n8n | verificar |
| FACEBOOK_APP_ID / SECRET | OAuth Meta Ads | verificar |

Esses valores são lidos via `GET /api/seguranca/status-chaves` (novo endpoint simples
que retorna apenas `{ chave: string, configurado: boolean }[]` sem expor os valores).

**Seção: Instâncias Evolution configuradas**

Tabela mostrando `integracoes_config WHERE tipo = 'evolution'`:
- Instância · URL · Status · user_id (email do dono)

**Seção: MCP — Ferramentas disponíveis**

Lista estática das tools disponíveis no MCP:
- buscar_contatos · obter_historico_conversa · criar_contato · atualizar_status_contato
- enviar_mensagem_whatsapp · listar_agentes · buscar_conhecimento · resumo_dashboard · buscar_midia

---

## Componentes a criar

```
src/pages/Seguranca.tsx              — página principal com as 4 abas
src/components/seguranca/
  UsuariosAcessos.tsx                — aba 1: tabela + toggles de módulos
  MapaBancoDados.tsx                 — aba 2: tabelas, endpoints, estatísticas
  LoginsSessoes.tsx                  — aba 3: checklist, config de auth
  ChavesIntegracoes.tsx              — aba 4: chaves e MCP
```

---

## Rota e sidebar

### Adicionar rota em `src/App.tsx` (ou onde ficam as rotas):
```tsx
<Route path="/seguranca" element={<ProtectedRoute adminOnly><Seguranca /></ProtectedRoute>} />
```

### Já existe na sidebar (grupo "Conteúdo"):
```
{ title: "Usuários", url: "/usuarios", icon: ShieldCheck, modulo: "usuarios" }
```

Mover para grupo "Conteúdo" e adicionar entrada nova:
```
{ title: "Segurança", url: "/seguranca", icon: Lock, modulo: "usuarios", color: "text-red-400" }
```

---

## Novo endpoint backend necessário

### `GET /api/seguranca/status-chaves`

Adicionar em `backend/src/index.ts` (protegido por `authMiddleware` + `adminMiddleware`):

```typescript
app.get('/api/seguranca/status-chaves', authMiddleware, adminMiddleware, (_req, res) => {
  const chaves = [
    { chave: 'JWT_SECRET',            configurado: !!process.env.JWT_SECRET },
    { chave: 'MCP_SECRET',            configurado: !!process.env.MCP_SECRET },
    { chave: 'N8N_CATALOG_SECRET',    configurado: !!process.env.N8N_CATALOG_SECRET },
    { chave: 'FACEBOOK_APP_ID',       configurado: !!process.env.FACEBOOK_APP_ID },
    { chave: 'FACEBOOK_APP_SECRET',   configurado: !!process.env.FACEBOOK_APP_SECRET },
    { chave: 'OPENAI_API_KEY',        configurado: !!process.env.OPENAI_API_KEY },
    { chave: 'EVOLUTION_API_KEY',     configurado: !!process.env.EVOLUTION_API_KEY },
    { chave: 'N8N_CRIS_WEBHOOK',      configurado: !!process.env.N8N_CRIS_WEBHOOK },
  ];
  res.json(chaves);
});
```

---

## Estilo e UX

- **Sem emojis** — usar apenas ícones lucide-react
- Ícones sugeridos: `ShieldCheck`, `Lock`, `Database`, `Key`, `Users`, `Globe`, `AlertTriangle`, `CheckCircle2`
- **Checklist de segurança**: verde = `CheckCircle2 text-green-500`, amarelo = `AlertTriangle text-yellow-500`, vermelho = `XCircle text-red-500`
- **Badges de role**: admin → `bg-purple-500/20 text-purple-400 border-purple-500/30` · usuário → `bg-muted text-muted-foreground`
- **Tabelas**: usar `Table` do shadcn/ui com linhas clicáveis e hover sutil
- **Expansão inline de módulos**: acordeão com `AnimatePresence` (framer-motion se disponível)

---

## Não alterar
Nenhum arquivo existente além dos listados acima. Os routers, middleware e auth não mudam.
