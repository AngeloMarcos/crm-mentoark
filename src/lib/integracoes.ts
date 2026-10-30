/**
 * Cliente das Integrações (2026-10-29, modelo Cubo): lista única + integrações de IA
 * (chave, teste e modelos ao vivo). Backend: routes/integracoesHub.ts e routes/ai-providers.ts.
 */
import { authHeader } from "@/lib/api-token";

const API_URL = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";

export type StatusIntegracao = "ok" | "atencao" | "erro" | "desligada";
export type CategoriaIntegracao = "ia" | "whatsapp" | "marketing" | "voz" | "automacao";

export interface ItemIntegracao {
  chave: string;
  categoria: CategoriaIntegracao;
  tipo: string;
  nome: string;
  status: StatusIntegracao;
  detalhe: string | null;
  gerenciar: string;
  id?: string;
}

export interface TipoCatalogo {
  tipo: string;
  categoria: CategoriaIntegracao;
  rotulo: string;
  descricao: string;
  criar: string | null;
}

export interface IntegracaoIA {
  id: string;
  nome: string;
  slug: string;
  modelo: string;
  ativo: boolean;
  ultimo_status: "ok" | "erro" | null;
  ultimo_erro: string | null;
  ultimo_teste_em: string | null;
  agentes_usando: number;
}

export interface TipoIAInfo {
  tipo: string;
  rotulo: string;
  descricao: string;
  modeloSugerido: string;
  dicaChave: string;
  linkChave: string;
}

export interface ModeloIA { id: string; rotulo: string; ferramentas: boolean | null }

async function chamar<T>(caminho: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${caminho}`, {
    ...init,
    headers: { ...authHeader(), ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `Erro ${res.status}`);
  return data as T;
}

export const listarIntegracoes = () => chamar<{ itens: ItemIntegracao[]; catalogo: TipoCatalogo[] }>("/api/integracoes");
export const listarIntegracoesIA = () => chamar<IntegracaoIA[]>("/api/ai-providers");
export const tiposIA = () => chamar<TipoIAInfo[]>("/api/ai-providers/tipos");
export const modelosDaIntegracao = (id: string) => chamar<{ modelos: ModeloIA[] }>(`/api/ai-providers/${id}/modelos`);
export const testarIntegracaoIA = (id: string) =>
  chamar<{ ok: boolean; erro: string | null; total_modelos: number }>(`/api/ai-providers/${id}/testar`, { method: "POST" });
export const criarIntegracaoIA = (body: { nome: string; slug: string; api_key: string }) =>
  chamar<IntegracaoIA & { teste: { ok: boolean; erro: string | null } }>("/api/ai-providers", { method: "POST", body: JSON.stringify(body) });
export const atualizarIntegracaoIA = (id: string, body: Partial<{ nome: string; api_key: string; ativo: boolean }>) =>
  chamar<IntegracaoIA & { teste?: { ok: boolean; erro: string | null } }>(`/api/ai-providers/${id}`, { method: "PATCH", body: JSON.stringify(body) });
export const excluirIntegracaoIA = (id: string) => chamar<{ success: boolean }>(`/api/ai-providers/${id}`, { method: "DELETE" });

export const ROTULO_CATEGORIA: Record<CategoriaIntegracao, string> = {
  ia: "Inteligência artificial",
  whatsapp: "WhatsApp",
  marketing: "Marketing",
  voz: "Voz",
  automacao: "Automação",
};

export const ROTULO_STATUS: Record<StatusIntegracao, string> = {
  ok: "Funcionando",
  atencao: "Atenção",
  erro: "Com erro",
  desligada: "Desligada",
};
