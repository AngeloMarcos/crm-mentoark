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
  // [AUDITORIA] LÓGICA: barra de progresso de sincronização de histórico (2026-07-22) —
  // vem junto do status de conexão, sem endpoint/polling novo (ver AUDITORIA_LOG.md).
  sync_status?: 'idle' | 'syncing' | 'completed' | 'error';
  sync_progress?: number;
  sync_total?: number;
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
    return {
      state: state as StatusResult['state'],
      phoneNumber: data?.phoneNumber,
      sync_status: data?.sync_status,
      sync_progress: data?.sync_progress,
      sync_total: data?.sync_total,
    };
  } catch (err: any) {
    return { state: 'close', error: true, message: err?.message };
  }
}

// [AUDITORIA] LÓGICA (Sprint 2 — multi-instância, 2026-07-23): antes, createInstance() só sabia
// resolver a instância "padrão" do tenant — não tinha como o painel pedir "conecta um número
// NOVO" nem "reconecta ESTE card específico" (ver diagnosticos/AUDITORIA_LOG.md, Sprint 1/2 do
// plano multi-instância). `novaConexao` e `instancia` são mutuamente exclusivos: o backend usa
// `novaConexao` pra calcular o próximo nome livre; sem ele, `instancia` (se pertencer ao
// tenant) direciona a ação pra aquela instância específica em vez da padrão.
export interface CreateInstanceOpts {
  instanceName?: string;
  phoneNumber?: string;
  forceReconnect?: boolean;
  novaConexao?: boolean;
  instancia?: string;
}

export async function createInstance(opts: CreateInstanceOpts = {}): Promise<CreateInstanceResult> {
  const { instanceName, phoneNumber, forceReconnect, novaConexao, instancia } = opts;
  const res = await fetch(`${API_BASE}/api/whatsapp/connect`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      instanceName, phoneNumber,
      force_reconnect: forceReconnect === true,
      nova_conexao: novaConexao === true,
      instancia,
    }),
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

export async function pollQr(instancia?: string): Promise<CreateInstanceResult> {
  const qs = instancia ? `?instancia=${encodeURIComponent(instancia)}` : '';
  const res = await fetch(`${API_BASE}/api/whatsapp/poll-qr${qs}`, {
    headers: authHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  // [AUDITORIA] FIX APLICADO: antes, qualquer erro HTTP virava sempre a mesma mensagem genérica
  // 'Erro ao buscar QR', mascarando o erro real que o backend passou a expor (ver whatsapp.ts
  // /poll-qr). Agora a mensagem do backend é propagada para quem chama pollQr().
  if (!res.ok) throw new Error(data?.message || 'Erro ao buscar QR');
  return data;
}

export async function disconnectInstance(instancia?: string): Promise<void> {
  await fetch(`${API_BASE}/api/whatsapp/disconnect`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ instancia }),
  });
}
