/**
 * Cliente da indexação automática da base de conhecimento (2026-10-30).
 * Backend: routes/baseConhecimento.ts + services/indexacao.ts.
 */
import { authHeader } from "@/lib/api-token";

const API_URL = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";

export interface StatusIndexacao {
  status: { pendente: number; indexando: number; indexado: number; erro: number };
  erros: { id: string; tipo: string; campo: string | null; erro_indexacao: string | null }[];
  por_agente: { agente_id: string | null; total: number }[];
  trechos: { indexados: number; pendentes: number };
}

async function chamar<T>(caminho: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${caminho}`, {
    ...init,
    headers: { ...authHeader(), ...(init.body ? { "Content-Type": "application/json" } : {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `Erro ${res.status}`);
  return data as T;
}

export const statusIndexacao = () => chamar<StatusIndexacao>("/api/base-conhecimento/status");
export const indexarConhecimentoAgora = () =>
  chamar<{ indexados: number; erros: number }>("/api/base-conhecimento/indexar-agora", { method: "POST" });
export const reindexarConhecimento = (body: { conhecimento_id?: string; so_erros?: boolean }) =>
  chamar<{ marcados: number; indexados: number; erros: number }>("/api/base-conhecimento/reindexar", {
    method: "POST", body: JSON.stringify(body),
  });
