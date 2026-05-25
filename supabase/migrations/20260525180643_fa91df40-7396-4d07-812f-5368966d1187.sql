
-- 1. Restringir policies de role public -> authenticated
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname='public'
      AND 'public' = ANY(roles)
      AND tablename IN (
        'tags','produtos','funil_estagios','follow_ups','respostas_rapidas',
        'galeria_imagens','catalogos','produto_imagens','catalogo_mensagens_logs',
        'facebook_campanhas','facebook_contas','marketing_leads'
      )
  LOOP
    EXECUTE format('ALTER POLICY %I ON public.%I TO authenticated', r.policyname, r.tablename);
  END LOOP;
END$$;

-- 2. Remover chat_messages da publicação realtime (não há uso de realtime no app)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='chat_messages'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.chat_messages';
  END IF;
END$$;

-- 3. Política explícita negando acesso de clientes a webhook_mensagens_processadas
DROP POLICY IF EXISTS "No client access" ON public.webhook_mensagens_processadas;
CREATE POLICY "No client access"
ON public.webhook_mensagens_processadas
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (false)
WITH CHECK (false);
