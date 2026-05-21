# Sprint 4 — Auditoria: WhatsApp — Chave API hardcoded + Performance
**Arquivo:** `backend/src/routes/whatsapp.ts`
**Severidade:** 🔴 CRÍTICO

---

## Problemas encontrados

### 1. API Key Evolution hardcoded como fallback — EXPOSIÇÃO DE CREDENCIAL
```typescript
const DEFAULT_EVO_KEY = process.env.EVOLUTION_API_KEY || 'mentoark2025evolutionkey';
```
A chave `mentoark2025evolutionkey` está visível no código-fonte.
Se o repositório for compartilhado ou vazado, qualquer pessoa pode usar
esta chave para controlar a instância Evolution API.

### 2. `SELECT to_regclass` executado em CADA requisição
Toda chamada a `/api/whatsapp/conversas` e `/api/whatsapp/conversas/:phone`
executa `SELECT to_regclass('public.whatsapp_messages')` para checar se a
tabela existe. Isso é desnecessário — a tabela existe ou não (nunca muda
em produção).

### 3. Sem paginação real na listagem de conversas
`LIMIT 200` hardcoded. Com usuários ativos, 200 conversas podem ter
dezenas de KB de payload, deixando o frontend lento.

### 4. `INSERT INTO agentes ... ON CONFLICT DO NOTHING` sem clausula `(coluna)`
O `ON CONFLICT DO NOTHING` sem especificar a constraint pode ignorar
erros de forma silenciosa em vez de tratar o conflito correto.

---

## Fixes

### `backend/src/routes/whatsapp.ts`

#### Fix 1 — Remover chave hardcoded

```typescript
// ANTES (INSEGURO):
const DEFAULT_EVO_KEY = process.env.EVOLUTION_API_KEY || 'mentoark2025evolutionkey';

// DEPOIS (SEGURO):
const DEFAULT_EVO_URL = process.env.EVOLUTION_API_URL || 'https://disparo.mentoark.com.br';
const DEFAULT_EVO_KEY = process.env.EVOLUTION_API_KEY ?? null; // null se não configurado
```

Na função `getEvolutionConfig`, tratar o caso de chave ausente:
```typescript
async function getEvolutionConfig(userId: string): Promise<{...} | null> {
  // ... busca no agente ...

  // Sem agente e sem chave global → retornar null (não tem config)
  if (!DEFAULT_EVO_KEY) return null;

  const instancia = `crm_${userId.slice(0, 8)}`;
  return { url: DEFAULT_EVO_URL, api_key: DEFAULT_EVO_KEY, instancia, agenteId: null, isGlobal: true };
}
```

Nas rotas que usam `getEvolutionConfig`, tratar o retorno null:
```typescript
router.post('/status', async (req: AuthRequest, res: Response) => {
  try {
    const cfg = await getEvolutionConfig(req.userId!);
    if (!cfg) return res.json({ state: 'close', instancia: null, motivo: 'Evolution API não configurada' });
    // ... resto igual
  }
});
```

#### Fix 2 — Cachear verificação da tabela (1x por instância do processo)

Substituir o `SELECT to_regclass` repetitivo:

```typescript
// Fora das rotas — cachear resultado
let _useNewTable: boolean | null = null;

async function checkUseNewTable(pool: Pool): Promise<boolean> {
  if (_useNewTable !== null) return _useNewTable;
  const r = await pool.query(`SELECT to_regclass('public.whatsapp_messages') AS t`);
  _useNewTable = !!r.rows[0]?.t;
  return _useNewTable;
}
```

Nas rotas, substituir `const hasTable = await pool.query(...)` por:
```typescript
const useNewTable = await checkUseNewTable(pool);
```

#### Fix 3 — Paginação na listagem de conversas

Na rota `GET /conversas`, substituir `LIMIT 200` hardcoded:
```typescript
router.get('/conversas', async (req: AuthRequest, res: Response) => {
  const limit  = Math.min(parseInt(String(req.query.limit  || '50'),  10), 100);
  const offset = Math.max(parseInt(String(req.query.offset || '0'),   10), 0);

  // ... na query:
  `... LIMIT $2 OFFSET $3`,
  [userId, limit, offset]
```

#### Fix 4 — ON CONFLICT com constraint explícita

```typescript
// ANTES:
ON CONFLICT DO NOTHING

// DEPOIS (especificar qual coluna causa o conflito):
ON CONFLICT (user_id, evolution_instancia) DO NOTHING
```
> Verificar se a constraint existe. Se não, adicionar em migrations:
> ```sql
> ALTER TABLE agentes ADD CONSTRAINT IF NOT EXISTS
>   uq_agentes_user_instancia UNIQUE (user_id, evolution_instancia);
> ```

---

## Nova variável de ambiente — verificar/adicionar no VPS
```
EVOLUTION_API_KEY=<chave real da Evolution API>
EVOLUTION_API_URL=https://disparo.mentoark.com.br
```

---

## Relatório solicitado ao final

Após aplicar, informe:
1. Chave hardcoded removida do código?
2. `to_regclass` agora executado apenas 1x?
3. Listagem de conversas aceita `?limit=` e `?offset=`?
4. `EVOLUTION_API_KEY` configurado no .env do VPS?
5. Quais outros hardcodes foram encontrados no arquivo?
