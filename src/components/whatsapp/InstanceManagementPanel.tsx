import { useEffect, useMemo, useState } from "react";
import { api } from "@/integrations/database/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Smartphone,
  Settings2,
  Loader2,
  Activity,
  Wifi,
  WifiOff,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

interface Agente {
  id: string;
  nome: string;
  evolution_instancia: string | null;
  whatsapp_score: number | null;
  fallback_owner: string | null;
  filial: string | null;
  reject_calls: boolean | null;
  ignore_groups: boolean | null;
  auto_read: boolean | null;
  show_signature: boolean | null;
  operation_mode: string | null;
  auto_distribute: boolean | null;
  linked_agent_id: string | null;
}

interface Profile {
  user_id: string;
  email: string;
  display_name: string | null;
}

type ConnState = "open" | "close" | "connecting";

function scoreColor(score: number) {
  if (score <= 40) return "bg-red-500";
  if (score <= 70) return "bg-yellow-500";
  return "bg-emerald-500";
}

function scoreLabel(score: number) {
  if (score <= 40) return "Risco alto";
  if (score <= 70) return "Atenção";
  return "Saudável";
}

function StatusChip({ state }: { state: ConnState }) {
  const cfg = {
    open: { label: "Conectado", className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30", Icon: Wifi },
    connecting: { label: "Reconectando", className: "bg-yellow-500/15 text-yellow-600 border-yellow-500/30", Icon: RefreshCw },
    close: { label: "Desconectado", className: "bg-red-500/15 text-red-600 border-red-500/30", Icon: WifiOff },
  }[state];
  const I = cfg.Icon;
  return (
    <Badge variant="outline" className={`gap-1 ${cfg.className}`}>
      <I className="h-3 w-3" /> {cfg.label}
    </Badge>
  );
}

export function InstanceManagementPanel() {
  const { user } = useAuth();
  const [agentes, setAgentes] = useState<Agente[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [statuses, setStatuses] = useState<Record<string, ConnState>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Agente | null>(null);
  const [saving, setSaving] = useState(false);

  const carregar = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await api
      .from("agentes")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) toast.error(`Erro ao carregar instâncias: ${error.message}`);
    else setAgentes((data ?? []) as Agente[]);
    setLoading(false);

    // profiles (pode falhar se não-admin) — silencioso
    try {
      const { data: pdata } = await api.from("profiles").select("user_id,email,display_name");
      if (pdata) setProfiles(pdata as Profile[]);
    } catch {}
  };

  const carregarStatus = async (lista: Agente[]) => {
    // Reusa endpoint global (uma única instância ativa por usuário no fluxo atual)
    try {
      const API_BASE = (import.meta.env.VITE_API_URL as string) || "http://localhost:3000";
      const t = localStorage.getItem("access_token");
      const res = await fetch(`${API_BASE}/api/whatsapp/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) },
      });
      if (!res.ok) return;
      const json = await res.json();
      const state: ConnState = json.state ?? "close";
      const map: Record<string, ConnState> = {};
      for (const a of lista) if (a.evolution_instancia) map[a.id] = state;
      setStatuses(map);
    } catch {}
  };

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    if (agentes.length > 0) carregarStatus(agentes);
  }, [agentes]);

  const instancias = useMemo(
    () => agentes.filter(a => !!a.evolution_instancia),
    [agentes]
  );

  const handleSave = async () => {
    if (!editing) return;
    setSaving(true);
    const payload = {
      nome: editing.nome,
      fallback_owner: editing.fallback_owner,
      filial: editing.filial,
      reject_calls: editing.reject_calls,
      ignore_groups: editing.ignore_groups,
      auto_read: editing.auto_read,
      show_signature: editing.show_signature,
      operation_mode: editing.operation_mode,
      auto_distribute: editing.auto_distribute,
      linked_agent_id: editing.linked_agent_id,
    };
    const { error } = await api.from("agentes").update(payload).eq("id", editing.id);
    setSaving(false);
    if (error) {
      toast.error(`Erro ao salvar: ${error.message}`);
      return;
    }
    toast.success("Configurações salvas");
    setEditing(null);
    carregar();
  };

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold tracking-tight">Instâncias WhatsApp</h2>
            <p className="text-sm text-muted-foreground">
              Gerencie o comportamento, automação e saúde de cada número conectado.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={carregar}>
            <RefreshCw className="h-4 w-4 mr-2" /> Atualizar
          </Button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando instâncias...
          </div>
        )}

        {!loading && instancias.length === 0 && (
          <Card className="p-8 text-center text-sm text-muted-foreground border-dashed">
            <Smartphone className="h-8 w-8 mx-auto mb-2 opacity-40" />
            Nenhuma instância configurada. Conecte um WhatsApp na aba <strong>Conversas</strong>.
          </Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {instancias.map(a => {
            const score = a.whatsapp_score ?? 100;
            const state: ConnState = statuses[a.id] ?? "close";
            return (
              <Card key={a.id} className="p-5 space-y-4 hover:shadow-lg transition-shadow">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                        <Smartphone className="h-4 w-4 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-bold truncate">{a.nome}</h3>
                        <p className="text-[10px] font-mono text-muted-foreground truncate">
                          {a.evolution_instancia}
                        </p>
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => setEditing(a)}
                    title="Configurar instância"
                  >
                    <Settings2 className="h-4 w-4" />
                  </Button>
                </div>

                <StatusChip state={state} />

                <div className="space-y-1.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center justify-between text-xs cursor-help">
                        <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
                          <Activity className="h-3 w-3" /> Score de saúde
                        </span>
                        <span className="font-bold tabular-nums">
                          {score} <span className="text-muted-foreground font-normal">/ 100</span>
                        </span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[260px] text-xs">
                      Score calculado com base em volume de disparos, taxa de resposta e
                      histórico de bloqueios.
                    </TooltipContent>
                  </Tooltip>
                  <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full ${scoreColor(score)} transition-all`}
                      style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground">{scoreLabel(score)}</p>
                </div>

                <div className="flex flex-wrap gap-1.5 pt-1">
                  {a.operation_mode && (
                    <Badge variant="secondary" className="text-[10px]">
                      {a.operation_mode === "manual" && "Manual"}
                      {a.operation_mode === "chatbot" && "Chatbot"}
                      {a.operation_mode === "agente_ia" && "Agente IA"}
                    </Badge>
                  )}
                  {a.auto_distribute && (
                    <Badge variant="outline" className="text-[10px]">Roleta</Badge>
                  )}
                  {a.filial && (
                    <Badge variant="outline" className="text-[10px]">{a.filial}</Badge>
                  )}
                </div>
              </Card>
            );
          })}
        </div>

        {/* Modal de configuração */}
        <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent className="sm:max-w-[560px]">
            <DialogHeader>
              <DialogTitle>Configurar Instância</DialogTitle>
              <DialogDescription>
                Ajuste comportamento e automação do número conectado.
              </DialogDescription>
            </DialogHeader>

            {editing && (
              <Tabs defaultValue="geral" className="w-full">
                <TabsList className="grid grid-cols-3 w-full">
                  <TabsTrigger value="geral">Geral</TabsTrigger>
                  <TabsTrigger value="comportamento">Comportamento</TabsTrigger>
                  <TabsTrigger value="automacao">Automação</TabsTrigger>
                </TabsList>

                {/* GERAL */}
                <TabsContent value="geral" className="space-y-4 pt-4">
                  <div className="space-y-1.5">
                    <Label>Nome de identificação</Label>
                    <Input
                      value={editing.nome ?? ""}
                      onChange={(e) => setEditing({ ...editing, nome: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Proprietário fallback</Label>
                    <p className="text-[11px] text-muted-foreground">
                      Recebe chats caso a distribuição automática falhe.
                    </p>
                    {profiles.length > 0 ? (
                      <Select
                        value={editing.fallback_owner ?? ""}
                        onValueChange={(v) => setEditing({ ...editing, fallback_owner: v })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione um usuário" />
                        </SelectTrigger>
                        <SelectContent>
                          {profiles.map(p => (
                            <SelectItem key={p.user_id} value={p.user_id}>
                              {p.display_name || p.email}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        placeholder="user_id ou email"
                        value={editing.fallback_owner ?? ""}
                        onChange={(e) => setEditing({ ...editing, fallback_owner: e.target.value })}
                      />
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label>Filial</Label>
                    <Input
                      placeholder="Ex: Matriz SP"
                      value={editing.filial ?? ""}
                      onChange={(e) => setEditing({ ...editing, filial: e.target.value })}
                    />
                  </div>
                </TabsContent>

                {/* COMPORTAMENTO */}
                <TabsContent value="comportamento" className="space-y-3 pt-4">
                  {[
                    { key: "reject_calls", label: "Rejeitar Chamadas", desc: "Recusa automaticamente ligações recebidas." },
                    { key: "ignore_groups", label: "Ignorar Grupos", desc: "Não processa mensagens vindas de grupos." },
                    { key: "auto_read", label: "Marcar como Lida Automaticamente", desc: "Confirmação azul ao receber." },
                    { key: "show_signature", label: "Exibir Nome do Agente (Assinatura)", desc: "Prefixa cada mensagem com o nome do atendente." },
                  ].map(({ key, label, desc }) => (
                    <div key={key} className="flex items-center justify-between gap-4 p-3 rounded-lg border bg-card/40">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{label}</p>
                        <p className="text-[11px] text-muted-foreground">{desc}</p>
                      </div>
                      <Switch
                        checked={!!(editing as any)[key]}
                        onCheckedChange={(v) => setEditing({ ...editing, [key]: v } as Agente)}
                      />
                    </div>
                  ))}
                </TabsContent>

                {/* AUTOMAÇÃO */}
                <TabsContent value="automacao" className="space-y-4 pt-4">
                  <div className="space-y-1.5">
                    <Label>Modo de Operação</Label>
                    <Select
                      value={editing.operation_mode ?? "manual"}
                      onValueChange={(v) => setEditing({ ...editing, operation_mode: v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="manual">Manual — atendimento humano puro</SelectItem>
                        <SelectItem value="chatbot">Chatbot (Fluxo) — bot configurável</SelectItem>
                        <SelectItem value="agente_ia">Agente IA — agente de IA do CRM</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {editing.operation_mode === "agente_ia" && (
                    <div className="space-y-1.5">
                      <Label>Agente IA vinculado</Label>
                      <Select
                        value={editing.linked_agent_id ?? ""}
                        onValueChange={(v) => setEditing({ ...editing, linked_agent_id: v })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione um agente" />
                        </SelectTrigger>
                        <SelectContent>
                          {agentes.map(a => (
                            <SelectItem key={a.id} value={a.id}>{a.nome}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-4 p-3 rounded-lg border bg-card/40">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">Distribuição Automática (Roleta)</p>
                      <p className="text-[11px] text-muted-foreground">
                        Distribui novos chats entre a equipe em round-robin.
                      </p>
                    </div>
                    <Switch
                      checked={!!editing.auto_distribute}
                      onCheckedChange={(v) => setEditing({ ...editing, auto_distribute: v })}
                    />
                  </div>
                </TabsContent>
              </Tabs>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>
                Cancelar
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Salvar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
