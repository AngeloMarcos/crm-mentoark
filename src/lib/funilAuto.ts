/**
 * Funil que anda sozinho (2026-11-02, modelo atendIA). Backend: routes/funilAuto.ts.
 */
import { authHeader } from "@/lib/api-token";

const API_URL = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";

export type TipoEtapa = "aberta" | "ganho" | "perdido";

export interface AutomacaoEtapa {
  tipo: "adicionar_etiqueta" | "definir_responsavel";
  ativo: boolean;
  etiqueta?: string;
  responsavel?: string;
}

export interface EtapaFunil {
  id: string;
  nome: string;
  tipo: TipoEtapa;
  cor: string | null;
  ordem: number | null;
  automacoes: AutomacaoEtapa[];
  cards: number;
}

export interface CardFunil {
  id: string;
  nome: string | null;
  telefone: string | null;
  empresa: string | null;
  tags: string[] | null;
  responsavel: string | null;
  valor_potencial: number | null;
  temperatura: string | null;
  funil_estagio_id: string;
  funil_entrou_em: string | null;
  ultima_mensagem_em: string | null;
  ultimo_movimento: { origem: string; resultado: string; motivo: string | null; created_at: string } | null;
}

export interface EventoFunil {
  id: number;
  origem: "manual" | "ia" | "api" | "automacao";
  resultado: "feito" | "recusado" | "falhou";
  motivo: string | null;
  created_at: string;
  de_nome: string | null;
  para_nome: string | null;
  agente_nome: string | null;
}

/** `agentes.acoes_funil` */
export interface AcoesFunil {
  mover: { ativo: boolean; etapas: string[]; quando: string };
}

export const ACOES_FUNIL_PADRAO: AcoesFunil = { mover: { ativo: false, etapas: [], quando: "" } };

export function acoesFunilDoAgente(bruto: unknown): AcoesFunil {
  const m = (bruto && typeof bruto === "object" ? (bruto as { mover?: Partial<AcoesFunil["mover"]> }).mover : null) || {};
  return {
    mover: {
      ativo: m.ativo === true,
      etapas: Array.isArray(m.etapas) ? m.etapas.filter((e): e is string => typeof e === "string") : [],
      quando: typeof m.quando === "string" ? m.quando : "",
    },
  };
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

export const listarEtapasFunil = () => chamar<{ etapas: EtapaFunil[] }>("/api/funil-auto/etapas");
export const listarCardsFunil = () => chamar<{ cards: CardFunil[]; limite: number }>("/api/funil-auto/cards");
export const eventosDoCard = (contatoId: string) =>
  chamar<{ eventos: EventoFunil[] }>(`/api/funil-auto/eventos?contato_id=${encodeURIComponent(contatoId)}`);

export const moverCard = (contatoId: string, estagioId: string | null, motivoId?: string) =>
  chamar<{ ok: boolean; motivo?: string; message?: string; automacoes?: Array<{ tipo: string; ok: boolean; erro?: string }> }>(
    "/api/funil-auto/mover", { method: "POST", body: JSON.stringify({ contato_id: contatoId, estagio_id: estagioId, ...(motivoId ? { motivo_id: motivoId } : {}) }) });

export interface RelatorioFunil {
  resumo: { entraram: number; ganhos: number; perdidos: number; conversao: number | null; valorGanho: number; cicloSeg: { p50: number | null; p90: number | null } };
  etapas: { id: string; nome: string; tipo: TipoEtapa; cor: string | null; cards: number; valor: number; sairam: number; tempoSeg: number | null }[];
  motivosPerda: { nome: string; total: number }[];
}
export const lerRelatorioFunil = (de: string) => chamar<RelatorioFunil>(`/api/funil-auto/relatorio?de=${de}`);

export const criarEtapa = (nome: string, tipo: TipoEtapa = "aberta", cor?: string) =>
  chamar<{ id: string }>("/api/funil-auto/etapas", { method: "POST", body: JSON.stringify({ nome, tipo, cor }) });

export const atualizarEtapa = (id: string, dados: Partial<Pick<EtapaFunil, "nome" | "cor" | "tipo" | "automacoes">>) =>
  chamar<{ ok: true }>(`/api/funil-auto/etapas/${id}`, { method: "PUT", body: JSON.stringify(dados) });

export const ordenarEtapas = (ids: string[]) =>
  chamar<{ ok: true }>("/api/funil-auto/etapas-ordem", { method: "PUT", body: JSON.stringify({ ids }) });

export const excluirEtapa = (id: string, moverPara: string | null) =>
  chamar<{ ok: true }>(`/api/funil-auto/etapas/${id}`, { method: "DELETE", body: JSON.stringify({ mover_para: moverPara }) });

export const ROTULO_ORIGEM: Record<EventoFunil["origem"], string> = {
  manual: "Equipe", ia: "IA", api: "API", automacao: "Automação",
};

/** Frase do evento, igual no histórico do card e na linha do tempo da conversa. */
export function textoEventoFunil(ev: EventoFunil): string {
  if (ev.origem === "automacao") return ev.motivo || "Automação da etapa";
  const quem = ev.origem === "ia" ? `IA${ev.agente_nome ? ` (${ev.agente_nome})` : ""}` : ROTULO_ORIGEM[ev.origem];
  const destino = ev.para_nome ? `"${ev.para_nome}"` : "fora do funil";
  if (ev.resultado === "feito") return `${quem} moveu ${ev.de_nome ? `de "${ev.de_nome}" ` : ""}para ${destino}`;
  return `${quem} tentou mover para ${destino}`;
}

export interface FunilDaConversa {
  contato_id: string | null;
  etapa: { id: string; nome: string; cor: string | null } | null;
  eventos: EventoFunil[];
}

export const funilDaConversa = (telefone: string) =>
  chamar<FunilDaConversa>(`/api/funil-auto/eventos-conversa?telefone=${encodeURIComponent(telefone)}`);
