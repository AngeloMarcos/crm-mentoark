
-- 1. Block client access to refresh_tokens entirely (server-only)
REVOKE ALL ON public.refresh_tokens FROM anon, authenticated;
DROP POLICY IF EXISTS "Users manage own refresh_tokens" ON public.refresh_tokens;
CREATE POLICY "Block client access to refresh_tokens"
  ON public.refresh_tokens AS RESTRICTIVE FOR ALL
  TO anon, authenticated
  USING (false) WITH CHECK (false);

-- 2. user_roles: explicit RESTRICTIVE deny for writes (prevent privilege escalation)
CREATE POLICY "Block client writes to user_roles INS" ON public.user_roles
  AS RESTRICTIVE FOR INSERT TO anon, authenticated WITH CHECK (false);
CREATE POLICY "Block client writes to user_roles UPD" ON public.user_roles
  AS RESTRICTIVE FOR UPDATE TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "Block client writes to user_roles DEL" ON public.user_roles
  AS RESTRICTIVE FOR DELETE TO anon, authenticated USING (false);

-- 3. whatsapp_message_status: explicit RESTRICTIVE deny for writes
CREATE POLICY "Block client writes to wa_msg_status INS" ON public.whatsapp_message_status
  AS RESTRICTIVE FOR INSERT TO anon, authenticated WITH CHECK (false);
CREATE POLICY "Block client writes to wa_msg_status UPD" ON public.whatsapp_message_status
  AS RESTRICTIVE FOR UPDATE TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "Block client writes to wa_msg_status DEL" ON public.whatsapp_message_status
  AS RESTRICTIVE FOR DELETE TO anon, authenticated USING (false);

-- 4. sub_perfis: revoke senha_temp at column level
REVOKE SELECT ON public.sub_perfis FROM authenticated, anon;
GRANT SELECT (id, user_id, membro_id, nome, email, avatar_cor, modulos, ativo, primeiro_acesso, created_at, updated_at)
  ON public.sub_perfis TO authenticated;

-- 5. agent_configs: also revoke evolution_server_url (server-side internal endpoint)
REVOKE SELECT (evolution_server_url) ON public.agent_configs FROM authenticated, anon;

-- 6. agentes: revoke evolution_server_url and webhook columns
REVOKE SELECT (evolution_server_url, webhook_principal, webhook_indexacao, webhook_teste, n8n_webhook_url)
  ON public.agentes FROM authenticated, anon;
