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

  console.log('[MIGRATIONS] OK');
}
