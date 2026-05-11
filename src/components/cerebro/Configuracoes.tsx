import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Webhook, Cpu, Database, Phone, Save, CheckCircle2, XCircle, Loader2, Info } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

interface AgentConfig {
  webhook_principal: string;
  webhook_indexacao: string;
  webhook_teste: string;
  modelo: string;
  temperatura: number;
  rag_threshold: number;
  rag_resultados: number;
  rag_ativo: boolean;
  evolution_server_url: string;
  evolution_api_key: string;
  evolution_instancia: string;
}

const defaultConfig: AgentConfig = {
  webhook_principal: "",
  webhook_indexacao: "",
  webhook_teste: "",
  modelo: "gpt-4o-mini",
  temperatura: 0.7,
  rag_threshold: 0.7,
  rag_resultados: 5,
  rag_ativo: true,
  evolution_server_url: "",
  evolution_api_key: "",
  evolution_instancia: ""
};

type TestStatus = "idle" | "loading" | "ok" | "fail";

export function Configuracoes() {
  const { user } = useAuth();
  const [config, setConfig] = useState<AgentConfig>(defaultConfig);
  const [tests, setTests] = useState<Record<string, TestStatus>>({});
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (user) carregarConfig();
  }, [user]);

  const carregarConfig = async () => {
    try {
      const { data, error } = await supabase
        .from("agentes")
        .select("*")
        .eq("user_id", user?.id)
        .maybeSingle();

      if (data) {
        setConfig({
          webhook_principal: data.webhook_principal || "",
          webhook_indexacao: data.webhook_indexacao || "",
          webhook_teste: data.webhook_teste || "",
          modelo: data.modelo || "gpt-4o-mini",
          temperatura: Number(data.temperatura) || 0.7,
          rag_threshold: Number(data.rag_threshold) || 0.7,
          rag_resultados: data.rag_resultados || 5,
          rag_ativo: data.rag_ativo ?? true,
          evolution_server_url: data.evolution_server_url || "",
          evolution_api_key: data.evolution_api_key || "",
          evolution_instancia: data.evolution_instancia || ""
        });
      }
    } catch (e) {
      toast.error("Erro ao carregar configurações");
    } finally {
      setLoading(false);
    }
  };

  const update = <K extends keyof AgentConfig>(k: K, v: AgentConfig[K]) =>
    setConfig((c) => ({ ...c, [k]: v }));

  const salvar = async () => {
    if (!user) return;
    setSalvando(true);
    try {
      const { error } = await supabase
        .from("agentes")
        .update({
          webhook_principal: config.webhook_principal,
          webhook_indexacao: config.webhook_indexacao,
          webhook_teste: config.webhook_teste,
          modelo: config.modelo,
          temperatura: config.temperatura,
          rag_threshold: config.rag_threshold,
          rag_resultados: config.rag_resultados,
          rag_ativo: config.rag_ativo,
          evolution_server_url: config.evolution_server_url,
          evolution_api_key: config.evolution_api_key,
          evolution_instancia: config.evolution_instancia
        })
        .eq("user_id", user.id);

      if (error) throw error;
      toast.success("Configurações salvas no banco de dados");
    } catch (e) {
      toast.error("Erro ao salvar");
    } finally {
      setSalvando(false);
    }
  };

  const testar = async (key: string, url: string) => {
    if (!url) return toast.error("Informe a URL primeiro");
    setTests((t) => ({ ...t, [key]: "loading" }));
    try {
      const res = await fetch(url, { method: "GET" });
      setTests((t) => ({ ...t, [key]: res.ok ? "ok" : "fail" }));
    } catch {
      setTests((t) => ({ ...t, [key]: "fail" }));
    }
  };

  const StatusIcon = ({ s }: { s: TestStatus }) => {
    if (s === "loading") return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
    if (s === "ok") return <CheckCircle2 className="h-4 w-4 text-success" />;
    if (s === "fail") return <XCircle className="h-4 w-4 text-destructive" />;
    return null;
  };

  const WebhookField = ({ label, k }: { label: string; k: "webhook_principal" | "webhook_indexacao" | "webhook_teste" }) => (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="flex gap-2">
        <Input value={config[k]} onChange={(e) => update(k, e.target.value)} placeholder="https://n8n.exemplo.com/webhook/..." />
        <Button variant="outline" size="sm" onClick={() => testar(k, config[k])} className="shrink-0">
          {tests[k] === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Testar"}
        </Button>
        <div className="flex items-center w-6 justify-center"><StatusIcon s={tests[k] ?? "idle"} /></div>
      </div>
    </div>
  );

  if (loading) return <div className="flex justify-center p-8"><Loader2 className="animate-spin text-primary" /></div>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card className="lg:col-span-2">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Webhook className="h-4 w-4 text-primary" /> Webhooks n8n</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <WebhookField label="URL Webhook Principal (WhatsApp)" k="webhook_principal" />
          <WebhookField label="URL Webhook Indexação (RAG)" k="webhook_indexacao" />
          <WebhookField label="URL Webhook Teste (Chat de Teste)" k="webhook_teste" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Cpu className="h-4 w-4 text-primary" /> Modelo LLM</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Modelo</Label>
            <Select value={config.modelo} onValueChange={(v) => update("modelo", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="gpt-4o-mini">gpt-4o-mini</SelectItem>
                <SelectItem value="gpt-4o">gpt-4o</SelectItem>
                <SelectItem value="gpt-4.1-mini">gpt-4.1-mini</SelectItem>
                <SelectItem value="gpt-4.1">gpt-4.1</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <Label>Temperatura</Label>
              <span className="text-muted-foreground font-mono">{config.temperatura.toFixed(1)}</span>
            </div>
            <Slider min={0} max={1} step={0.1} value={[config.temperatura]} onValueChange={([v]) => update("temperatura", v)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="h-4 w-4 text-primary" /> RAG
            <Badge variant={config.rag_ativo ? "default" : "secondary"} className="ml-auto text-[10px]">
              {config.rag_ativo ? "Ativo" : "Desativado"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-xs">RAG ativo</Label>
            <Switch checked={config.rag_ativo} onCheckedChange={(v) => update("rag_ativo", v)} />
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <Label>Match threshold</Label>
              <span className="text-muted-foreground font-mono">{config.rag_threshold.toFixed(2)}</span>
            </div>
            <Slider min={0.5} max={1} step={0.05} value={[config.rag_threshold]} onValueChange={([v]) => update("rag_threshold", v)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Número de resultados</Label>
            <Input type="number" min={1} max={50} value={config.rag_resultados} onChange={(e) => update("rag_resultados", Number(e.target.value) || 0)} />
          </div>
        </CardContent>
      </Card>

      <div className="lg:col-span-2 flex justify-end">
        <Button onClick={salvar} size="lg" disabled={salvando}>
          {salvando ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />} Salvar configurações
        </Button>
      </div>
    </div>
  );
}
