import { api } from "@/integrations/database/client";

async function callProxy(action: string) {
  const { data: { session } } = await api.auth.getSession();
  if (!session?.user?.id) {
    throw new Error('Usuário não autenticado');
  }

  const { data, error } = await api.functions.invoke('evolution-proxy', {
    body: {
      action,
      user_id: session.user.id
    }
  });

  if (error) {
    throw new Error(error.message || 'Erro ao comunicar com a Evolution API');
  }

  return data;
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
  return await callProxy('status');
}

export async function createInstance(): Promise<CreateInstanceResult> {
  return await callProxy('create');
}

export async function reconnectInstance(): Promise<CreateInstanceResult> {
  return await callProxy('create');
}

export async function disconnectInstance(): Promise<void> {
  await callProxy('logout');
}

