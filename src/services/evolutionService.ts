const API_BASE = (import.meta.env.VITE_API_URL as string) || 'http://localhost:3000';

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = localStorage.getItem('access_token');
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

export async function fetchConnectionStatus(): Promise<StatusResult> {
  const res = await fetch(`${API_BASE}/api/whatsapp/status`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!res.ok) return { state: 'close' };
  return res.json();
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
