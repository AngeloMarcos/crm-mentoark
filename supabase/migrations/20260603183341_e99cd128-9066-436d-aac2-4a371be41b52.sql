
-- ai_fila
DROP POLICY IF EXISTS "Full access to authenticated users on ai_fila" ON public.ai_fila;
CREATE POLICY "Users manage own ai_fila" ON public.ai_fila FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- disparo_optouts
DROP POLICY IF EXISTS "Full access to authenticated users on disparo_optouts" ON public.disparo_optouts;
CREATE POLICY "Users manage own disparo_optouts" ON public.disparo_optouts FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ia_pausa_log
DROP POLICY IF EXISTS "Full access to authenticated users on ia_pausa_log" ON public.ia_pausa_log;
CREATE POLICY "Users manage own ia_pausa_log" ON public.ia_pausa_log FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- opt_out_contatos
DROP POLICY IF EXISTS "Full access to authenticated users on opt_out" ON public.opt_out_contatos;
CREATE POLICY "Users manage own opt_out_contatos" ON public.opt_out_contatos FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- cargos: change public -> authenticated
DROP POLICY IF EXISTS "Users can view cargos from their owner" ON public.cargos;
DROP POLICY IF EXISTS "Admins can manage their own cargos" ON public.cargos;
CREATE POLICY "Users can view cargos from their owner" ON public.cargos FOR SELECT TO authenticated
  USING ((user_id IN (SELECT users.owner_id FROM public.users WHERE users.id = auth.uid())) OR (user_id = auth.uid()));
CREATE POLICY "Admins can manage their own cargos" ON public.cargos FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- user_modulos
DROP POLICY IF EXISTS "Users can view their own modules" ON public.user_modulos;
CREATE POLICY "Users can view their own modules" ON public.user_modulos FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- users: remove public exposure
DROP POLICY IF EXISTS "Users are viewable by everyone (for profiles)" ON public.users;
CREATE POLICY "Users can view own record" ON public.users FOR SELECT TO authenticated
  USING (auth.uid() = id);

-- sub_perfis: hide senha_temp from clients
REVOKE SELECT (senha_temp) ON public.sub_perfis FROM authenticated, anon;

-- Harden functions: search_path + revoke anon execute
ALTER FUNCTION public.update_updated_at_column() SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.sync_user_to_profile() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM anon, public;
