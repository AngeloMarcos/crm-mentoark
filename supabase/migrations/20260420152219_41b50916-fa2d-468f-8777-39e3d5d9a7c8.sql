-- Tabela de campanhas de disparo
CREATE TABLE public.disparos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  nome TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'rascunho',
  lista_id UUID,
  mensagem_template TEXT,
  total_leads INTEGER NOT NULL DEFAULT 0,
  enviados INTEGER NOT NULL DEFAULT 0,
  falhas INTEGER NOT NULL DEFAULT 0,
  intervalo_min INTEGER NOT NULL DEFAULT 45,
  intervalo_max INTEGER NOT NULL DEFAULT 90,
  pausa_a_cada INTEGER NOT NULL DEFAULT 20,
  pausa_duracao INTEGER NOT NULL DEFAULT 5,
  horario_inicio TEXT NOT NULL DEFAULT '08:00',
  horario_fim TEXT NOT NULL DEFAULT '20:00',
  data_inicio TIMESTAMPTZ,
  data_fim TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.disparos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own disparos" ON public.disparos
  FOR SELECT TO authenticated
  USING ((auth.uid() = user_id) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users insert own disparos" ON public.disparos
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own disparos" ON public.disparos
  FOR UPDATE TO authenticated
  USING ((auth.uid() = user_id) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users delete own disparos" ON public.disparos
  FOR DELETE TO authenticated
  USING ((auth.uid() = user_id) OR has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_disparos_updated_at
  BEFORE UPDATE ON public.disparos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Log individual por lead
CREATE TABLE public.disparo_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  disparo_id UUID NOT NULL REFERENCES public.disparos(id) ON DELETE CASCADE,
  contato_id UUID,
  user_id UUID NOT NULL,
  nome TEXT,
  telefone TEXT NOT NULL,
  mensagem_enviada TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  tentativas INTEGER NOT NULL DEFAULT 0,
  erro TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  enviado_at TIMESTAMPTZ
);

ALTER TABLE public.disparo_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own disparo_logs" ON public.disparo_logs
  FOR SELECT TO authenticated
  USING ((auth.uid() = user_id) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users insert own disparo_logs" ON public.disparo_logs
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own disparo_logs" ON public.disparo_logs
  FOR UPDATE TO authenticated
  USING ((auth.uid() = user_id) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users delete own disparo_logs" ON public.disparo_logs
  FOR DELETE TO authenticated
  USING ((auth.uid() = user_id) OR has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_disparo_logs_disparo_id ON public.disparo_logs(disparo_id);
CREATE INDEX idx_disparo_logs_status ON public.disparo_logs(status);