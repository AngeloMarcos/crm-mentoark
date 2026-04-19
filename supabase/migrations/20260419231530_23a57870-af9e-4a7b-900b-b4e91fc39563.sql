CREATE TABLE IF NOT EXISTS public.integracoes_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  nome text NOT NULL,
  tipo text NOT NULL,
  url text,
  api_key text,
  instancia text,
  status text NOT NULL DEFAULT 'inativo' CHECK (status IN ('conectado','sincronizando','atencao','erro','inativo')),
  ultima_sync timestamptz,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.integracoes_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own integracoes" ON public.integracoes_config
  FOR SELECT TO authenticated
  USING ((auth.uid() = user_id) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users insert own integracoes" ON public.integracoes_config
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own integracoes" ON public.integracoes_config
  FOR UPDATE TO authenticated
  USING ((auth.uid() = user_id) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users delete own integracoes" ON public.integracoes_config
  FOR DELETE TO authenticated
  USING ((auth.uid() = user_id) OR has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS integracoes_config_user_id_idx ON public.integracoes_config(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS integracoes_config_user_tipo_idx ON public.integracoes_config(user_id, tipo);

CREATE TRIGGER update_integracoes_config_updated_at
BEFORE UPDATE ON public.integracoes_config
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();