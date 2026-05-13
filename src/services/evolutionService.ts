import { callEdgeFunction } from '@/lib/api';

export const GLOBAL_INSTANCE_NAME = "Cris"; // Instância única conforme logs

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

async function getAuthData(): Promise<{ user_id: string; instance_name?: string }> {
  try {
    const { api } = await import('@/integrations/database/client');
    const { data: userData } = await api.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) throw new Error('Não autenticado');

    // Tenta buscar instância configurada
    const { data: config } = await api
      .from('integracoes_config')
      .select('instancia')
      .eq('tipo', 'evolution')
      .eq('user_id', userId)
      .maybeSingle();

    return { 
      user_id: userId, 
      instance_name: GLOBAL_INSTANCE_NAME 
    };
  } catch (e) {
    throw new Error('Não autenticado');
  }
}

async function call(action: string) {
  const { user_id, instance_name } = await getAuthData();
  const res = await callEdgeFunction<any>('evolution-proxy', {
    method: 'POST',
    body: { action, user_id, instance_name },
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
