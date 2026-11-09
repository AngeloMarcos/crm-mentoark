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
export const lerConfigAtendimento = () => chamar<{ motivo_obrigatorio: boolean }>("/atendimentos/config");
export const salvarConfigAtendimento = (motivo_obrigatorio: boolean) =>
  chamar<{ motivo_obrigatorio: boolean }>("/atendimentos/config", { method: "PUT", body: { motivo_obrigatorio } });
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
    case "resolvido": return comMotivo(`Resolvido${por}`, ev.motivo_nome);
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
