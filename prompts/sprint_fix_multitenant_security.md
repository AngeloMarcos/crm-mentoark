# Sprint Fix — Isolamento Multi-Tenant (Segurança Crítica)

## Contexto
Foi identificado que um usuário novo conseguia ver dados de outro usuário (vazamento de dados entre tenants).
A auditoria revelou 4 problemas no backend. Este sprint corrige todos eles.

---

## Fix 1 — `backend/src/middleware.ts`
**Problema:** Se o JWT não tiver o campo `sub`, o `userId` ficava `undefined` e o filtro `WHERE user_id = $1` era ignorado silenciosamente, retornando dados de TODOS os usuários.
**Correção:** Rejeitar o token com 401 se `sub` estiver ausente. Garantir que `userId` seja sempre uma string.

Substitua a função `authMiddleware` completa por:

```typescript
export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Token não fornecido' });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as any;
    if (!payload.sub) {
      return res.status(401).json({ message: 'Token inválido: sub ausente' });
    }
    req.userId   = String(payload.sub);
    req.userRole = payload.role;
    req.userEmail = payload.email;
    next();
  } catch {
    return res.status(401).json({ message: 'Token inválido ou expirado' });
  }
}
```

---

## Fix 2 — `backend/src/crud.ts`
**Problema 1:** Sem rota `DELETE /` — chamadas de bulk delete (ex: apagar conhecimento por tipo) falhavam silenciosamente com 404.
**Problema 2:** Se `userId` fosse null, os filtros de `user_id` eram ignorados permitindo acesso a dados de outros usuários.
**Correção:** Adicionar guard `if (userIdCol && !userId) return 401` nos handlers GET e DELETE. Adicionar rota `DELETE /` com user_id obrigatório.

**No handler `GET /`**, adicione logo após `const userId = ...`:
```typescript
if (userIdCol && !userId) return res.status(401).json({ message: 'userId ausente' });
```

**No handler `DELETE /:id`**, adicione logo após `const userId = ...`:
```typescript
if (userIdCol && !userId) return res.status(401).json({ message: 'userId ausente' });
```

**Adicione uma nova rota `DELETE /`** ANTES do `return router;` final:
```typescript
// DELETE / (bulk delete por filtros de query string)
router.delete('/', wrap(async (req: AuthRequest, res: Response) => {
  const userId = userIdCol ? req.userId ?? null : null;
  if (userIdCol && !userId) return res.status(401).json({ message: 'userId ausente' });

  const { conditions, params } = buildWhere(req.query as any, userIdCol, userId);

  // Nunca deletar tudo sem nenhum filtro
  if (!conditions.length) {
    return res.status(400).json({ message: 'Bulk delete requer pelo menos um filtro' });
  }

  const sql = `DELETE FROM ${tableName} WHERE ${conditions.join(' AND ')}`;
  await pool.query(sql, params);
  return res.status(204).send();
}));
```

---

## Fix 3 — `backend/src/routes/usuarios.ts`
**Problema:** O endpoint `GET /api/user_roles` não exigia autenticação de admin — qualquer usuário logado conseguia listar os roles de todos os outros usuários.
**Correção:** Adicionar `adminMiddleware` no GET `/user_roles`.

Mude:
```typescript
router.get('/user_roles', async (req: AuthRequest, res: Response) => {
```
Para:
```typescript
router.get('/user_roles', adminMiddleware, async (req: AuthRequest, res: Response) => {
```

---

## Fix 4 — `backend/src/services/agentEngine.ts`
**Problema:** A busca do agente pelo webhook usava apenas `evolution_instancia` sem verificar `user_id IS NOT NULL`. Se dois usuários configurassem a mesma instância, o primeiro agente encontrado seria usado — cruzando dados entre tenants.
**Correção:** Adicionar `AND user_id IS NOT NULL` na query e ordenar por `created_at DESC` para pegar o registro mais recente.

Mude a query na função `processarMensagem`:
```typescript
// DE:
const agenteRes = await pool.query(
  `SELECT * FROM agentes WHERE evolution_instancia = $1 AND ativo = true LIMIT 1`,
  [entrada.instancia]
);

// PARA:
const agenteRes = await pool.query(
  `SELECT * FROM agentes
   WHERE evolution_instancia = $1 AND ativo = true AND user_id IS NOT NULL
   ORDER BY created_at DESC LIMIT 1`,
  [entrada.instancia]
);
```

---

## Após aplicar os fixes
1. Fazer build do backend: `cd backend && npm run build`
2. Fazer deploy no VPS via script `node deploy.mjs` ou via SSH
3. Executar no pgAdmin a migration diagnóstico: `supabase/migrations/20260512000004_fix_multitenant_isolation.sql`
4. Verificar na última query da migration se cada usuário tem seus próprios dados isolados
