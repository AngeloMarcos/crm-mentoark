// Edge function: valida números no WhatsApp via Evolution API.
// Recebe { contato_ids?: string[], lista_id?: string } e atualiza
// `contatos.tags` adicionando `whatsapp_invalido` para os que não existirem.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface Body {
  contato_ids?: string[];
  lista_id?: string;
}

function normalizarBR(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, "").replace(/^0+/, "");
  if (!d) return null;
  if (!d.startsWith("55") && (d.length === 10 || d.length === 11)) d = "55" + d;
  if (!d.startsWith("55") || d.length < 12) return null;
  const ddd = d.slice(2, 4);
  let resto = d.slice(4);
  if (resto.length === 8 && /^[6-9]/.test(resto)) resto = "9" + resto;
  if (/^[2-5]/.test(resto)) return null; // fixo
  if (resto.length !== 9 || !resto.startsWith("9")) return null;
  return "55" + ddd + resto;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Cliente para identificar o usuário a partir do JWT
    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Sessão inválida" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json().catch(() => ({}))) as Body;

    // Cliente admin para queries
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // 1) carrega Evolution config
    const { data: evo, error: evoErr } = await admin
      .from("integracoes_config")
      .select("url, api_key, instancia, status")
      .eq("user_id", user.id)
      .eq("tipo", "evolution")
      .limit(1)
      .maybeSingle();
    if (evoErr || !evo?.url || !evo?.api_key || !evo?.instancia) {
      return new Response(
        JSON.stringify({ error: "Evolution API não configurada" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 2) carrega contatos alvo
    let query = admin
      .from("contatos")
      .select("id, telefone, tags")
      .eq("user_id", user.id)
      .not("telefone", "is", null);
    if (body.contato_ids?.length) query = query.in("id", body.contato_ids);
    if (body.lista_id) query = query.eq("lista_id", body.lista_id);

    const { data: contatos, error: cErr } = await query;
    if (cErr) throw cErr;
    if (!contatos?.length) {
      return new Response(
        JSON.stringify({ ok: true, total: 0, validos: 0, invalidos: 0, fixos: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 3) normaliza e separa fixos
    const fixos: string[] = [];
    const mapJidParaIds = new Map<string, string[]>();
    for (const c of contatos) {
      const jid = normalizarBR(c.telefone);
      if (!jid) {
        fixos.push(c.id);
        continue;
      }
      const arr = mapJidParaIds.get(jid) ?? [];
      arr.push(c.id);
      mapJidParaIds.set(jid, arr);
    }

    const jids = Array.from(mapJidParaIds.keys());
    const baseUrl = evo.url.replace(/\/$/, "");
    const invalidosIds = new Set<string>(fixos);
    let validos = 0;

    // 4) chama Evolution em lotes de 50
    const CHUNK = 50;
    for (let i = 0; i < jids.length; i += CHUNK) {
      const lote = jids.slice(i, i + CHUNK);
      try {
        const res = await fetch(
          `${baseUrl}/chat/whatsappNumbers/${evo.instancia}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: evo.api_key,
            },
            body: JSON.stringify({ numbers: lote }),
          },
        );
        if (!res.ok) {
          // se o lote falhar, marca todos como inválidos para reprocessamento posterior
          await res.text().catch(() => "");
          continue;
        }
        const json = (await res.json()) as Array<{
          exists?: boolean;
          number?: string;
          jid?: string;
        }>;
        for (const item of json ?? []) {
          const num = (item.number ?? item.jid ?? "").replace(/\D/g, "");
          const ids = mapJidParaIds.get(num) ?? [];
          if (item.exists) {
            validos += ids.length;
          } else {
            ids.forEach((id) => invalidosIds.add(id));
          }
        }
      } catch (_e) {
        // ignora falha do lote
      }
    }

    // 5) atualiza tags dos inválidos (adiciona "whatsapp_invalido" sem duplicar)
    if (invalidosIds.size) {
      const ids = Array.from(invalidosIds);
      const { data: paraAtualizar } = await admin
        .from("contatos")
        .select("id, tags")
        .in("id", ids);
      for (const c of paraAtualizar ?? []) {
        const tags = Array.isArray(c.tags) ? c.tags : [];
        if (!tags.includes("whatsapp_invalido")) {
          await admin
            .from("contatos")
            .update({ tags: [...tags, "whatsapp_invalido"] })
            .eq("id", c.id);
        }
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        total: contatos.length,
        validos,
        invalidos: invalidosIds.size,
        fixos: fixos.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
