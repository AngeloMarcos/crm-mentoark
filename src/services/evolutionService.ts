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
  state?: string;
  phoneNumber?: string;
}

export interface StatusResult {
  state: 'open' | 'close' | 'connecting';
  phoneNumber?: string;
}

export async function fetchConnectionStatus(instancia?: string): Promise<StatusResult> {
  // Ajuste cirúrgico: O endpoint para verificar o status de uma instância deve ser via configs
  // A rota /api/whatsapp/evo/status/:instancia não existe no backend.
  const API_URL = `${API_BASE}/api/integracoes_config`;

  console.log(`[EvolutionService] Buscando status global de integrações: ${API_URL}`);

  try {
    const res = await fetch(API_URL, {
      method: 'GET',
      headers: authHeaders(),
    });

    if (!res.ok) {
      console.error(`[EvolutionService] Erro na resposta (${res.status}):`, await res.text().catch(() => 'no body'));
      return { state: 'close' };
    }
    
    const data = await res.json();
    
    if (Array.isArray(data)) {
      // Se pedimos uma instância específica (ex: 'teste')
      if (instancia) {
        const config = data.find(i => 
          i.tipo === 'evolution' && 
          i.instancia?.toLowerCase().trim() === instancia.toLowerCase().trim()
        );
        console.log(`[EvolutionService] Status para ${instancia}:`, config ? config.status : 'não encontrada');
        return { 
          state: config?.status === 'conectado' ? 'open' : 'close' 
        };
      }
      
      // Se não passou instância, mas tem alguma conectada, retornamos 'open'
      const anyOpen = data.some(i => i.tipo === 'evolution' && i.status === 'conectado');
      return { state: anyOpen ? 'open' : 'close' };
    }
    
    return { state: 'close' };
  } catch (error) {
    console.error(`[EvolutionService] Erro crítico ao buscar status:`, error);
    return { state: 'close' };
  }
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
