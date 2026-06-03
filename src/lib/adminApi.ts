import { toast } from "sonner";

const API_BASE =
  (import.meta.env.VITE_API_URL as string) || "https://api.mentoark.com.br";

export interface AdminFetchOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  params?: Record<string, string | number | undefined>;
  silent?: boolean;
}

export class AdminApiError extends Error {
  status: number;
  payload: any;
  constructor(status: number, message: string, payload?: any) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

function getToken(): string | null {
  return (
    localStorage.getItem("crm_access_token") ||
    localStorage.getItem("access_token") ||
    null
  );
}

function buildUrl(path: string, params?: AdminFetchOptions["params"]): string {
  const url = new URL(path.startsWith("http") ? path : `${API_BASE}${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v === undefined || v === null || v === "") return;
      url.searchParams.set(k, String(v));
    });
  }
  return url.toString();
}

export async function adminFetch<T = any>(
  path: string,
  opts: AdminFetchOptions = {},
): Promise<T> {
  const { method = "GET", body, params, silent } = opts;
  const token = getToken();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(buildUrl(path, params), {
      method,
      headers,
      body: body !== undefined && method !== "GET" ? JSON.stringify(body) : undefined,
    });
  } catch {
    if (!silent) toast.error("Servidor indisponível");
    throw new AdminApiError(0, "network");
  }

  const raw = await res.text();
  let parsed: any = null;
  if (raw) {
    if (raw.trim().startsWith("<")) {
      parsed = { message: "Resposta inválida do servidor" };
    } else {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = { message: "Resposta inválida do servidor" };
      }
    }
  }

  if (res.status === 401) {
    if (!silent) toast.error("Sessão expirada. Faça login novamente.");
    try {
      localStorage.removeItem("crm_access_token");
      localStorage.removeItem("crm_refresh_token");
      localStorage.removeItem("crm_user");
    } catch {}
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      window.location.href = "/login";
    }
    throw new AdminApiError(401, "unauthorized", parsed);
  }

  if (res.status === 403) {
    if (!silent) toast.error("Acesso restrito a administradores");
    throw new AdminApiError(403, "forbidden", parsed);
  }

  if (res.status === 502) {
    if (!silent) toast.error("Conexão lenta com o servidor de mensagens. Tentando reconectar...", { id: "api-502" });
    throw new AdminApiError(502, "Bad Gateway", parsed);
  }

  if (res.status === 503) {
    const msg = parsed?.message || "Serviço indisponível";
    if (!silent) toast.error(msg);
    throw new AdminApiError(503, msg, parsed);
  }

  if (!res.ok) {
    const msg = parsed?.message || parsed?.error || `Erro ${res.status}`;
    if (!silent) toast.error(msg);
    throw new AdminApiError(res.status, msg, parsed);
  }

  return parsed as T;
}
