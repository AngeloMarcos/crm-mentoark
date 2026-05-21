# Sprint 7 — Auditoria: Disparos + CRUD — Rate Limit em Memória + SELECT * + Limite Padrão
**Arquivos:** `backend/src/routes/disparos.ts`, `backend/src/crud.ts`
**Severidade:** 🟠 ALTO

---

## Problemas encontrados

### 1. Rate limiting de disparos em memória (`Map`) — perde no restart
```typescript
const lastSentAt = new Map<string, number>();
```
Toda vez que o servidor reinicia (deploy, crash, OOM), o rate limit de
1 msg/s é zerado. Um restart pode ser explorado para disparar mensagens
em rajada além do limite.

### 2. CRUD usa `SELECT *` em todas as tabelas
`crud.ts` linha 100: `SELECT * FROM ${tableName}${whereClause}`
`SELECT *` traz todas as colunas inclusive campos grandes (texto longo, JSONB)
mesmo quando o cliente só precisa de 2-3 campos. Em tabelas como `conhecimento`
ou `n8n_chat_histories` isso pode trazer MBs por query.

### 3. Limite padrão do CRUD é 1000 registros por request
```typescript
const limit = Math.min(parseInt(String(req.query.limit || '1000'), 10) || 1000, 2000);
```
O padrão é 1000, máximo é 2000. Para tabelas com muitos registros
(contatos, disparo_logs), isso pode retornar payloads de vários MB
a cada requisição do frontend.

### 4. `disparo_log_id` não verificado como pertencente ao `disparo_id`
No `POST /disparos/enviar`, o `disparo_log_id` vem do body sem cruzamento
com o `disparo_id`. Um usuário poderia atualizar o log de outro disparo
se adivinhar o UUID.

### 5. `UPDATE disparos SET falhas + 1` sem checar `disparo_id` no mesmo tenant
Em caso de erro, a query:
```typescript
`UPDATE disparos SET falhas = falhas + 1 WHERE id = $1 AND user_id = $2`
```
Está correta (tem user_id). ✓ OK — mas `disparo_log_id` não tem essa verificação cruzada.

---

## Fixes

### `backend/src/routes/disparos.ts`

#### Fix 1 — Rate limiting persistente via Redis ou banco

Se Redis não estiver disponível, usar o banco como fallback:

```typescript
// Substituir o Map em memória por verificação no banco
// Remove estas linhas:
// const lastSentAt = new Map<string, number>();
// export const _lastSentAt = lastSentAt;

// Adicionar helper de rate limit via banco:
async function checkRateLimit(pool: Pool, userId: string): Promise<boolean> {
  const r = await pool.query(`
    SELECT last_disparo_at FROM disparo_rate_limit
    WHERE user_id = $1
    FOR UPDATE SKIP LOCKED
  `, [userId]).catch(() => ({ rows: [] as any[] }));

  const now = Date.now();
  const lastAt = r.rows[0]?.last_disparo_at
    ? new Date(r.rows[0].last_disparo_at).getTime()
    : 0;

  if (now - lastAt < 1000) return false; // bloqueado

  await pool.query(`
    INSERT INTO disparo_rate_limit (user_id, last_disparo_at)
    VALUES ($1, NOW())
    ON CONFLICT (user_id) DO UPDATE SET last_disparo_at = NOW()
  `, [userId]).catch(() => {});

  return true;
}
```

Adicionar à migration:
```typescript
  await pool.query(`
    CREATE TABLE IF NOT EXISTS disparo_rate_limit (
      user_id         UUID PRIMARY KEY,
      last_disparo_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
```

No handler de envio, substituir o check de Map:
```typescript
// ANTES:
const now = Date.now();
const last = lastSentAt.get(userId) ?? 0;
if (now - last < 1000) { ... }

// DEPOIS:
const allowed = await checkRateLimit(pool, userId);
if (!allowed) {
  res.set('Retry-After', '1');
  return res.status(429).json({
    message: 'Limite de 1 mensagem por segundo atingido — tente novamente em instantes',
  });
}
```

#### Fix 2 — Verificar que disparo_log_id pertence ao disparo_id

Logo antes do rate limit check no enviar:
```typescript
// Verificar que disparo_log e disparo pertencem ao mesmo user e são relacionados
const logCheck = await pool.query(
  `SELECT id FROM disparo_logs
   WHERE id = $1 AND disparo_id = $2 AND user_id = $3`,
  [disparo_log_id, disparo_id, userId]
);
if (!logCheck.rows.length) {
  return res.status(403).json({ message: 'disparo_log_id inválido para este disparo' });
}
```

---

### `backend/src/crud.ts`

#### Fix 3 — Reduzir limite padrão

```typescript
// ANTES:
const limit = Math.min(parseInt(String(req.query.limit || '1000'), 10) || 1000, 2000);

// DEPOIS:
const limit = Math.min(parseInt(String(req.query.limit || '100'), 10) || 100, 500);
```

> **Nota**: O frontend pode precisar de ajuste se usa o limite padrão.
> Páginas que precisam de mais registros devem passar `?limit=N` explicitamente.

#### Fix 4 — Suporte a `?select=col1,col2` no CRUD

Adicionar ao `RESERVED_PARAMS`:
```typescript
const RESERVED_PARAMS = new Set(['order', 'asc', 'limit', 'page', 'head', 'select', 'count']);
```

Na query de GET all, permitir seleção de colunas:
```typescript
  // Colunas permitidas: apenas letras, números e underscore
  const selectParam = String(req.query.select || '').trim();
  const selectCols = selectParam
    ? selectParam
        .split(',')
        .filter(c => /^[a-z_][a-z0-9_]*$/.test(c.trim()))
        .join(', ')
    : '*';

  let sql = `SELECT ${selectCols || '*'} FROM ${tableName}${whereClause}`;
```

---

## Relatório solicitado ao final

Após aplicar, informe:
1. Tabela `disparo_rate_limit` criada e ativa?
2. Verificação cruzada de `disparo_log_id + disparo_id + user_id` adicionada?
3. Limite padrão do CRUD reduzido de 1000 para 100?
4. Suporte a `?select=` adicionado?
5. Frontend apresentou algum problema após redução do limite?
