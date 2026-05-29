-- Patch: adiciona colunas faltantes em tarefas (schema antigo sem esses campos)
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS coluna_id        UUID REFERENCES kanban_colunas(id) ON DELETE SET NULL;
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS atribuido_a      UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS contato_nome     TEXT;
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS contato_telefone TEXT;
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS remote_jid       TEXT;
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS instance_name    TEXT;
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS conversa_id      TEXT;
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS origem           TEXT DEFAULT 'manual';
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS tags             TEXT[] DEFAULT '{}';
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS data_limite      DATE;
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS concluida_em     TIMESTAMPTZ;
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS sub_perfil_id    UUID;
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS contato_id       UUID;

-- Índices que falharam antes
CREATE INDEX IF NOT EXISTS idx_tarefas_user_coluna ON tarefas (user_id, coluna_id, ordem);
CREATE INDEX IF NOT EXISTS idx_tarefas_atribuido   ON tarefas (atribuido_a) WHERE atribuido_a IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tarefas_origem      ON tarefas (user_id, origem, created_at DESC);

-- Verificação
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'tarefas'
ORDER BY ordinal_position;
