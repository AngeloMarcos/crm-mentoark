
ALTER FUNCTION public.get_next_disparo_batch(integer) SET search_path = public;
ALTER FUNCTION public.handle_updated_at() SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
