import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle2, Send, History, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface WebhookLog {
  timestamp: string;
  status: number;
  telefone: string;
  sucesso: boolean;
}

const API_URL = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";

const SimuladorWebhook = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [resposta, setResposta] = useState<{ status: number; body: string } | null>(null);
  const [logs, setLogs] = useState<WebhookLog[]>(() => {
    const saved = sessionStorage.getItem("webhook_sim_logs");
    return saved ? JSON.parse(saved) : [];
  });

  const [form, setForm] = useState({
    instance: "mentoark",
    remoteJid: "5511999999999",
    pushName: "João Teste",
    message: "Olá, gostaria de testar o webhook",
    event: "messages.upsert",
    fromMe: false,
  });

  useEffect(() => {
    sessionStorage.setItem("webhook_sim_logs", JSON.stringify(logs));
  }, [logs]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResposta(null);

    const payload = {
      event: form.event,
      instance: form.instance,
      data: {
        key: {
          remoteJid: `${form.remoteJid}@s.whatsapp.net`,
          fromMe: form.fromMe,
          id: "FAKE_MSG_" + Date.now(),
        },
        message: {
          conversation: form.message,
        },
        messageTimestamp: Math.floor(Date.now() / 1000),
        pushName: form.pushName,
      },
    };

    try {
      const res = await fetch(`${API_URL}/api/webhook/evolution`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const body = await res.text();
      const status = res.status;
      
      setResposta({ status, body });

      const newLog: WebhookLog = {
        timestamp: new Date().toLocaleTimeString(),
        status,
        telefone: form.remoteJid,
        sucesso: res.ok,
      };

      setLogs((prev) => [newLog, ...prev].slice(0, 10));

      if (res.ok) {
        toast({
          title: "✅ Sucesso",
          description: "Mensagem enviada para o webhook.",
        });
      }
    } catch (err: any) {
      console.error(err);
      setResposta({ status: 500, body: err.message || "Erro de conexão" });
      toast({
        title: "❌ Erro",
        description: "Falha ao conectar com o backend.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const renderFeedback = () => {
    if (!resposta) return null;

    let message = "";
    let type: "default" | "destructive" | "warning" = "default";

    if (resposta.status === 200) {
      message = "✅ Mensagem processada pelo backend";
    } else if (resposta.status === 401) {
      message = "🔐 HMAC obrigatório — configure EVOLUTION_WEBHOOK_SECRET como vazio no .env para testes";
      type = "warning";
    } else if (resposta.status >= 500) {
      message = "❌ Erro interno — ver logs do backend";
      type = "destructive";
    } else {
      message = `Status ${resposta.status}: Resposta não esperada`;
      type = "warning";
    }

    return (
      <Card className="mt-6 border-2 border-muted">
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center gap-2">
            Resultado da Requisição
            <Badge variant={type === "destructive" ? "destructive" : type === "warning" ? "outline" : "secondary"}>
              HTTP {resposta.status}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className={`text-sm font-medium ${type === "destructive" ? "text-red-500" : type === "warning" ? "text-orange-500" : "text-green-600"}`}>
            {message}
          </p>
          <div className="bg-slate-950 text-green-400 font-mono text-xs p-3 rounded overflow-x-auto max-h-40">
            <pre>{resposta.body || "(corpo vazio)"}</pre>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="container max-w-4xl py-10 space-y-8">
      <Alert variant="destructive" className="bg-orange-50 border-orange-200 text-orange-800">
        <AlertTriangle className="h-4 w-4" color="#c2410c" />
        <AlertTitle>Ambiente de Desenvolvimento</AlertTitle>
        <AlertDescription>
          ⚠️ Esta página existe apenas para desenvolvimento. Nunca exponha em produção.
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Send className="w-5 h-5" />
              Simulador de Mensagem
            </CardTitle>
            <CardDescription>Simule payloads da Evolution API</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Instância</Label>
                  <Input 
                    value={form.instance} 
                    onChange={e => setForm({...form, instance: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Telefone (apenas números)</Label>
                  <Input 
                    value={form.remoteJid} 
                    onChange={e => setForm({...form, remoteJid: e.target.value})}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Nome (pushName)</Label>
                <Input 
                  value={form.pushName} 
                  onChange={e => setForm({...form, pushName: e.target.value})}
                />
              </div>

              <div className="space-y-2">
                <Label>Mensagem</Label>
                <Textarea 
                  value={form.message} 
                  onChange={e => setForm({...form, message: e.target.value})}
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-2 gap-4 items-end">
                <div className="space-y-2">
                  <Label>Evento</Label>
                  <Select 
                    value={form.event} 
                    onValueChange={v => setForm({...form, event: v})}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="messages.upsert">messages.upsert</SelectItem>
                      <SelectItem value="messages.update">messages.update</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-3 pb-2 border rounded-md px-3 h-10">
                  <Switch 
                    checked={form.fromMe} 
                    onCheckedChange={v => setForm({...form, fromMe: v})}
                  />
                  <Label className="cursor-pointer">fromMe</Label>
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Processando..." : "Enviar para webhook"}
              </Button>
            </form>

            {renderFeedback()}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <History className="w-5 h-5" />
              Histórico
            </CardTitle>
          </CardHeader>
          <CardContent>
            {logs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-10">Nenhuma chamada realizada ainda.</p>
            ) : (
              <div className="space-y-2">
                {logs.map((log, i) => (
                  <div key={i} className="flex items-center justify-between p-2 rounded border bg-muted/30 text-xs">
                    <div className="flex flex-col">
                      <span className="font-medium">{log.telefone}</span>
                      <span className="text-muted-foreground">{log.timestamp}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={log.sucesso ? "outline" : "destructive"} className="h-5">
                        {log.status}
                      </Badge>
                      {log.sucesso ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <AlertCircle className="w-4 h-4 text-red-500" />}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default SimuladorWebhook;
