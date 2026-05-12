-- ──────────────────────────────────────────────────────────────────────────────
-- Migration: Galeria central de imagens (biblioteca de mídia por usuário)
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS galeria_imagens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  filename    TEXT NOT NULL,
  tamanho     BIGINT,                  -- bytes
  tipo        TEXT DEFAULT 'image/jpeg',
  tags        TEXT[] DEFAULT '{}',     -- ex: ['produto', 'banner', 'avatar']
  titulo      TEXT,                    -- nome amigável opcional
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS galeria_imagens_user_id_idx ON galeria_imagens (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS galeria_imagens_tags_idx    ON galeria_imagens USING GIN (tags);

COMMENT ON TABLE galeria_imagens IS 'Biblioteca central de imagens do usuário — pode ser reutilizada em produtos, catálogos, disparos, etc.';

-- ──────────────────────────────────────────────────────────────────────────────
-- Adicionar coluna galeria_imagem_id em produto_imagens (opcional — referência fraca)
-- Permite saber qual imagem da galeria está vinculada ao produto (sem FK obrigatória
-- para não bloquear exclusão independente)
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE produto_imagens
  ADD COLUMN IF NOT EXISTS galeria_imagem_id UUID;  -- referência fraca (sem FK constraint)

COMMENT ON COLUMN produto_imagens.galeria_imagem_id IS 'ID na galeria_imagens de onde a imagem foi selecionada (referência informativa, sem FK)';
