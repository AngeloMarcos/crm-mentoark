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
  // Ajuste cirúrgico: Se for uma instância específica, vamos buscar nas configurações de integrações
  // Caso contrário, usamos a rota padrão de status global
  const API_URL = instancia 
    ? `${API_BASE}/api/integracoes_config`
    : `${API_BASE}/api/whatsapp/status`;

  console.log(`[EvolutionService] Buscando status: ${API_URL} (Instância: ${instancia || 'Global'})`);

  try {
    const res = await fetch(API_URL, {
      method: instancia ? 'GET' : 'POST',
      headers: authHeaders(),
    });

    if (!res.ok) {
      console.error(`[EvolutionService] Erro na resposta (${res.status}):`, await res.text().catch(() => 'no body'));
      return { state: 'close' };
    }
    
    const data = await res.json();
    
    if (instancia && Array.isArray(data)) {
      // Procura a configuração da evolução para esta instância específica
      // Normalização: Comparamos ignorando case e espaços para maior resiliência
      const config = data.find(i => 
        i.tipo === 'evolution' && 
        i.instancia?.toLowerCase().trim() === instancia.toLowerCase().trim()
      );
      
      console.log(`[EvolutionService] Resultado para ${instancia}:`, config ? config.status : 'não encontrada');
      
      return { 
        state: config?.status === 'conectado' ? 'open' : 'close' 
      };
    }
    
    return data;
  } catch (error) {
    console.error(`[EvolutionService] Erro crítico ao buscar status para ${instancia || 'default'}:`, error);
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
