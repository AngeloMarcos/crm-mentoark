-- 1. Ativar RLS para tabelas restantes
ALTER TABLE public.opt_out_contatos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disparo_optouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ia_pausa_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_fila ENABLE ROW LEVEL SECURITY;

-- 2. Criar políticas básicas (permitir acesso total ao service_role e authenticated para simplificar por enquanto)
CREATE POLICY "Full access to authenticated users on opt_out" ON public.opt_out_contatos FOR ALL TO authenticated USING (true);
CREATE POLICY "Full access to authenticated users on disparo_optouts" ON public.disparo_optouts FOR ALL TO authenticated USING (true);
CREATE POLICY "Full access to authenticated users on ia_pausa_log" ON public.ia_pausa_log FOR ALL TO authenticated USING (true);
CREATE POLICY "Full access to authenticated users on ai_fila" ON public.ai_fila FOR ALL TO authenticated USING (true);

-- 3. Trigger para Sincronizar public.users -> public.profiles
-- Isso garante que usuários criados via backend customizado apareçam no frontend que consome 'profiles'
CREATE OR REPLACE FUNCTION public.sync_user_to_profile()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (user_id, email, display_name, avatar_url, updated_at)
    VALUES (NEW.id, NEW.email, NEW.display_name, NEW.avatar_url, now())
    ON CONFLICT (user_id) DO UPDATE SET
        email = EXCLUDED.email,
        display_name = EXCLUDED.display_name,
        avatar_url = EXCLUDED.avatar_url,
        updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_sync_user_to_profile ON public.users;
CREATE TRIGGER trg_sync_user_to_profile
AFTER INSERT OR UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.sync_user_to_profile();

-- 4. Sincronização Inicial (popular profiles com dados de users existentes)
INSERT INTO public.profiles (user_id, email, display_name, avatar_url, updated_at)
SELECT id, email, display_name, avatar_url, now()
FROM public.users
ON CONFLICT (user_id) DO NOTHING;
