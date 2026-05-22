
-- =========================================================
-- Tighten permissive "true" policies to owner-only
-- =========================================================

-- chat_messages
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='chat_messages' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.chat_messages', p.policyname);
  END LOOP;
END $$;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users select own chat_messages" ON public.chat_messages FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own chat_messages" ON public.chat_messages FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own chat_messages" ON public.chat_messages FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own chat_messages" ON public.chat_messages FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- chats
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='chats' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.chats', p.policyname);
  END LOOP;
END $$;
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users select own chats" ON public.chats FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own chats" ON public.chats FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own chats" ON public.chats FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own chats" ON public.chats FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- dados_cliente
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='dados_cliente' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.dados_cliente', p.policyname);
  END LOOP;
END $$;
ALTER TABLE public.dados_cliente ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users select own dados_cliente" ON public.dados_cliente FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own dados_cliente" ON public.dados_cliente FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own dados_cliente" ON public.dados_cliente FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own dados_cliente" ON public.dados_cliente FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- n8n_chat_histories
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='n8n_chat_histories' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.n8n_chat_histories', p.policyname);
  END LOOP;
END $$;
ALTER TABLE public.n8n_chat_histories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users select own n8n_history" ON public.n8n_chat_histories FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own n8n_history" ON public.n8n_chat_histories FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own n8n_history" ON public.n8n_chat_histories FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own n8n_history" ON public.n8n_chat_histories FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- profiles
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='profiles' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.profiles', p.policyname);
  END LOOP;
END $$;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users select own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- user_roles  (read own only; writes only via service role / definer functions)
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='user_roles' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.user_roles', p.policyname);
  END LOOP;
END $$;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users select own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- =========================================================
-- Enable RLS on previously-unprotected tables
-- =========================================================

ALTER TABLE public.disparo_rate_limit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own rate limit" ON public.disparo_rate_limit FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.galeria_midias ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own galeria" ON public.galeria_midias FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.oauth_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own oauth_state" ON public.oauth_state FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.refresh_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own refresh_tokens" ON public.refresh_tokens FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own whatsapp_messages" ON public.whatsapp_messages FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- webhook_mensagens_processadas has no user_id; lock to service role only (no policies = deny for anon/authenticated)
ALTER TABLE public.webhook_mensagens_processadas ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- Fix mutable search_path on existing SECURITY DEFINER functions
-- =========================================================
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      AND NOT EXISTS (
        SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) c
        WHERE c LIKE 'search_path=%'
      )
  LOOP
    EXECUTE format('ALTER FUNCTION %I.%I(%s) SET search_path = public', r.nspname, r.proname, r.args);
  END LOOP;
END $$;
