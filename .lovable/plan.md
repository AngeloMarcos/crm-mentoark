## Conclusão: Sprint 7 não tem ação aplicável

O sprint foi escrito assumindo um backend que usa o **Supabase JS SDK** (`createClient` de `@supabase/supabase-js`). Este projeto **não usa**.

### Arquitetura real

- Backend Express conecta direto no Postgres da VPS (`147.93.9.172/crm`) via `pg.Pool`
- `backend/src/db.ts` exporta uma **única instância** `pool` reutilizada por todos os routers
- Pool já configurado com `max: 20`, `idleTimeoutMillis: 30000`, `connectionTimeoutMillis: 5000` — limites sãos
- Nenhum arquivo em `backend/src` chama `createClient` ou importa `@supabase/supabase-js`

O frontend usa Supabase SDK (`src/integrations/supabase/client.ts`) mas isso roda no browser de cada usuário, não tem pooling de servidor pra esgotar.

### O que fazer

**Nada no código.** Em vez de aplicar o sprint como escrito, recomendo:

1. **Pular para o próximo sprint** — esta verificação já está OK
2. (Opcional) Adicionar monitoramento de saturação do pool em produção:
   - Endpoint `/health` já testa `SELECT 1`
   - Poderia expor `pool.totalCount`, `pool.idleCount`, `pool.waitingCount` num `/health/pool` admin-only
   - Útil pra detectar leaks de conexão (queries sem `release()`)
3. (Opcional) Reduzir `max: 20` se o Postgres da VPS tiver pouco `max_connections` configurado — múltiplos containers + n8n + pgadmin podem somar e estourar

### Por que recomendo apenas pular

Adicionar um arquivo `lib/supabase.ts` singleton seria criar código morto — nada chamaria. O risco zero não vale a complexidade extra.

### Se você quiser monitoramento opcional

Me diga "aplicar monitoramento do pool" que eu faço:
- Novo endpoint `GET /health/pool` (admin-only) retornando `{ total, idle, waiting }`
- Log periódico em `cron.ts` se `waitingCount > 0` por mais de N segundos

Caso contrário, manda o **Sprint 8**.