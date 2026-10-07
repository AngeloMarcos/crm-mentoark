import { useEffect, useState } from "react";
import { Megaphone, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getAuthToken } from "@/lib/api-token";

const BASE = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";

interface Toque {
  id: string;
  canal: "ctwa" | "lead_ads" | "utm";
  ad_id: string | null;
  campaign_id: string | null;
  source_url: string | null;
  headline: string | null;
  tem_clid: boolean;
  criado_em: string;
  anuncio_nome: string | null;
  conjunto_nome: string | null;
  campanha_nome: string | null;
}

const ROTULO_CANAL: Record<Toque["canal"], string> = {
  ctwa: "Clique para WhatsApp",
  lead_ads: "Formulário (Lead Ads)",
  utm: "Link com UTM",
};

/** Sprint M1: de quais anúncios o contato veio (primeiro toque destacado). Some quando não há nenhum. */
export function OrigemAnuncio({ contatoId }: { contatoId: string }) {
  const [toques, setToques] = useState<Toque[]>([]);
  const [primeiro, setPrimeiro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    fetch(`${BASE}/api/marketing/atribuicoes?contato_id=${contatoId}`, { headers: { Authorization: `Bearer ${getAuthToken()}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!ativo || !d) return;
        setToques(d.toques ?? []);
        setPrimeiro(d.primeira_atribuicao_id ?? null);
      })
      .catch(() => {});
    return () => { ativo = false; };
  }, [contatoId]);

  if (toques.length === 0) return null;

  return (
    <div>
      <label className="text-xs text-muted-foreground uppercase font-semibold block mb-1">Origem (anúncio)</label>
      <div className="space-y-2">
        {toques.slice(0, 5).map((t) => (
          <div key={t.id} className="rounded-lg border p-2.5 text-sm space-y-0.5">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Megaphone className="h-3.5 w-3.5 text-blue-500 shrink-0" />
              <span className="font-medium">{t.campanha_nome || t.headline || "Campanha não identificada"}</span>
              {t.id === primeiro && <Badge variant="outline" className="text-[10px]">primeiro toque</Badge>}
            </div>
            {(t.conjunto_nome || t.anuncio_nome) && (
              <p className="text-xs text-muted-foreground">
                {[t.conjunto_nome, t.anuncio_nome].filter(Boolean).join(" › ")}
              </p>
            )}
            <p className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
              {ROTULO_CANAL[t.canal]} · {new Date(t.criado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
              {!t.ad_id && " · sem ID do anúncio"}
              {t.source_url && (
                <a href={t.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-blue-500 hover:underline">
                  ver anúncio <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
