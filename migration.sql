ALTER TABLE contatos ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE contatos ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE contatos ADD COLUMN IF NOT EXISTS muted_until TIMESTAMP WITH TIME ZONE;
SELECT column_name FROM information_schema.columns WHERE table_name='contatos' AND column_name IN ('is_pinned','is_archived','muted_until');
