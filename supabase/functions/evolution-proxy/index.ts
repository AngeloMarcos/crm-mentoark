import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

// Defaults from integracoes_config found earlier
const DEFAULT_EVO_URL = 'https://fierceparrot-evolution.cloudfy.live'
const DEFAULT_EVO_KEY = 'wZKRX72nZ6sM4yQuOoS6lo76fs5fO7cV'

const EVO_BASE_URL = (Deno.env.get('EVOLUTION_API_URL') || DEFAULT_EVO_URL).replace(/\/+$/, '')
const EVO_API_KEY = Deno.env.get('EVOLUTION_API_KEY') || DEFAULT_EVO_KEY

console.log(`[evolution-proxy] EVO_BASE_URL: ${EVO_BASE_URL}, API_KEY present: ${!!EVO_API_KEY}`)

function evoHeaders() {
  return {
    'Content-Type': 'application/json',
    'apikey': EVO_API_KEY,
  }
}

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
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Unauthorized' }, 401)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return jsonResponse({ error: 'Unauthorized' }, 401)
    }

    const userId = user.id
    const body = await req.json()
    const { action } = body

    if (!action) {
      return jsonResponse({ error: 'Missing action' }, 400)
    }

    // Use user-specific instance name
    const instanceName = body.instance_name || `user_${userId.slice(0, 8)}`
    console.log(`[evolution-proxy] Action: ${action}, Instance: ${instanceName}, User: ${userId}`)

    switch (action) {
      case 'create': {
        // Check if instance already exists in DB
        const { data: existing } = await supabase
          .from('tenant_whatsapp')
          .select('id, status')
          .eq('user_id', userId)
          .maybeSingle()

        if (existing && existing.status === 'connected') {
          return jsonResponse({ state: 'open', message: 'Already connected', instanceName })
        }

        console.log(`[evolution-proxy] Creating instance: ${instanceName}`)
        const createRes = await fetch(`${EVO_BASE_URL}/instance/create`, {
          method: 'POST',
          headers: evoHeaders(),
          body: JSON.stringify({
            instanceName,
            qrcode: true,
            integration: 'WHATSAPP-WHATSMEOW',
          }),
        })

        const createData = await createRes.json()
        if (!createRes.ok) {
          if (createRes.status === 403 || createData?.response?.message?.includes?.('already')) {
            return await connectAndReturnQR(supabase, instanceName, userId)
          }
          return jsonResponse({ error: 'Failed to create instance', details: createData }, 500)
        }

        const qrCode = createData?.qrcode?.base64 || createData?.base64
        const pairingCode = createData?.qrcode?.pairingCode || createData?.pairingCode

        await supabase
          .from('tenant_whatsapp')
          .upsert({
            user_id: userId,
            instance_name: instanceName,
            status: 'connecting',
            qr_code: qrCode || null,
            qr_expires_at: new Date(Date.now() + 60000).toISOString(),
          }, { onConflict: 'user_id' })

        return jsonResponse({
          qrCode: qrCode ? (qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`) : null,
          pairingCode: pairingCode || null,
          instanceName,
        })
      }

      case 'connect': {
        return await connectAndReturnQR(supabase, instanceName, userId)
      }

      case 'status': {
        const statusRes = await fetch(`${EVO_BASE_URL}/instance/connectionState/${instanceName}`, {
          headers: evoHeaders(),
        })

        if (!statusRes.ok) return jsonResponse({ state: 'close' })

        const statusData = await statusRes.json()
        const state = statusData?.instance?.state || statusData?.state || 'close'

        if (state === 'open') {
          let phoneNumber = null
          try {
            const profileRes = await fetch(`${EVO_BASE_URL}/instance/fetchInstances?instanceName=${instanceName}`, {
              headers: evoHeaders(),
            })
            if (profileRes.ok) {
              const instances = await profileRes.json()
              const inst = Array.isArray(instances) ? instances[0] : instances
              phoneNumber = inst?.instance?.owner || inst?.owner || null
            }
          } catch { /* ignore */ }

          await supabase
            .from('tenant_whatsapp')
            .upsert({
              user_id: userId,
              instance_name: instanceName,
              status: 'connected',
              connected_at: new Date().toISOString(),
              phone_number: phoneNumber,
              qr_code: null,
            }, { onConflict: 'user_id' })
          
          return jsonResponse({ state: 'open', phoneNumber })
        }

        return jsonResponse({ state })
      }

      case 'logout': {
        try {
          await fetch(`${EVO_BASE_URL}/instance/logout/${instanceName}`, {
            method: 'DELETE',
            headers: evoHeaders(),
          })
        } catch (e) { console.error(e) }

        await supabase
          .from('tenant_whatsapp')
          .update({
            status: 'disconnected',
            last_disconnect_at: new Date().toISOString(),
            qr_code: null,
            phone_number: null,
          })
          .eq('user_id', userId)

        return jsonResponse({ state: 'close' })
      }

      default:
        return jsonResponse({ error: `Unknown action: ${action}` }, 400)
    }
  } catch (err) {
    console.error('[evolution-proxy] Unexpected error:', err)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
})

async function connectAndReturnQR(supabase: any, instanceName: string, userId: string) {
  const connectRes = await fetch(`${EVO_BASE_URL}/instance/connect/${instanceName}`, {
    headers: evoHeaders(),
  })

  const connectData = await connectRes.json()
  if (!connectRes.ok) {
    return jsonResponse({ error: 'Failed to connect', details: connectData }, 500)
  }

  const qrCode = connectData?.base64 || connectData?.code || connectData?.qrcode?.base64
  const pairingCode = connectData?.pairingCode || connectData?.qrcode?.pairingCode

  await supabase
    .from('tenant_whatsapp')
    .upsert({
      user_id: userId,
      instance_name: instanceName,
      status: 'connecting',
      qr_code: qrCode || null,
      qr_expires_at: new Date(Date.now() + 60000).toISOString(),
    }, { onConflict: 'user_id' })

  return jsonResponse({
    qrCode: qrCode ? (qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`) : null,
    pairingCode: pairingCode || null,
    instanceName,
  })
}
