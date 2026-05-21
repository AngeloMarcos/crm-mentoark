# Sprint 3 — Auditoria: Banco de Dados — Migrations + Campos Nullable + Índices
**Arquivo:** `backend/src/migrations.ts` + SQL direto no banco
**Severidade:** 🟠 ALTO

---

## Problemas encontrados

### 1. `marketing_leads.user_id` e `facebook_campanhas.user_id` são nullable
Campos críticos de isolamento multi-tenant definidos sem `NOT NULL`.
Um lead sem `user_id` não aparece para nenhum usuário mas existe no banco,
ocupando espaço e podendo causar confusão em queries.

### 2. Sem índices nas tabelas de marketing e opt-out
- `marketing_leads` sem índice em `(user_id, capturado_em)` — scans completos
- `facebook_campanhas` sem índice em `user_id`
- `disparo_optouts` tem índice mas `opt_out_contatos` pode estar duplicada

### 3. Sem limpeza automática de `refresh_tokens` expirados
A tabela `refresh_tokens` acumula tokens infinitamente. Com o tempo, queries
de refresh ficam mais lentas mesmo com tokens revogados/expirados.

### 4. Sem limpeza do `webhook_mensagens_processadas`
Mensagens processadas ficam no banco para sempre — isso cresce
indefinidamente conforme o volume de mensagens.

### 5. Sem versioning de migrations
As migrations rodam todas as vezes que o servidor inicia (com `IF NOT EXISTS`
e `ADD COLUMN IF NOT EXISTS`). Funciona, mas não há como saber o estado
real do banco ou fazer rollbacks.

### 6. `galeria_midias.descricao` não está nas migrations
O campo `descricao` é usado no código mas não tem migração formal.
Se o banco for recriado do zero, o campo não existe e o sistema falha.

---

## Fixes

### `backend/src/migrations.ts` — adicionar ao final da função

```typescript
  // ── marketing_leads: garantir NOT NULL e índice ────────────────────────
  // Nota: se já existem registros com user_id NULL, a migração abaixo falha.
  // Nesse caso, rode primeiro: UPDATE marketing_leads SET user_id = '...' WHERE user_id IS NULL
  await pool.query(`
    ALTER TABLE marketing_leads
      ALTER COLUMN user_id SET NOT NULL
  `).catch(err => console.warn('[MIGRATIONS] marketing_leads.user_id já NOT NULL ou tem NULLs:', err.message));

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_marketing_leads_user_capturado
    ON marketing_leads (user_id, capturado_em DESC)
  `);

  // ── facebook_campanhas: índice ─────────────────────────────────────────
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_facebook_campanhas_user
    ON facebook_campanhas (user_id)
  `);

  // ── galeria_midias: coluna descricao ───────────────────────────────────
  await pool.query(`
    ALTER TABLE galeria_midias ADD COLUMN IF NOT EXISTS descricao TEXT
  `);

  // ── refresh_tokens: índice para limpeza eficiente ─────────────────────
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires
    ON refresh_tokens (expires_at) WHERE revoked = false
  `);

  // ── Limpeza de tokens expirados/revogados (mantém 30 dias de histórico) ─
  await pool.query(`
    DELETE FROM refresh_tokens
    WHERE revoked = true AND expires_at < NOW() - INTERVAL '30 days'
  `).catch(() => {});

  // ── Limpeza de deduplicação de webhook (mantém 24h) ──────────────────
  await pool.query(`
    DELETE FROM webhook_mensagens_processadas
    WHERE criado_em < NOW() - INTERVAL '24 hours'
  `).catch(() => {});

  // ── Índice em contatos para busca por telefone (muito frequente) ──────
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_contatos_user_telefone
    ON contatos (user_id, telefone)
  `).catch(() => {});

  // ── Índice em whatsapp_messages para listagem de conversas ───────────
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_wamsg_session_user_desc
    ON whatsapp_messages (user_id, session_id, created_at DESC)
  `).catch(() => {});
```

### SQL direto no banco — verificar e limpar nulls antes da migration

Rodar **antes** de aplicar o NOT NULL:
```sql
-- Verificar se há leads sem user_id
SELECT count(*) FROM marketing_leads WHERE user_id IS NULL;
SELECT count(*) FROM facebook_campanhas WHERE user_id IS NULL;

-- Se houver, deletar os órfãos (leads sem usuário)
DELETE FROM marketing_leads WHERE user_id IS NULL;
DELETE FROM facebook_campanhas WHERE user_id IS NULL;

-- Verificar tokens acumulados
SELECT count(*), sum(CASE WHEN revoked THEN 1 ELSE 0 END) as revogados,
       sum(CASE WHEN expires_at < NOW() THEN 1 ELSE 0 END) as expirados
FROM refresh_tokens;
```

---

## Relatório solicitado ao final

Após aplicar, informe:
1. `marketing_leads.user_id` passou a ser NOT NULL sem erros?
2. Índices criados em quantas tabelas?
3. Quantos refresh_tokens expirados foram deletados?
4. Coluna `galeria_midias.descricao` existe agora?
5. Alguma migration falhou? Por quê?
