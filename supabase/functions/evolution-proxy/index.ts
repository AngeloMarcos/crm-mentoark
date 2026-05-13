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

    const instanceName = `user_${userId.slice(0, 8)}`
    console.log(`[evolution-proxy] Action: ${action}, Instance: ${instanceName}, User: ${userId}`)

    switch (action) {
      case 'status': {
        const res = await fetch(`${EVO_BASE_URL}/instance/connectionStatus/${instanceName}`, {
          headers: { 'apikey': EVO_API_KEY }
        })
        const data = await res.json()
        return jsonResponse({
          state: data.instance?.state || 'close',
          phoneNumber: data.instance?.ownerJid?.split(':')[0]
        })
      }

      case 'create': {
        console.log(`[evolution-proxy] Creating/fetching QR for ${instanceName}`)
        // Tenta criar primeiro
        const createRes = await fetch(`${EVO_BASE_URL}/instance/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': EVO_API_KEY },
          body: JSON.stringify({
            instanceName,
            token: EVO_API_KEY,
            qrcode: true
          })
        })
        
        const createData = await createRes.json()
        let qrCode = createData.qrcode?.base64 || createData.instance?.qrcode?.base64
        
        // Se não veio no create (ou já existe), busca explicitamente
        if (!qrCode) {
          console.log(`[evolution-proxy] QR not in create response, fetching via /connect`)
          const qrRes = await fetch(`${EVO_BASE_URL}/instance/connect/${instanceName}`, {
            headers: { 'apikey': EVO_API_KEY }
          })
          const qrData = await qrRes.json()
          qrCode = qrData.base64 || qrData.code
        }

        return jsonResponse({
          qrCode,
          instanceName,
          state: 'connecting'
        })
      }

      case 'logout': {
        await fetch(`${EVO_BASE_URL}/instance/logout/${instanceName}`, {
          method: 'DELETE',
          headers: { 'apikey': EVO_API_KEY }
        })
        return jsonResponse({ success: true })
      }

      default:
        return jsonResponse({ error: 'Action not supported' }, 400)
    }
  } catch (error: any) {
    console.error(`[evolution-proxy] Error:`, error)
    return jsonResponse({ error: error.message }, 500)
  }
})
