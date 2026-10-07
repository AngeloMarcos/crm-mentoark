import { useState, useEffect, useCallback } from "react";
import { CheckCircle2, AlertCircle, ExternalLink, Copy, Webhook, RefreshCw, LogOut, KeyRound } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { getAuthToken } from "@/lib/api-token";
import { type MetaStatus } from "@/hooks/useMetaStatus";
import { PaginasLeadAds } from "./PaginasLeadAds";

// Ícone manual para evitar erro de importação da lucide-react
const Facebook = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
  </svg>
);

const BASE = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";
const WEBHOOK_URL = `${BASE}/api/marketing/webhook/leads`;

interface Props {
  status: MetaStatus;
  onRecarregar: () => void;
}

interface ContaAnuncio {
  id: string;
  nome: string;
  status: "ativa" | "inativa";
  moeda: string | null;
  business: string | null;
}

const authHeaders = (json = false): HeadersInit => ({
  Authorization: `Bearer ${getAuthToken()}`,
  ...(json ? { "Content-Type": "application/json" } : {}),
});

async function lerErro(r: Response) {
  const data = await r.json().catch(() => ({}));
  return data?.error?.message || data?.message || `HTTP ${r.status}`;
}

export function ContaMeta({ status, onRecarregar }: Props) {
  const [desconectando, setDesconectando] = useState(false);
  const [tokenSistema, setTokenSistema] = useState("");
  const [salvandoToken, setSalvandoToken] = useState(false);
  const [contas, setContas] = useState<ContaAnuncio[]>([]);
  const [carregandoContas, setCarregandoContas] = useState(false);
  const [trocandoConta, setTrocandoConta] = useState(false);

  const carregarContas = useCallback(async () => {
    setCarregandoContas(true);
    try {
      const r = await fetch(`${BASE}/api/marketing/facebook/contas`, { headers: authHeaders() });
      if (!r.ok) throw new Error(await lerErro(r));
      const data = await r.json();
      setContas(data.contas ?? []);
    } catch (e) {
      toast.error("Erro ao listar contas de anúncio: " + (e as Error).message);
    } finally {
      setCarregandoContas(false);
    }
  }, []);

  useEffect(() => {
    if (status.conectado) carregarContas();
    else setContas([]);
  }, [status.conectado, carregarContas]);

  // O popup do OAuth avisa por postMessage quando termina (sucesso ou erro).
  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      if (ev.origin !== new URL(BASE).origin || ev.data?.tipo !== "meta_oauth") return;
      if (ev.data.ok) {
        toast.success(ev.data.mensagem || "Conta Meta conectada!");
        onRecarregar();
      } else {
        toast.error(ev.data.mensagem || "Não foi possível conectar à Meta.");
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [onRecarregar]);

  const handleConectar = async () => {
    // Abre o popup já no clique (senão o navegador bloqueia) e só depois aponta pra URL da Meta.
    const popup = window.open("about:blank", "meta_oauth", "width=600,height=700");
    try {
      const r = await fetch(`${BASE}/api/marketing/facebook/auth`, { headers: authHeaders() });
      if (!r.ok) throw new Error(await lerErro(r));
      const { url } = await r.json();
      if (popup) popup.location.href = url;
      else window.location.href = url;
    } catch (e) {
      popup?.close();
      toast.error((e as Error).message);
    }
  };

  const handleSalvarToken = async () => {
    setSalvandoToken(true);
    try {
      const r = await fetch(`${BASE}/api/marketing/facebook/token`, {
        method: "POST", headers: authHeaders(true), body: JSON.stringify({ access_token: tokenSistema.trim() }),
      });
      if (!r.ok) throw new Error(await lerErro(r));
      const data = await r.json();
      setTokenSistema("");
      toast.success(data.ad_account_id
        ? `Conectado como ${data.nome}.`
        : `Conectado como ${data.nome}. Escolha abaixo qual das ${data.contas.length} contas de anúncio usar.`);
      onRecarregar();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSalvandoToken(false);
    }
  };

  const handleTrocarConta = async (adAccountId: string) => {
    setTrocandoConta(true);
    try {
      const r = await fetch(`${BASE}/api/marketing/facebook/conta`, {
        method: "POST", headers: authHeaders(true), body: JSON.stringify({ ad_account_id: adAccountId }),
      });
      if (!r.ok) throw new Error(await lerErro(r));
      const data = await r.json();
      toast.success(`Conta de anúncios: ${data.nome}`);
      onRecarregar();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setTrocandoConta(false);
    }
  };

  const handleDesconectar = async () => {
    if (!confirm("Deseja desconectar a conta Meta Ads? Os dados de campanhas e leads não serão apagados.")) return;
    setDesconectando(true);
    try {
      await fetch(`${BASE}/api/marketing/facebook/desconectar`, {
        method: "POST", headers: authHeaders(),
      });
      toast.success("Conta Meta desconectada.");
      onRecarregar();
    } catch {
      toast.error("Erro ao desconectar.");
    } finally {
      setDesconectando(false);
    }
  };

  const copiarWebhook = () => {
    navigator.clipboard.writeText(WEBHOOK_URL);
    toast.success("URL do webhook copiada!");
  };

  return (
    <div className="mt-6 space-y-4 max-w-2xl">

      {/* Status da conexão */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Facebook className="h-4 w-4 text-blue-600" />
            Conexão com Meta Ads
          </CardTitle>
          <CardDescription>
            Conecte sua conta do Facebook Business para acessar campanhas e leads reais.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status.conectado ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200">
                <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
                <div>
                  <p className="font-medium text-green-800 dark:text-green-300">Conta conectada</p>
                  <p className="text-sm text-green-700 dark:text-green-400">
                    {status.nome_conta} · {status.tipo_token === "system_user" ? "Token de Usuário do Sistema (não expira)" : "Login com Facebook"}
                  </p>
                </div>
              </div>

              {status.tipo_token !== "system_user" && status.dias_restantes != null && status.dias_restantes <= 7 && (
                <div className="flex items-start gap-3 p-3 rounded-lg bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 text-sm text-yellow-800 dark:text-yellow-300">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  O acesso à Meta expira em {Math.max(0, status.dias_restantes)} dia(s). Clique em "Conectar com Facebook Business" de novo para renovar.
                </div>
              )}

              <div className="space-y-1.5">
                <Label>Conta de anúncios</Label>
                <Select
                  value={status.ad_account_id ?? undefined}
                  onValueChange={handleTrocarConta}
                  disabled={carregandoContas || trocandoConta || contas.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={carregandoContas ? "Carregando contas..." : "Escolha a conta de anúncios"} />
                  </SelectTrigger>
                  <SelectContent>
                    {contas.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.nome}{c.business ? ` · ${c.business}` : ""}{c.status === "inativa" ? " (inativa)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!status.ad_account_id && contas.length > 0 && (
                  <p className="text-xs text-yellow-700 dark:text-yellow-400">
                    Escolha a conta para ver Métricas e Campanhas.
                  </p>
                )}
              </div>

              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={onRecarregar} className="gap-1.5">
                  <RefreshCw className="h-3.5 w-3.5" /> Verificar status
                </Button>
                <Button variant="destructive" size="sm" onClick={handleDesconectar}
                  disabled={desconectando} className="gap-1.5">
                  <LogOut className="h-3.5 w-3.5" />
                  {desconectando ? "Desconectando..." : "Desconectar"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200">
                <AlertCircle className="h-5 w-5 text-yellow-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-yellow-800 dark:text-yellow-300">
                    {status.expirado ? "Acesso à Meta expirado" : "Não conectado"}
                  </p>
                  <p className="text-sm text-yellow-700 dark:text-yellow-400">
                    Conecte de uma das duas formas abaixo.
                  </p>
                </div>
              </div>

              <div className="space-y-2 rounded-lg border p-3">
                <p className="text-sm font-medium flex items-center gap-1.5">
                  <KeyRound className="h-4 w-4" /> Token de Usuário do Sistema <Badge variant="outline" className="text-[10px]">recomendado</Badge>
                </p>
                <p className="text-xs text-muted-foreground">
                  Business Manager → Configurações → Usuários do sistema → atribua as contas de anúncio →
                  Gerar token com <code>ads_read</code>, <code>ads_management</code>, <code>leads_retrieval</code>,{" "}
                  <code>pages_show_list</code> e <code>pages_manage_metadata</code> (para receber os leads de formulário). Não expira.
                </p>
                <div className="flex gap-2">
                  <Input
                    type="password"
                    autoComplete="off"
                    placeholder="Cole o token aqui (EAA...)"
                    value={tokenSistema}
                    onChange={(e) => setTokenSistema(e.target.value)}
                  />
                  <Button onClick={handleSalvarToken} disabled={salvandoToken || tokenSistema.trim().length < 50}>
                    {salvandoToken ? "Validando..." : "Conectar"}
                  </Button>
                </div>
              </div>

              <div className="space-y-2 rounded-lg border p-3">
                <p className="text-sm font-medium">Login com Facebook</p>
                <p className="text-xs text-muted-foreground">
                  Para quem não tem Business Manager. O acesso dura ~60 dias e precisa ser renovado.
                </p>
                <Button onClick={handleConectar} className="gap-2 bg-blue-600 hover:bg-blue-700">
                  <Facebook className="h-4 w-4" />
                  Conectar com Facebook Business
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {status.conectado && <PaginasLeadAds />}

      {/* Webhook de Lead Ads */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Webhook className="h-4 w-4 text-purple-600" />
            Webhook de Lead Ads
          </CardTitle>
          <CardDescription>
            Configure este URL no Meta Business Manager para receber leads automaticamente no CRM.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <code className="flex-1 rounded-lg bg-muted px-3 py-2 text-sm font-mono break-all">
              {WEBHOOK_URL}
            </code>
            <Button variant="outline" size="icon" onClick={copiarWebhook} title="Copiar URL">
              <Copy className="h-4 w-4" />
            </Button>
          </div>

          {/* Passo a passo */}
          <div className="space-y-2 text-sm">
            <p className="font-medium">Como configurar:</p>
            <ol className="space-y-1.5 text-muted-foreground list-none">
              {[
                "Configuração única do app da Mentoark (feita pelo administrador): developers.facebook.com → app → Webhooks → objeto \"Page\"",
                "Cole a URL acima e o token de verificação configurado no servidor (META_WEBHOOK_VERIFY_TOKEN)",
                "Assine o campo 'leadgen'",
                "Depois disso, cada cliente só liga as páginas dele no card \"Formulários de Lead Ads\" acima",
              ].map((passo, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-full bg-purple-100 text-purple-700 text-xs flex items-center justify-center shrink-0 mt-0.5 font-medium">
                    {i + 1}
                  </span>
                  {passo}
                </li>
              ))}
            </ol>
          </div>

          <Button variant="outline" size="sm" className="gap-1.5"
            onClick={() => window.open("https://business.facebook.com/settings/", "_blank")}>
            <ExternalLink className="h-3.5 w-3.5" />
            Abrir Meta Business Manager
          </Button>
        </CardContent>
      </Card>

      {/* Permissões necessárias */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Permissões OAuth necessárias</CardTitle>
          <CardDescription>Estas permissões são solicitadas durante a autorização Meta.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {[
              "ads_read", "ads_management", "business_management", "pages_show_list",
              "pages_read_engagement", "pages_manage_metadata", "leads_retrieval",
            ].map((perm) => (
              <Badge key={perm} variant="outline" className="font-mono text-xs">{perm}</Badge>
            ))}
          </div>
        </CardContent>
      </Card>

    </div>
  );
}
