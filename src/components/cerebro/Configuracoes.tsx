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

interface AgentConfig {
  webhook_principal: string;
  webhook_indexacao: string;
  webhook_teste: string;
  modelo_llm: string;
  temperatura: number;
  janela_contexto: number;
  rag_threshold: number;
  rag_resultados: number;
  rag_ativo: boolean;
  telefone_teste: string;
}

const STORAGE_KEY = "crm_agent_config";

const defaultConfig: AgentConfig = {
  webhook_principal: "",
  webhook_indexacao: "",
  webhook_teste: "",
  modelo_llm: "gpt-4.1-mini",
  temperatura: 0.7,
  janela_contexto: 50,
  rag_threshold: 0.7,
  rag_resultados: 5,
  rag_ativo: true,
  telefone_teste: "",
};

type TestStatus = "idle" | "loading" | "ok" | "fail";

export function Configuracoes() {
  const [config, setConfig] = useState<AgentConfig>(defaultConfig);
  const [tests, setTests] = useState<Record<string, TestStatus>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setConfig({ ...defaultConfig, ...JSON.parse(raw) });
      // Compat com TestarAgente
      const legacyUrl = localStorage.getItem("n8n_webhook_url");
      const legacyTel = localStorage.getItem("n8n_telefone_teste");
      setConfig((c) => ({
        ...c,
        webhook_teste: c.webhook_teste || legacyUrl || "",
        telefone_teste: c.telefone_teste || legacyTel || "",
      }));
    } catch {}
  }, []);

  const update = <K extends keyof AgentConfig>(k: K, v: AgentConfig[K]) =>
    setConfig((c) => ({ ...c, [k]: v }));

  const salvar = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    // Mantém compatibilidade com a aba Testar Agente
    if (config.webhook_teste) localStorage.setItem("n8n_webhook_url", config.webhook_teste);
    if (config.telefone_teste) localStorage.setItem("n8n_telefone_teste", config.telefone_teste);
    toast.success("Configurações salvas");
  };

  const testar = async (key: string, url: string) => {
    if (!url) return toast.error("Informe a URL primeiro");
    setTests((t) => ({ ...t, [key]: "loading" }));
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(url, { method: "GET", signal: ctrl.signal });
      clearTimeout(tid);
      setTests((t) => ({ ...t, [key]: res.ok || res.status < 500 ? "ok" : "fail" }));
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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Webhooks */}
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

      {/* Modelo */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Cpu className="h-4 w-4 text-primary" /> Modelo LLM</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Modelo</Label>
            <Select value={config.modelo_llm} onValueChange={(v) => update("modelo_llm", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="gpt-4.1-mini">gpt-4.1-mini</SelectItem>
                <SelectItem value="gpt-4.1">gpt-4.1</SelectItem>
                <SelectItem value="gpt-4o">gpt-4o</SelectItem>
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
          <div className="space-y-1.5">
            <Label className="text-xs">Janela de contexto (mensagens)</Label>
            <Input type="number" min={1} value={config.janela_contexto} onChange={(e) => update("janela_contexto", Number(e.target.value) || 0)} />
          </div>
          <div className="flex gap-2 text-xs text-muted-foreground bg-muted/40 rounded-md p-2 border">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>Estas configurações são apenas referência visual. Altere no n8n para aplicar.</span>
          </div>
        </CardContent>
      </Card>

      {/* RAG */}
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
          <div className="flex gap-2 text-xs text-muted-foreground bg-muted/40 rounded-md p-2 border">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>Altere estes valores também na função <code className="bg-muted px-1 rounded">match_documents</code> no Supabase.</span>
          </div>
        </CardContent>
      </Card>

      {/* Telefone teste */}
      <Card className="lg:col-span-2">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Phone className="h-4 w-4 text-primary" /> Telefone de teste</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label className="text-xs">Usado pelo Chat de Teste como session_id</Label>
          <Input
            value={config.telefone_teste}
            onChange={(e) => update("telefone_teste", e.target.value.replace(/\D/g, ""))}
            placeholder="5511999998888"
            inputMode="numeric"
            maxLength={15}
          />
          <p className="text-[11px] text-muted-foreground">Apenas números com DDI (ex: 55 + DDD + número).</p>
        </CardContent>
      </Card>

      {/* Salvar */}
      <div className="lg:col-span-2 flex justify-end">
        <Button onClick={salvar} size="lg">
          <Save className="h-4 w-4 mr-2" /> Salvar configurações
        </Button>
      </div>
    </div>
  );
}
