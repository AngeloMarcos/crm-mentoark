import { useEffect, useState } from "react";
import { authHeader } from "@/lib/api-token";
import { CRMLayout } from "@/components/CRMLayout";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Bot, Workflow, MessageCircle, Zap, Sparkles,
  Eye, EyeOff, Plus, Pencil, Trash2, Loader2,
  CheckCircle2, XCircle, Power, AlertTriangle, Plug, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

const API_URL = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";

type Status = "conectado" | "inativo" | "erro" | "atencao" | "sincronizando";

interface Integracao {
  id: string;
  user_id: string;
  tipo: string;
  nome: string;
  url: string | null;
  api_key: string | null;
  instancia: string | null;
  status: Status;
  updated_at: string | null;
}

interface AiProvider {
  id?: string;
  slug: string;
  nome: string;
  modelo: string;
  ativo: boolean;
}

const TIPO_LABELS: Record<string, string> = {
  evolution: "Evolution API",
  n8n: "N8N",
  openai: "OpenAI",
  elevenlabs: "ElevenLabs",
  webhook_in: "Webhook Entrada",
  webhook_out: "Webhook Saída",
  google_places: "Google Places",
  gemini: "Google Gemini",
  telegram: "Telegram Bot",
  instagram: "Instagram",
};

const TIPO_OPTIONS = Object.entries(TIPO_LABELS).map(([value, label]) => ({ value, label }));

const STATUS_CONFIG: Record<Status, { label: string; className: string; icon: any }> = {
  conectado:    { label: "Conectado",    className: "bg-green-100 text-green-700",   icon: CheckCircle2 },
  inativo:      { label: "Inativo",      className: "bg-gray-100 text-gray-500",     icon: Power },
  erro:         { label: "Erro",         className: "bg-red-100 text-red-700",       icon: XCircle },
  atencao:      { label: "Atenção",      className: "bg-yellow-100 text-yellow-700", icon: AlertTriangle },
  sincronizando:{ label: "Sincronizando",className: "bg-blue-100 text-blue-700",    icon: Loader2 },
};

const AI_PROVIDERS = [
  { slug: "openai",  label: "OpenAI",          icon: Bot,      modelos: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-3.5-turbo"] },
  { slug: "claude",  label: "Claude (Anthropic)", icon: Sparkles, modelos: ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"] },
  { slug: "gemini",  label: "Google Gemini",   icon: Zap,      modelos: ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"] },
] as const;

const EMPTY_FORM = { tipo: "evolution", nome: "", url: "", api_key: "", instancia: "", status: "inativo" as Status };

function StatusBadge({ status }: { status: Status }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.inativo;
  const Icon = cfg.icon;
  return (
    <Badge className={`${cfg.className} border-0 gap-1 text-[11px] font-semibold`}>
      <Icon className={`h-3 w-3 ${status === "sincronizando" ? "animate-spin" : ""}`} />
      {cfg.label}
    </Badge>
  );
}

function SecretInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        type={show ? "text" : "password"}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder ?? "••••••••"}
        className="pr-10"
      />
      <button
        type="button"
        onClick={() => setShow(v => !v)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

export default function IntegracoesPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Integracao[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<Integracao | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  // ── AI Providers ────────────────────────────────────────────────────────────
  const [aiProviders, setAiProviders] = useState<AiProvider[]>([]);
  const [aiForm, setAiForm] = useState<Record<string, { api_key: string; modelo: string; saving: boolean; testing: boolean }>>(
    Object.fromEntries(AI_PROVIDERS.map(p => [p.slug, { api_key: "", modelo: p.modelos[0], saving: false, testing: false }]))
  );

  const fetchRows = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/integracoes_config`, { headers: authHeader() });
      if (!res.ok) throw new Error("Erro ao carregar");
      setRows(await res.json());
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchAiProviders = async () => {
    try {
      const res = await fetch(`${API_URL}/api/ai-providers`, { headers: authHeader() });
      if (!res.ok) return;
      const lista: AiProvider[] = await res.json();
      setAiProviders(lista);
      setAiForm(prev => {
        const next = { ...prev };
        lista.forEach(p => { if (next[p.slug]) next[p.slug] = { ...next[p.slug], modelo: p.modelo }; });
        return next;
      });
    } catch {}
  };

  useEffect(() => { fetchRows(); fetchAiProviders(); }, [user?.id]);

  // ── CRUD Integrações ─────────────────────────────────────────────────────────
  const openAdd = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setModal(true);
  };

  const openEdit = (row: Integracao) => {
    setEditing(row);
    setForm({
      tipo: row.tipo,
      nome: row.nome,
      url: row.url ?? "",
      api_key: row.api_key ?? "",
      instancia: row.instancia ?? "",
      status: row.status,
    });
    setModal(true);
  };

  const testar = async () => {
    if (!form.url && !form.api_key) { toast.error("Preencha URL e/ou API Key"); return; }
    setTesting(true);
    try {
      if (form.tipo === "evolution") {
        const base = form.url.trim().replace(/\/$/, "");
        const res = await fetch(`${base}/instance/fetchInstances`, {
          headers: { apikey: form.api_key.trim() },
        });
        if (res.ok) {
          const data = await res.json().catch(() => []);
          const count = Array.isArray(data) ? data.length : 0;
          setForm(f => ({ ...f, status: "conectado" }));
          toast.success(`Evolution conectada — ${count} instância(s)`);
        } else {
          setForm(f => ({ ...f, status: "erro" }));
          toast.error(`Falha HTTP ${res.status}`);
        }
      } else if (form.url) {
        const res = await fetch(form.url).catch(() => null);
        setForm(f => ({ ...f, status: res?.ok ? "conectado" : "erro" }));
        toast[res?.ok ? "success" : "error"](res?.ok ? "Conexão OK" : "Sem resposta");
      }
    } catch (e: any) {
      setForm(f => ({ ...f, status: "erro" }));
      toast.error(e.message);
    } finally {
      setTesting(false);
    }
  };

  const salvar = async () => {
    if (!form.nome.trim()) { toast.error("Nome é obrigatório"); return; }
    if (form.tipo === "evolution" && (!form.url || !form.api_key || !form.instancia)) {
      toast.error("URL, API Key e Nome da Instância são obrigatórios para Evolution");
      return;
    }
    setSaving(true);
    try {
      const body = {
        tipo: form.tipo,
        nome: form.nome.trim(),
        url: form.url.trim() || null,
        api_key: (form.api_key.trim() && !form.api_key.startsWith('****')) ? form.api_key.trim() : undefined,
        instancia: form.instancia.trim() || null,
        status: form.status,
      };
      const res = editing
        ? await fetch(`${API_URL}/api/integracoes_config/${editing.id}`, {
            method: "PUT", headers: { ...authHeader(), "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch(`${API_URL}/api/integracoes_config`, {
            method: "POST", headers: { ...authHeader(), "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "Erro ao salvar");
      toast.success(editing ? "Integração atualizada!" : "Integração criada!");
      setModal(false);
      fetchRows();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const remover = async (id: string) => {
    if (!confirm("Remover esta integração?")) return;
    setDeleting(id);
    try {
      const res = await fetch(`${API_URL}/api/integracoes_config/${id}`, {
        method: "DELETE", headers: authHeader(),
      });
      if (!res.ok) throw new Error("Erro ao remover");
      toast.success("Removida!");
      setRows(prev => prev.filter(r => r.id !== id));
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDeleting(null);
    }
  };

  // ── AI Providers CRUD ────────────────────────────────────────────────────────
  const salvarProvider = async (slug: string) => {
    const f = aiForm[slug];
    if (!f.api_key.trim()) { toast.error("Informe a API Key"); return; }
    const nome = AI_PROVIDERS.find(p => p.slug === slug)?.label ?? slug;
    setAiForm(prev => ({ ...prev, [slug]: { ...prev[slug], saving: true } }));
    try {
      const existing = aiProviders.find(p => p.slug === slug);
      const payload = { nome, slug, modelo: f.modelo, api_key: f.api_key, ativo: true };
      const res = existing?.id
        ? await fetch(`${API_URL}/api/ai-providers/${existing.id}`, {
            method: "PATCH", headers: { ...authHeader(), "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch(`${API_URL}/api/ai-providers`, {
            method: "POST", headers: { ...authHeader(), "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "Erro");
      toast.success(`${nome} salvo!`);
      setAiForm(prev => ({ ...prev, [slug]: { ...prev[slug], api_key: "" } }));
      fetchAiProviders();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setAiForm(prev => ({ ...prev, [slug]: { ...prev[slug], saving: false } }));
    }
  };

  const testarProvider = async (slug: string) => {
    const f = aiForm[slug];
    if (!f.api_key.trim()) { toast.error("Informe a API Key"); return; }
    setAiForm(prev => ({ ...prev, [slug]: { ...prev[slug], testing: true } }));
    try {
      const res = await fetch(`${API_URL}/api/ai-providers/testar`, {
        method: "POST",
        headers: { ...authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({ slug, api_key: f.api_key, modelo: f.modelo }),
      });
      const data = await res.json();
      toast[data.ok ? "success" : "error"](data.ok ? "Conexão OK!" : `Falha: ${data.status ?? "erro"}`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setAiForm(prev => ({ ...prev, [slug]: { ...prev[slug], testing: false } }));
    }
  };

  const evolutionRows = rows.filter(r => r.tipo === "evolution");
  const otherRows = rows.filter(r => r.tipo !== "evolution");

  return (
    <CRMLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Conectores</h1>
            <p className="text-muted-foreground text-sm">Gerencie integrações e serviços externos</p>
          </div>
          <Button onClick={openAdd} size="sm">
            <Plus className="h-4 w-4 mr-1.5" /> Nova Integração
          </Button>
        </div>

        {/* ── Instâncias Evolution ─────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-green-600" />
              WhatsApp / Evolution API
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : evolutionRows.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                Nenhuma instância configurada.{" "}
                <button className="text-primary underline underline-offset-2" onClick={openAdd}>Adicionar</button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Instância</TableHead>
                    <TableHead>Servidor</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {evolutionRows.map(row => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.nome}</TableCell>
                      <TableCell className="font-mono text-xs">{row.instancia ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground truncate max-w-[200px]">
                        {row.url?.replace("https://", "") ?? "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <StatusBadge status={row.status} />
                          {row.status === "inativo" && (
                            <Button 
                              variant="outline" 
                              size="sm" 
                              className="h-7 text-[10px] px-2 gap-1"
                              onClick={async () => {
                                try {
                                  const res = await fetch(`${API_URL}/api/whatsapp/connect`, {
                                    method: "POST",
                                    headers: { ...authHeader(), "Content-Type": "application/json" },
                                    body: JSON.stringify({ instance: row.instancia })
                                  });
                                  if (res.ok) {
                                    toast.success("Solicitação enviada!");
                                    fetchRows();
                                  } else {
                                    throw new Error();
                                  }
                                } catch {
                                  toast.error("Erro ao solicitar reconexão");
                                }
                              }}
                            >
                              <RefreshCw className="h-3 w-3" /> Reconectar
                            </Button>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 justify-end">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(row)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => remover(row.id)}
                            disabled={deleting === row.id}
                          >
                            {deleting === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* ── Provedores de IA ─────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Bot className="h-4 w-4 text-primary" />
              Provedores de IA
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-3 gap-4">
              {AI_PROVIDERS.map(({ slug, label, icon: Icon, modelos }) => {
                const configured = aiProviders.find(p => p.slug === slug);
                const f = aiForm[slug];
                return (
                  <div key={slug} className="border rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-primary" />
                        <span className="font-semibold text-sm">{label}</span>
                      </div>
                      <Badge className={`border-0 text-[10px] ${configured ? "bg-green-100 text-green-700" : "bg-red-50 text-red-600"}`}>
                        {configured ? "✓ Ativo" : "Não configurado"}
                      </Badge>
                    </div>

                    {configured && (
                      <p className="text-xs text-muted-foreground">
                        Modelo: <span className="font-medium">{configured.modelo}</span>
                      </p>
                    )}

                    <div className="space-y-1.5">
                      <Label className="text-xs">API Key</Label>
                      <SecretInput
                        value={f.api_key}
                        onChange={v => setAiForm(prev => ({ ...prev, [slug]: { ...prev[slug], api_key: v } }))}
                        placeholder={configured ? "••••• (salva — cole para atualizar)" : "sk-..."}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs">Modelo padrão</Label>
                      <Select
                        value={f.modelo}
                        onValueChange={v => setAiForm(prev => ({ ...prev, [slug]: { ...prev[slug], modelo: v } }))}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {modelos.map(m => <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        size="sm" variant="outline" className="flex-1 h-8 text-xs"
                        onClick={() => testarProvider(slug)}
                        disabled={f.testing || !f.api_key}
                      >
                        {f.testing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Plug className="h-3.5 w-3.5 mr-1" />}
                        Testar
                      </Button>
                      <Button
                        size="sm" className="flex-1 h-8 text-xs"
                        onClick={() => salvarProvider(slug)}
                        disabled={f.saving || !f.api_key}
                      >
                        {f.saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
                        Salvar
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* ── Outras integrações ───────────────────────────────────────────── */}
        {otherRows.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Workflow className="h-4 w-4 text-primary" />
                Outras Integrações
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>URL / Destino</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {otherRows.map(row => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.nome}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{TIPO_LABELS[row.tipo] ?? row.tipo}</TableCell>
                      <TableCell className="text-xs text-muted-foreground truncate max-w-[220px]">
                        {row.url?.replace("https://", "") ?? "—"}
                      </TableCell>
                      <TableCell><StatusBadge status={row.status} /></TableCell>
                      <TableCell>
                        <div className="flex gap-1 justify-end">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(row)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => remover(row.id)}
                            disabled={deleting === row.id}
                          >
                            {deleting === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── Modal Add/Edit ──────────────────────────────────────────────────── */}
      <Dialog open={modal} onOpenChange={o => { setModal(o); if (!o) setEditing(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar Integração" : "Nova Integração"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select
                value={form.tipo}
                onValueChange={v => setForm(f => ({ ...f, tipo: v }))}
                disabled={!!editing}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIPO_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input
                value={form.nome}
                onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
                placeholder="Ex: WhatsApp Cris"
              />
            </div>

            {["evolution", "n8n", "webhook_in", "webhook_out", "database_vector"].includes(form.tipo) && (
              <div className="space-y-1.5">
                <Label>URL</Label>
                <Input
                  value={form.url}
                  onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                  placeholder="https://..."
                />
              </div>
            )}

            {["evolution", "openai", "gemini", "elevenlabs", "meta_ads", "telegram", "instagram", "database_vector", "google_places"].includes(form.tipo) && (
              <div className="space-y-1.5">
                <Label>API Key</Label>
                <SecretInput
                  value={form.api_key}
                  onChange={v => setForm(f => ({ ...f, api_key: v }))}
                />
              </div>
            )}

            {form.tipo === "evolution" && (
              <div className="space-y-1.5">
                <Label>Nome da Instância</Label>
                <Input
                  value={form.instancia}
                  onChange={e => setForm(f => ({ ...f, instancia: e.target.value }))}
                  placeholder="Ex: crm_empresa"
                />
                <p className="text-xs text-muted-foreground">
                  Deve ser idêntico ao nome da instância no servidor Evolution.
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v as Status }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="conectado">Conectado</SelectItem>
                  <SelectItem value="inativo">Inativo</SelectItem>
                  <SelectItem value="erro">Erro</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {(form.url || form.api_key) && (
              <Button variant="secondary" className="w-full" onClick={testar} disabled={testing}>
                {testing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plug className="h-4 w-4 mr-2" />}
                Testar conexão
              </Button>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setModal(false)}>Cancelar</Button>
            <Button onClick={salvar} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CRMLayout>
  );
}
