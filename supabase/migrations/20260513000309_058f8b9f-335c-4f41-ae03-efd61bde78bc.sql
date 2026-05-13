-- 1. Galeria de Imagens
CREATE TABLE IF NOT EXISTS public.galeria_imagens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  filename    TEXT NOT NULL,
  tamanho     BIGINT,
  tipo        TEXT DEFAULT 'image/jpeg',
  tags        TEXT[] DEFAULT '{}',
  titulo      TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- 2. Catálogos
CREATE TABLE IF NOT EXISTS public.catalogos (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    nome TEXT NOT NULL,
    descricao TEXT,
    ativo BOOLEAN DEFAULT true,
    ordem INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 3. Produtos
CREATE TABLE IF NOT EXISTS public.produtos (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    catalogo_id UUID REFERENCES public.catalogos(id) ON DELETE CASCADE,
    nome TEXT NOT NULL,
    descricao TEXT,
    preco DECIMAL(10,2),
    preco_promocional DECIMAL(10,2),
    codigo TEXT,
    estoque INTEGER,
    ativo BOOLEAN DEFAULT true,
    ordem INTEGER DEFAULT 0,
    custom_fields JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 4. Produto Imagens
CREATE TABLE IF NOT EXISTS public.produto_imagens (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    produto_id UUID NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    legenda TEXT,
    principal BOOLEAN DEFAULT false,
    ordem INTEGER DEFAULT 0,
    galeria_imagem_id UUID REFERENCES public.galeria_imagens(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 5. Histórico de Envios WhatsApp (Catálogo)
CREATE TABLE IF NOT EXISTS public.catalogo_mensagens_logs (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL, -- 'PRODUTO' ou 'CATALOGO'
    catalogo_id UUID REFERENCES public.catalogos(id) ON DELETE SET NULL,
    produto_id UUID REFERENCES public.produtos(id) ON DELETE SET NULL,
    contato_id UUID REFERENCES public.contatos(id) ON DELETE SET NULL,
    telefone TEXT NOT NULL,
    status TEXT NOT NULL, -- 'ENVIADO', 'ERRO', 'PENDENTE'
    mensagem_texto TEXT,
    midia_url TEXT,
    erro_mensagem TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 6. Áudio ElevenLabs em Agentes
ALTER TABLE public.agentes
  ADD COLUMN IF NOT EXISTS voice_id          TEXT,
  ADD COLUMN IF NOT EXISTS elevenlabs_model  TEXT DEFAULT 'eleven_multilingual_v2',
  ADD COLUMN IF NOT EXISTS voice_stability   NUMERIC(3,2) DEFAULT 0.50,
  ADD COLUMN IF NOT EXISTS voice_similarity  NUMERIC(3,2) DEFAULT 0.75;

-- RLS
ALTER TABLE public.galeria_imagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.produtos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.produto_imagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_mensagens_logs ENABLE ROW LEVEL SECURITY;

-- Políticas
DROP POLICY IF EXISTS "Users can manage their own gallery" ON public.galeria_imagens;
CREATE POLICY "Users can manage their own gallery" ON public.galeria_imagens FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage their own catalogos" ON public.catalogos;
CREATE POLICY "Users can manage their own catalogos" ON public.catalogos FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage their own produtos" ON public.produtos;
CREATE POLICY "Users can manage their own produtos" ON public.produtos FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage their own produto_imagens" ON public.produto_imagens;
CREATE POLICY "Users can manage their own produto_imagens" ON public.produto_imagens FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their own message logs" ON public.catalogo_mensagens_logs;
CREATE POLICY "Users can view their own message logs" ON public.catalogo_mensagens_logs FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own message logs" ON public.catalogo_mensagens_logs;
CREATE POLICY "Users can insert their own message logs" ON public.catalogo_mensagens_logs FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Índices
CREATE INDEX IF NOT EXISTS idx_galeria_user ON public.galeria_imagens(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_catalogo_logs_user ON public.catalogo_mensagens_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_produtos_catalogo ON public.produtos(catalogo_id);
