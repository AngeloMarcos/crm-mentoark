import { useState, useEffect, useCallback } from "react";

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
  origem: "real" | "mock";
}

const MOCK_CAMPANHAS: Campanha[] = [
  {
    id: "mock-1", nome: "Lançamento Imóveis Junho", status: "ACTIVE", objetivo: "Leads",
    plataforma: "ambos", orcamentoDiario: 80, orcamentoTotal: 2400, inicio: "2025-06-01",
    impressoes: 48200, alcance: 22300, cliques: 867, ctr: 1.8, cpc: 2.77,
    gastoTotal: 1240, leads: 213, cpl: 5.82, origem: "mock",
  },
  {
    id: "mock-2", nome: "WhatsApp Click-to-Chat", status: "ACTIVE", objetivo: "Mensagens",
    plataforma: "facebook", orcamentoDiario: 40, orcamentoTotal: 1200, inicio: "2025-06-10",
    impressoes: 31500, alcance: 14800, cliques: 756, ctr: 2.4, cpc: 1.59,
    gastoTotal: 620, leads: 189, cpl: 3.28, origem: "mock",
  },
  {
    id: "mock-3", nome: "Branding Instagram Stories", status: "PAUSED", objetivo: "Alcance",
    plataforma: "instagram", orcamentoDiario: 30, orcamentoTotal: 900, inicio: "2025-05-15", fim: "2025-05-30",
    impressoes: 92000, alcance: 61000, cliques: 460, ctr: 0.5, cpc: 1.96,
    gastoTotal: 900, leads: 14, cpl: 64.29, origem: "mock",
  },
];

export function useCampanhas(metaConectado: boolean) {
  const [campanhas, setCampanhas] = useState<Campanha[]>([]);
  const [loading, setLoading] = useState(true);
  const [isMock, setIsMock] = useState(false);
  const [filtroStatus, setFiltroStatus] = useState<"ALL" | "ACTIVE" | "PAUSED">("ALL");

  const carregar = useCallback(async () => {
    setLoading(true);
    if (!metaConectado) {
      await new Promise((r) => setTimeout(r, 600));
      setCampanhas(MOCK_CAMPANHAS);
      setIsMock(true);
      setLoading(false);
      return;
    }
    try {
      const token = localStorage.getItem("crm_access_token") || "";
      const r = await fetch(`${BASE}/api/marketing/campanhas?status=${filtroStatus}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error();
      const data = await r.json();
      setCampanhas(data.campanhas ?? []);
      setIsMock(false);
    } catch {
      setCampanhas(MOCK_CAMPANHAS);
      setIsMock(true);
    } finally {
      setLoading(false);
    }
  }, [metaConectado, filtroStatus]);

  useEffect(() => { carregar(); }, [carregar]);

  const pausar = async (id: string) => {
    if (isMock) return;
    const token = localStorage.getItem("crm_access_token") || "";
    await fetch(`${BASE}/api/marketing/campanhas/${id}/pausar`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    carregar();
  };

  const reativar = async (id: string) => {
    if (isMock) return;
    const token = localStorage.getItem("crm_access_token") || "";
    await fetch(`${BASE}/api/marketing/campanhas/${id}/reativar`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    carregar();
  };

  return { campanhas, loading, isMock, filtroStatus, setFiltroStatus, recarregar: carregar, pausar, reativar };
}
