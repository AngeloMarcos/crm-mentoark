-- Timeline de interações por lead
CREATE TABLE IF NOT EXISTS public.timeline_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contato_id uuid NOT NULL REFERENCES public.contatos(id) ON DELETE CASCADE,
  tipo text NOT NULL,
  titulo text NOT NULL,
  descricao text,
  data_evento timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.timeline_eventos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own timeline" ON public.timeline_eventos
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_timeline_contato_data ON public.timeline_eventos(contato_id, data_evento DESC);

-- Tarefas por lead
CREATE TABLE IF NOT EXISTS public.tarefas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contato_id uuid REFERENCES public.contatos(id) ON DELETE CASCADE,
  titulo text NOT NULL,
  descricao text,
  status text NOT NULL DEFAULT 'pendente',
  prioridade text NOT NULL DEFAULT 'media',
  prazo timestamptz,
  concluida_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tarefas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own tarefas" ON public.tarefas
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_tarefas_user_status ON public.tarefas(user_id, status);
CREATE INDEX IF NOT EXISTS idx_tarefas_contato ON public.tarefas(contato_id);