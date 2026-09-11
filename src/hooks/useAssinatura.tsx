import {
  createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode,
} from "react";
import { useAuth } from "@/hooks/useAuth";
import { setReadOnly } from "@/lib/readonly";

const API_BASE = (import.meta.env.VITE_API_URL as string) || "https://api.mentoark.com.br";

export type AssinaturaStatus = "trial" | "ativa" | "expirada";

export interface AssinaturaInfo {
  status: AssinaturaStatus;
  plano: string;
  trial_fim: string | null;
  dias_restantes: number;
  read_only: boolean;
  sou_dono: boolean;
  sou_master: boolean;
}

interface AssinaturaCtx {
  assinatura: AssinaturaInfo | null;
  recarregar: () => Promise<void>;
}

const Ctx = createContext<AssinaturaCtx>({ assinatura: null, recarregar: async () => {} });

/**
 * Provider único (montado no CRMLayout). Busca o status no mount, a cada 5 min e no focus da
 * aba, e empurra `read_only` pro módulo `lib/readonly` — que o client HTTP consulta antes de
 * qualquer escrita. Fase 1: só o banner usa. Fase 2: a trava passa a valer (backend + este).
 */
export function AssinaturaProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [assinatura, setAssinatura] = useState<AssinaturaInfo | null>(null);
  const tokenRef = useRef<string | undefined>(undefined);
  tokenRef.current = session?.access_token;

  const recarregar = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) { setAssinatura(null); setReadOnly(false); return; }
    try {
      const r = await fetch(`${API_BASE}/api/assinatura`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) {
        const data: AssinaturaInfo = await r.json();
        setAssinatura(data);
        setReadOnly(!!data.read_only);
      }
    } catch {
      /* silencioso — sem status o banner some e a trava fica desligada (fail-open) */
    }
  }, []);

  useEffect(() => {
    recarregar();
    const t = setInterval(recarregar, 5 * 60_000);
    const onFocus = () => recarregar();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(t); window.removeEventListener("focus", onFocus); };
  }, [recarregar, session?.access_token]);

  useEffect(() => () => setReadOnly(false), []);

  return <Ctx.Provider value={{ assinatura, recarregar }}>{children}</Ctx.Provider>;
}

export function useAssinatura() {
  return useContext(Ctx);
}
