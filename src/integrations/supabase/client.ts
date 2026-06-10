// Supabase não é usado neste projeto — todo acesso é via backend Express/PostgreSQL.
// Este stub evita erros de import em componentes legados.
export const supabase = new Proxy({} as any, {
  get: () => (..._args: any[]) => ({ data: null, error: null }),
});
