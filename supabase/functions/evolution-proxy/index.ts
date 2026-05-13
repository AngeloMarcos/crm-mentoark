import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

// Credenciais padrão da Evolution API
const DEFAULT_EVO_URL = 'https://fierceparrot-evolution.cloudfy.live'
const DEFAULT_EVO_KEY = 'wZKRX72nZ6sM4yQuOoS6lo76fs5fO7cV'

const EVO_BASE_URL = (Deno.env.get('EVOLUTION_API_URL') || DEFAULT_EVO_URL).replace(/\/+$/, '')
const EVO_API_KEY = Deno.env.get('EVOLUTION_API_KEY') || DEFAULT_EVO_KEY

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY')!,
    )

    const body = await req.json().catch(() => ({}))
    const { action, user_id: userId } = body

    if (!action) return jsonResponse({ error: 'Missing action' }, 400)
    if (!userId) return jsonResponse({ error: 'Missing user_id' }, 400)

    const instanceName = body.instance_name || `user_${userId.slice(0, 8)}`

    switch (action) {
      case 'status': {
        const res = await fetch(`${EVO_BASE_URL}/instance/connectionStatus/${instanceName}`, {
          headers: { 'apikey': EVO_API_KEY }
        })
        const data = await res.json()
        
        // Se a instância não existe na Evolution, retorna fechado
        if (res.status === 404) {
           return jsonResponse({ state: 'close' })
        }

        return jsonResponse({
          state: data.instance?.state || 'close',
          phoneNumber: data.instance?.ownerJid?.split(':')[0]
        })
      }

      case 'create': {
        console.log(`[evolution-proxy] Inciando criação/conexão para ${instanceName}`)
        
        // 1. Verifica se a instância já existe
        const checkRes = await fetch(`${EVO_BASE_URL}/instance/fetchInstances?instanceName=${instanceName}`, {
          headers: { 'apikey': EVO_API_KEY }
        })
        const instances = await checkRes.json()
        const exists = Array.isArray(instances) ? instances.some(i => i.instanceName === instanceName) : false

        let qrCode = null

        if (!exists) {
          console.log(`[evolution-proxy] Criando nova instância ${instanceName}`)
          const createRes = await fetch(`${EVO_BASE_URL}/instance/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': EVO_API_KEY },
            body: JSON.stringify({
              instanceName,
              integration: "WHATSAPP-BAILEYS",
              qrcode: true
            })
          })
          const createData = await createRes.json()
          qrCode = createData.qrcode?.base64
        }

        // 2. Se não criou agora ou não veio QR, solicita conexão para obter o código
        if (!qrCode) {
          console.log(`[evolution-proxy] Buscando QR code de conexão para ${instanceName}`);
          
          // Forçar a geração de um novo par de chaves/QR se necessário, ou apenas buscar o atual
          // Em algumas versões da Evolution, chamar /connect gera o QR se a instância estiver 'close'
          const connectRes = await fetch(`${EVO_BASE_URL}/instance/connect/${instanceName}`, {
            headers: { 'apikey': EVO_API_KEY }
          });
          const connectData = await connectRes.json();
          
          console.log(`[evolution-proxy] Connect response data:`, connectData);
          
          // Tenta extrair o QR de todas as propriedades possíveis retornadas pela Evolution
          qrCode = connectData.base64 || 
                   connectData.code || 
                   connectData.qrcode?.base64 || 
                   connectData.instance?.qrcode?.base64;
        }

        if (!qrCode) {
          console.log(`[evolution-proxy] QR Code não encontrado nos retornos. Tentando buscar status final.`);
        }

        return jsonResponse({
          qrCode,
          instanceName,
          state: 'connecting'
        })
      }

      case 'logout': {
        console.log(`[evolution-proxy] Removendo instância ${instanceName}`)
        await fetch(`${EVO_BASE_URL}/instance/delete/${instanceName}`, {
          method: 'DELETE',
          headers: { 'apikey': EVO_API_KEY }
        })
        return jsonResponse({ success: true })
      }

      default:
        return jsonResponse({ error: 'Action not supported' }, 400)
    }
  } catch (error: any) {
    console.error(`[evolution-proxy] Erro fatal:`, error)
    return jsonResponse({ error: error.message }, 500)
  }
})
