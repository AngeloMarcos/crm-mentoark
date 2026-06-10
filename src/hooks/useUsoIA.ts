// src/hooks/useUsoIA.ts
// Hook para consumir as métricas do Motor de IA nativo.
// Backend ainda não implementa /api/ia/* — o hook trata 404 como "vazio"
// para que a UI mostre empty state em vez de quebrar.

import { useCallback, useEffect, useRef, useState } from "react";

const API_BASE = (import.meta.env.VITE_API_URL as string) || "http://localhost:3000";

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  const t = localStorage.getItem("access_token");
  if (t) h["Authorization"] = `Bearer ${t}`;
  return h;
}

export interface UsoResumo {
  mensagens: number;
  tokens_in: number;
  tokens_out: number;
  custo_brl: number;
  por_dia: Array<{ dia: string; tokens: number; custo: number }>;
  por_modalidade: Array<{ modalidade: string; count: number }>;
}

export interface ExecucaoIA {
  id: string;
  agente_id: string;
  agente_nome: string;
  provider: string;
  modelo: string;
  modalidade: "texto" | "audio" | "imagem" | "video" | string;
  tokens_in: number;
  tokens_out: number;
  custo_brl: number;
  latencia_ms: number;
  status: "ok" | "erro" | string;
  created_at: string;
}

const RESUMO_VAZIO: UsoResumo = {
  mensagens: 0,
  tokens_in: 0,
  tokens_out: 0,
  custo_brl: 0,
  por_dia: [],
  por_modalidade: [],
};

interface UseUsoIAArgs {
  from?: string; // ISO
  to?: string;   // ISO
  agenteId?: string;
}

export function useUsoIA({ from, to, agenteId }: UseUsoIAArgs = {}) {
  const [data, setData] = useState<UsoResumo>(RESUMO_VAZIO);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aguardandoBackend, setAguardandoBackend] = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      if (agenteId) qs.set("agente_id", agenteId);
      const res = await fetch(`${API_BASE}/api/ia/uso?${qs.toString()}`, {
        headers: authHeaders(),
      });
      if (res.status === 404) {
        setAguardandoBackend(true);
        setData(RESUMO_VAZIO);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as UsoResumo;
      setAguardandoBackend(false);
      setData({
        mensagens: json.mensagens ?? 0,
        tokens_in: json.tokens_in ?? 0,
        tokens_out: json.tokens_out ?? 0,
        custo_brl: json.custo_brl ?? 0,
        por_dia: json.por_dia ?? [],
        por_modalidade: json.por_modalidade ?? [],
      });
    } catch (e: any) {
      setError(e?.message ?? "Erro desconhecido");
      setData(RESUMO_VAZIO);
    } finally {
      setLoading(false);
    }
  }, [from, to, agenteId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  return { data, loading, error, aguardandoBackend, reload: carregar };
}

interface UseUltimasArgs {
  limit?: number;
  agenteId?: string;
  pollMs?: number;
}

export function useUltimasExecucoes({ limit = 20, agenteId, pollMs }: UseUltimasArgs = {}) {
  const [items, setItems] = useState<ExecucaoIA[]>([]);
  const [loading, setLoading] = useState(true);
  const [aguardandoBackend, setAguardandoBackend] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const carregar = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ limit: String(limit) });
      if (agenteId) qs.set("agente_id", agenteId);
      const res = await fetch(`${API_BASE}/api/ia/execucoes?${qs.toString()}`, {
        headers: authHeaders(),
      });
      if (res.status === 404) {
        setAguardandoBackend(true);
        setItems([]);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ExecucaoIA[];
      setAguardandoBackend(false);
      setItems(Array.isArray(json) ? json : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [limit, agenteId]);

  useEffect(() => {
    carregar();
    const safePollMs = pollMs && pollMs >= 5000 ? pollMs : 0;
    if (safePollMs > 0) {
      timerRef.current = setInterval(carregar, safePollMs);
      return () => {
        if (timerRef.current) clearInterval(timerRef.current);
      };
    }
  }, [carregar, pollMs]);

  return { items, loading, aguardandoBackend, reload: carregar };
}
