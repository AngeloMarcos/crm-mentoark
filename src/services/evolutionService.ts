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
  error?: boolean;
  message?: string;
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
    const data = await res.json().catch(() => ({}));
    // [AUDITORIA] FIX APLICADO: antes, qualquer !res.ok virava um `{ state: 'close' }` genérico,
    // indistinguível de uma instância realmente desconectada — agora repassamos error/message
    // vindos do backend (ver GET /evo/status em whatsapp.ts) para quem chama decidir o que fazer.
    if (!res.ok) return { state: 'close', error: true, message: data?.message };
    const state = data?.state === 'open' ? 'open' : data?.state === 'connecting' ? 'connecting' : data?.state === 'unauthorized' ? 'unauthorized' : 'close';
    return { state: state as StatusResult['state'], phoneNumber: data?.phoneNumber };
  } catch (err: any) {
    return { state: 'close', error: true, message: err?.message };
  }
}

export async function createInstance(instanceName?: string, phoneNumber?: string, forceReconnect?: boolean): Promise<CreateInstanceResult> {
  const res = await fetch(`${API_BASE}/api/whatsapp/connect`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ instanceName, phoneNumber, force_reconnect: forceReconnect === true }),
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
  const data = await res.json().catch(() => ({}));
  // [AUDITORIA] FIX APLICADO: antes, qualquer erro HTTP virava sempre a mesma mensagem genérica
  // 'Erro ao buscar QR', mascarando o erro real que o backend passou a expor (ver whatsapp.ts
  // /poll-qr). Agora a mensagem do backend é propagada para quem chama pollQr().
  if (!res.ok) throw new Error(data?.message || 'Erro ao buscar QR');
  return data;
}

export async function disconnectInstance(): Promise<void> {
  await fetch(`${API_BASE}/api/whatsapp/disconnect`, {
    method: 'POST',
    headers: authHeaders(),
  });
}
