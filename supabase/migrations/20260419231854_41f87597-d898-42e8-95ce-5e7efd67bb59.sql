CREATE TABLE IF NOT EXISTS public.agentes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  nome text NOT NULL,
  descricao text,
  persona text,
  tom text NOT NULL DEFAULT 'profissional',
  objetivo text,
  mensagem_boas_vindas text,
  regras text,
  modelo text NOT NULL DEFAULT 'gpt-4o-mini',
  temperatura numeric NOT NULL DEFAULT 0.7,
  max_tokens integer NOT NULL DEFAULT 1000,
  evolution_instancia text,
  evolution_api_key text,
  evolution_server_url text,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agentes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own agentes" ON public.agentes
  FOR SELECT TO authenticated
  USING ((auth.uid() = user_id) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users insert own agentes" ON public.agentes
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own agentes" ON public.agentes
  FOR UPDATE TO authenticated
  USING ((auth.uid() = user_id) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users delete own agentes" ON public.agentes
  FOR DELETE TO authenticated
  USING ((auth.uid() = user_id) OR has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS agentes_user_id_idx ON public.agentes(user_id);

CREATE TRIGGER update_agentes_updated_at
BEFORE UPDATE ON public.agentes
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();