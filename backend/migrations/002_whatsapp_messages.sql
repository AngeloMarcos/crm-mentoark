-- Migration 002: whatsapp_messages — schema unificado
-- Dropa a versão antiga (colunas em PT) e recria com nomes canônicos

DROP TABLE IF EXISTS whatsapp_messages CASCADE;

CREATE TABLE whatsapp_messages (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  instance_name   TEXT        NOT NULL,
  remote_jid      TEXT        NOT NULL,
  message_id      TEXT        NOT NULL,
  from_me         BOOLEAN     NOT NULL DEFAULT false,
  message_type    TEXT        NOT NULL DEFAULT 'text',
  content         TEXT,
  media_url       TEXT,
  media_mimetype  TEXT,
  quoted_id       TEXT,
  status          TEXT        NOT NULL DEFAULT 'received',
  agent_id        UUID        REFERENCES agentes(id) ON DELETE SET NULL,
  metadata        JSONB       NOT NULL DEFAULT '{}',
  timestamp_wa    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_whatsapp_message UNIQUE (message_id, instance_name)
);

CREATE INDEX idx_wa_messages_conversation
  ON whatsapp_messages (user_id, remote_jid, timestamp_wa DESC NULLS LAST);

CREATE INDEX idx_wa_messages_instance
  ON whatsapp_messages (user_id, instance_name, created_at DESC);

CREATE INDEX idx_wa_messages_status_pending
  ON whatsapp_messages (user_id, status)
  WHERE status IN ('pending', 'failed');

CREATE INDEX idx_wa_messages_content_fts
  ON whatsapp_messages USING gin(to_tsvector('portuguese', coalesce(content, '')));

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_wa_messages_updated_at ON whatsapp_messages;
CREATE TRIGGER trg_wa_messages_updated_at
  BEFORE UPDATE ON whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE VIEW whatsapp_conversations AS
SELECT DISTINCT ON (user_id, instance_name, remote_jid)
  id, user_id, instance_name, remote_jid,
  content         AS ultima_mensagem,
  from_me         AS ultima_foi_minha,
  message_type    AS ultimo_tipo,
  status          AS ultimo_status,
  timestamp_wa    AS ultimo_timestamp,
  created_at      AS ultimo_created_at
FROM whatsapp_messages
ORDER BY user_id, instance_name, remote_jid, timestamp_wa DESC NULLS LAST;

CREATE OR REPLACE FUNCTION get_conversation_history(
  p_user_id    UUID,
  p_remote_jid TEXT,
  p_instance   TEXT  DEFAULT NULL,
  p_limit      INT   DEFAULT 20
)
RETURNS TABLE (role TEXT, content TEXT, timestamp_wa TIMESTAMPTZ, message_type TEXT)
LANGUAGE sql STABLE AS $$
  SELECT
    CASE WHEN from_me THEN 'assistant' ELSE 'user' END AS role,
    coalesce(content, '[' || message_type || ']')       AS content,
    timestamp_wa,
    message_type
  FROM whatsapp_messages
  WHERE user_id    = p_user_id
    AND remote_jid = p_remote_jid
    AND (p_instance IS NULL OR instance_name = p_instance)
    AND content    IS NOT NULL
    AND message_type = 'text'
  ORDER BY timestamp_wa ASC NULLS LAST
  LIMIT p_limit;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp_messages TO mentoark;
GRANT SELECT ON whatsapp_conversations TO mentoark;
GRANT EXECUTE ON FUNCTION get_conversation_history TO mentoark;
