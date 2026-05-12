-- ──────────────────────────────────────────────────────────────────────────────
-- Migration: ElevenLabs voice_id em agentes
-- ──────────────────────────────────────────────────────────────────────────────

-- 1) Adiciona voice_id na tabela de agentes (qual voz ElevenLabs usar por agente)
ALTER TABLE agentes
  ADD COLUMN IF NOT EXISTS voice_id          TEXT,
  ADD COLUMN IF NOT EXISTS elevenlabs_model  TEXT DEFAULT 'eleven_multilingual_v2',
  ADD COLUMN IF NOT EXISTS voice_stability   NUMERIC(3,2) DEFAULT 0.50,
  ADD COLUMN IF NOT EXISTS voice_similarity  NUMERIC(3,2) DEFAULT 0.75;

COMMENT ON COLUMN agentes.voice_id         IS 'ID da voz ElevenLabs usada pelo agente para respostas em áudio';
COMMENT ON COLUMN agentes.elevenlabs_model IS 'Modelo TTS da ElevenLabs (ex: eleven_multilingual_v2)';
COMMENT ON COLUMN agentes.voice_stability  IS 'Parâmetro stability da voz (0.0–1.0)';
COMMENT ON COLUMN agentes.voice_similarity IS 'Parâmetro similarity_boost da voz (0.0–1.0)';

-- 2) integracoes_config já aceita tipo TEXT livre, portanto não precisa de ALTER.
--    Garantimos apenas que existe um índice útil caso não exista.
CREATE INDEX IF NOT EXISTS integracoes_config_tipo_idx
  ON integracoes_config (user_id, tipo);
