/**
 * Chaves da API pública /v1 (2026-11-02, modelo Cubo Configurações → API Keys).
 * Backend: routes/apiKeys.ts (gerência) e routes/apiPublica.ts (a API em si).
 */
import { authHeader } from "@/lib/api-token";

export const API_URL = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";

export type Acao = "read" | "create" | "update" | "delete";
export type Escopos = Record<string, Acao[]>;

export interface ChaveApi {
  id: string;
  titulo: string;
  prefixo: string;
  scopes: Escopos;
  full_access: boolean;
  ativo: boolean;
  last_used_at: string | null;
  expira_em: string | null;
  created_at: string;
}

export type Recursos = Record<string, { nome: string; acoes: Acao[] }>;

async function chamar<T>(caminho: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${caminho}`, {
    ...init,
    headers: { ...authHeader(), ...(init.body ? { "Content-Type": "application/json" } : {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `Erro ${res.status}`);
  return data as T;
}

export const listarChaves = () => chamar<{ chaves: ChaveApi[]; recursos: Recursos }>("/api/api-keys");

export const criarChave = (dados: { titulo: string; scopes: Escopos; full_access: boolean; expira_em?: string | null }) =>
  chamar<ChaveApi & { chave: string }>("/api/api-keys", { method: "POST", body: JSON.stringify(dados) });

export const atualizarChave = (id: string, dados: Partial<Pick<ChaveApi, "titulo" | "scopes" | "full_access" | "ativo">>) =>
  chamar<ChaveApi>(`/api/api-keys/${id}`, { method: "PATCH", body: JSON.stringify(dados) });

export const revogarChave = (id: string) => chamar<{ ok: true }>(`/api/api-keys/${id}`, { method: "DELETE" });

export const ROTULO_ACAO: Record<Acao, string> = { read: "Ler", create: "Criar", update: "Editar", delete: "Excluir" };
