-- Tabela principal do cérebro
CREATE TABLE IF NOT EXISTS public.conhecimento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('personalidade','negocio','faq','objecao','script')),
  categoria text,
  campo text,
  conteudo text NOT NULL,
  contexto text,
  indexado boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.conhecimento ENABLE ROW LEVEL SECURITY;

-- RLS policies (separadas por comando, com suporte a admin)
CREATE POLICY "Users select own conhecimento"
  ON public.conhecimento FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users insert own conhecimento"
  ON public.conhecimento FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own conhecimento"
  ON public.conhecimento FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users delete own conhecimento"
  ON public.conhecimento FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- Indexes
CREATE INDEX IF NOT EXISTS conhecimento_user_tipo_idx ON public.conhecimento(user_id, tipo);
CREATE INDEX IF NOT EXISTS conhecimento_indexado_idx ON public.conhecimento(indexado);

-- Trigger para updated_at
CREATE TRIGGER update_conhecimento_updated_at
  BEFORE UPDATE ON public.conhecimento
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();