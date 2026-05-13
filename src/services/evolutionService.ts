const API_BASE = (import.meta.env.VITE_API_URL as string) || 'http://localhost:3000';

function getToken(): string {
  return localStorage.getItem('access_token') || localStorage.getItem('crm_access_token') || '';
}

async function callBackend(path: string, body?: object) {
  const res = await fetch(`${API_BASE}/api/whatsapp/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message || 'Erro ao comunicar com o servidor');
  }
  return res.json();
}

export interface CreateInstanceResult {
  qrCode?: string;
  instanceName?: string;
  state?: string;
  phoneNumber?: string;
}

export interface StatusResult {
  state: 'open' | 'close' | 'connecting';
  phoneNumber?: string;
}

export async function fetchConnectionStatus(): Promise<StatusResult> {
  const data = await callBackend('status');
  return data || { state: 'close' };
}

export async function createInstance(): Promise<CreateInstanceResult> {
  return await callBackend('connect');
}

export async function reconnectInstance(): Promise<CreateInstanceResult> {
  return await callBackend('connect');
}

export async function disconnectInstance(): Promise<void> {
  await callBackend('disconnect');
}
