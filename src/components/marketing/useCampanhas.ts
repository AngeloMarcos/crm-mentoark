import { useState, useEffect, useCallback } from "react";
import { getAuthToken } from "@/lib/api-token";

const BASE = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";

export interface Campanha {
  id: string;
  nome: string;
  status: "ACTIVE" | "PAUSED" | "ARCHIVED" | "DELETED";
  objetivo: string;
  plataforma: "facebook" | "instagram" | "ambos";
  orcamentoDiario: number;
  orcamentoTotal: number;
  inicio: string;
  fim?: string;
  // Métricas
  impressoes: number;
  alcance: number;
  cliques: number;
  ctr: number;
  cpc: number;
  gastoTotal: number;
  leads: number;
  cpl: number;
  origem: "real";
}

export function useCampanhas(metaConectado: boolean) {
  const [campanhas, setCampanhas] = useState<Campanha[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [filtroStatus, setFiltroStatus] = useState<"ALL" | "ACTIVE" | "PAUSED">("ALL");

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    if (!metaConectado) {
      setCampanhas([]);
      setLoading(false);
      return;
    }
    try {
      const r = await fetch(`${BASE}/api/marketing/campanhas?status=${filtroStatus}`, {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error?.message || data?.message || `HTTP ${r.status}`);
      setCampanhas(data.campanhas ?? []);
    } catch (e) {
      setCampanhas([]);
      setErro((e as Error)?.message || "Falha ao carregar campanhas da Meta");
    } finally {
      setLoading(false);
    }
  }, [metaConectado, filtroStatus]);

  useEffect(() => { carregar(); }, [carregar]);

  // Lança erro quando a Meta recusa — antes resolvia sempre e o toast mostrava "pausada" mesmo falhando.
  const alterarStatus = async (id: string, acao: "pausar" | "reativar") => {
    const r = await fetch(`${BASE}/api/marketing/campanhas/${id}/${acao}`, { method: "POST", headers: { Authorization: `Bearer ${getAuthToken()}` } });
    const data = await r.json().catch(() => ({}));
    carregar();
    if (!r.ok) throw new Error(data?.error?.message || `HTTP ${r.status}`);
  };
  const pausar = (id: string) => alterarStatus(id, "pausar");
  const reativar = (id: string) => alterarStatus(id, "reativar");

  return { campanhas, loading, erro, metaConectado, filtroStatus, setFiltroStatus, recarregar: carregar, pausar, reativar };
}
