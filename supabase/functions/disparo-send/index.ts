// Envia uma mensagem WhatsApp via Evolution API (server-side, evita CORS)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ ok: false, error: "missing auth" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, anon, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { telefone, texto } = await req.json();
    if (!telefone || !texto) {
      return new Response(JSON.stringify({ ok: false, error: "telefone/texto obrigatórios" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Busca config Evolution do usuário
    const { data: cfg, error: cfgErr } = await supabase
      .from("integracoes_config")
      .select("url, api_key, instancia")
      .eq("user_id", userData.user.id)
      .eq("tipo", "evolution")
      .limit(1)
      .maybeSingle();

    if (cfgErr || !cfg?.url || !cfg?.api_key || !cfg?.instancia) {
      return new Response(JSON.stringify({ ok: false, error: "Evolution não configurada" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const number = String(telefone).replace(/\D/g, "");
    const url = `${cfg.url.replace(/\/$/, "")}/message/sendText/${cfg.instancia}`;

    const evoRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: cfg.api_key },
      body: JSON.stringify({ number, text: texto }),
    });

    const bodyText = await evoRes.text();

    if (!evoRes.ok) {
      console.log("Evolution error", evoRes.status, bodyText);
      return new Response(JSON.stringify({ ok: false, error: `HTTP ${evoRes.status}: ${bodyText.slice(0, 300)}` }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, response: bodyText.slice(0, 500) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
