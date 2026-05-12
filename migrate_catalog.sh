export PGPASSWORD='Mentoark@2025'
psql -h 147.93.9.172 -U mentoark -d crm <<EOF
CREATE TABLE IF NOT EXISTS catalogos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  nome text NOT NULL,
  descricao text,
  capa_url text,
  ativo boolean NOT NULL DEFAULT true,
  ordem integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_catalogos_user_id ON catalogos(user_id);
CREATE INDEX IF NOT EXISTS idx_catalogos_ativo ON catalogos(user_id, ativo);

CREATE TABLE IF NOT EXISTS produtos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  catalogo_id uuid NOT NULL REFERENCES catalogos(id) ON DELETE CASCADE,
  nome text NOT NULL,
  descricao text,
  preco numeric(10,2),
  preco_promocional numeric(10,2),
  codigo text,
  estoque integer,
  ativo boolean NOT NULL DEFAULT true,
  ordem integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_produtos_user_id ON produtos(user_id);
CREATE INDEX IF NOT EXISTS idx_produtos_catalogo_id ON produtos(catalogo_id);
CREATE INDEX IF NOT EXISTS idx_produtos_ativo ON produtos(catalogo_id, ativo);

CREATE TABLE IF NOT EXISTS produto_imagens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  produto_id uuid NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  url text NOT NULL,
  legenda text,
  principal boolean NOT NULL DEFAULT false,
  ordem integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_produto_imagens_produto_id ON produto_imagens(produto_id);

SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('catalogos', 'produtos', 'produto_imagens');
EOF
