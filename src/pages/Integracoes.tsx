import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getAuthToken, authHeader } from "@/lib/api-token";
import { CRMLayout } from "@/components/CRMLayout";
import { api } from "@/integrations/database/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Workflow,
  MessageCircle,
  BarChart3,
  Database,
  Webhook,
  RefreshCw,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  XCircle,
  Power,
  Eye,
  EyeOff,
  Plug,
  MapPin,
  Brain,
  Volume2,
  Mail,
  Share2,
  Send as TelegramIcon,
  Sparkles,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { toast } from "sonner";

type IntegStatus = "conectado" | "sincronizando" | "atencao" | "erro" | "inativo";

interface IntegRow {
  id: string;
  user_id: string;
  nome: string;
  tipo: string;
  url: string | null;
  api_key: string | null;
  instancia: string | null;
  status: IntegStatus;
  ultima_sync: string | null;
  config: any;
}

interface Template {
  tipo: string;
  nome: string;
  descricao: string;
  icone: keyof typeof iconMap;
  campos: { url?: boolean; api_key?: boolean; instancia?: boolean; whatsapp?: boolean };
  urlLabel: string;
}

const iconMap = {
  Workflow,
  MessageCircle,
  BarChart3,
  Database,
  Webhook,
  RefreshCw,
  MapPin,
  Brain,
  Volume2,
  Mail,
  Share2,
  TelegramIcon,
  Sparkles,
} as const;

const statusConfig: Record<IntegStatus, { label: string; color: string; icon: any }> = {
  conectado: { label: "Conectado", color: "bg-success/15 text-success", icon: CheckCircle2 },
  sincronizando: { label: "Sincronizando", color: "bg-info/15 text-info", icon: Loader2 },
  atencao: { label: "Atenção", color: "bg-warning/15 text-warning", icon: AlertTriangle },
  erro: { label: "Erro", color: "bg-destructive/15 text-destructive", icon: XCircle },
  inativo: { label: "Inativo", color: "bg-muted text-muted-foreground", icon: Power },
};

const TEMPLATES: Template[] = [
  {
    tipo: "n8n",
    nome: "N8N Automation",
    descricao: "Automações e workflows",
    icone: "Workflow",
    campos: { url: true },
    urlLabel: "URL do N8N",
  },
  {
    tipo: "evolution",
    nome: "WhatsApp",
    descricao: "Conecte seu WhatsApp para enviar e receber mensagens",
    icone: "MessageCircle",
    campos: { whatsapp: true },
    urlLabel: "",
  },
  {
    tipo: "database_vector",
    nome: "Database Vector",
    descricao: "Banco vetorial (RAG)",
    icone: "Database",
    campos: { url: true, api_key: true },
    urlLabel: "URL do Database",
  },
  {
    tipo: "meta_ads",
    nome: "Meta Ads",
    descricao: "Performance de campanhas",
    icone: "BarChart3",
    campos: { api_key: true },
    urlLabel: "URL da Meta Ads API",
  },
  {
    tipo: "webhook_in",
    nome: "Webhook Entrada",
    descricao: "Recebe eventos externos",
    icone: "Webhook",
    campos: { url: true },
    urlLabel: "URL do Webhook (entrada)",
  },
  {
    tipo: "webhook_out",
    nome: "Webhook Saída",
    descricao: "Envia eventos para terceiros",
    icone: "RefreshCw",
    campos: { url: true },
    urlLabel: "URL do Webhook (saída)",
  },
  {
    tipo: "google_places",
    nome: "Google Places API",
    descricao: "Busca de leads por localização e segmento",
    icone: "MapPin",
    campos: { api_key: true },
    urlLabel: "",
  },
  {
    tipo: "openai",
    nome: "OpenAI",
    descricao: "Scoring e análise de leads por IA",
    icone: "Brain",
    campos: { api_key: true },
    urlLabel: "",
  },
  {
    tipo: "elevenlabs",
    nome: "ElevenLabs",
    descricao: "Síntese de voz para respostas de áudio via IA",
    icone: "Volume2",
    campos: { api_key: true },
    urlLabel: "",
  },
  {
    tipo: "instagram",
    nome: "Instagram Business",
    descricao: "Gestão de Directs e comentários via API",
    icone: "Share2",
    campos: { api_key: true },
    urlLabel: "",
  },
  {
    tipo: "messenger",
    nome: "Facebook Messenger",
    descricao: "Integração com chat do Facebook",
    icone: "MessageCircle",
    campos: { api_key: true },
    urlLabel: "",
  },
  {
    tipo: "telegram",
    nome: "Telegram Bot",
    descricao: "Automação via Telegram",
    icone: "TelegramIcon",
    campos: { api_key: true },
    urlLabel: "",
  },
  {
    tipo: "gemini",
    nome: "Google Gemini",
    descricao: "Integração com modelos Google Gemini (IA)",
    icone: "Sparkles",
    campos: { api_key: true },
    urlLabel: "",
  },
];

function formatarData(iso: string | null) {
  if (!iso) return "Nunca sincronizado";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function IntegracoesPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState<IntegRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [template, setTemplate] = useState<Template | null>(null);
  const [existing, setExisting] = useState<IntegRow | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [form, setForm] = useState({
    nome: "",
    url: "",
    api_key: "",
    instancia: "",
    status: "inativo" as IntegStatus,
  });
  
  // WhatsApp connection states
  const [step, setStep] = useState<1 | 2>(1);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [loadingQr, setLoadingQr] = useState(false);
  const [whatsappForm, setWhatsappForm] = useState({
    pais: "55",
    numero: "",
  });

  // n8n section
  const [n8nSecret, setN8nSecret] = useState("");
  const [n8nShowSecret, setN8nShowSecret] = useState(false);
  const [n8nSavingSecret, setN8nSavingSecret] = useState(false);
  const [n8nExistingId, setN8nExistingId] = useState<string | null>(null);
  const [agentesN8n, setAgentesN8n] = useState<{ nome: string; n8n_webhook_url: string }[]>([]);

  const carregar = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await api
      .from("integracoes_config")
      .select("*")
      .eq("user_id", user.id);
    if (error) {
      toast.error(`Erro ao carregar conectores: ${error.message}`);
    } else {
      const list = (data ?? []) as IntegRow[];
      setRows(list);
      const n8n = list.find((r) => r.tipo === "n8n");
      setN8nExistingId(n8n?.id ?? null);
      setN8nSecret(n8n?.api_key ?? "");
    }

    // Carrega agentes com webhook n8n
    setLoading(false);
  };

  const carregarAgentesN8n = async () => {
    const API_URL = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";
    const res = await fetch(`${API_URL}/api/agentes`, { headers: authHeader() });
    if (!res.ok) return;
    const todos = await res.json();
    setAgentesN8n(
      todos
        .filter((a: any) => a.n8n_webhook_url)
        .map((a: any) => ({ nome: a.nome, n8n_webhook_url: a.n8n_webhook_url }))
    );
  };

  useEffect(() => {
    carregar();
    carregarAgentesN8n();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
  useEffect(() => {
    const tipo = searchParams.get("tipo");
    if (tipo && rows.length > 0) {
      const tpl = TEMPLATES.find((t) => t.tipo === tipo);
      const row = rows.find((r) => r.tipo === tipo) ?? null;
      if (tpl) {
        abrirConfig(tpl, row);
        searchParams.delete("tipo");
        setSearchParams(searchParams);
      }
    }
  }, [searchParams, rows]);

  const salvarN8nSecret = async () => {
    if (!user) return;
    setN8nSavingSecret(true);
    const payload: any = {
      user_id: user.id,
      tipo: "n8n",
      nome: "n8n",
      api_key: n8nSecret.trim() || null,
      status: n8nSecret.trim() ? ("conectado" as IntegStatus) : ("inativo" as IntegStatus),
    };
    if (n8nExistingId) payload.id = n8nExistingId;
    const { error } = await api.from("integracoes_config").upsert(payload);
    setN8nSavingSecret(false);
    if (error) {
      toast.error(`Erro ao salvar segredo: ${error.message}`);
      return;
    }
    toast.success("Segredo n8n salvo!");
    carregar();
  };

  const n8nBaseUrl = (() => {
    const first = agentesN8n[0]?.n8n_webhook_url;
    if (!first) return "";
    try {
      return new URL(first).origin;
    } catch {
      return "";
    }
  })();

  const truncate = (s: string, n = 50) => (s.length > n ? s.slice(0, n) + "…" : s);


  const abrirConfig = (tpl: Template, row: IntegRow | null) => {
    setTemplate(tpl);
    setExisting(row);
    setShowKey(false);
    setForm({
      nome: row?.nome ?? tpl.nome,
      url: row?.url ?? "",
      api_key: row?.api_key ?? "",
      instancia: row?.instancia ?? "",
      status: (row?.status as IntegStatus) ?? "inativo",
    });
    setModal(true);
    if (tpl.tipo === "evolution") {
      setStep(row?.status === "conectado" ? 2 : 1);
      setQrCode(null);
      setPairingCode(null);
      const config = row?.config || {};
      setWhatsappForm({
        pais: config.pais || "55",
        numero: config.numero || "",
      });
    }
  };

  const testarConexao = async () => {
    if (!template) return;
    setTestando(true);
    try {
      if (template.tipo === "openai") {
        if (!form.api_key) { toast.error("Informe a API Key."); setTestando(false); return; }
        const res = await fetch("https://api.openai.com/v1/models", {
          headers: { "Authorization": `Bearer ${form.api_key}` },
        });
        if (res.ok) {
          setForm((f) => ({ ...f, status: "conectado" }));
          toast.success("OpenAI conectada ✅");
        } else {
          setForm((f) => ({ ...f, status: "erro" }));
          toast.error("API Key da OpenAI inválida");
        }
      } else if (template.tipo === "gemini") {
        if (!form.api_key) { toast.error("Informe a API Key."); setTestando(false); return; }
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${form.api_key}`);
        if (res.ok) {
          setForm((f) => ({ ...f, status: "conectado" }));
          toast.success("Google Gemini conectado ✅");
        } else {
          setForm((f) => ({ ...f, status: "erro" }));
          toast.error("API Key do Gemini inválida");
        }
      } else if (template.tipo === "elevenlabs") {
        const token = getAuthToken();
        const apiUrl = (import.meta.env.VITE_API_URL as string) || "http://localhost:3000";
        const res = await fetch(`${apiUrl}/api/elevenlabs/voices`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          const count = Array.isArray(data) ? data.length : (data.voices?.length ?? 0);
          setForm((f) => ({ ...f, status: "conectado" }));
          toast.success(`ElevenLabs conectado — ${count} vozes disponíveis`);
        } else {
          setForm((f) => ({ ...f, status: "erro" }));
          toast.error("API Key inválida ou sem permissão");
        }
      } else if (template.tipo === "evolution") {
        if (!form.api_key || !form.url) { toast.error("Informe URL e API Key."); setTestando(false); return; }
        const url = form.url.replace(/\/$/, "") + "/instance/fetchInstances";
        const res = await fetch(url, {
          method: "GET",
          headers: { "apikey": form.api_key },
        });
        if (res.ok) {
          setForm((f) => ({ ...f, status: "conectado" }));
          toast.success("Evolution API conectada ✅");
        } else {
          setForm((f) => ({ ...f, status: "erro" }));
          toast.error(`Falha: HTTP ${res.status} — verifique URL e API Key`);
        }
      } else if (form.url) {
        const res = await fetch(form.url, { method: "GET" });
        if (res.ok || res.type === "opaque") {
          setForm((f) => ({ ...f, status: "conectado" }));
          toast.success("Conexão bem-sucedida ✅");
        } else {
          setForm((f) => ({ ...f, status: "erro" }));
          toast.error("A URL respondeu com erro.");
        }
      } else {
        toast.error("Informe os dados para testar.");
      }
    } catch (e: any) {
      setForm((f) => ({ ...f, status: "erro" }));
      toast.error(`Falha na conexão: ${e?.message ?? "erro de rede"}`);
    } finally {
      setTestando(false);
    }
  };


  const desconectarWhatsApp = async () => {
    if (!user || !existing) return;
    if (!confirm("Tem certeza que deseja desconectar este WhatsApp?")) return;
    
    setSalvando(true);
    try {
      const token = getAuthToken();
      const API_URL = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";
      
      const res = await fetch(`${API_URL}/api/whatsapp/disconnect`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` }
      });

      if (!res.ok) throw new Error("Erro ao desconectar");

      const { error } = await api
        .from("integracoes_config")
        .update({ status: "inativo", instancia: null })
        .eq("id", existing.id);

      if (error) throw error;

      toast.success("WhatsApp desconectado!");
      setModal(false);
      carregar();
    } catch (e: any) {
      toast.error(`Falha: ${e.message}`);
    } finally {
      setSalvando(false);
    }
  };

  const gerarQRCode = async () => {
    if (!user) return;
    setLoadingQr(true);
    setQrCode(null);
    setPairingCode(null);
    
    try {
      const fullNumber = whatsappForm.pais + whatsappForm.numero.replace(/\D/g, "");
      const token = getAuthToken();
      const API_URL = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";
      
      const res = await fetch(`${API_URL}/api/whatsapp/connect`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ 
          phoneNumber: fullNumber,
          nome: form.nome 
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Erro ao conectar");
      }

      const data = await res.json();
      if (data.qrCode) {
        setQrCode(data.qrCode);
        setPairingCode(data.pairingCode);
        setStep(2);
        
        if (data.instancia) {
          setForm(f => ({ ...f, instancia: data.instancia }));
        }
        
        toast.success("Dados enviados! Prossiga para o pareamento.");
      } else if (data.state === "open") {
        toast.success("WhatsApp já está conectado!");
        setForm(f => ({ ...f, status: "conectado", instancia: data.instancia }));
        setModal(false);
      }
    } catch (e: any) {
      toast.error(`Falha: ${e.message}`);
    } finally {
      setLoadingQr(false);
    }
  };

  useEffect(() => {
    let interval: any;
    if (modal && template?.tipo === "evolution" && step === 2 && form.instancia) {
      interval = setInterval(async () => {
        try {
          const token = getAuthToken();
          const API_URL = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";
          const res = await fetch(`${API_URL}/api/whatsapp/status`, {
            method: "POST",
            headers: { 
              "Content-Type": "application/json",
              "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({ instancia: form.instancia })
          });
          if (res.ok) {
            const data = await res.json();
            if (data.state === "open" || data.state === "connected") {
              toast.success("✓ WhatsApp conectado com sucesso!");
              setModal(false);
              carregar();
            }
          }
        } catch (e) {
          console.error("Polling error", e);
        }
      }, 5000);
    }
    return () => clearInterval(interval);
  }, [modal, step, template, form.instancia]);

  const salvar = async () => {
    if (!user || !template) return;
    if (!form.nome.trim()) {
      toast.error("Informe o nome.");
      return;
    }
    setSalvando(true);
    const payload = {
      user_id: user.id,
      tipo: template.tipo,
      nome: form.nome.trim(),
      url: form.url.trim() || null,
      api_key: form.api_key.trim() || null,
      instancia: form.instancia.trim() || null,
      status: form.status,
      config: template.tipo === "evolution" ? whatsappForm : existing?.config || {},
      ultima_sync:
        form.status === "conectado" ? new Date().toISOString() : existing?.ultima_sync ?? null,
    };
    const { error } = await api
      .from("integracoes_config")
      .upsert(payload);
    setSalvando(false);
    if (error) {
      toast.error(`Erro ao salvar: ${error.message}`);
      return;
    }
    toast.success("Conector salvo!");
    setModal(false);
    setTemplate(null);
    setExisting(null);
    carregar();
  };

  const cards = TEMPLATES.map((tpl) => {
    const row = rows.find((r) => r.tipo === tpl.tipo) ?? null;
    return { tpl, row };
  });

  const algumaConfigurada = rows.length > 0;

  return (
    <CRMLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Conectores</h1>
          <p className="text-muted-foreground text-sm">
            Status das conexões e serviços externos
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Seção Conector n8n */}
            <Card>
              <CardContent className="p-5 space-y-5">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <Workflow className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <h2 className="font-semibold">Conector n8n</h2>
                    <p className="text-xs text-muted-foreground">
                      Configure o segredo compartilhado e veja os agentes roteando para o n8n.
                    </p>
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Segredo compartilhado (x-n8n-secret)</Label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Input
                          type={n8nShowSecret ? "text" : "password"}
                          value={n8nSecret}
                          onChange={(e) => setN8nSecret(e.target.value)}
                          placeholder="••••••••••••"
                          className="pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setN8nShowSecret((v) => !v)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          {n8nShowSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      <Button onClick={salvarN8nSecret} disabled={n8nSavingSecret}>
                        {n8nSavingSecret && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                        Salvar
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label>URL base do seu n8n</Label>
                    <Input value={n8nBaseUrl} readOnly placeholder="—" className="bg-muted/40" />
                    <p className="text-xs text-muted-foreground">
                      Configure em cada agente individualmente a URL completa do webhook.
                    </p>
                  </div>
                </div>

                <div className="border-t border-border/50 pt-4">
                  {agentesN8n.length > 0 ? (
                    <div className="mt-3 space-y-1">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Agentes roteando para n8n
                      </p>
                      {agentesN8n.map(a => (
                        <div key={a.nome} className="flex items-center justify-between text-sm bg-blue-50 border border-blue-100 rounded px-3 py-1.5">
                          <span className="font-medium">{a.nome}</span>
                          <span className="text-xs text-muted-foreground truncate max-w-[180px]">
                            {a.n8n_webhook_url}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-3">
                      Nenhum agente usando n8n ainda. Configure em <strong>Agentes</strong>.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>


            {!algumaConfigurada && (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center text-center py-10 gap-3">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                    <Plug className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="font-semibold">Nenhum conector configurado</p>
                    <p className="text-sm text-muted-foreground">
                      Comece conectando seu primeiro serviço externo abaixo.
                    </p>
                  </div>
                  <Button onClick={() => abrirConfig(TEMPLATES[0], null)}>
                    Configurar primeiro conector
                  </Button>
                </CardContent>
              </Card>
            )}

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {cards.map(({ tpl, row }) => {
                const Icon = iconMap[tpl.icone] || Workflow;
                const status = (row?.status ?? "inativo") as IntegStatus;
                const st = statusConfig[status];
                const StIcon = st.icon;
                
                // Formatação especial para WhatsApp Conectado
                const isWhatsapp = tpl.tipo === "evolution";
                const isConectado = status === "conectado";
                const displayStatusLabel = isWhatsapp && isConectado ? "● Conectado" : st.label;
                const displayStatusColor = isWhatsapp && isConectado ? "bg-green-100 text-green-700" : st.color;

                return (
                  <Card
                    key={tpl.tipo}
                    className="hover:border-primary/30 transition-colors"
                  >
                    <CardContent className="p-5 space-y-4">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                            <Icon className="h-5 w-5" />
                          </div>
                          <div>
                            <p className="font-semibold text-sm">
                              {row?.nome ?? tpl.nome}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {isWhatsapp && isConectado && row?.instancia ? (
                                <span className="text-primary font-medium">{row.instancia}</span>
                              ) : tpl.descricao}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <Badge className={`${displayStatusColor} text-[10px] font-bold uppercase border-0 gap-1`}>
                          {!isWhatsapp && (
                            <StIcon
                              className={`h-3 w-3 ${
                                status === "sincronizando" ? "animate-spin" : ""
                              }`}
                            />
                          )}
                          {displayStatusLabel}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {row ? formatarData(row.ultima_sync) : "Não configurado"}
                        </span>
                      </div>

                      <Button
                        variant={isConectado ? "secondary" : "outline"}
                        size="sm"
                        className="w-full"
                        onClick={() => abrirConfig(tpl, row)}
                      >
                        {isWhatsapp && isConectado ? "Gerenciar" : 
                         status === "erro" ? "Reconectar" : "Configurar"}
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </>
        )}
      </div>

      <Dialog
        open={modal}
        onOpenChange={(o) => {
          setModal(o);
          if (!o) {
            setTemplate(null);
            setExisting(null);
          }
        }}
      >
        <DialogContent className="max-w-lg">
          {template && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {template.tipo === "evolution" 
                    ? (step === 1 ? "Nova Conexão WhatsApp" : `Conectar Instância: ${form.nome}`)
                    : `Configurar ${template.nome}`
                  }
                </DialogTitle>
                {template.tipo !== "evolution" && (
                  <DialogDescription>{template.descricao}</DialogDescription>
                )}
              </DialogHeader>

              <div className="space-y-4">
                {template.tipo === "evolution" && step === 1 && (
                  <>
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-2">
                      <div className="flex items-center gap-2 text-amber-800 font-bold text-sm">
                        <ShieldCheck className="h-4 w-4" /> 🛡️ ATENÇÃO — ANTI-BAN
                      </div>
                      <ul className="text-xs text-amber-700 space-y-1 list-disc list-inside">
                        <li>Nunca conecte no WhatsApp Web simultaneamente</li>
                        <li>Desligue o Wi-Fi/4G do celular logo após escanear o QR Code</li>
                      </ul>
                    </div>

                    <div className="space-y-1.5">
                      <Label>Nome da Identificação *</Label>
                      <Input
                        placeholder="Ex: Vendas Matriz"
                        value={form.nome}
                        onChange={(e) => setForm({ ...form, nome: e.target.value })}
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-1.5">
                        <Label>País *</Label>
                        <Select 
                          value={whatsappForm.pais} 
                          onValueChange={(v) => setWhatsappForm({ ...whatsappForm, pais: v })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="55">🇧🇷 Brasil (+55)</SelectItem>
                            <SelectItem value="1">🇺🇸 EUA (+1)</SelectItem>
                            <SelectItem value="351">🇵🇹 Portugal (+351)</SelectItem>
                            <SelectItem value="54">🇦🇷 Argentina (+54)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-2 space-y-1.5">
                        <Label>Número do WhatsApp *</Label>
                        <Input
                          type="tel"
                          placeholder="(11) 99999-9999"
                          value={whatsappForm.numero}
                          onChange={(e) => setWhatsappForm({ ...whatsappForm, numero: e.target.value })}
                        />
                      </div>
                    </div>
                  </>
                )}

                {template.tipo === "evolution" && step === 2 && (
                  <div className="space-y-6">
                    <p className="text-sm text-muted-foreground text-center">
                      Escaneie o QR Code ou use o Código de Pareamento
                    </p>

                    <Card className="border-border/50 bg-muted/30">
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-center gap-2 font-semibold text-sm">
                          <Smartphone className="h-4 w-4 text-primary" /> Opção 1 — Código de Pareamento
                        </div>
                        <p className="text-[11px] text-muted-foreground leading-tight">
                          No WhatsApp: Configurações {">"} Aparelhos Conectados {">"} Conectar {">"} Conectar com número de telefone
                        </p>
                        <div className="bg-white border rounded-lg p-3 text-center">
                          <span className="text-2xl font-mono font-bold tracking-[0.2em]">
                            {pairingCode || "------"}
                          </span>
                        </div>
                      </CardContent>
                    </Card>

                    <div className="relative flex items-center justify-center py-2">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t border-border" />
                      </div>
                      <span className="relative bg-white px-3 text-xs text-muted-foreground uppercase font-medium">ou</span>
                    </div>

                    <Card className="border-border/50 bg-muted/30">
                      <CardContent className="p-4 space-y-3 flex flex-col items-center">
                        <div className="flex items-center gap-2 font-semibold text-sm w-full">
                          <MessageCircle className="h-4 w-4 text-green-500" /> Opção 2 — Escanear QR Code
                        </div>
                        {qrCode ? (
                          <div className="bg-white p-2 rounded-lg border">
                            <img src={qrCode} alt="WhatsApp QR Code" className="w-[180px] h-[180px]" />
                          </div>
                        ) : (
                          <div className="w-[180px] h-[180px] bg-white rounded-lg border flex items-center justify-center">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground/30" />
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    <div className="flex gap-3">
                      <Button variant="outline" className="flex-1 gap-2" onClick={gerarQRCode} disabled={loadingQr}>
                        <RefreshCw className={`h-4 w-4 ${loadingQr ? "animate-spin" : ""}`} />
                        Atualizar Códigos
                      </Button>
                      {form.status === "conectado" && (
                        <Button variant="destructive" className="flex-1" onClick={desconectarWhatsApp}>
                          Desconectar
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                {template.tipo !== "evolution" && (
                  <>
                    <div className="space-y-1.5">
                      <Label>Nome</Label>
                      <Input
                        value={form.nome}
                        onChange={(e) => setForm({ ...form, nome: e.target.value })}
                      />
                    </div>
                  </>
                )}

                {template.campos.url && (
                  <div className="space-y-1.5">
                    <Label>{template.urlLabel}</Label>
                    <Input
                      value={form.url}
                      onChange={(e) => setForm({ ...form, url: e.target.value })}
                      placeholder="https://..."
                    />
                  </div>
                )}

                {template.campos.api_key && (
                  <div className="space-y-1.5">
                    <Label>API Key</Label>
                    <div className="relative">
                      <Input
                        type={showKey ? "text" : "password"}
                        value={form.api_key}
                        onChange={(e) =>
                          setForm({ ...form, api_key: e.target.value })
                        }
                        placeholder="••••••••••••"
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowKey((v) => !v)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showKey ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {template.campos.instancia && (
                  <div className="space-y-1.5">
                    <Label>Instância</Label>
                    <Input
                      value={form.instancia}
                      onChange={(e) =>
                        setForm({ ...form, instancia: e.target.value })
                      }
                      placeholder="ex: minha-instancia"
                    />
                  </div>
                )}

                {template.campos.whatsapp && form.status === "conectado" && (
                  <div className="space-y-4 pt-4 border-t border-border/50">
                    <div className="bg-muted/50 p-4 rounded-lg space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-muted-foreground uppercase font-bold">Número Conectado</span>
                        <span className="text-sm font-medium">
                          +{whatsappForm.pais} ({whatsappForm.numero.slice(0,2)}) {whatsappForm.numero.slice(2,3)}****-{whatsappForm.numero.slice(-4)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-muted-foreground uppercase font-bold">Status</span>
                        <Badge className="bg-green-100 text-green-700 border-0">Ativo</Badge>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-3">
                      <Button 
                        variant="outline" 
                        className="w-full"
                        onClick={gerarQRCode}
                        disabled={loadingQr}
                      >
                        Reconectar
                      </Button>
                      <Button 
                        variant="destructive" 
                        className="w-full"
                        onClick={desconectarWhatsApp}
                        disabled={salvando}
                      >
                        Desconectar
                      </Button>
                    </div>
                  </div>
                )}

                {!template.campos.whatsapp && (
                  <div className="space-y-1.5">
                    <Label>Status</Label>
                    <Select
                      value={form.status}
                      onValueChange={(v) =>
                        setForm({ ...form, status: v as IntegStatus })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="conectado">Conectado</SelectItem>
                        <SelectItem value="inativo">Inativo</SelectItem>
                        <SelectItem value="erro">Erro</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {template.tipo !== "evolution" && (template.campos.url || template.campos.api_key || template.tipo === "elevenlabs") && (
                  <Button
                    variant="secondary"
                    className="w-full"
                    onClick={testarConexao}
                    disabled={testando}
                  >
                    {testando ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Plug className="h-4 w-4 mr-2" />
                    )}
                    Testar conexão
                  </Button>
                )}
              </div>


              <DialogFooter>
                <Button variant="outline" onClick={() => setModal(false)}>
                  Cancelar
                </Button>
                <Button onClick={salvar} disabled={salvando}>
                  {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
                  Salvar
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </CRMLayout>
  );
}
