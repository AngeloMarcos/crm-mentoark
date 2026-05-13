import { callEdgeFunction } from '@/lib/api';

interface SendMessageParams {
  phone: string;
  message: string;
  instance_name?: string;
}

export async function sendWhatsAppMessage(params: SendMessageParams): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await callEdgeFunction<any>('send-whatsapp', {
      method: 'POST',
      body: params,
    });

    if (res.error) {
      return { ok: false, error: res.error };
    }

    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Erro ao enviar mensagem' };
  }
}
