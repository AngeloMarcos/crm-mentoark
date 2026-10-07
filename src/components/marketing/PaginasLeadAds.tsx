import { useCallback, useEffect, useState } from "react";
import { FileText, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { getAuthToken } from "@/lib/api-token";

const BASE = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";

interface Pagina {
  id: string;
  nome: string;
  inscrita: boolean;
  podeInscrever: boolean;
}

async function lerErro(r: Response) {
  const data = await r.json().catch(() => ({}));
  return data?.error?.message || data?.message || `HTTP ${r.status}`;
}

/** Sprint M1: escolhe quais páginas mandam os leads de formulário (Lead Ads) para o CRM. */
export function PaginasLeadAds() {
  const [paginas, setPaginas] = useState<Pagina[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [alterando, setAlterando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const r = await fetch(`${BASE}/api/marketing/facebook/paginas`, { headers: { Authorization: `Bearer ${getAuthToken()}` } });
      if (!r.ok) throw new Error(await lerErro(r));
      setPaginas((await r.json()).paginas ?? []);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const alternar = async (p: Pagina, ligar: boolean) => {
    setAlterando(p.id);
    try {
      const r = await fetch(`${BASE}/api/marketing/facebook/paginas/${p.id}/${ligar ? "inscrever" : "desinscrever"}`, {
        method: "POST", headers: { Authorization: `Bearer ${getAuthToken()}` },
      });
      if (!r.ok) throw new Error(await lerErro(r));
      setPaginas((prev) => prev.map((x) => (x.id === p.id ? { ...x, inscrita: ligar } : x)));
      toast.success(ligar ? `Leads da página "${p.nome}" vão entrar no CRM.` : `Página "${p.nome}" desligada.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAlterando(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-4 w-4 text-purple-600" />
          Formulários de Lead Ads
        </CardTitle>
        <CardDescription>
          Ligue as páginas cujos formulários de anúncio devem virar contato no CRM, já com a campanha e o anúncio de origem.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {carregando ? (
          <p className="text-sm text-muted-foreground">Carregando páginas…</p>
        ) : erro ? (
          <div className="space-y-2">
            <p className="text-sm text-red-600">{erro}</p>
            <p className="text-xs text-muted-foreground">
              O token precisa das permissões <code>pages_show_list</code>, <code>pages_manage_metadata</code> e <code>leads_retrieval</code>, com as páginas atribuídas.
            </p>
          </div>
        ) : paginas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma página encontrada para este token. Atribua as páginas ao usuário do sistema no Business Manager.</p>
        ) : (
          paginas.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{p.nome}</p>
                <p className="text-xs text-muted-foreground">
                  {p.podeInscrever ? (p.inscrita ? "Recebendo leads" : "Desligada") : "Sem permissão de gerenciar esta página"}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {p.inscrita && <Badge className="bg-green-100 text-green-700 border-green-300">ativo</Badge>}
                <Switch
                  checked={p.inscrita}
                  disabled={!p.podeInscrever || alterando === p.id}
                  onCheckedChange={(v) => alternar(p, v)}
                  aria-label={`Receber leads da página ${p.nome}`}
                />
              </div>
            </div>
          ))
        )}
        <Button variant="ghost" size="sm" onClick={carregar} disabled={carregando} className="gap-1.5">
          <RefreshCw className={`h-3.5 w-3.5 ${carregando ? "animate-spin" : ""}`} /> Atualizar lista
        </Button>
      </CardContent>
    </Card>
  );
}
