# 🔐 Sprint Fix — Segurança Multi-Tenant (CRÍTICO)

Foram encontrados 4 problemas de segurança que permitem que um usuário veja dados de outro. Aplique todos os fixes abaixo nos arquivos do backend.

---

## ARQUIVO 1: `backend/src/middleware.ts`

**Motivo:** Se o JWT não contiver o campo `sub`, o `userId` vira `undefined`. Nesse caso o filtro `WHERE user_id = $1` é ignorado silenciosamente e todos os dados são retornados para qualquer usuário.

Substitua a função `authMiddleware` inteira por esta versão:

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

## ARQUIVO 2: `backend/src/crud.ts`

**Motivo:** (a) Não existe rota `DELETE /` então chamadas de bulk delete (ex: apagar conhecimento por tipo) falham com 404 silenciosamente. (b) Se `userId` fosse null por algum bug, o filtro de user_id era pulado permitindo acesso cruzado.

Faça 3 mudanças neste arquivo:

**Mudança A** — No handler `router.get('/', ...)`, logo após a linha `const userId = userIdCol ? req.userId ?? null : null;`, adicione:
```typescript
if (userIdCol && !userId) return res.status(401).json({ message: 'userId ausente' });
```

**Mudança B** — No handler `router.delete('/:id', ...)`, logo após a linha `const userId = userIdCol ? req.userId ?? null : null;`, adicione:
```typescript
if (userIdCol && !userId) return res.status(401).json({ message: 'userId ausente' });
```

**Mudança C** — Adicione este novo handler ANTES do `return router;` no final do arquivo:
```typescript
// DELETE / (bulk delete com filtros — ex: deletar por tipo)
router.delete('/', wrap(async (req: AuthRequest, res: Response) => {
  const userId = userIdCol ? req.userId ?? null : null;
  if (userIdCol && !userId) return res.status(401).json({ message: 'userId ausente' });

  const { conditions, params } = buildWhere(req.query as any, userIdCol, userId);

  if (!conditions.length) {
    return res.status(400).json({ message: 'Bulk delete requer pelo menos um filtro' });
  }

  const sql = `DELETE FROM ${tableName} WHERE ${conditions.join(' AND ')}`;
  await pool.query(sql, params);
  return res.status(204).send();
}));
```

---

## ARQUIVO 3: `backend/src/routes/usuarios.ts`

**Motivo:** O endpoint `GET /api/user_roles` estava aberto para qualquer usuário autenticado, expondo roles de todos os outros usuários.

Encontre esta linha:
```typescript
router.get('/user_roles', async (req: AuthRequest, res: Response) => {
```

Substitua por:
```typescript
router.get('/user_roles', adminMiddleware, async (req: AuthRequest, res: Response) => {
```

---

## ARQUIVO 4: `backend/src/services/agentEngine.ts`

**Motivo:** A busca do agente pelo webhook usava apenas o nome da instância WhatsApp sem garantir que `user_id` não seja null. Em caso de duplicidade de instância entre tenants, dados seriam cruzados.

Encontre este trecho (dentro de `processarMensagem`):
```typescript
const agenteRes = await pool.query(
  `SELECT * FROM agentes WHERE evolution_instancia = $1 AND ativo = true LIMIT 1`,
  [entrada.instancia]
);
```

Substitua por:
```typescript
const agenteRes = await pool.query(
  `SELECT * FROM agentes
   WHERE evolution_instancia = $1 AND ativo = true AND user_id IS NOT NULL
   ORDER BY created_at DESC LIMIT 1`,
  [entrada.instancia]
);
```

---

## Checklist pós-fix
- [ ] Todos os 4 arquivos modificados
- [ ] Build do backend passa sem erros TypeScript
- [ ] Endpoints `/api/agent_prompts`, `/api/conhecimento`, `/api/agentes` retornam apenas dados do usuário autenticado
- [ ] `GET /api/user_roles` retorna 403 para usuários não-admin
- [ ] `DELETE /api/conhecimento?tipo_in=negocio,personalidade` retorna 204 (não mais 404)
