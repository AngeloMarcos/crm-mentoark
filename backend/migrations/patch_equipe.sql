-- Patch: colunas faltantes em equipe_membros
ALTER TABLE equipe_membros ADD COLUMN IF NOT EXISTS convidado_por UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_equipe_membros_user ON equipe_membros(user_id);

-- Verificar
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'equipe_membros' ORDER BY ordinal_position;
