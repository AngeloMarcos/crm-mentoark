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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS webhook_mensagens_processadas (
      message_id TEXT PRIMARY KEY,
      instancia  TEXT,
      criado_em  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_webhook_dedup_criado
    ON webhook_mensagens_processadas (criado_em)
  `);

  console.log('[MIGRATIONS] OK');
}
