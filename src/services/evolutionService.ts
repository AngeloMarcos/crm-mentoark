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

async function getUserId(): Promise<string> {
  try {
    const { api } = await import('@/integrations/database/client');
    const { data } = await api.auth.getUser();
    const id = data?.user?.id;
    if (!id) throw new Error('Não autenticado');
    return id;
  } catch (e) {
    throw new Error('Não autenticado');
  }
}

async function call(action: string) {
  const user_id = await getUserId();
  const res = await callEdgeFunction<any>('evolution-proxy', {
    method: 'POST',
    body: { action, user_id },
  });
  if (res.error) throw new Error(res.error);
  return res.data;
}

export async function createInstance(): Promise<CreateInstanceResult> {
  return await call('create');
}

export async function reconnectInstance(): Promise<CreateInstanceResult> {
  return await call('connect');
}

export async function fetchConnectionStatus(): Promise<StatusResult> {
  const data = await call('status');
  return data || { state: 'close' };
}

export async function disconnectInstance(): Promise<void> {
  await call('logout');
}
