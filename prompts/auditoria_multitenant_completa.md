# Auditoria Multi-Tenant — MentoArk CRM
**Data:** 2026-05-13 | **Escopo:** Todos os arquivos backend + schema de banco

---

## RESULTADO GERAL

| Categoria | Status |
|---|---|
| Middleware JWT (`middleware.ts`) | ✅ Seguro |
| Factory CRUD (`crud.ts`) | ⚠️ 2 gaps menores |
| Rotas especializadas (contatos, agentes, etc.) | ✅ Seguro |
| Webhook Evolution | ✅ Seguro |
| MCP (n8n) | 🔴 Vulnerável se MCP_SECRET não configurado |
| Endpoint público catálogo n8n | 🔴 Expõe dados sem autenticação |
| `chat_messages` / `chats` / `dados_cliente` | ⚠️ Colunas user_id adicionadas mas dados antigos podem ter NULL |
| Schema do banco (migrations) | ✅ user_id presente em todas as tabelas críticas |

---

## FALHAS ENCONTRADAS (ordenadas por gravidade)

---

### 🔴 CRÍTICO 1 — Endpoint `/api/catalogo/n8n/:userId` é PÚBLICO sem autenticação

**Arquivo:** `backend/src/index.ts` (linha 62)

```typescript
// PROBLEMA: qualquer pessoa que souber um UUID de usuário
// consegue ver TODOS os produtos e catálogos desse usuário
app.get('/api/catalogo/n8n/:userId', async (req, res) => { ... });
```

Este endpoint foi criado para o n8n acessar os catálogos, mas não exige nenhum token.
Um atacante que descobrir o UUID de um cliente pode listar todos os seus produtos e preços.

**Correção:** Proteger com um segredo estático de n8n, ou exigir o JWT do agente:

```typescript
// backend/src/index.ts
app.get('/api/catalogo/n8n/:userId', async (req, res) => {
  // Verifica segredo compartilhado com n8n
  const secret = req.headers['x-n8n-secret'] || req.query.secret;
  if (!secret || secret !== process.env.N8N_CATALOG_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  // ... resto do handler
});
```

Adicionar `N8N_CATALOG_SECRET=<string_aleatoria>` no `.env` e configurar o mesmo no n8n.

---

### 🔴 CRÍTICO 2 — MCP sem segredo deixa todos os dados expostos

**Arquivo:** `backend/src/routes/mcp.ts` (linha 9-19)

```typescript
function checkAuth(req, res): boolean {
  const secret = process.env.MCP_SECRET;
  if (!secret) return true;  // ← SE MCP_SECRET não estiver no .env, TUDO está aberto!
  ...
}
```

Se `MCP_SECRET` não estiver configurado no `.env` do VPS, o endpoint `/mcp/sse` e `/mcp/messages` ficam completamente abertos. Qualquer um pode listar contatos, conhecimento e conversa de qualquer usuário.

Além disso, a ferramenta MCP `obter_historico_conversa` busca conversas **sem filtrar por user_id**:
```typescript
// PROBLEMA: qualquer chamador com acesso ao MCP pode ler conversa de qualquer telefone
WHERE session_id = $1  // falta: AND user_id = $2
```

**Correção:**
1. Garantir que `MCP_SECRET` está no `.env` do VPS com um valor forte.
2. Tornar o `MCP_SECRET` **obrigatório** (se não estiver configurado, rejeitar):

```typescript
function checkAuth(req: Request, res: Response): boolean {
  const secret = process.env.MCP_SECRET;
  if (!secret) {
    res.status(503).json({ error: 'MCP_SECRET não configurado no servidor' });
    return false;
  }
  const key = (req.headers['x-mcp-key'] as string) || (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (key !== secret) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}
```

3. Em `obter_historico_conversa`, exigir `user_id` e filtrar:
```typescript
server.tool('obter_historico_conversa', '...', {
  user_id: z.string().describe('UUID do usuário dono da conversa'),
  session_id: z.string(),
  limit: z.number().int().min(1).max(100).optional().default(20),
}, async ({ user_id, session_id, limit }) => {
  const r = await pool.query(
    `SELECT session_id, message, created_at
     FROM n8n_chat_histories
     WHERE session_id = $1 AND user_id = $2
     ORDER BY created_at DESC LIMIT $3`,
    [session_id, user_id, limit ?? 20]
  );
  ...
});
```

---

### ⚠️ MÉDIO 1 — `GET /:id` no `crud.ts` não tem guard 401

**Arquivo:** `backend/src/crud.ts` (linha 120-131)

```typescript
router.get('/:id', wrap(async (req: AuthRequest, res: Response) => {
  const userId = userIdCol ? req.userId ?? null : null;
  // ← FALTA: if (userIdCol && !userId) return res.status(401).json(...)
  const params: any[] = [req.params.id];
  let sql = `SELECT * FROM ${tableName} WHERE ${idCol} = $1`;
  if (userIdCol && userId) {
    sql += ` AND ${userIdCol} = $2`;
    params.push(userId);
  }
  // Se userId for null (não deveria ocorrer após fix do middleware), retorna qualquer registro pelo id
```

Embora o `authMiddleware` corrigido garanta que `req.userId` sempre seja string, a defesa em profundidade exige a guard no próprio handler.

**Correção:** Adicionar logo após a linha `const userId = ...`:
```typescript
if (userIdCol && !userId) return res.status(401).json({ message: 'userId ausente' });
```

---

### ⚠️ MÉDIO 2 — `PUT /` (bulk update) no `crud.ts` não tem guard 401

**Arquivo:** `backend/src/crud.ts` (linha 185-207)

Mesma situação do GET /:id. O `DELETE /` e `DELETE /:id` têm a guard, mas o `PUT /` não tem.

**Correção:** Adicionar após `const userId = ...`:
```typescript
if (userIdCol && !userId) return res.status(401).json({ message: 'userId ausente' });
```

---

### ⚠️ MÉDIO 3 — `chat_messages`, `chats`, `dados_cliente` com user_id NULL

**Migration:** `20260512232228` adicionou a coluna `user_id` a essas tabelas, mas dados anteriores têm `user_id = NULL`.

O backend filtra por `user_id = $1`, então registros com `user_id NULL` ficam invisíveis para todos os usuários — não há vazamento, mas pode haver perda de dados históricos.

**Verificar no pgAdmin:**
```sql
SELECT 'chat_messages' AS tabela, COUNT(*) FROM chat_messages WHERE user_id IS NULL
UNION ALL
SELECT 'chats', COUNT(*) FROM chats WHERE user_id IS NULL
UNION ALL
SELECT 'dados_cliente', COUNT(*) FROM dados_cliente WHERE user_id IS NULL;
```

Se houver registros, associar ao usuário correto antes de adicionar NOT NULL.

---

### ⚠️ MÉDIO 4 — `n8n_chat_histories` sem índice composto user_id + session_id

Para multi-tenant com muitos clientes, a busca `WHERE session_id = $1 AND user_id = $2` vai ser lenta sem índice.

**Correção SQL:**
```sql
CREATE INDEX IF NOT EXISTS idx_n8n_chat_uid_session
  ON n8n_chat_histories(user_id, session_id);
CREATE INDEX IF NOT EXISTS idx_n8n_chat_uid_created
  ON n8n_chat_histories(user_id, created_at DESC);
```

---

### ℹ️ INFO 1 — `disparos` registra tabela `disparos` mas a rota monta `makeCrud(pool, 'disparos')`

Não existe tabela `disparos` nas migrations — a tabela de campanhas de disparo parece ser `campanhas`. Verificar se a tabela `disparos` existe no banco; se não existir, a rota vai dar erro 500 em toda operação CRUD.

**Verificar:**
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('disparos', 'campanhas', 'disparo_logs');
```

---

### ℹ️ INFO 2 — `webhook_mensagens_processadas` — tabela de deduplicação pode não existir

**Arquivo:** `backend/src/routes/webhook.ts` (linha 78-84)

O webhook usa:
```sql
SELECT id FROM webhook_mensagens_processadas WHERE id = $1
INSERT INTO webhook_mensagens_processadas (id, instancia, telefone) VALUES (...)
```

Se esta tabela não existir no banco, todo webhook vai dar erro 500 e nenhuma mensagem será processada.

---

## MIGRATION SQL CORRETIVA

Execute no pgAdmin (`147.93.9.172:5432 / crm`):

```sql
-- ============================================================
-- MIGRATION: Correções Multi-Tenant e Segurança
-- Execute: pgAdmin → db crm → Query Tool
-- ============================================================

-- 1. Garantir que webhook_mensagens_processadas existe
CREATE TABLE IF NOT EXISTS webhook_mensagens_processadas (
  id          TEXT PRIMARY KEY,
  instancia   TEXT,
  telefone    TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webhook_proc_created
  ON webhook_mensagens_processadas(created_at);

-- Auto-limpar registros com mais de 24h (evitar crescimento infinito)
-- (Rodar como job periódico ou via cron no backend)
-- DELETE FROM webhook_mensagens_processadas WHERE created_at < NOW() - INTERVAL '24 hours';

-- 2. Índices de performance multi-tenant em n8n_chat_histories
CREATE INDEX IF NOT EXISTS idx_n8n_chat_uid_session
  ON n8n_chat_histories(user_id, session_id);
CREATE INDEX IF NOT EXISTS idx_n8n_chat_uid_created
  ON n8n_chat_histories(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_n8n_chat_session_created
  ON n8n_chat_histories(session_id, created_at ASC);

-- 3. Verificar NULLs nas tabelas recentemente migradas
SELECT 'chat_messages' AS tabela, COUNT(*) AS nulls FROM chat_messages WHERE user_id IS NULL
UNION ALL
SELECT 'chats', COUNT(*) FROM chats WHERE user_id IS NULL
UNION ALL
SELECT 'dados_cliente', COUNT(*) FROM dados_cliente WHERE user_id IS NULL
UNION ALL
SELECT 'n8n_chat_histories', COUNT(*) FROM n8n_chat_histories WHERE user_id IS NULL;

-- 4. Verificar se tabela 'disparos' existe (vs 'campanhas')
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('disparos', 'campanhas', 'disparo_logs', 'listas', 'tarefas');

-- 5. Verificar se todas as tabelas do SIMPLE_TABLES têm coluna user_id
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name = 'user_id'
  AND table_name IN (
    'listas','chamadas','timeline_eventos','tarefas','campanhas',
    'disparo_logs','agentes','conhecimento','integracoes_config',
    'catalogos','produtos','produto_imagens','dados_cliente',
    'chat_messages','chats','contatos','agent_prompts',
    'documents','n8n_chat_histories','galeria_imagens',
    'produto_imagens','user_modulos'
  )
ORDER BY table_name;

-- 6. Diagnóstico: quantos dados cada usuário tem (visibilidade por tenant)
SELECT
  u.email,
  u.id,
  u.role,
  (SELECT COUNT(*) FROM contatos c WHERE c.user_id = u.id) AS contatos,
  (SELECT COUNT(*) FROM agentes a WHERE a.user_id = u.id) AS agentes,
  (SELECT COUNT(*) FROM agent_prompts ap WHERE ap.user_id = u.id) AS prompts,
  (SELECT COUNT(*) FROM conhecimento k WHERE k.user_id = u.id) AS conhecimento,
  (SELECT COUNT(*) FROM n8n_chat_histories h WHERE h.user_id = u.id) AS historico_msgs,
  (SELECT COUNT(*) FROM integracoes_config ic WHERE ic.user_id = u.id) AS integracoes
FROM users u
ORDER BY u.created_at;

-- 7. Detectar instâncias Evolution duplicadas entre tenants (problema grave)
SELECT evolution_instancia, COUNT(*) AS qtd, array_agg(user_id::text) AS users
FROM agentes
WHERE evolution_instancia IS NOT NULL AND evolution_instancia <> ''
GROUP BY evolution_instancia
HAVING COUNT(*) > 1;

-- 8. Garantir NOT NULL em n8n_chat_histories.user_id (após verificar NULL count acima)
-- ATENÇÃO: só executar se a query 3 retornar 0 NULLs para n8n_chat_histories
-- ALTER TABLE n8n_chat_histories ALTER COLUMN user_id SET NOT NULL;
```

---

## CORREÇÕES NO BACKEND (código)

### Arquivo: `backend/src/crud.ts`

**Mudança A** — Adicionar guard em `GET /:id` (linha ~122):
```typescript
router.get('/:id', wrap(async (req: AuthRequest, res: Response) => {
  const userId = userIdCol ? req.userId ?? null : null;
  if (userIdCol && !userId) return res.status(401).json({ message: 'userId ausente' }); // ← ADICIONAR
  ...
```

**Mudança B** — Adicionar guard em `PUT /` (linha ~186):
```typescript
router.put('/', wrap(async (req: AuthRequest, res: Response) => {
  const userId = userIdCol ? req.userId ?? null : null;
  if (userIdCol && !userId) return res.status(401).json({ message: 'userId ausente' }); // ← ADICIONAR
  ...
```

### Arquivo: `backend/src/index.ts`

**Mudança C** — Proteger endpoint público do catálogo:
```typescript
app.get('/api/catalogo/n8n/:userId', async (req, res) => {
  const secret = req.headers['x-n8n-secret'] || req.query.secret;
  if (process.env.N8N_CATALOG_SECRET && secret !== process.env.N8N_CATALOG_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  // ... resto do código existente sem alteração
});
```

### Arquivo: `backend/src/routes/mcp.ts`

**Mudança D** — Tornar MCP_SECRET obrigatório:
```typescript
function checkAuth(req: Request, res: Response): boolean {
  const secret = process.env.MCP_SECRET;
  if (!secret) {
    res.status(503).json({ error: 'MCP não disponível: MCP_SECRET não configurado' });
    return false;
  }
  const key = (req.headers['x-mcp-key'] as string) || (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (key !== secret) { res.status(401).json({ error: 'Unauthorized' }); return false; }
  return true;
}
```

**Mudança E** — Filtrar `obter_historico_conversa` por user_id:
```typescript
server.tool('obter_historico_conversa', '...', {
  user_id: z.string().describe('UUID do usuário dono da conversa'),
  session_id: z.string(),
  limit: z.number().int().min(1).max(100).optional().default(20),
}, async ({ user_id, session_id, limit }) => {
  const r = await pool.query(
    `SELECT session_id, message, created_at
     FROM n8n_chat_histories
     WHERE session_id = $1 AND user_id = $2
     ORDER BY created_at DESC LIMIT $3`,
    [session_id, user_id, limit ?? 20]
  );
  ...
});
```

### Arquivo: `backend/.env` (VPS)

Verificar e adicionar se não existirem:
```
MCP_SECRET=<gerar string aleatória forte, ex: openssl rand -hex 32>
N8N_CATALOG_SECRET=<outra string aleatória>
```

---

## RESUMO DOS STATUS POR ARQUIVO

| Arquivo | Isolamento | Status |
|---|---|---|
| `middleware.ts` | JWT com sub obrigatório | ✅ |
| `crud.ts` GET / | Guard userId ✅ | ✅ |
| `crud.ts` GET /:id | **Sem guard userId** | ⚠️ Corrigir |
| `crud.ts` POST / | Injeta userId automaticamente | ✅ |
| `crud.ts` PUT /:id | AND user_id no UPDATE | ✅ |
| `crud.ts` PUT / | **Sem guard userId** | ⚠️ Corrigir |
| `crud.ts` DELETE /:id | Guard userId ✅ | ✅ |
| `crud.ts` DELETE / | Guard userId ✅ | ✅ |
| `contatos.ts` | user_id = $1 em todas queries | ✅ |
| `agent_prompts.ts` | user_id em todas queries | ✅ |
| `disparos.ts` | user_id em todas queries | ✅ |
| `dashboard.ts` | user_id = $1 | ✅ |
| `functions.ts` | user_id em todas queries | ✅ |
| `galeria.ts` | user_id em todas queries | ✅ |
| `catalogo.ts` | user_id em todas queries | ✅ |
| `usuarios.ts` | adminMiddleware em user_roles | ✅ |
| `modulos.ts` | user_id em todas queries | ✅ |
| `agentEngine.ts` | user_id IS NOT NULL na lookup | ✅ |
| `webhook.ts` | Público, sem dados sensíveis | ✅ |
| `mcp.ts` | **MCP_SECRET opcional** | 🔴 Corrigir |
| `index.ts` catalogo/n8n | **Sem autenticação** | 🔴 Corrigir |
| `n8n_chat_histories.ts` | user_id em queries | ✅ |

---

## CHECKLIST PÓS-CORREÇÃO

- [ ] Executar migration SQL acima no pgAdmin
- [ ] Verificar resultado da query 3 (NULLs): deve ser zero em `n8n_chat_histories`
- [ ] Verificar resultado da query 4 (tabela `disparos` existe?)
- [ ] Verificar resultado da query 5 (todas as tabelas têm `user_id`)
- [ ] Verificar resultado da query 7 (sem instâncias duplicadas entre tenants)
- [ ] Corrigir `crud.ts` (guards em GET /:id e PUT /)
- [ ] Corrigir `index.ts` (proteger endpoint catalogo/n8n)
- [ ] Corrigir `mcp.ts` (MCP_SECRET obrigatório + filtro user_id no histórico)
- [ ] Adicionar `MCP_SECRET` e `N8N_CATALOG_SECRET` no `.env` do VPS
- [ ] Rebuild e redeploy do backend
- [ ] Testar: criar 2 usuários, verificar que cada um vê apenas seus dados
