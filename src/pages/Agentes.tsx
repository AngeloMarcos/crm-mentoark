import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CRMLayout } from "@/components/CRMLayout";
import { api } from "@/integrations/database/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Bot,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Eye,
  EyeOff,
  Plug,
  MessageCircle,
  Brain,
  Database,
} from "lucide-react";
import { toast } from "sonner";

interface Agente {
  id: string;
  user_id: string;
  nome: string;
  descricao: string | null;
  persona: string | null;
  tom: string;
  idioma?: string;
  objetivo: string | null;
  mensagem_boas_vindas: string | null;
  regras: string | null;
  modelo: string;
  temperatura: number;
  max_tokens: number;
  evolution_instancia: string | null;
  evolution_api_key: string | null;
  evolution_server_url: string | null;
  rag_ativo: boolean | null;
  rag_threshold: number | null;
  rag_resultados: number | null;
  ativo: boolean;
  created_at: string;
  updated_at: string;
}

const TONS = ["profissional", "amigável", "consultivo", "formal", "descontraído"];
const MODELOS = ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1", "claude-3-5-sonnet", "gemini-1.5-pro"];

const formInicial = {
  nome: "",
  descricao: "",
  persona: "",
  tom: "profissional",
  idioma: "Português BR",
  objetivo: "",
  mensagem_boas_vindas: "",
  regras: "",
  modelo: "gpt-4o-mini",
  temperatura: 0.7,
  max_tokens: 1000,
  evolution_server_url: "",
  evolution_api_key: "",
  evolution_instancia: "",
  rag_ativo: true,
  rag_threshold: 0.7,
  rag_resultados: 5,
  ativo: true,
};

function formatarData(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AgentesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [agentes, setAgentes] = useState<Agente[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<Agente | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [form, setForm] = useState(formInicial);

  const carregar = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await api
      .from("agentes")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) {
      toast.error(`Erro ao carregar agentes: ${error.message}`);
    } else {
      setAgentes((data ?? []) as Agente[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const abrirCriar = () => {
    setEditing(null);
    setForm(formInicial);
    setShowKey(false);
    setModal(true);
  };

  const abrirEditar = (a: Agente) => {
    setEditing(a);
    setForm({
      nome: a.nome,
      descricao: a.descricao ?? "",
      persona: a.persona ?? "",
      tom: a.tom,
      idioma: a.idioma ?? "Português BR",
      objetivo: a.objetivo ?? "",
      mensagem_boas_vindas: a.mensagem_boas_vindas ?? "",
      regras: a.regras ?? "",
      modelo: a.modelo,
      temperatura: Number(a.temperatura),
      max_tokens: a.max_tokens,
      evolution_server_url: a.evolution_server_url ?? "",
      evolution_api_key: a.evolution_api_key ?? "",
      evolution_instancia: a.evolution_instancia ?? "",
      rag_ativo: a.rag_ativo ?? true,
      rag_threshold: a.rag_threshold ?? 0.7,
      rag_resultados: a.rag_resultados ?? 5,
      ativo: a.ativo,
    });
    setShowKey(false);
    setModal(true);
  };

  const salvar = async () => {
    if (!user) return;
    if (!form.nome.trim()) {
      toast.error("Informe o nome do agente.");
      return;
    }
    setSalvando(true);
    const payload = {
      nome: form.nome.trim(),
      descricao: form.descricao.trim() || null,
      persona: form.persona.trim() || null,
      tom: form.tom,
      idioma: form.idioma,
      objetivo: form.objetivo.trim() || null,
      mensagem_boas_vindas: form.mensagem_boas_vindas.trim() || null,
      regras: form.regras.trim() || null,
      modelo: form.modelo,
      temperatura: form.temperatura,
      max_tokens: form.max_tokens,
      evolution_server_url: form.evolution_server_url.trim() || null,
      evolution_api_key: form.evolution_api_key.trim() || null,
      evolution_instancia: form.evolution_instancia.trim() || null,
      rag_ativo: form.rag_ativo,
      rag_threshold: form.rag_threshold,
      rag_resultados: form.rag_resultados,
      ativo: form.ativo,
    };

    if (editing) {
      const { error } = await api
        .from("agentes")
        .update(payload)
        .eq("id", editing.id);
      setSalvando(false);
      if (error) {
        toast.error(`Erro ao salvar: ${error.message}`);
        return;
      }
      toast.success("✅ Agente salvo!");
    } else {
      const { error } = await api
        .from("agentes")
        .insert([{ ...payload, user_id: user.id }]);
      setSalvando(false);
      if (error) {
        toast.error(`Erro ao criar: ${error.message}`);
        return;
      }
      toast.success("✅ Agente criado!");
    }
    setModal(false);
    setEditing(null);
    setForm(formInicial);
    carregar();
  };

  const remover = async (a: Agente) => {
    if (!confirm(`Remover o agente "${a.nome}"?`)) return;
    const { error } = await api.from("agentes").delete().eq("id", a.id);
    if (error) {
      toast.error(`Erro ao remover: ${error.message}`);
      return;
    }
    toast.success("Agente removido");
    carregar();
  };

  const testarEvolution = async () => {
    if (!form.evolution_server_url || !form.evolution_api_key) {
      toast.error("Informe URL e API Key.");
      return;
    }
    setTestando(true);
    try {
      const url = form.evolution_server_url.replace(/\/$/, "") + "/instance/fetchInstances";
      const res = await fetch(url, {
        method: "GET",
        headers: { apikey: form.evolution_api_key },
      });
      if (res.ok) {
        toast.success("✅ Conexão estabelecida");
      } else {
        toast.error("❌ Falha na conexão — verifique URL e API Key");
      }
    } catch (e: any) {
      toast.error(`❌ Falha na conexão: ${e?.message ?? "erro de rede"}`);
    } finally {
      setTestando(false);
    }
  };

  return (
    <CRMLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Agentes</h1>
              <p className="text-muted-foreground text-sm">
                Gerencie seus agentes de atendimento
              </p>
            </div>
          </div>
          <Button onClick={abrirCriar}>
            <Plus className="h-4 w-4" /> Novo Agente
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : agentes.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center text-center py-12 gap-3">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
                <Bot className="h-7 w-7" />
              </div>
              <div>
                <p className="font-semibold">Nenhum agente criado ainda</p>
                <p className="text-sm text-muted-foreground">
                  Crie seu primeiro agente de atendimento para começar.
                </p>
              </div>
              <Button onClick={abrirCriar}>Criar primeiro agente</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {agentes.map((a) => (
              <Card
                key={a.id}
                className="hover:border-primary/30 transition-colors"
              >
                <CardContent className="p-5 space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <Bot className="h-6 w-6" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold truncate">{a.nome}</p>
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {a.descricao || "Sem descrição"}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline" className="text-xs">
                      {a.modelo}
                    </Badge>
                    <Badge
                      className={`text-xs border-0 ${
                        a.ativo
                          ? "bg-success/15 text-success"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {a.ativo ? "Ativo" : "Inativo"}
                    </Badge>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => abrirEditar(a)}
                    >
                      <Pencil className="h-4 w-4" /> Editar
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => remover(a)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog
        open={modal}
        onOpenChange={(o) => {
          setModal(o);
          if (!o) {
            setEditing(null);
            setForm(formInicial);
          }
        }}
      >
        <DialogContent className="w-[95vw] max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Editar agente" : "Novo agente"}
            </DialogTitle>
            <DialogDescription>
              Configure identidade, comportamento, integração e status.
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="identidade">
            <TabsList className="grid grid-cols-2 sm:grid-cols-5 w-full">
              <TabsTrigger value="identidade">Identidade</TabsTrigger>
              <TabsTrigger value="comportamento">Comportamento</TabsTrigger>
              <TabsTrigger value="conhecimento">Conhecimento</TabsTrigger>
              <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
              <TabsTrigger value="status">Status</TabsTrigger>
            </TabsList>

            <TabsContent value="identidade" className="space-y-4 pt-4">
              <div className="space-y-1.5">
                <Label>Nome do Agente *</Label>
                <Input
                  value={form.nome}
                  onChange={(e) => setForm({ ...form, nome: e.target.value })}
                  placeholder="Ex: Ana – Atendente Digital"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Descrição</Label>
                <Textarea
                  value={form.descricao}
                  onChange={(e) =>
                    setForm({ ...form, descricao: e.target.value })
                  }
                  placeholder="Ex: Agente de vendas para WhatsApp"
                  rows={2}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Persona</Label>
                <Textarea
                  value={form.persona}
                  onChange={(e) => setForm({ ...form, persona: e.target.value })}
                  placeholder="Ex: Você é Ana, uma atendente simpática e profissional..."
                  rows={4}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Tom de Voz</Label>
                  <Select
                    value={form.tom}
                    onValueChange={(v) => setForm({ ...form, tom: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TONS.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Idioma</Label>
                  <Select
                    value={form.idioma || "Português BR"}
                    onValueChange={(v) => setForm({ ...form, idioma: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Português BR">Português BR</SelectItem>
                      <SelectItem value="Português PT">Português PT</SelectItem>
                      <SelectItem value="Espanhol">Espanhol</SelectItem>
                      <SelectItem value="Inglês">Inglês</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Objetivo Principal</Label>
                <Textarea
                  value={form.objetivo}
                  onChange={(e) =>
                    setForm({ ...form, objetivo: e.target.value })
                  }
                  placeholder="Ex: Qualificar leads e agendar demonstrações"
                  rows={2}
                />
              </div>
            </TabsContent>

            <TabsContent value="comportamento" className="space-y-4 pt-4">
              <div className="space-y-1.5">
                <Label>Mensagem de Boas-Vindas</Label>
                <Textarea
                  value={form.mensagem_boas_vindas}
                  onChange={(e) =>
                    setForm({ ...form, mensagem_boas_vindas: e.target.value })
                  }
                  rows={3}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Regras e Restrições</Label>
                <Textarea
                  value={form.regras}
                  onChange={(e) => setForm({ ...form, regras: e.target.value })}
                  placeholder="Ex: Não mencionar concorrentes. Não inventar preços."
                  rows={3}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Modelo de IA</Label>
                <Select
                  value={form.modelo}
                  onValueChange={(v) => setForm({ ...form, modelo: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MODELOS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Temperatura</Label>
                  <span className="text-sm font-medium">
                    {form.temperatura.toFixed(1)}
                  </span>
                </div>
                <Slider
                  value={[form.temperatura]}
                  min={0}
                  max={1}
                  step={0.1}
                  onValueChange={(v) =>
                    setForm({ ...form, temperatura: v[0] })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Max Tokens</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.max_tokens}
                  onChange={(e) =>
                    setForm({ ...form, max_tokens: Number(e.target.value) })
                  }
                />
              </div>
            </TabsContent>

            <TabsContent value="conhecimento" className="space-y-4 pt-4">
              <div className="rounded-lg border p-4 bg-muted/20 space-y-4">
                <div className="flex items-center gap-2 text-primary">
                  <Brain className="h-5 w-5" />
                  <h3 className="font-semibold">Cérebro do Agente (RAG)</h3>
                </div>
                <p className="text-sm text-muted-foreground">
                  O Cérebro permite que o agente consulte informações específicas sobre seu negócio, FAQ e scripts em tempo real.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>RAG Ativo</Label>
                    <div className="flex items-center gap-2">
                      <Switch 
                        checked={form.rag_ativo ?? true} 
                        onCheckedChange={(v) => setForm({ ...form, rag_ativo: v })} 
                      />
                      <span className="text-xs text-muted-foreground">{form.rag_ativo ? "Ligado" : "Desligado"}</span>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Resultados RAG</Label>
                    <Input 
                      type="number" 
                      value={form.rag_resultados ?? 5} 
                      onChange={(e) => setForm({ ...form, rag_resultados: Number(e.target.value) })}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label>Confiança Mínima (Threshold)</Label>
                    <span className="text-xs font-medium">{(form.rag_threshold ?? 0.7).toFixed(2)}</span>
                  </div>
                  <Slider
                    value={[form.rag_threshold ?? 0.7]}
                    min={0}
                    max={1}
                    step={0.05}
                    onValueChange={(v) => setForm({ ...form, rag_threshold: v[0] })}
                  />
                </div>
                <Button 
                  variant="outline" 
                  className="w-full gap-2"
                  onClick={() => navigate("/cerebro")}
                >
                  <Database className="h-4 w-4" /> Gerenciar Base de Conhecimento
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="whatsapp" className="space-y-4 pt-4">
              <div className="space-y-1.5">
                <Label>URL do Servidor Evolution</Label>
                <Input
                  value={form.evolution_server_url}
                  onChange={(e) =>
                    setForm({ ...form, evolution_server_url: e.target.value })
                  }
                  placeholder="https://api.evolution.mentoark.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label>API Key Evolution</Label>
                <div className="relative">
                  <Input
                    type={showKey ? "text" : "password"}
                    value={form.evolution_api_key}
                    onChange={(e) =>
                      setForm({ ...form, evolution_api_key: e.target.value })
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
              <div className="space-y-1.5">
                <Label>Nome da Instância</Label>
                <Input
                  value={form.evolution_instancia}
                  onChange={(e) =>
                    setForm({ ...form, evolution_instancia: e.target.value })
                  }
                  placeholder="ex: mentoark-principal"
                />
              </div>
              <Button
                variant="secondary"
                className="w-full"
                onClick={testarEvolution}
                disabled={testando}
              >
                {testando ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plug className="h-4 w-4" />
                )}
                Testar conexão
              </Button>
            </TabsContent>

            <TabsContent value="status" className="space-y-4 pt-4">
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <p className="font-medium text-sm">Agente ativo</p>
                  <p className="text-xs text-muted-foreground">
                    Quando inativo, não responde mensagens.
                  </p>
                </div>
                <Switch
                  checked={form.ativo}
                  onCheckedChange={(v) => setForm({ ...form, ativo: v })}
                />
              </div>

              {editing && (
                <div className="rounded-md border p-3 space-y-1 text-sm">
                  <p>
                    <span className="text-muted-foreground">Criado em: </span>
                    {formatarData(editing.created_at)}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Última atualização: </span>
                    {formatarData(editing.updated_at)}
                  </p>
                </div>
              )}

              {editing?.evolution_instancia && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() =>
                    navigate(
                      `/whatsapp?instancia=${encodeURIComponent(
                        editing.evolution_instancia!,
                      )}`,
                    )
                  }
                >
                  <MessageCircle className="h-4 w-4" /> Ver Histórico WhatsApp
                </Button>
              )}
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button variant="outline" onClick={() => setModal(false)}>
              Cancelar
            </Button>
            <Button onClick={salvar} disabled={salvando}>
              {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? "Salvar alterações" : "Criar agente"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CRMLayout>
  );
}
