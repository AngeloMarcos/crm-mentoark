// Stub — re-exporta o cliente HTTP próprio como "supabase"
// Mantém compatibilidade com imports existentes sem depender do Supabase real.
import { api } from "@/integrations/database/client";

export const supabase = api;
export default api;
