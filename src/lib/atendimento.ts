/**
 * Sprint Atendimento v1, Fase 3 (diagnosticos/SPRINT_ATENDIMENTO_V1.md).
 * Cliente das rotas /api/atendimentos e /api/motivos, e os textos da linha do tempo.
 */
import { authHeader } from "@/lib/api-token";

const API_URL = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";

export type EstadoAtendimento = "aberto" | "aguardando" | "resolvido";
export type TipoMotivo = "transferencia" | "resolucao" | "pausa" | "perda";
export type FiltroAtendimento = EstadoAtendimento | "meus" | "sem_atendente";

export interface Atendimento {
  id: string;
  estado: EstadoAtendimento;
  atendente_id: string | null;
  atendente_nome?: string | null;
  instance_name: string;
  remote_jid: string;
}

export interface EventoAtendimento {
  id: number;
  atendimento_id: string;
  tipo: string;
  origem: string;
  texto: string | null;
  ate: string | null;
  created_at: string;
  autor_id: string | null;
  autor_nome: string | null;
  de_nome: string | null;
  para_nome: string | null;
  motivo_nome: string | null;
}

export interface ConversaAtendimento {
  atendimento: Atendimento | null;
  eventos: EventoAtendimento[];
  ia: { pausada: boolean; ate: string | null };
}

export interface Atendente { id: string; display_name: string | null; email: string }
export interface Motivo { id: string; tipo: TipoMotivo; nome: string; ativo: boolean; ordem: number }
export type Contadores = Record<FiltroAtendimento, number>;

async function chamar<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const r = await fetch(`${API_URL}/api${path}`, {
    method: opts.method || "GET",
    headers: { ...authHeader(), ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(d?.message || `Erro ${r.status}`);
  return d as T;
}

export const lerConversa = (instancia: string, jid: string) =>
  chamar<ConversaAtendimento>(`/atendimentos/conversa?instancia=${encodeURIComponent(instancia)}&jid=${encodeURIComponent(jid)}`);
export const abrirAtendimento = (instancia: string, jid: string) =>
  chamar<Atendimento>("/atendimentos/abrir", { method: "POST", body: { instancia, jid } });
export const acaoAtendimento = (id: string, acao: string, corpo: Record<string, unknown> = {}) =>
  chamar<Atendimento>(`/atendimentos/${id}/${acao}`, { method: "POST", body: corpo });
export const listarAtendentes = () => chamar<Atendente[]>("/atendimentos/atendentes");
export const lerContadores = () => chamar<Contadores>("/atendimentos/contadores");
export interface ConfigAtendimento { motivo_obrigatorio: boolean; resolver_inativo_horas: number }
export const lerConfigAtendimento = () => chamar<ConfigAtendimento>("/atendimentos/config");
export const salvarConfigAtendimento = (campos: Partial<ConfigAtendimento>) =>
  chamar<ConfigAtendimento>("/atendimentos/config", { method: "PUT", body: campos });
export const listarMotivos = (tipo: TipoMotivo, todos = false) => chamar<Motivo[]>(`/motivos?tipo=${tipo}${todos ? "&todos=1" : ""}`);
export const criarMotivo = (tipo: TipoMotivo, nome: string) => chamar<Motivo>("/motivos", { method: "POST", body: { tipo, nome } });
export const editarMotivo = (id: string, campos: Partial<Pick<Motivo, "nome" | "ativo" | "ordem">>) =>
  chamar<Motivo>(`/motivos/${id}`, { method: "PATCH", body: campos });

function comMotivo(texto: string, motivo: string | null): string {
  return motivo ? `${texto} — ${motivo}` : texto;
}

export function textoEventoAtendimento(ev: EventoAtendimento, timeZone?: string): string {
  const por = ev.autor_nome ? ` por ${ev.autor_nome}` : "";
  switch (ev.tipo) {
    case "aberto": return "Atendimento aberto";
    case "atribuido": return ev.para_nome ? `Atribuído a ${ev.para_nome}` : "Atendimento atribuído";
    case "transferido":
      return comMotivo(`Transferido${ev.de_nome ? ` de ${ev.de_nome}` : ""}${ev.para_nome ? ` para ${ev.para_nome}` : ""}`, ev.motivo_nome);
    case "aguardando": return "Cliente pediu atendente: aguardando humano";
    case "resolvido": {
      if (ev.origem === "sistema") {
        const horas = /(\d+) h/.exec(ev.texto || "")?.[1];
        return horas ? `Encerrado por inatividade (${horas} h)` : "Encerrado por inatividade";
      }
      return comMotivo(`Resolvido${por}`, ev.motivo_nome);
    }
    case "reaberto": return `Reaberto${por}`;
    case "ia_pausada": {
      if (!ev.ate) return comMotivo(`IA pausada${por} até devolver`, ev.motivo_nome);
      const hora = new Date(ev.ate).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone });
      return comMotivo(`IA pausada${por} até ${hora}`, ev.motivo_nome);
    }
    case "ia_retomada": return ev.origem === "sistema" ? "IA voltou: fim da pausa" : `IA devolvida${por}`;
    default: return ev.tipo;
  }
}

/** Quanto falta para a pausa acabar; null quando não há prazo ou ele já venceu. */
export function tempoRestantePausa(ate: string | null, agora: Date = new Date()): string | null {
  if (!ate) return null;
  const ms = new Date(ate).getTime() - agora.getTime();
  if (ms <= 0) return null;
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "menos de 1 min";
  if (min < 60) return `${min} min`;
  const resto = min % 60;
  return resto ? `${Math.floor(min / 60)} h ${resto} min` : `${Math.floor(min / 60)} h`;
}

// ── Relatórios (Sprint Relatórios de Atendimento v1) ─────────────────────────────────────────

export interface Percentis { p50: number | null; p90: number | null }

export interface RelatorioAtendimento {
  periodo: { de: string; ate: string; dias: number };
  resumo: {
    total: number; resolvidos: number; emAndamento: number; reabertos: number; semAtendente: number;
    resolvidosSoIa: number; resolvidosInatividade: number; resolvidosPorAlguem: number; respondidos: number; respondidosHumano: number; pediramHumano: number;
    humanoNaMeta: number; resolvidosNaMeta: number;
    respostaSeg: Percentis; respostaHumanaSeg: Percentis; resolucaoSeg: Percentis;
  };
  dias: { dia: string; abertos: number; resolvidos: number }[];
  atendentes: { id: string; nome: string; atribuidos: number; resolvidos: number; respostaHumanaSeg: number | null; resolucaoSeg: number | null }[];
  motivos: { nome: string; total: number }[];
}

export interface SituacaoAgora {
  abertos: number; aguardando: number; semAtendente: number;
  fila: { id: string; telefone: string; nome: string; atendente_nome: string | null; desde: string }[];
}

export const lerRelatorio = (de: string) => chamar<RelatorioAtendimento>(`/atendimentos/relatorio?de=${de}`);
export const lerSituacaoAgora = () => chamar<SituacaoAgora>("/atendimentos/agora");

/** "45 s", "12 min", "2 h 5 min", "1 d 3 h"; null vira "—". */
export function formatarDuracao(seg: number | null): string {
  if (seg === null || seg === undefined) return "—";
  if (seg < 60) return `${Math.round(seg)} s`;
  const min = Math.floor(seg / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), restoMin = min % 60;
  if (h < 24) return restoMin ? `${h} h ${restoMin} min` : `${h} h`;
  const d = Math.floor(h / 24), restoH = h % 24;
  return restoH ? `${d} d ${restoH} h` : `${d} d`;
}

/** Primeiro dia (AAAA-MM-DD, Brasília) de um período de `dias` dias terminando hoje. */
export function diaInicialDoPeriodo(dias: number, agora: Date = new Date()): string {
  const hoje = agora.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const t = Date.parse(`${hoje}T00:00:00Z`) - (dias - 1) * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
