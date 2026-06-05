import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { adminFetch } from "@/lib/adminApi";
import { toast } from "sonner";
import { Search, Loader2, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";

interface TraceResult {
  phone: string;
  suffix: string;
  whatsapp_messages: any[];
  dedup: any[];
  contato: any[];
  opt_out: any[];
  logs: string[];
}

export default function DiagnosticoWhatsApp() {
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<TraceResult | null>(null);

  async function buscar() {
    const num = phone.replace(/\D/g, "");
    if (num.length < 8) {
      toast.error("Informe um número com pelo menos 8 dígitos");
      return;
    }
    setLoading(true);
    try {
      const r = await adminFetch<TraceResult>("/api/admin/webhook-trace", {
        params: { phone: num },
      });
      setData(r);
    } catch {
      // adminFetch já mostra toast
    } finally {
      setLoading(false);
    }
  }

  const flag = (ok: boolean, label: string) => (
    <div className="flex items-center gap-2 text-sm">
      {ok ? (
        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
      ) : (
        <XCircle className="h-4 w-4 text-rose-500" />
      )}
      <span className={ok ? "" : "text-muted-foreground"}>{label}</span>
    </div>
  );

  return (
    <AppLayout>
      <div className="container max-w-6xl py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Diagnóstico WhatsApp</h1>
          <p className="text-sm text-muted-foreground">
            Verifica por que uma mensagem de um número específico não está chegando no CRM.
          </p>
        </div>

        <Card>
          <CardContent className="pt-6 flex gap-2">
            <Input
              placeholder="Ex: 11999190910 ou 5511999190910"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && buscar()}
            />
            <Button onClick={buscar} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              <span className="ml-2">Diagnosticar</span>
            </Button>
          </CardContent>
        </Card>

        {data && (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Resumo — {data.phone}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {flag(data.whatsapp_messages.length > 0, `Webhook salvou ${data.whatsapp_messages.length} mensagem(ns) em whatsapp_messages`)}
                {flag(data.dedup.length > 0, `${data.dedup.length} entrada(s) em webhook_mensagens_processadas`)}
                {flag(data.contato.length > 0, `${data.contato.length} contato(s) cadastrado(s) no CRM`)}
                {data.opt_out.length > 0 && (
                  <div className="flex items-center gap-2 text-sm text-amber-600">
                    <AlertTriangle className="h-4 w-4" />
                    <span>Número em OPT-OUT — IA bloqueada ({data.opt_out[0].motivo})</span>
                  </div>
                )}
                {data.contato[0]?.opt_out && (
                  <div className="flex items-center gap-2 text-sm text-amber-600">
                    <AlertTriangle className="h-4 w-4" />
                    <span>Contato marcado como opt_out=true</span>
                  </div>
                )}
                {data.contato[0]?.atendente_pausou_ia && (
                  <div className="flex items-center gap-2 text-sm text-amber-600">
                    <AlertTriangle className="h-4 w-4" />
                    <span>IA pausada pelo atendente para este contato</span>
                  </div>
                )}
                {data.whatsapp_messages.length === 0 && data.logs.length === 0 && (
                  <div className="flex items-center gap-2 text-sm text-rose-600 mt-3 p-3 rounded bg-rose-500/10">
                    <XCircle className="h-4 w-4" />
                    <span>
                      Nenhum vestígio: a Evolution provavelmente <strong>não enviou webhook</strong> para
                      este número. Verifique a configuração de webhook da instância.
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Logs do webhook (filtrados por número)</CardTitle>
              </CardHeader>
              <CardContent>
                {data.logs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma linha de log encontrada.</p>
                ) : (
                  <pre className="text-xs font-mono whitespace-pre-wrap max-h-96 overflow-auto bg-muted/40 p-3 rounded">
                    {data.logs.join("\n")}
                  </pre>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Últimas mensagens salvas</CardTitle>
              </CardHeader>
              <CardContent>
                {data.whatsapp_messages.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma mensagem em whatsapp_messages.</p>
                ) : (
                  <div className="space-y-2">
                    {data.whatsapp_messages.map((m, i) => (
                      <div key={i} className="text-xs border rounded p-2 flex items-start gap-2">
                        <Badge variant={m.from_me ? "secondary" : "default"}>
                          {m.from_me ? "→ enviou" : "← recebeu"}
                        </Badge>
                        <div className="flex-1">
                          <div className="text-muted-foreground">
                            {new Date(m.created_at).toLocaleString()} · {m.instance_name} · {m.message_type} · {m.status}
                          </div>
                          <div>{m.content || <em className="text-muted-foreground">(sem texto)</em>}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
}
