import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";

const API_BASE = (import.meta.env.VITE_API_URL as string) || "https://api.mentoark.com.br";

export type AssinaturaStatus = "trial" | "ativa" | "expirada";

export interface AssinaturaInfo {
  status: AssinaturaStatus;
  plano: string;
  trial_fim: string | null;
  dias_restantes: number;
  read_only: boolean;
  sou_dono: boolean;
}

/**
 * Estado da assinatura do tenant (trial de 3 dias). Fase 1: só alimenta o banner.
 * A trava de escrita (read_only) só passa a bloquear de verdade na Fase 2.
 */
export function useAssinatura() {
  const { session } = useAuth();
  const [data, setData] = useState<AssinaturaInfo | null>(null);

  const carregar = useCallback(async () => {
    const token = session?.access_token;
    if (!token) { setData(null); return; }
    try {
      const r = await fetch(`${API_BASE}/api/assinatura`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) setData(await r.json());
    } catch {
      /* silencioso — sem status, banner some, nada trava */
    }
  }, [session?.access_token]);

  useEffect(() => {
    carregar();
    const t = setInterval(carregar, 5 * 60_000);
    const onFocus = () => carregar();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(t); window.removeEventListener("focus", onFocus); };
  }, [carregar]);

  return { assinatura: data, recarregar: carregar };
}
