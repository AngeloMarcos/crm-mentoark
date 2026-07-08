/**
 * evolutionService.ts — Cliente frontend para as rotas de conexão Evolution do backend
 * (/api/whatsapp/evo/status, /connect, /poll-qr, /disconnect). Usado por WhatsAppInterface e
 * InstanceManagementPanel para checar/gerenciar o estado da conexão WhatsApp.
 */
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
  instancia?: string;
  state?: string;
  phoneNumber?: string;
  qrPending?: boolean; // true quando Evolution ainda não gerou o QR (Baileys inicializando)
}

export interface StatusResult {
  state: 'open' | 'close' | 'connecting' | 'unauthorized';
  phoneNumber?: string;
}

// [AUDITORIA] BUG: o parâmetro `instancia` era aceito mas nunca usado — a URL chamada abaixo
// nunca incluía `?instancia=`, mesmo o backend (GET /api/whatsapp/evo/status, ver
// backend/src/routes/whatsapp.ts) aceitando esse query param para checar uma instância
// específica. Nenhum dos chamadores atuais (WhatsAppInterface, InstanceManagementPanel x2)
// passa esse argumento hoje, então não havia impacto visível ainda — mas a
// assinatura da função sugeria (incorretamente) que dava pra checar uma instância específica.
// [AUDITORIA] FIX APLICADO: query param agora é enviado quando `instancia` é passado. Mudança
// aditiva/opcional — comportamento para todos os chamadores atuais (que não passam o argumento)
// continua idêntico.
export async function fetchConnectionStatus(instancia?: string): Promise<StatusResult> {
  try {
    const qs = instancia ? `?instancia=${encodeURIComponent(instancia)}` : '';
    const res = await fetch(`${API_BASE}/api/whatsapp/evo/status${qs}`, {
      headers: authHeaders(),
    });
    if (!res.ok) return { state: 'close' };
    const data = await res.json();
    const state = data?.state === 'open' ? 'open' : data?.state === 'connecting' ? 'connecting' : data?.state === 'unauthorized' ? 'unauthorized' : 'close';
    return { state: state as StatusResult['state'], phoneNumber: data?.phoneNumber };
  } catch {
    return { state: 'close' };
  }
}

export async function createInstance(instanceName?: string, phoneNumber?: string): Promise<CreateInstanceResult> {
  const res = await fetch(`${API_BASE}/api/whatsapp/connect`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ instanceName, phoneNumber }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Erro ao conectar instância');
  }
  return res.json();
}

export async function reconnectInstance(): Promise<CreateInstanceResult> {
  return createInstance();
}

export async function pollQr(): Promise<CreateInstanceResult> {
  const res = await fetch(`${API_BASE}/api/whatsapp/poll-qr`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Erro ao buscar QR');
  return res.json();
}

export async function disconnectInstance(): Promise<void> {
  await fetch(`${API_BASE}/api/whatsapp/disconnect`, {
    method: 'POST',
    headers: authHeaders(),
  });
}
