Varri todas as 31 páginas + componentes. Encontrei 4 módulos com gaps reais + 1 bug crítico de auth espalhado pelo código.

## Bug crítico (afeta vários módulos)

**Token storage inconsistente** — `useAuth`/ApiClient salvam em `crm_access_token`, mas 19 arquivos fazem `fetch` direto usando `localStorage.getItem("access_token")` (chave errada). Esses requests vão sem `Authorization` válido e dependem de o backend ter modo compat ou estão retornando 401 silenciosamente.

Arquivos afetados: `Usuarios.tsx`, `CentralBI.tsx`, `CatalogoEnvios.tsx`, `Integracoes.tsx`, `Galeria.tsx`, `InstanceManagementPanel.tsx`, `UsuariosAcessos.tsx`, `BuscarLeadsModal.tsx`, `ChavesIntegracoes.tsx`, `Catalogo.tsx`, `SendWhatsAppModal.tsx`, `CatalogoDetalhe.tsx` (8 ocorrências).

**Fix**: criar um helper `src/lib/api-token.ts` com `getAuthToken()` que lê `crm_access_token` (com fallback pra `access_token` durante transição) e substituir todas as 19 chamadas.

---

## Módulos incompletos

### 1. Workflows (`/workflows`) — 30% pronto
- Builder visual funciona (drag-and-drop, paleta, canvas)
- Botão **Salvar** só persiste em `localStorage` (não no banco)
- Botão **Executar** só mostra `toast.info("Execução via n8n — configure o webhook em Integrações")` — nada acontece
- **Faltam**: tabela `workflows` no Postgres VPS, rota CRUD em `backend/src/routes/workflows.ts`, integração com endpoint `/webhook` do n8n pra disparar execução

### 2. Marketing Digital / Campanhas Meta (`/marketing-digital`) — 60% pronto
- OAuth Facebook implementado, métricas vêm da Meta API
- **Mas**: sem conexão Meta, mostra 3 campanhas MOCK fixas (`MOCK_CAMPANHAS` em `useCampanhas.ts` + `MOCK_LEADS` em `LeadsCaptados.tsx`)
- Pausar/reativar campanha são no-ops em modo mock
- **Faltam**: remover mocks (mostrar empty state "Conecte sua conta Meta"), validar que OAuth callback grava token corretamente, testar fluxo end-to-end

### 3. Segurança (`/seguranca`) — 50% pronto
- Tab **Usuários & Acessos**: real, conectada ao backend ✅
- Tab **Chaves & Integrações**: real ✅
- Tab **Banco & Multi-tenant**: lista de tabelas **hardcoded** no JSX. Inclui `leads` (não existe) e está desatualizada
- Tab **Logins & Sessões**: checklist e config **100% hardcoded** ("Última auditoria: hoje às 14:32" é string literal, botão "Rodar Auditoria" não faz nada, botão "Ver Logs Supabase Audit" não navega)
- **Faltam**: rota `GET /api/seguranca/tabelas` (lista dinâmica via `pg_catalog`), rota `GET /api/seguranca/auditoria` (corre os checks de verdade), conectar botões aos endpoints

### 4. CatálogoEnvios (`/catalogo/envios`) — 95% pronto
- Funciona, mas usa `access_token` (bug acima)
- **Faltam**: filtros (status, tipo, período), paginação (hoje hardcoded em `limit=100`), reenviar item com erro

---

## Plano de execução (ordem sugerida)

| # | Tarefa | Esforço | Impacto |
|---|--------|---------|---------|
| 1 | Helper `getAuthToken()` + refatorar 19 fetches | 30 min | 🔴 Alto — destrava chamadas que estão silenciosamente quebradas |
| 2 | Segurança — tornar tabs Banco e Logins reais (2 rotas backend + refactor componentes) | 2h | 🟠 Médio — página parece pronta mas é fake |
| 3 | Marketing — remover mocks, mostrar empty state honesto | 1h | 🟡 Médio — UX confusa hoje |
| 4 | Workflows — persistência no banco (tabela + rota CRUD + UI de listagem) | 3h | 🟠 Médio — feature visível mas sem efeito |
| 5 | Workflows — execução real via n8n webhook | 2h | 🟢 Baixo — depende de #4 |
| 6 | CatalogoEnvios — filtros + paginação + reenviar | 1h | 🟢 Baixo — incremental |

Total: ~9h para fechar tudo. Posso começar pelo #1 (rápido e libera o resto), ou você prefere atacar primeiro um módulo específico?

## Perguntas

a) Quer que eu execute na ordem acima, ou prioriza algum? (ex: só Workflows + bug do token)
b) Para Workflows backend, ok criar tabela `workflows (id, user_id, nome, nodes jsonb, edges jsonb, ativo, ...)` no Postgres VPS? Eu gero o SQL pra você rodar no pgAdmin.
c) Para Segurança tab "Logins", o que você quer no botão "Ver Logs de Autenticação"? Listar logins recentes da tabela `auth.users` / `refresh_tokens`, ou abrir o pgAdmin?