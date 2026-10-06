import { useState, useEffect } from "react";

const BASE = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";

export interface MetaStatus {
  conectado: boolean;
  expirado?: boolean;
  nome_conta?: string;
  ad_account_id?: string | null;
  tipo_token?: "oauth" | "system_user";
  token_expira_em?: string | null;
  dias_restantes?: number | null;
  loading: boolean;
}

export function useMetaStatus() {
  const [status, setStatus] = useState<MetaStatus>({ conectado: false, loading: true });

  const verificar = async () => {
    setStatus((s) => ({ ...s, loading: true }));
    try {
      const token = localStorage.getItem("crm_access_token") || "";
      const r = await fetch(`${BASE}/api/marketing/facebook/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) {
        const data = await r.json();
        setStatus({ ...data, conectado: data.conectado ?? false, loading: false });
      } else {
        setStatus({ conectado: false, loading: false });
      }
    } catch {
      setStatus({ conectado: false, loading: false });
    }
  };

  useEffect(() => { verificar(); }, []);
  return { ...status, recarregar: verificar };
}
