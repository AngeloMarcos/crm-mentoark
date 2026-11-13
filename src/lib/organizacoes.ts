/**
 * Organizações (2026-11-12, lacuna P3 do Cubo) — cliente de /api/organizacoes.
 * A organização é da CONTA; `contatos.organizacao_id` aponta para ela.
 */
import { authHeader } from "@/lib/api-token";

const API_URL = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";

export interface Organizacao {
  id: string;
  nome: string;
  site: string | null;
  telefone: string | null;
  cidade: string | null;
  estado: string | null;
  notas: string | null;
  contatos?: number;
  created_at: string;
}

export interface ContatoDaOrganizacao {
  id: string;
  nome: string;
  telefone: string | null;
  email: string | null;
  cargo: string | null;
  status: string;
}

export type DadosOrganizacao = Partial<Pick<Organizacao, "nome" | "site" | "telefone" | "cidade" | "estado" | "notas">>;

async function chamar<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const r = await fetch(`${API_URL}/api/organizacoes${path}`, {
    method: opts.method || "GET",
    headers: { ...authHeader(), ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error((d as any)?.message || `Erro ${r.status}`);
  return d as T;
}

export const listarOrganizacoes = (busca = "") => chamar<Organizacao[]>(busca ? `?search=${encodeURIComponent(busca)}` : "");
export const lerOrganizacao = (id: string) => chamar<Organizacao & { contatos: ContatoDaOrganizacao[] }>(`/${id}`);
export const criarOrganizacao = (dados: DadosOrganizacao) => chamar<Organizacao>("", { method: "POST", body: dados });
export const editarOrganizacao = (id: string, dados: DadosOrganizacao) => chamar<Organizacao>(`/${id}`, { method: "PATCH", body: dados });
export const excluirOrganizacao = (id: string) => chamar<{ ok: true }>(`/${id}`, { method: "DELETE" });
export const vincularContatos = (id: string, contatoIds: string[]) =>
  chamar<{ ok: true; alterados: number }>(`/${id}/vincular`, { method: "POST", body: { contatoIds } });
export const desvincularContatos = (id: string, contatoIds: string[]) =>
  chamar<{ ok: true; alterados: number }>(`/${id}/desvincular`, { method: "POST", body: { contatoIds } });
