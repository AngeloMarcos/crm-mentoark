import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const DEFAULT_EVO_URL = 'https://fierceparrot-evolution.cloudfy.live'
const DEFAULT_EVO_KEY = 'wZKRX72nZ6sM4yQuOoS6lo76fs5fO7cV'

const EVO_BASE_URL = (Deno.env.get('EVOLUTION_API_URL') || DEFAULT_EVO_URL).replace(/\/+$/, '')
const EVO_API_KEY = Deno.env.get('EVOLUTION_API_KEY') || DEFAULT_EVO_KEY

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = await req.json()
    const { phone, message, instance_name } = body

    if (!phone || !message) {
      return new Response(JSON.stringify({ error: 'Missing phone or message' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const resolvedInstance = instance_name || `user_${user.id.slice(0, 8)}`
    
    console.log(`[send-whatsapp] Sending to ${phone} via ${resolvedInstance}`)

    const res = await fetch(`${EVO_BASE_URL}/message/sendText/${resolvedInstance}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': EVO_API_KEY,
      },
      body: JSON.stringify({
        number: phone,
        text: message,
      }),
    })

    const data = await res.json()

    if (!res.ok) {
      console.error('[send-whatsapp] Evolution API error:', data)
      return new Response(JSON.stringify({ error: 'Failed to send message', details: data }), {
        status: res.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Save message to chat_messages
    const { error: dbError } = await supabase.from('chat_messages').insert({
      phone,
      bot_message: message,
      user_id: user.id,
      active: true
    })

    if (dbError) {
      console.error('[send-whatsapp] DB error:', dbError)
    }

    return new Response(JSON.stringify({ ok: true, data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[send-whatsapp] Unexpected error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
