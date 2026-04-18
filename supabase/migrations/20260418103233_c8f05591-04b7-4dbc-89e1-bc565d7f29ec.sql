-- ============ LISTAS ============
CREATE TABLE public.listas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  descricao TEXT,
  cor TEXT DEFAULT 'hsl(217 91% 45%)',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.listas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own listas" ON public.listas FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users insert own listas" ON public.listas FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own listas" ON public.listas FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users delete own listas" ON public.listas FOR DELETE TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_listas_updated_at BEFORE UPDATE ON public.listas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ CONTATOS ============
CREATE TABLE public.contatos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lista_id UUID REFERENCES public.listas(id) ON DELETE SET NULL,
  nome TEXT NOT NULL,
  telefone TEXT,
  email TEXT,
  empresa TEXT,
  cargo TEXT,
  origem TEXT DEFAULT 'Manual',
  status TEXT NOT NULL DEFAULT 'novo',
  tags TEXT[] DEFAULT '{}',
  notas TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_contatos_user ON public.contatos(user_id);
CREATE INDEX idx_contatos_lista ON public.contatos(lista_id);
CREATE INDEX idx_contatos_status ON public.contatos(status);

ALTER TABLE public.contatos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own contatos" ON public.contatos FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users insert own contatos" ON public.contatos FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own contatos" ON public.contatos FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users delete own contatos" ON public.contatos FOR DELETE TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_contatos_updated_at BEFORE UPDATE ON public.contatos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ CHAMADAS ============
CREATE TABLE public.chamadas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contato_id UUID NOT NULL REFERENCES public.contatos(id) ON DELETE CASCADE,
  resultado TEXT NOT NULL,
  notas TEXT,
  duracao_segundos INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chamadas_user ON public.chamadas(user_id);
CREATE INDEX idx_chamadas_contato ON public.chamadas(contato_id);

ALTER TABLE public.chamadas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own chamadas" ON public.chamadas FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users insert own chamadas" ON public.chamadas FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own chamadas" ON public.chamadas FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users delete own chamadas" ON public.chamadas FOR DELETE TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));