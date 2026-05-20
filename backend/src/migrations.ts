import { Pool } from 'pg';

export async function runMigrations(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_messages (
      id TEXT PRIMARY KEY,
      user_id UUID NOT NULL,
      instancia TEXT NOT NULL,
      session_id TEXT NOT NULL,
      remote_jid TEXT NOT NULL,
      from_me BOOLEAN NOT NULL DEFAULT false,
      push_name TEXT,
      tipo TEXT NOT NULL DEFAULT 'text',
      conteudo TEXT,
      midia_url TEXT,
      midia_mime TEXT,
      midia_nome TEXT,
      status TEXT DEFAULT 'received',
      timestamp_unix BIGINT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_wamsg_user_session
    ON whatsapp_messages (user_id, session_id, created_at DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_wamsg_user_instancia
    ON whatsapp_messages (user_id, instancia, created_at DESC)
  `);

  await pool.query(`ALTER TABLE contatos ADD COLUMN IF NOT EXISTS push_name TEXT`);
  await pool.query(`ALTER TABLE contatos ADD COLUMN IF NOT EXISTS profile_pic_url TEXT`);
  await pool.query(`ALTER TABLE contatos ADD COLUMN IF NOT EXISTS ultima_mensagem_em TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE contatos ADD COLUMN IF NOT EXISTS opt_out BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE agentes ADD COLUMN IF NOT EXISTS n8n_webhook_url TEXT`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS opt_out_contatos (
      id BIGSERIAL PRIMARY KEY,
      user_id UUID NOT NULL,
      telefone TEXT NOT NULL,
      keyword TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (user_id, telefone)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_optout_user_telefone
    ON opt_out_contatos (user_id, telefone)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS disparo_optouts (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id UUID NOT NULL,
      telefone TEXT NOT NULL,
      motivo TEXT DEFAULT 'usuario_solicitou',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_disparo_optouts_user_telefone
    ON disparo_optouts (user_id, telefone, created_at DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS facebook_contas (
      id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id         UUID NOT NULL UNIQUE,
      ad_account_id   TEXT NOT NULL,
      nome_conta      TEXT,
      access_token    TEXT NOT NULL,
      token_expira_em TIMESTAMPTZ,
      criado_em       TIMESTAMPTZ DEFAULT NOW(),
      atualizado_em   TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS marketing_leads (
      id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id         UUID,
      meta_lead_id    TEXT UNIQUE,
      nome            TEXT,
      telefone        TEXT,
      email           TEXT,
      campanha        TEXT,
      campanha_id     TEXT,
      formulario_id   TEXT,
      plataforma      TEXT DEFAULT 'facebook',
      dados_extras    JSONB DEFAULT '{}',
      status_crm      TEXT DEFAULT 'novo',
      capturado_em    TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS facebook_campanhas (
      id              TEXT PRIMARY KEY,
      user_id         UUID,
      nome            TEXT,
      status          TEXT,
      objetivo        TEXT,
      plataforma      TEXT,
      orcamento_diario NUMERIC,
      orcamento_total  NUMERIC,
      inicio          DATE,
      fim             DATE,
      metricas        JSONB DEFAULT '{}',
      atualizado_em   TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS webhook_mensagens_processadas (
      message_id TEXT PRIMARY KEY,
      instancia  TEXT,
      criado_em  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE webhook_mensagens_processadas
      ADD COLUMN IF NOT EXISTS criado_em TIMESTAMPTZ DEFAULT NOW()
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_webhook_dedup_criado
    ON webhook_mensagens_processadas (criado_em)
  `).catch(() => {});

  // ── Sprint 3: Database Audit Fixes ─────────────────────────────────────────

  // 1. Criar refresh_tokens se não existir (necessário para auth.ts)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id UUID NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // 2. Criar galeria_midias se não existir (usada em galeria.ts)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS galeria_midias (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id UUID NOT NULL,
      url TEXT NOT NULL,
      filename TEXT NOT NULL,
      tamanho INTEGER,
      tipo TEXT,
      tags TEXT[] DEFAULT '{}',
      titulo TEXT,
      descricao TEXT,
      media_type TEXT,
      pasta TEXT DEFAULT 'geral',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // 3. marketing_leads: garantir NOT NULL e índice
  await pool.query(`
    ALTER TABLE marketing_leads
      ALTER COLUMN user_id SET NOT NULL
  `).catch(err => console.warn('[MIGRATIONS] marketing_leads.user_id já NOT NULL ou tem NULLs:', err.message));

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_marketing_leads_user_capturado
    ON marketing_leads (user_id, capturado_em DESC)
  `);

  // 4. facebook_campanhas: garantir NOT NULL e índice
  await pool.query(`
    ALTER TABLE facebook_campanhas
      ALTER COLUMN user_id SET NOT NULL
  `).catch(err => console.warn('[MIGRATIONS] facebook_campanhas.user_id já NOT NULL ou tem NULLs:', err.message));

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_facebook_campanhas_user
    ON facebook_campanhas (user_id)
  `);

  // 5. refresh_tokens: índice para limpeza eficiente
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires
    ON refresh_tokens (expires_at) WHERE revoked = false
  `);

  // 6. Limpeza de tokens expirados/revogados (mantém 30 dias de histórico)
  await pool.query(`
    DELETE FROM refresh_tokens
    WHERE revoked = true AND expires_at < NOW() - INTERVAL '30 days'
  `).catch(() => {});

  // 7. Limpeza de deduplicação de webhook (mantém 24h)
  await pool.query(`
    DELETE FROM webhook_mensagens_processadas
    WHERE criado_em < NOW() - INTERVAL '24 hours'
  `).catch(() => {});

  // 8. Índice em contatos para busca por telefone
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_contatos_user_telefone
    ON contatos (user_id, telefone)
  `).catch(() => {});

  // 9. Índice em whatsapp_messages para listagem de conversas
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_wamsg_session_user_desc
    ON whatsapp_messages (user_id, session_id, created_at DESC)
  `).catch(() => {});

  // ── Sprint 5: OAuth CSRF protection ────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS oauth_state (
      user_id    UUID PRIMARY KEY,
      nonce      TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    )
  `);

  // ── Tabelas de CRM — Sprint de Funcionalidades ──────────────────────────────

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
  await pool.query(`ALTER TABLE agentes ADD COLUMN IF NOT EXISTS sla_ativo                BOOLEAN DEFAULT false`).catch(() => {});
  await pool.query(`ALTER TABLE agentes ADD COLUMN IF NOT EXISTS sla_tme                  INTEGER DEFAULT 15`).catch(() => {});
  await pool.query(`ALTER TABLE agentes ADD COLUMN IF NOT EXISTS sla_ociosidade           INTEGER DEFAULT 30`).catch(() => {});
  await pool.query(`ALTER TABLE agentes ADD COLUMN IF NOT EXISTS sla_tma                  INTEGER DEFAULT 120`).catch(() => {});
  await pool.query(`ALTER TABLE agentes ADD COLUMN IF NOT EXISTS sla_acao_estouro         TEXT    DEFAULT 'none'`).catch(() => {});
  await pool.query(`ALTER TABLE agentes ADD COLUMN IF NOT EXISTS sla_notificar_supervisor BOOLEAN DEFAULT false`).catch(() => {});
  await pool.query(`ALTER TABLE agentes ADD COLUMN IF NOT EXISTS sla_email_supervisor     TEXT`).catch(() => {});

  console.log('[MIGRATIONS] OK');
}
