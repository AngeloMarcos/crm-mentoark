# Sprint 8 — Auditoria: Usuários + MCP CORS + Role Validation + Cron Cleanup
**Arquivos:** `backend/src/routes/usuarios.ts`, `backend/src/routes/mcp.ts`, `backend/src/index.ts`, `backend/src/cron.ts`
**Severidade:** 🟠 ALTO

---

## Problemas encontrados

### 1. `POST /api/user_roles` aceita qualquer string como role
```typescript
const { user_id, role } = req.body;
await pool.query(`UPDATE users SET role = $1 WHERE id = $2`, [role, user_id]);
```
Um admin pode acidentalmente ou maliciosamente setar `role = "superadmin"`
ou qualquer string inválida. Deve ser restrito a `['admin', 'user']`.

### 2. Admin pode rebaixar a si mesmo para `user`
`DELETE /api/user_roles` seta `role = 'user'` sem verificar se o usuário
está removendo o próprio admin. Se o único admin fizer isso, o sistema
fica sem administrador.

### 3. MCP (`/mcp`) sem headers CORS — n8n Cloud não consegue conectar
O router do MCP não configura headers CORS. Quando o n8n Cloud (em
domínio diferente) tenta fazer a requisição OPTIONS, recebe erro 403 ou
resposta sem os headers corretos, impossibilitando a conexão.

### 4. Sem cron de limpeza para tabelas de crescimento ilimitado
As seguintes tabelas crescem indefinidamente sem limpeza automática:
- `webhook_mensagens_processadas` — dedup de mensagens WhatsApp
- `refresh_tokens` revogados/expirados
- `disparo_rate_limit` — registros de usuários inativos
- `catalogo_mensagens_logs` — histórico de envios

### 5. `GET /api/profiles` retorna todos os usuários sem paginação
```typescript
const r = await pool.query(`SELECT id, email, display_name, created_at FROM users ORDER BY created_at DESC`);
```
Se houver muitos usuários, retorna tudo sem limite — impacto em memória.

---

## Fixes

### `backend/src/routes/usuarios.ts`

#### Fix 1 — Validar roles permitidos

```typescript
const ROLES_PERMITIDOS = ['admin', 'user'] as const;
type UserRole = typeof ROLES_PERMITIDOS[number];

// POST /api/user_roles
router.post('/user_roles', adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { user_id, role } = req.body;
    if (!user_id || !role) return res.status(400).json({ message: 'user_id e role obrigatórios' });

    // NOVO: validar role
    if (!ROLES_PERMITIDOS.includes(role as UserRole)) {
      return res.status(400).json({
        message: `Role inválido. Valores aceitos: ${ROLES_PERMITIDOS.join(', ')}`,
      });
    }

    const r = await pool.query(
      `UPDATE users SET role = $1 WHERE id = $2 RETURNING id AS user_id, role`,
      [role, user_id]
    );
    if (!r.rows.length) return res.status(404).json({ message: 'Usuário não encontrado' });
    return res.status(201).json(r.rows[0]);
  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
});
```

#### Fix 2 — Impedir auto-rebaixamento de admin

```typescript
// DELETE /api/user_roles — impede admin de remover o próprio role
router.delete('/user_roles', adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const user_id = req.query.user_id || req.body.user_id;
    if (!user_id) return res.status(400).json({ message: 'user_id obrigatório' });

    // NOVO: não permitir auto-rebaixamento
    if (String(user_id) === req.userId) {
      return res.status(403).json({ message: 'Você não pode remover seu próprio acesso de admin.' });
    }

    await pool.query(`UPDATE users SET role = 'user' WHERE id = $1`, [user_id]);
    return res.status(204).send();
  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
});
```

#### Fix 3 — Paginação no GET /profiles

```typescript
router.get('/profiles', adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const limit  = Math.min(parseInt(String(req.query.limit  || '50'), 10), 200);
    const offset = Math.max(parseInt(String(req.query.offset || '0'),  10), 0);
    const search = req.query.search ? `%${req.query.search}%` : null;

    const r = await pool.query(
      `SELECT id AS user_id, email, display_name, role, active, created_at
       FROM users
       WHERE ($1::text IS NULL OR email ILIKE $1 OR display_name ILIKE $1)
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [search, limit, offset]
    );
    return res.json(r.rows);
  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
});
```

---

### `backend/src/index.ts` — CORS para o MCP

```typescript
// ── MCP com CORS específico para n8n Cloud ─────────────────────────────────
app.use('/mcp', (req, res, next) => {
  const mcpOrigins = (process.env.MCP_ALLOWED_ORIGINS || 'https://fierceparrot-n8n.cloudfy.live')
    .split(',').map(s => s.trim());

  const origin = req.headers.origin;
  if (!origin || mcpOrigins.includes(origin) || mcpOrigins.includes('*')) {
    res.header('Access-Control-Allow-Origin', origin || '*');
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-mcp-key, mcp-session-id');
  res.header('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
}, mcpRouter(pool));
```

Adicionar ao `.env`:
```
MCP_ALLOWED_ORIGINS=https://fierceparrot-n8n.cloudfy.live,https://n8n.mentoark.com.br
```

---

### `backend/src/cron.ts` — limpeza automática de tabelas

Adicionar job de limpeza periódica:

```typescript
// No arquivo cron.ts, adicionar ou expandir initCronJobs():

export function initCronJobs() {
  // Limpeza diária às 3h00 (horário do servidor)
  setInterval(async () => {
    const hour = new Date().getUTCHours(); // adaptar para timezone do servidor
    if (hour !== 3) return;

    try {
      // 1. Limpar deduplicação de webhook (mais de 24h)
      await pool.query(`DELETE FROM webhook_mensagens_processadas WHERE criado_em < NOW() - INTERVAL '24 hours'`);

      // 2. Limpar refresh tokens revogados/expirados (mais de 30 dias)
      await pool.query(`DELETE FROM refresh_tokens WHERE revoked = true AND expires_at < NOW() - INTERVAL '30 days'`);

      // 3. Limpar rate limit de disparos de usuários inativos (mais de 7 dias)
      await pool.query(`DELETE FROM disparo_rate_limit WHERE last_disparo_at < NOW() - INTERVAL '7 days'`);

      // 4. Limpar logs de catálogo com mais de 90 dias
      await pool.query(`DELETE FROM catalogo_mensagens_logs WHERE created_at < NOW() - INTERVAL '90 days'`);

      // 5. Limpar oauth_state expirado
      await pool.query(`DELETE FROM oauth_state WHERE expires_at < NOW()`);

      console.log('[CRON] Limpeza periódica concluída:', new Date().toISOString());
    } catch (err: any) {
      console.error('[CRON] Erro na limpeza:', err.message);
    }
  }, 60 * 60 * 1000); // verifica a cada hora
}
```

---

## Relatório solicitado ao final

Após aplicar, informe:
1. Role validation adicionada — strings inválidas são rejeitadas?
2. Auto-rebaixamento de admin bloqueado?
3. CORS do `/mcp` funciona com o n8n Cloud?
4. Cron de limpeza configurado e rodando?
5. Paginação no `/profiles` ativa?
6. Quantas tabelas são limpas pelo cron?
7. Algum outro endpoint sem controle de acesso foi identificado?
