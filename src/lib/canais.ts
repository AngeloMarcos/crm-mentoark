/**
 * Cliente de Canais (2026-10-30, modelo Cubo): número de WhatsApp → agente de IA que responde.
 * Backend: routes/canais.ts (QR Code) e routes/metaOficial.ts `PUT /configs/:id/ia` (oficial).
 */
import { authHeader } from "@/lib/api-token";

const API_URL = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";

export interface Canal {
  id: string;
  provider: "evolution" | "meta_cloud";
  nome: string;
  instancia: string | null;
  numero: string | null;
  conectado: boolean;
  pessoal: boolean;
  alerta: string | null;
  ia_ativa: boolean;
  agente_id: string | null;
  agente_proprio: boolean;
  qualidade?: string | null;
  limite?: string | null;
}

export interface AgenteOpcao {
  id: string;
  nome: string;
  ativo: boolean;
  modelo: string | null;
  eh_numero: boolean;
  tem_prompt: boolean;
  tem_escopo: boolean;
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

export const listarCanais = () => chamar<{ canais: Canal[]; agentes: AgenteOpcao[] }>("/api/canais");

/** Liga/desliga a IA e/ou troca o agente que responde no número. */
export function atualizarCanal(canal: Canal, mudanca: { ia_ativa?: boolean; agente_id?: string | null }) {
  if (canal.provider === "meta_cloud") {
    return chamar("/api/meta-oficial/configs/" + canal.id + "/ia", {
      method: "PUT",
      body: JSON.stringify({ ia_ativa: mudanca.ia_ativa ?? canal.ia_ativa, agente_id: mudanca.agente_id ?? canal.agente_id }),
    });
  }
  const body: Record<string, unknown> = {};
  if (mudanca.ia_ativa !== undefined) body.ia_ativa = mudanca.ia_ativa;
  // Número QR Code: escolher o próprio número volta ao comportamento antigo (NULL).
  if (mudanca.agente_id !== undefined) body.agente_resposta_id = mudanca.agente_id === canal.id ? null : mudanca.agente_id;
  return chamar("/api/canais/numero/" + canal.id, { method: "PUT", body: JSON.stringify(body) });
}
