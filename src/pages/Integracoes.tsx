import { useEffect, useState } from "react";
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
  campos: { url?: boolean; api_key?: boolean; instancia?: boolean };
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
    nome: "Evolution API / WhatsApp",
    descricao: "Mensagens via WhatsApp",
    icone: "MessageCircle",
    campos: { url: true, api_key: true, instancia: true },
    urlLabel: "URL da Evolution API",
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

  const carregar = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await api
      .from("integracoes_config")
      .select("*")
      .eq("user_id", user.id);
    if (error) {
      toast.error(`Erro ao carregar integrações: ${error.message}`);
    } else {
      setRows((data ?? []) as IntegRow[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const abrirConfig = (tpl: Template, row: IntegRow | null) => {
    setTemplate(tpl);
    setExisting(row);
    setShowKey(false);
    setForm({
      nome: row?.nome ?? tpl.nome,
      url: row?.url ?? "",
      api_key: row?.api_key ?? "",
      instancia: row?.instancia ?? "",
      status: row?.status ?? "inativo",
    });
    setModal(true);
  };

  const testarConexao = async () => {
    if (!template) return;
    if (!form.url) { toast.error("Informe a URL para testar."); return; }
    setTestando(true);
    try {
      if (template.tipo === "evolution") {
        if (!form.api_key) { toast.error("Informe a API Key para testar."); setTestando(false); return; }
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
      } else {
        const res = await fetch(form.url, { method: "GET" });
        if (res.ok || res.type === "opaque") {
          setForm((f) => ({ ...f, status: "conectado" }));
          toast.success("Conexão bem-sucedida ✅");
        } else {
          setForm((f) => ({ ...f, status: "erro" }));
          toast.error("A URL respondeu com erro.");
        }
      }
    } catch (e: any) {
      setForm((f) => ({ ...f, status: "erro" }));
      toast.error(`Falha na conexão: ${e?.message ?? "erro de rede"}`);
    } finally {
      setTestando(false);
    }
  };

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
    toast.success("Integração salva!");
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
          <h1 className="text-2xl font-bold tracking-tight">Integrações</h1>
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
            {!algumaConfigurada && (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center text-center py-10 gap-3">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                    <Plug className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="font-semibold">Nenhuma integração configurada</p>
                    <p className="text-sm text-muted-foreground">
                      Comece conectando seu primeiro serviço externo abaixo.
                    </p>
                  </div>
                  <Button onClick={() => abrirConfig(TEMPLATES[0], null)}>
                    Configurar primeira integração
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
                              {tpl.descricao}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <Badge className={`${st.color} text-xs border-0 gap-1`}>
                          <StIcon
                            className={`h-3 w-3 ${
                              status === "sincronizando" ? "animate-spin" : ""
                            }`}
                          />
                          {st.label}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {row ? formatarData(row.ultima_sync) : "Não configurado"}
                        </span>
                      </div>

                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => abrirConfig(tpl, row)}
                      >
                        {status === "erro"
                          ? "Reconectar"
                          : row
                          ? "Configurar"
                          : "Configurar"}
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
                <DialogTitle>Configurar {template.nome}</DialogTitle>
                <DialogDescription>{template.descricao}</DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Nome</Label>
                  <Input
                    value={form.nome}
                    onChange={(e) => setForm({ ...form, nome: e.target.value })}
                  />
                </div>

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

                {template.campos.url && (
                  <Button
                    variant="secondary"
                    className="w-full"
                    onClick={testarConexao}
                    disabled={testando}
                  >
                    {testando ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plug className="h-4 w-4" />
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
