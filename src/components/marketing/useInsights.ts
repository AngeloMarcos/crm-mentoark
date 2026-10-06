import { useState, useEffect, useCallback, useRef } from "react";
import { format, subDays } from "date-fns";
import { getAuthToken } from "@/lib/api-token";

const BASE = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";

export interface InsightsTotais {
  impressoes: number;
  cliquesLink: number;
  ctrLink: number;
  cpm: number;
  visualizacoesSite: number;
  frequencia: number;
  alcance: number;
  gasto: number;
  resultados: number;
  custoPorResultado: number;
}

export interface InsightsDia {
  data: string; // yyyy-MM-dd
  gasto: number;
  impressoes: number;
  cliquesLink: number;
  resultados: number;
  cpm: number;
  ctrLink: number;
  custoPorResultado: number;
}

export interface InsightsResposta {
  periodo: { since: string; until: string };
  moeda: string;
  totais: InsightsTotais;
  serie: InsightsDia[];
  campanhas: { id: string; nome: string }[];
}

export type PeriodoDias = 7 | 14 | 30 | 90;

export function useInsights(metaConectado: boolean, dias: PeriodoDias, campanhaId: string) {
  const [dados, setDados] = useState<InsightsResposta | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const reqId = useRef(0);

  const carregar = useCallback(async () => {
    const id = ++reqId.current;
    setErro(null);
    if (!metaConectado) {
      setDados(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const hoje = new Date();
      const params = new URLSearchParams({
        since: format(subDays(hoje, dias - 1), "yyyy-MM-dd"),
        until: format(hoje, "yyyy-MM-dd"),
      });
      if (campanhaId) params.set("campaign_id", campanhaId);

      const r = await fetch(`${BASE}/api/marketing/insights?${params}`, {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(json?.error?.message || json?.message || `HTTP ${r.status}`);
      if (id !== reqId.current) return; // resposta antiga (usuário já trocou o filtro)
      setDados(json as InsightsResposta);
    } catch (e) {
      if (id !== reqId.current) return;
      setDados(null);
      setErro((e as Error)?.message || "Falha ao carregar métricas da Meta");
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [metaConectado, dias, campanhaId]);

  useEffect(() => { carregar(); }, [carregar]);

  return { dados, loading, erro, recarregar: carregar };
}
