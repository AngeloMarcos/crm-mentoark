Sprints 8 e 9 são operações **na VPS de produção** (`147.93.9.172`), não no código deste repo Lovable. Plano de execução:

## Sprint 8 — Monitoramento

O script original usa `pm2`, mas seu stack é **Docker Compose** (sem PM2). Vou gerar `monitor-crm.sh` adaptado:

- ✅ RAM, CPU, disco (passos originais funcionam)
- 🔄 PM2 → Docker: troca `pm2 list ... awk` por `docker ps --format '{{.Names}} {{.Status}}'` + `docker inspect` para detectar restarts dos containers `crm`, `crm-api`, `n8n`, `evolution`, `pgadmin`
- ✅ Health: `curl -sk https://api.mentoark.com.br/health` (via Traefik) em vez de localhost:3000
- ✅ Cron `*/5 * * * *`
- ➕ Adiciono check de containers `unhealthy`/`exited`

**Entrega:** `monitor-crm.sh` no repo (em `scripts/`). Você copia pra VPS com `scp` e roda `bash monitor-crm.sh` + cron.

## Sprint 9 — Módulos dos 2 usuários

**Análise:** Nada bate com o sprint:

- ❌ Não existe tabela `users` com coluna `modulos` (PASSO 2A inválido)
- ✅ Existe tabela `user_modulos (user_id, modulo, ativo)` (PASSO 2B é o caminho)
- ⚠️ **Já existe fallback automático** no backend (`modulos.ts` linha 49-51): se um usuário tem 0 registros em `user_modulos`, retorna os 7 módulos `padrao` (`dashboard, leads, contatos, discagem, funil, whatsapp, disparos`) — exatamente os que o sprint quer setar.

Ou seja: **provavelmente esses 2 usuários JÁ têm acesso** aos módulos padrão. Se mesmo assim eles relatam "não conseguem usar", o bug pode estar em outro lugar (role no JWT, frontend que ignora o fallback, RLS no Supabase, etc).

**Antes de rodar o SQL eu preciso confirmar com você** (não tenho acesso ao Postgres da VPS daqui):

1. Esses 2 emails realmente existem como users no Postgres da VPS? Quais são os IDs?
2. Eles têm linhas em `user_modulos` com `ativo=false` (que silenciaria o fallback)? Ou estão zerados mesmo?
3. Qual sintoma específico eles relatam — sidebar vazia? Erro 403? Tela em branco?

### Entrega Sprint 9

Vou gerar `scripts/sprint9-fix-modulos.sql` que:
- Diagnostica: `SELECT user_id, count(*), bool_or(ativo) FROM user_modulos WHERE user_id IN (...) GROUP BY user_id`
- Aplica: `INSERT ... ON CONFLICT (user_id, modulo) DO UPDATE SET ativo=true` para os 7 módulos padrão
- Usa subquery `(SELECT id FROM auth.users WHERE email IN (...))` ou — se `auth.users` não existe no Postgres da VPS — você passa os UUIDs direto

Você roda via `psql` na VPS ou no `pgadmin.mentoark.com.br`.

## O que eu vou criar (em build mode)

1. `scripts/monitor-crm.sh` — script de monitoramento adaptado pra Docker
2. `scripts/sprint9-fix-modulos.sql` — SQL de diagnóstico + correção dos módulos
3. `scripts/README.md` — instruções de uso (SSH, cron, psql)

## Perguntas antes de implementar

**a)** OK em criar uma pasta `scripts/` no repo pra esses utilitários de VPS? (não interfere com build do frontend)

**b)** Pro Sprint 9 — você consegue me passar (rodando no pgAdmin):
```sql
SELECT u.id, u.email, count(um.modulo) total, count(*) FILTER (WHERE um.ativo) ativos
FROM auth.users u LEFT JOIN public.user_modulos um ON um.user_id = u.id
WHERE u.email IN ('gkl15.working@gmail.com','grotheraphael@gmail.com')
GROUP BY u.id, u.email;
```
Sem esse output, vou gerar o SQL "às cegas" assumindo que os emails existem em `auth.users`.

**c)** O fragmento "Sprint 10" no fim da sua mensagem ficou cortado. Quer que eu espere ou seguimos só com 8 e 9?