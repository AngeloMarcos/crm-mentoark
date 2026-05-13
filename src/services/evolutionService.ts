import { callEdgeFunction } from '@/lib/api';

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

export async function createInstance(): Promise<CreateInstanceResult> {
  const res = await callEdgeFunction<any>('evolution-proxy', {
    method: 'POST',
    body: { action: 'create' },
  });
  if (res.error) throw new Error(res.error);
  return res.data;
}

export async function reconnectInstance(): Promise<CreateInstanceResult> {
  const res = await callEdgeFunction<any>('evolution-proxy', {
    method: 'POST',
    body: { action: 'connect' },
  });
  if (res.error) throw new Error(res.error);
  return res.data;
}

export async function fetchConnectionStatus(): Promise<StatusResult> {
  const res = await callEdgeFunction<any>('evolution-proxy', {
    method: 'POST',
    body: { action: 'status' },
  });
  if (res.error) throw new Error(res.error);
  return res.data || { state: 'close' };
}

export async function disconnectInstance(): Promise<void> {
  const res = await callEdgeFunction<any>('evolution-proxy', {
    method: 'POST',
    body: { action: 'logout' },
  });
  if (res.error) throw new Error(res.error);
}
