
-- Revoke column-level SELECT on sensitive credential columns from authenticated/anon
REVOKE SELECT (evolution_api_key, evolution_server_url) ON public.agent_configs FROM authenticated, anon;
REVOKE SELECT (evolution_api_key, evolution_server_url) ON public.agentes FROM authenticated, anon;
REVOKE SELECT (access_token) ON public.facebook_contas FROM authenticated, anon;
REVOKE SELECT (api_key) ON public.integracoes_config FROM authenticated, anon;
REVOKE SELECT (senha_temp) ON public.sub_perfis FROM authenticated, anon;
REVOKE SELECT (password_hash) ON public.users FROM authenticated, anon;

-- Lock down user_modulos: explicit deny for writes from authenticated; only service_role may write
REVOKE INSERT, UPDATE, DELETE ON public.user_modulos FROM authenticated, anon;
GRANT ALL ON public.user_modulos TO service_role;

-- Add restrictive policies to make write protection explicit even if grants change
DROP POLICY IF EXISTS "No client inserts on user_modulos" ON public.user_modulos;
CREATE POLICY "No client inserts on user_modulos"
  ON public.user_modulos AS RESTRICTIVE FOR INSERT TO authenticated, anon
  WITH CHECK (false);

DROP POLICY IF EXISTS "No client updates on user_modulos" ON public.user_modulos;
CREATE POLICY "No client updates on user_modulos"
  ON public.user_modulos AS RESTRICTIVE FOR UPDATE TO authenticated, anon
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "No client deletes on user_modulos" ON public.user_modulos;
CREATE POLICY "No client deletes on user_modulos"
  ON public.user_modulos AS RESTRICTIVE FOR DELETE TO authenticated, anon
  USING (false);
