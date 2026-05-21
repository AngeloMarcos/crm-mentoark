# Claude Code — Prompt 1: Migrations — Criar Tabelas Faltando
**Arquivo:** `backend/src/migrations.ts`
**Prioridade:** 🔴 CRÍTICO — O frontend está quebrando porque estas tabelas não existem no banco

---

## Contexto

O arquivo `backend/src/migrations.ts` roda automaticamente ao iniciar o servidor e cria as tabelas via `CREATE TABLE IF NOT EXISTS`. Várias páginas do frontend já foram desenvolvidas pelo Lovable mas as tabelas que elas usam não foram adicionadas ao arquivo de migrations, então o banco não as tem.

**Tabelas faltando identificadas lendo o código do frontend:**
- `respostas_rapidas` — página RespostasRapidas.tsx
- `tags` — páginas Tags.tsx, Disparos.tsx, Funil.tsx
- `funil_estagios` — páginas Tags.tsx, Funil.tsx, Disparos.tsx
- `listas` — páginas Leads.tsx, Discagem.tsx
- `chamadas` — página Discagem.tsx
- `timeline_eventos` — componente LeadTimeline.tsx
- `tarefas` — componente LeadTarefas.tsx
- `dados_cliente` — páginas Dashboard.tsx, ContatoDetalhe.tsx
- `chat_messages` — páginas Dashboard.tsx, ContatoDetalhe.tsx
- `follow_ups` — componente FollowUpModal.tsx

**Colunas SLA faltando na tabela `agentes`:**
A página SLA.tsx lê e salva colunas que ainda não existem na tabela `agentes`.

---

## Tarefa

No arquivo `backend/src/migrations.ts`, dentro da função `runMigrations(pool)`, **antes do `console.log('[MIGRATIONS] OK')`**, adicione os seguintes blocos:

```typescript
  // ── Tabelas de CRM — Sprint de Funcionalidades ──────────────────────────────

  // Respostas Rápidas (atalhos de mensagem no WhatsApp)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS respostas_rapidas (
      id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id    UUID NOT NULL,
      atalho     TEXT NOT NULL,
      titulo     TEXT NOT NULL,
      mensagem   TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (user_id, atalho)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_respostas_rapidas_user
    ON respostas_rapidas (user_id, created_at DESC)
  `).catch(() => {});

  // Tags de contatos
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tags (
      id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id    UUID NOT NULL,
      nome       TEXT NOT NULL,
      cor        TEXT NOT NULL DEFAULT '#3b82f6',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (user_id, nome)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_tags_user
    ON tags (user_id)
  `).catch(() => {});

  // Estágios do Funil de Vendas
  await pool.query(`
    CREATE TABLE IF NOT EXISTS funil_estagios (
      id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id    UUID NOT NULL,
      nome       TEXT NOT NULL,
      cor        TEXT NOT NULL DEFAULT '#3b82f6',
      ordem      INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_funil_estagios_user_ordem
    ON funil_estagios (user_id, ordem)
  `).catch(() => {});

  // Listas de contatos para discagem
  await pool.query(`
    CREATE TABLE IF NOT EXISTS listas (
      id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id    UUID NOT NULL,
      nome       TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_listas_user
    ON listas (user_id, created_at DESC)
  `).catch(() => {});

  // Registro de chamadas (módulo Discagem)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chamadas (
      id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id     UUID NOT NULL,
      contato_id  UUID NOT NULL,
      resultado   TEXT,
      notas       TEXT,
      duracao_seg INTEGER,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_chamadas_user_contato
    ON chamadas (user_id, contato_id, created_at DESC)
  `).catch(() => {});

  // Timeline de eventos por contato (notas, chamadas, reuniões etc.)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS timeline_eventos (
      id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id     UUID NOT NULL,
      contato_id  UUID NOT NULL,
      tipo        TEXT NOT NULL DEFAULT 'nota',
      titulo      TEXT NOT NULL,
      descricao   TEXT,
      data_evento TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_timeline_user_contato
    ON timeline_eventos (user_id, contato_id, data_evento DESC)
  `).catch(() => {});

  // Tarefas vinculadas a contatos
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tarefas (
      id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id      UUID NOT NULL,
      contato_id   UUID NOT NULL,
      titulo       TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pendente',
      prioridade   TEXT NOT NULL DEFAULT 'media',
      prazo        TIMESTAMPTZ,
      concluida_at TIMESTAMPTZ,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_tarefas_user_contato
    ON tarefas (user_id, contato_id, prazo)
  `).catch(() => {});
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_tarefas_user_status
    ON tarefas (user_id, status, prazo)
  `).catch(() => {});

  // Dados de clientes WhatsApp (legado/compatibilidade n8n)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dados_cliente (
      id              BIGSERIAL PRIMARY KEY,
      user_id         UUID NOT NULL,
      nomewpp         TEXT,
      telefone        TEXT,
      "Setor"         TEXT,
      atendimento_ia  BOOLEAN DEFAULT false,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dados_cliente_user
    ON dados_cliente (user_id, created_at DESC)
  `).catch(() => {});
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dados_cliente_telefone
    ON dados_cliente (user_id, telefone)
  `).catch(() => {});

  // Histórico de mensagens de chat (legado/compatibilidade n8n)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id           BIGSERIAL PRIMARY KEY,
      user_id      UUID NOT NULL,
      phone        TEXT,
      user_message TEXT,
      bot_message  TEXT,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_chat_messages_user_phone
    ON chat_messages (user_id, phone, created_at ASC)
  `).catch(() => {});

  // Follow-ups agendados
  await pool.query(`
    CREATE TABLE IF NOT EXISTS follow_ups (
      id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id      UUID NOT NULL,
      contato_id   UUID NOT NULL,
      data_retorno TIMESTAMPTZ NOT NULL,
      motivo       TEXT,
      observacao   TEXT,
      status       TEXT NOT NULL DEFAULT 'pendente',
      created_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_follow_ups_user_data
    ON follow_ups (user_id, data_retorno, status)
  `).catch(() => {});

  // ── SLA: adicionar colunas na tabela agentes ─────────────────────────────────
  await pool.query(`ALTER TABLE agentes ADD COLUMN IF NOT EXISTS sla_ativo               BOOLEAN   DEFAULT false`).catch(() => {});
  await pool.query(`ALTER TABLE agentes ADD COLUMN IF NOT EXISTS sla_tme                 INTEGER   DEFAULT 15`).catch(() => {});
  await pool.query(`ALTER TABLE agentes ADD COLUMN IF NOT EXISTS sla_ociosidade          INTEGER   DEFAULT 30`).catch(() => {});
  await pool.query(`ALTER TABLE agentes ADD COLUMN IF NOT EXISTS sla_tma                 INTEGER   DEFAULT 120`).catch(() => {});
  await pool.query(`ALTER TABLE agentes ADD COLUMN IF NOT EXISTS sla_acao_estouro        TEXT      DEFAULT 'none'`).catch(() => {});
  await pool.query(`ALTER TABLE agentes ADD COLUMN IF NOT EXISTS sla_notificar_supervisor BOOLEAN  DEFAULT false`).catch(() => {});
  await pool.query(`ALTER TABLE agentes ADD COLUMN IF NOT EXISTS sla_email_supervisor    TEXT`).catch(() => {});
```

---

## Verificação após aplicar

1. Reinicie o servidor backend: `pm2 restart crm-backend` (ou equivalente)
2. No log de inicialização, deve aparecer `[MIGRATIONS] OK` sem erros
3. Acesse o banco e confirme com:
   ```sql
   SELECT table_name FROM information_schema.tables
   WHERE table_schema = 'public'
   AND table_name IN (
     'respostas_rapidas','tags','funil_estagios','listas',
     'chamadas','timeline_eventos','tarefas','dados_cliente',
     'chat_messages','follow_ups'
   )
   ORDER BY table_name;
   ```
   Deve retornar 10 linhas.

4. Confirme as colunas SLA no agentes:
   ```sql
   SELECT column_name FROM information_schema.columns
   WHERE table_name = 'agentes' AND column_name LIKE 'sla_%';
   ```
   Deve retornar 7 linhas.

---

## Relatório solicitado ao final

Informe:
1. Quantas tabelas foram criadas com sucesso?
2. As colunas SLA foram adicionadas ao `agentes`?
3. Houve algum erro no log de migrations?
4. O servidor reiniciou sem erros?
