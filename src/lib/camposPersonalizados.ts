/**
 * Campos personalizados do contato (2026-11-11) — cliente de /api/campos-personalizados e
 * formatação dos valores (mesmas regras de backend/src/services/camposPersonalizados.ts).
 */
import { authHeader } from "@/lib/api-token";

const API_URL = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";

export type TipoCampo = "texto" | "numero" | "moeda" | "data" | "selecao" | "multipla" | "sim_nao";
export type ValorCampo = string | number | boolean | string[];

export interface CampoPersonalizado {
  id: string;
  nome: string;
  chave: string;
  tipo: TipoCampo;
  opcoes: string[];
  descricao: string | null;
  ia_preenche: boolean;
  ativo: boolean;
  ordem: number;
}

export const TIPOS_CAMPO: { tipo: TipoCampo; rotulo: string }[] = [
  { tipo: "texto", rotulo: "Texto" },
  { tipo: "numero", rotulo: "Número" },
  { tipo: "moeda", rotulo: "Valor (R$)" },
  { tipo: "data", rotulo: "Data" },
  { tipo: "selecao", rotulo: "Lista (uma opção)" },
  { tipo: "multipla", rotulo: "Lista (várias opções)" },
  { tipo: "sim_nao", rotulo: "Sim ou não" },
];
export const rotuloTipo = (t: TipoCampo) => TIPOS_CAMPO.find(x => x.tipo === t)?.rotulo ?? t;
export const temOpcoes = (t: TipoCampo) => t === "selecao" || t === "multipla";

async function chamar<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const r = await fetch(`${API_URL}/api/campos-personalizados${path}`, {
    method: opts.method || "GET",
    headers: { ...authHeader(), ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(d?.message || `Erro ${r.status}`);
  return d as T;
}

type DadosCampo = Partial<Pick<CampoPersonalizado, "nome" | "tipo" | "opcoes" | "descricao" | "ia_preenche" | "ativo">>;

export const listarCampos = (todos = false) => chamar<CampoPersonalizado[]>(todos ? "?todos=1" : "");
export const criarCampo = (dados: DadosCampo) => chamar<CampoPersonalizado>("", { method: "POST", body: dados });
export const editarCampo = (id: string, dados: DadosCampo) => chamar<CampoPersonalizado>(`/${id}`, { method: "PATCH", body: dados });
export const excluirCampo = (id: string) => chamar<{ ok: true }>(`/${id}`, { method: "DELETE" });
export const ordenarCampos = (ids: string[]) => chamar<CampoPersonalizado[]>("/ordem", { method: "PUT", body: { ids } });

export const lerValoresDoContato = (contatoId: string) =>
  chamar<{ campos: CampoPersonalizado[]; valores: Record<string, ValorCampo> }>(`/contato/${contatoId}`);
export const salvarValoresDoContato = (contatoId: string, valores: Record<string, ValorCampo | null>) =>
  chamar<{ valores: Record<string, ValorCampo> }>(`/contato/${contatoId}`, { method: "PUT", body: { valores } });

export function formatarValor(campo: Pick<CampoPersonalizado, "tipo">, valor: unknown): string {
  if (valor === null || valor === undefined || valor === "") return "";
  switch (campo.tipo) {
    case "moeda": return typeof valor === "number" ? valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : String(valor);
    case "numero": return typeof valor === "number" ? valor.toLocaleString("pt-BR") : String(valor);
    case "data": { const m = String(valor).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : String(valor); }
    case "sim_nao": return valor === true ? "Sim" : valor === false ? "Não" : String(valor);
    case "multipla": return Array.isArray(valor) ? valor.join(", ") : String(valor);
    default: return String(valor);
  }
}
