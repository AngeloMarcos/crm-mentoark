import { api } from "@/integrations/database/client";

const API_BASE = (import.meta.env.VITE_API_URL as string) || "https://api.mentoark.com.br";

export interface CallOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: unknown;
  params?: Record<string, string>;
  authToken?: string;
}

export interface ApiResponse<T = unknown> {
  data?: T;
  total?: number;
  error?: string;
  success?: boolean;
  message?: string;
  [key: string]: unknown;
}

export async function callEdgeFunction<T = unknown>(
  name: string,
  options: CallOptions = {}
): Promise<ApiResponse<T>> {
  const { method = 'GET', body, params } = options;
  let { authToken } = options;

  if (!authToken) {
    authToken = (await getAuthToken()) || undefined;
  }

  const url = new URL(`${API_BASE}/api/functions/${name}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') {
        url.searchParams.append(k, v);
      }
    });
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  try {
    const res = await fetch(url.toString(), {
      method,
      headers,
      body: body && method !== 'GET' ? JSON.stringify(body) : undefined,
    });

    const json = await res.json();

    if (!res.ok) {
      return { error: json.error || json.message || `HTTP ${res.status}`, ...json };
    }

    return { data: json, success: true } as ApiResponse<T>;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error';
    return { error: message };
  }
}

export async function getAuthToken(): Promise<string | null> {
  try {
    const { data } = await api.auth.getSession();
    return data.session?.access_token || null;
  } catch {
    return null;
  }
}
