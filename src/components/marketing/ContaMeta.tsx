import { useState } from "react";
import { CheckCircle2, AlertCircle, ExternalLink, Copy, Webhook, RefreshCw, LogOut } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { type MetaStatus } from "@/hooks/useMetaStatus";

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

export function ContaMeta({ status, onRecarregar }: Props) {
  const [desconectando, setDesconectando] = useState(false);

  const handleConectar = () => {
    const authUrl = `${BASE}/api/marketing/facebook/auth`;
    window.open(authUrl, "_blank", "width=600,height=700");
    // Após fechar a janela, recarrega o status
    const interval = setInterval(() => { onRecarregar(); }, 3000);
    setTimeout(() => clearInterval(interval), 60000);
  };

  const handleDesconectar = async () => {
    if (!confirm("Deseja desconectar a conta Meta Ads? Os dados de campanhas e leads não serão apagados.")) return;
    setDesconectando(true);
    try {
      const token = localStorage.getItem("crm_access_token") || "";
      await fetch(`${BASE}/api/marketing/facebook/desconectar`, {
        method: "POST", headers: { Authorization: `Bearer ${token}` },
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
                    {status.nome_conta} · Ad Account: {status.ad_account_id}
                  </p>
                </div>
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
                  <p className="font-medium text-yellow-800 dark:text-yellow-300">Não conectado</p>
                  <p className="text-sm text-yellow-700 dark:text-yellow-400">
                    Clique abaixo para autorizar o acesso à sua conta Meta Ads via OAuth.
                  </p>
                </div>
              </div>
              <Button onClick={handleConectar} className="gap-2 bg-blue-600 hover:bg-blue-700">
                <Facebook className="h-4 w-4" />
                Conectar com Facebook Business
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

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
                "Acesse Meta Business Manager → Configurações → Configurações de Negócios",
                "Vá em Webhooks → Adicionar assinatura → Selecione 'leadgen'",
                "Cole a URL acima e o token de verificação: mentoark-lead-webhook",
                "Selecione os campos: id, ad_id, form_id, created_time, field_data",
                "Salve e verifique o webhook. Os leads chegarão automaticamente.",
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
              "ads_management", "ads_read", "pages_show_list",
              "leads_retrieval", "business_management", "instagram_basic",
            ].map((perm) => (
              <Badge key={perm} variant="outline" className="font-mono text-xs">{perm}</Badge>
            ))}
          </div>
        </CardContent>
      </Card>

    </div>
  );
}
