CREATE TABLE IF NOT EXISTS public.campanhas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  nome text NOT NULL,
  status text NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa','pausada','finalizada')),
  plataforma text NOT NULL DEFAULT 'Meta Ads',
  investimento numeric NOT NULL DEFAULT 0,
  impressoes integer NOT NULL DEFAULT 0,
  cliques integer NOT NULL DEFAULT 0,
  ctr numeric NOT NULL DEFAULT 0,
  leads_gerados integer NOT NULL DEFAULT 0,
  cpl numeric NOT NULL DEFAULT 0,
  conversoes integer NOT NULL DEFAULT 0,
  periodo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.campanhas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own campanhas" ON public.campanhas
  FOR SELECT TO authenticated
  USING ((auth.uid() = user_id) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users insert own campanhas" ON public.campanhas
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own campanhas" ON public.campanhas
  FOR UPDATE TO authenticated
  USING ((auth.uid() = user_id) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users delete own campanhas" ON public.campanhas
  FOR DELETE TO authenticated
  USING ((auth.uid() = user_id) OR has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS campanhas_user_id_idx ON public.campanhas(user_id);

CREATE TRIGGER update_campanhas_updated_at
BEFORE UPDATE ON public.campanhas
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();