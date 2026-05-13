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
        
        // 1. Verifica status atual para saber se já está open
        const statusRes = await fetch(`${EVO_BASE_URL}/instance/connectionStatus/${instanceName}`, {
          headers: { 'apikey': EVO_API_KEY }
        })
        const statusData = await statusRes.json()

        if (statusData.instance?.state === 'open') {
          return jsonResponse({
            state: 'open',
            phoneNumber: statusData.instance?.ownerJid?.split(':')[0],
            instanceName
          })
        }

        // 2. Tenta criar se não existir (ou garantir que existe)
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
        let qrCode = createData.qrcode?.base64 || createData.instance?.qrcode?.base64

        // 3. Se não veio QR, força conexão
        if (!qrCode) {
          const connectRes = await fetch(`${EVO_BASE_URL}/instance/connect/${instanceName}`, {
            headers: { 'apikey': EVO_API_KEY }
          })
          const connectData = await connectRes.json()
          
          if (connectData.instance?.state === 'open') {
             return jsonResponse({
               state: 'open',
               phoneNumber: connectData.instance?.ownerJid?.split(':')[0],
               instanceName
             })
          }

          qrCode = connectData.base64 || 
                   connectData.code || 
                   connectData.qrcode?.base64 || 
                   connectData.instance?.qrcode?.base64;
        }

        return jsonResponse({
          qrCode,
          instanceName,
          state: 'connecting'
        })
      }

      case 'logout': {
        // Usa logout primeiro, depois delete para garantir
        await fetch(`${EVO_BASE_URL}/instance/logout/${instanceName}`, {
          method: 'DELETE',
          headers: { 'apikey': EVO_API_KEY }
        })
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
    console.error(`[evolution-proxy] Erro:`, error)
    return jsonResponse({ error: error.message }, 500)
  }
})

