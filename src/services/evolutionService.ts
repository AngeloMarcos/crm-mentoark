import { getAuthToken } from "@/lib/api-token";

const API_BASE = (import.meta.env.VITE_API_URL as string) || 'http://localhost:3000';

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = getAuthToken();
  if (t) h['Authorization'] = `Bearer ${t}`;
  return h;
}

export interface CreateInstanceResult {
  qrCode?: string;
  pairingCode?: string;
  instanceName?: string;
  state?: string;
  phoneNumber?: string;
}

export interface StatusResult {
  state: 'open' | 'close' | 'connecting';
  phoneNumber?: string;
}

export async function fetchConnectionStatus(instancia?: string): Promise<StatusResult> {
  const API_URL = instancia 
    ? `${API_BASE}/api/integracoes_config`
    : `${API_BASE}/api/whatsapp/status`;

  try {
    const res = await fetch(API_URL, {
      method: instancia ? 'GET' : 'POST',
      headers: authHeaders(),
    });

    if (!res.ok) return { state: 'close' };
    
    const data = await res.json();
    
    if (instancia && Array.isArray(data)) {
      const config = data.find(i => i.tipo === 'evolution' && i.instancia === instancia);
      return { 
        state: config?.status === 'conectado' ? 'open' : 'close' 
      };
    }
    
    return data;
  } catch (error) {
    console.error(`[EvolutionService] Error fetching status for ${instancia || 'default'}:`, error);
    return { state: 'close' };
  }
}

export async function createInstance(instanceName?: string, phoneNumber?: string): Promise<CreateInstanceResult> {
  const res = await fetch(`${API_BASE}/api/whatsapp/connect`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ instanceName, phoneNumber }),
  });
  if (!res.ok) throw new Error('Erro ao conectar instância');
  return res.json();
}

export async function reconnectInstance(): Promise<CreateInstanceResult> {
  return createInstance();
}

export async function disconnectInstance(): Promise<void> {
  await fetch(`${API_BASE}/api/whatsapp/disconnect`, {
    method: 'POST',
    headers: authHeaders(),
  });
}
