import { useEffect, useMemo, useRef, useState } from "react";
import { CRMLayout } from "@/components/CRMLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Send, Plus, Play, Pause, Trash2, Pencil, Copy, FileText, RefreshCw, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

type DisparoStatus = "rascunho" | "em_andamento" | "pausado" | "concluido" | "cancelado";

interface Disparo {
  id: string;
  user_id: string;
  nome: string;
  status: DisparoStatus;
  lista_id: string | null;
  mensagem_template: string | null;
  total_leads: number;
  enviados: number;
  falhas: number;
  intervalo_min: number;
  intervalo_max: number;
  pausa_a_cada: number;
  pausa_duracao: number;
  horario_inicio: string;
  horario_fim: string;
  data_inicio: string | null;
  data_fim: string | null;
  created_at: string;
}

interface Lista { id: string; nome: string; }
interface Contato { id: string; nome: string; telefone: string | null; empresa: string | null; }
interface DisparoLog {
  id: string; disparo_id: string; contato_id: string | null; nome: string | null;
  telefone: string; mensagem_enviada: string | null; status: string; tentativas: number;
  erro: string | null; created_at: string; enviado_at: string | null;
}

const statusConfig: Record<DisparoStatus, { label: string; className: string }> = {
  rascunho:     { label: "Rascunho",     className: "bg-muted text-muted-foreground" },
  em_andamento: { label: "Em andamento", className: "bg-info/20 text-info border-info/30" },
  pausado:      { label: "Pausado",      className: "bg-warning/20 text-warning border-warning/30" },
  concluido:    { label: "Concluído",    className: "bg-success/20 text-success border-success/30" },
  cancelado:    { label: "Cancelado",    className: "bg-destructive/20 text-destructive border-destructive/30" },
};

const emptyForm = {
  nome: "",
  lista_id: "",
  mensagem_template: "Olá {{nome}}, tudo bem?",
  intervalo_min: 45,
  intervalo_max: 90,
  pausa_a_cada: 20,
  pausa_duracao: 5,
  horario_inicio: "08:00",
  horario_fim: "20:00",
};

const renderTemplate = (tpl: string, c: { nome?: string | null; empresa?: string | null; telefone?: string | null }) =>
  (tpl || "")
    .split("{{nome}}").join(c.nome ?? "")
    .split("{{empresa}}").join(c.empresa ?? "")
    .split("{{telefone}}").join(c.telefone ?? "");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const inWindow = (start: string, end: string) => {
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return cur >= sh * 60 + sm && cur <= eh * 60 + em;
};

export default function DisparosPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [disparos, setDisparos] = useState<Disparo[]>([]);
  const [listas, setListas] = useState<Lista[]>([]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [previewContato, setPreviewContato] = useState<Contato | null>(null);
  const [previewCount, setPreviewCount] = useState(0);

  const [logsOpen, setLogsOpen] = useState(false);
  const [logsDisparo, setLogsDisparo] = useState<Disparo | null>(null);
  const [logs, setLogs] = useState<DisparoLog[]>([]);
  const [logFilter, setLogFilter] = useState<string>("todos");

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const runningRef = useRef<Set<string>>(new Set());
  const pauseFlagRef = useRef<Set<string>>(new Set());

  const carregar = async () => {
    if (!user) return;
    setLoading(true);
    const [{ data: ds }, { data: ls }] = await Promise.all([
      supabase.from("disparos").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("listas").select("id, nome").eq("user_id", user.id).order("nome"),
    ]);
    setDisparos((ds as Disparo[]) ?? []);
    setListas((ls as Lista[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { carregar(); /* eslint-disable-next-line */ }, [user?.id]);

  // Preview de leads + contato exemplo
  useEffect(() => {
    const run = async () => {
      if (!user || !form.lista_id) { setPreviewContato(null); setPreviewCount(0); return; }
      const { data, count } = await supabase
        .from("contatos")
        .select("id, nome, telefone, empresa", { count: "exact" })
        .eq("user_id", user.id)
        .eq("lista_id", form.lista_id)
        .not("telefone", "is", null)
        .limit(1);
      setPreviewCount(count ?? 0);
      setPreviewContato((data?.[0] as Contato) ?? null);
    };
    run();
  }, [form.lista_id, user?.id]);

  const abrirNovo = () => {
    setEditingId(null);
    setForm({ ...emptyForm });
    setDialogOpen(true);
  };

  const abrirEditar = (d: Disparo) => {
    setEditingId(d.id);
    setForm({
      nome: d.nome,
      lista_id: d.lista_id ?? "",
      mensagem_template: d.mensagem_template ?? "",
      intervalo_min: d.intervalo_min,
      intervalo_max: d.intervalo_max,
      pausa_a_cada: d.pausa_a_cada,
      pausa_duracao: d.pausa_duracao,
      horario_inicio: d.horario_inicio,
      horario_fim: d.horario_fim,
    });
    setDialogOpen(true);
  };

  const salvar = async () => {
    if (!user) return;
    if (!form.nome.trim()) { toast.error("Informe o nome da campanha"); return; }
    if (!form.lista_id) { toast.error("Selecione uma lista de contatos"); return; }
    if (!form.mensagem_template.trim()) { toast.error("Escreva a mensagem"); return; }
    if (form.intervalo_min > form.intervalo_max) { toast.error("Intervalo mínimo deve ser ≤ máximo"); return; }

    const payload = {
      user_id: user.id,
      nome: form.nome,
      lista_id: form.lista_id,
      mensagem_template: form.mensagem_template,
      intervalo_min: Number(form.intervalo_min),
      intervalo_max: Number(form.intervalo_max),
      pausa_a_cada: Number(form.pausa_a_cada),
      pausa_duracao: Number(form.pausa_duracao),
      horario_inicio: form.horario_inicio,
      horario_fim: form.horario_fim,
      total_leads: previewCount,
    };

    const { error } = editingId
      ? await supabase.from("disparos").update(payload).eq("id", editingId)
      : await supabase.from("disparos").insert(payload);

    if (error) { toast.error(error.message); return; }
    toast.success("✅ Campanha salva!");
    setDialogOpen(false);
    carregar();
  };

  const excluir = async (id: string) => {
    const { error } = await supabase.from("disparos").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Campanha excluída");
    setConfirmDeleteId(null);
    carregar();
  };

  const duplicar = async (d: Disparo) => {
    if (!user) return;
    const { error } = await supabase.from("disparos").insert({
      user_id: user.id, nome: `${d.nome} (cópia)`, lista_id: d.lista_id,
      mensagem_template: d.mensagem_template, intervalo_min: d.intervalo_min, intervalo_max: d.intervalo_max,
      pausa_a_cada: d.pausa_a_cada, pausa_duracao: d.pausa_duracao,
      horario_inicio: d.horario_inicio, horario_fim: d.horario_fim, total_leads: d.total_leads,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Campanha duplicada");
    carregar();
  };

  const setStatus = async (id: string, status: DisparoStatus, extras: Record<string, unknown> = {}) => {
    await supabase.from("disparos").update({ status, ...extras }).eq("id", id);
  };

  const carregarLogs = async (disparoId: string) => {
    const { data } = await supabase
      .from("disparo_logs").select("*").eq("disparo_id", disparoId).order("created_at");
    setLogs((data as DisparoLog[]) ?? []);
  };

  const abrirLogs = async (d: Disparo) => {
    setLogsDisparo(d);
    setLogFilter("todos");
    await carregarLogs(d.id);
    setLogsOpen(true);
  };

  const reenviarFalhas = async () => {
    if (!logsDisparo) return;
    const { error } = await supabase
      .from("disparo_logs")
      .update({ status: "pending", erro: null })
      .eq("disparo_id", logsDisparo.id)
      .eq("status", "failed");
    if (error) { toast.error(error.message); return; }
    toast.success("Falhas resetadas para pending");
    await carregarLogs(logsDisparo.id);
  };

  const getEvolutionConfig = async () => {
    if (!user) return null;
    const { data: ag } = await supabase
      .from("agentes")
      .select("evolution_server_url, evolution_api_key, evolution_instancia")
      .eq("user_id", user.id).eq("ativo", true)
      .not("evolution_server_url", "is", null)
      .limit(1).maybeSingle();
    if (ag?.evolution_server_url && ag?.evolution_api_key && ag?.evolution_instancia) {
      return { url: ag.evolution_server_url, key: ag.evolution_api_key, inst: ag.evolution_instancia };
    }
    const { data: ig } = await supabase
      .from("integracoes_config")
      .select("url, api_key, instancia")
      .eq("user_id", user.id).eq("tipo", "evolution")
      .limit(1).maybeSingle();
    if (ig?.url && ig?.api_key && ig?.instancia) {
      return { url: ig.url, key: ig.api_key, inst: ig.instancia };
    }
    return null;
  };

  const enviarMensagem = async (cfg: { url: string; key: string; inst: string }, telefone: string, texto: string) => {
    const url = `${cfg.url.replace(/\/$/, "")}/message/sendText/${cfg.inst}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: cfg.key },
      body: JSON.stringify({ number: telefone.replace(/\D/g, ""), text: texto }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  };

  const iniciar = async (d: Disparo) => {
    if (!user) return;
    if (runningRef.current.has(d.id)) return;

    const cfg = await getEvolutionConfig();
    if (!cfg) { toast.error("Configure a Evolution API em Agentes ou Integrações"); return; }

    // Gerar logs se ainda não existem
    const { count } = await supabase.from("disparo_logs").select("id", { count: "exact", head: true }).eq("disparo_id", d.id);
    if (!count) {
      const { data: contatos } = await supabase
        .from("contatos").select("id, nome, telefone, empresa")
        .eq("user_id", user.id).eq("lista_id", d.lista_id!)
        .not("telefone", "is", null);
      const rows = (contatos ?? []).map((c: any) => ({
        disparo_id: d.id, contato_id: c.id, user_id: user.id,
        nome: c.nome, telefone: c.telefone,
        mensagem_enviada: renderTemplate(d.mensagem_template ?? "", c),
        status: "pending",
      }));
      if (rows.length) await supabase.from("disparo_logs").insert(rows);
      await supabase.from("disparos").update({ total_leads: rows.length, data_inicio: new Date().toISOString() }).eq("id", d.id);
    }

    await setStatus(d.id, "em_andamento", { data_inicio: d.data_inicio ?? new Date().toISOString() });
    runningRef.current.add(d.id);
    pauseFlagRef.current.delete(d.id);
    toast.success("🚀 Disparo iniciado — mantenha esta aba aberta");
    carregar();

    let enviadosNoLote = 0;
    try {
      while (true) {
        if (pauseFlagRef.current.has(d.id)) break;

        const { data: pendings } = await supabase
          .from("disparo_logs").select("*")
          .eq("disparo_id", d.id).eq("status", "pending")
          .order("created_at").limit(1);
        const log = pendings?.[0] as DisparoLog | undefined;
        if (!log) break;

        if (!inWindow(d.horario_inicio, d.horario_fim)) {
          await sleep(60_000);
          continue;
        }

        await supabase.from("disparo_logs").update({ status: "sending", tentativas: log.tentativas + 1 }).eq("id", log.id);
        try {
          await enviarMensagem(cfg, log.telefone, log.mensagem_enviada ?? "");
          await supabase.from("disparo_logs").update({ status: "sent", enviado_at: new Date().toISOString() }).eq("id", log.id);
          // contador
          const { data: cur } = await supabase.from("disparos").select("enviados").eq("id", d.id).single();
          await supabase.from("disparos").update({ enviados: ((cur as any)?.enviados ?? 0) + 1 }).eq("id", d.id);
        } catch (err: any) {
          await supabase.from("disparo_logs").update({ status: "failed", erro: err.message ?? "erro" }).eq("id", log.id);
          const { data: cur } = await supabase.from("disparos").select("falhas").eq("id", d.id).single();
          await supabase.from("disparos").update({ falhas: ((cur as any)?.falhas ?? 0) + 1 }).eq("id", d.id);
        }

        enviadosNoLote += 1;
        if (d.pausa_a_cada > 0 && enviadosNoLote % d.pausa_a_cada === 0) {
          await sleep(d.pausa_duracao * 60_000);
        } else {
          const wait = (Math.floor(Math.random() * (d.intervalo_max - d.intervalo_min + 1)) + d.intervalo_min) * 1000;
          await sleep(wait);
        }
      }

      if (!pauseFlagRef.current.has(d.id)) {
        await setStatus(d.id, "concluido", { data_fim: new Date().toISOString() });
        toast.success(`✅ Disparo "${d.nome}" concluído`);
      }
    } finally {
      runningRef.current.delete(d.id);
      pauseFlagRef.current.delete(d.id);
      carregar();
    }
  };

  const pausar = async (d: Disparo) => {
    pauseFlagRef.current.add(d.id);
    await setStatus(d.id, "pausado");
    toast.info("Disparo pausado");
    carregar();
  };

  const cancelar = async (d: Disparo) => {
    pauseFlagRef.current.add(d.id);
    await setStatus(d.id, "cancelado", { data_fim: new Date().toISOString() });
    toast.info("Disparo cancelado");
    carregar();
  };

  const previewMensagem = useMemo(
    () => (previewContato ? renderTemplate(form.mensagem_template, previewContato) : form.mensagem_template),
    [form.mensagem_template, previewContato],
  );

  const filteredLogs = useMemo(
    () => (logFilter === "todos" ? logs : logs.filter((l) => l.status === logFilter)),
    [logs, logFilter],
  );

  const logStatusBadge = (s: string) => {
    const map: Record<string, string> = {
      pending: "bg-muted text-muted-foreground",
      sending: "bg-info/20 text-info border-info/30",
      sent: "bg-success/20 text-success border-success/30",
      failed: "bg-destructive/20 text-destructive border-destructive/30",
      skipped: "bg-warning/20 text-warning border-warning/30",
    };
    return <Badge variant="outline" className={map[s] ?? ""}>{s}</Badge>;
  };

  return (
    <CRMLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <Send className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Disparos em Massa</h1>
              <p className="text-sm text-muted-foreground">
                Envie mensagens WhatsApp em lote com proteção anti-ban
              </p>
            </div>
          </div>
          <Button onClick={abrirNovo}><Plus className="h-4 w-4" /> Nova Campanha de Disparo</Button>
        </div>

        {loading ? (
          <div className="text-muted-foreground text-sm">Carregando…</div>
        ) : disparos.length === 0 ? (
          <Card className="max-w-lg mx-auto text-center">
            <CardContent className="pt-10 pb-10 flex flex-col items-center gap-4">
              <div className="h-16 w-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
                <Send className="h-7 w-7" />
              </div>
              <div>
                <h3 className="font-semibold text-lg">Nenhuma campanha de disparo ainda</h3>
                <p className="text-sm text-muted-foreground">Crie sua primeira campanha para começar</p>
              </div>
              <Button onClick={abrirNovo}><Plus className="h-4 w-4" /> Criar primeira campanha</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {disparos.map((d) => {
              const cfg = statusConfig[d.status];
              const pct = d.total_leads ? Math.round(((d.enviados + d.falhas) / d.total_leads) * 100) : 0;
              return (
                <Card key={d.id} className="border-border/60 hover:border-primary/30 transition-colors">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base leading-tight">{d.nome}</CardTitle>
                      <Badge variant="outline" className={cfg.className}>{cfg.label}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{d.enviados + d.falhas} / {d.total_leads}</span>
                        <span>{pct}%</span>
                      </div>
                      <Progress value={pct} className="h-2" />
                      <div className="flex justify-between text-xs">
                        <span className="text-success">✓ {d.enviados} enviados</span>
                        {d.falhas > 0 && <span className="text-destructive">✗ {d.falhas} falhas</span>}
                      </div>
                    </div>
                    {d.status === "em_andamento" && (
                      <div className="flex items-start gap-2 text-xs text-warning bg-warning/10 rounded-md p-2">
                        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                        <span>Mantenha esta aba aberta durante o disparo.</span>
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground">
                      Criada em {new Date(d.created_at).toLocaleDateString("pt-BR")}
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {d.status === "rascunho" && (
                        <>
                          <Button size="sm" onClick={() => iniciar(d)}><Play className="h-4 w-4" /> Iniciar</Button>
                          <Button size="sm" variant="outline" onClick={() => abrirEditar(d)}><Pencil className="h-4 w-4" /> Editar</Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirmDeleteId(d.id)}><Trash2 className="h-4 w-4" /></Button>
                        </>
                      )}
                      {d.status === "em_andamento" && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => pausar(d)}><Pause className="h-4 w-4" /> Pausar</Button>
                          <Button size="sm" variant="ghost" onClick={() => abrirLogs(d)}><FileText className="h-4 w-4" /> Logs</Button>
                        </>
                      )}
                      {d.status === "pausado" && (
                        <>
                          <Button size="sm" onClick={() => iniciar(d)}><Play className="h-4 w-4" /> Retomar</Button>
                          <Button size="sm" variant="outline" onClick={() => cancelar(d)}>Cancelar</Button>
                          <Button size="sm" variant="ghost" onClick={() => abrirLogs(d)}><FileText className="h-4 w-4" /> Logs</Button>
                        </>
                      )}
                      {(d.status === "concluido" || d.status === "cancelado") && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => abrirLogs(d)}><FileText className="h-4 w-4" /> Logs</Button>
                          <Button size="sm" variant="outline" onClick={() => duplicar(d)}><Copy className="h-4 w-4" /> Duplicar</Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirmDeleteId(d.id)}><Trash2 className="h-4 w-4" /></Button>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Dialog Nova/Editar */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar Campanha" : "Nova Campanha de Disparo"}</DialogTitle>
            <DialogDescription>Configure mensagem, lista e proteção anti-ban.</DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="ident">
            <TabsList className="grid grid-cols-3 w-full">
              <TabsTrigger value="ident">Identificação</TabsTrigger>
              <TabsTrigger value="msg">Mensagem</TabsTrigger>
              <TabsTrigger value="ban">Anti-Ban</TabsTrigger>
            </TabsList>

            <TabsContent value="ident" className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Nome da campanha *</Label>
                <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Ex: Promoção Black Friday" />
              </div>
              <div className="space-y-2">
                <Label>Lista de contatos *</Label>
                <Select value={form.lista_id} onValueChange={(v) => setForm({ ...form, lista_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecione uma lista" /></SelectTrigger>
                  <SelectContent>
                    {listas.map((l) => <SelectItem key={l.id} value={l.id}>{l.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
                {form.lista_id && (
                  <p className="text-sm text-muted-foreground">
                    {previewCount} {previewCount === 1 ? "lead será importado" : "leads serão importados"} (apenas com telefone)
                  </p>
                )}
              </div>
            </TabsContent>

            <TabsContent value="msg" className="space-y-4 pt-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label>Template *</Label>
                    <span className="text-xs text-muted-foreground">{form.mensagem_template.length} caracteres</span>
                  </div>
                  <Textarea
                    rows={10}
                    value={form.mensagem_template}
                    onChange={(e) => setForm({ ...form, mensagem_template: e.target.value })}
                    placeholder="Olá {{nome}}, tudo bem?"
                  />
                  <p className="text-xs text-muted-foreground">
                    Variáveis: <code>{"{{nome}}"}</code>, <code>{"{{empresa}}"}</code>, <code>{"{{telefone}}"}</code>
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Preview</Label>
                  <div className="border border-border/60 rounded-md p-3 min-h-[200px] bg-muted/30 text-sm whitespace-pre-wrap">
                    {previewMensagem || <span className="text-muted-foreground">Selecione uma lista para ver o preview…</span>}
                  </div>
                  {previewContato && (
                    <p className="text-xs text-muted-foreground">Exemplo com: {previewContato.nome}</p>
                  )}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="ban" className="space-y-4 pt-4">
              <p className="text-xs text-muted-foreground">
                Configurações recomendadas para reduzir risco de bloqueio do WhatsApp.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Intervalo mínimo (s)</Label>
                  <Input type="number" min={1} value={form.intervalo_min}
                    onChange={(e) => setForm({ ...form, intervalo_min: Number(e.target.value) })} />
                </div>
                <div className="space-y-2">
                  <Label>Intervalo máximo (s)</Label>
                  <Input type="number" min={1} value={form.intervalo_max}
                    onChange={(e) => setForm({ ...form, intervalo_max: Number(e.target.value) })} />
                </div>
                <div className="space-y-2">
                  <Label>Pausa a cada (mensagens)</Label>
                  <Input type="number" min={0} value={form.pausa_a_cada}
                    onChange={(e) => setForm({ ...form, pausa_a_cada: Number(e.target.value) })} />
                </div>
                <div className="space-y-2">
                  <Label>Duração da pausa (min)</Label>
                  <Input type="number" min={0} value={form.pausa_duracao}
                    onChange={(e) => setForm({ ...form, pausa_duracao: Number(e.target.value) })} />
                </div>
                <div className="space-y-2">
                  <Label>Horário início</Label>
                  <Input type="time" value={form.horario_inicio}
                    onChange={(e) => setForm({ ...form, horario_inicio: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Horário fim</Label>
                  <Input type="time" value={form.horario_fim}
                    onChange={(e) => setForm({ ...form, horario_fim: e.target.value })} />
                </div>
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={salvar}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog Logs */}
      <Dialog open={logsOpen} onOpenChange={setLogsOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Logs do Disparo {logsDisparo ? `— ${logsDisparo.nome}` : ""}</DialogTitle>
            <DialogDescription>Histórico individual de envios.</DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <Select value={logFilter} onValueChange={setLogFilter}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="sending">Sending</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => logsDisparo && carregarLogs(logsDisparo.id)}>
                <RefreshCw className="h-4 w-4" /> Atualizar
              </Button>
              <Button size="sm" variant="outline" onClick={reenviarFalhas}>Reenviar falhas</Button>
            </div>
          </div>
          <div className="max-h-[60vh] overflow-auto border border-border/60 rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Tentativas</TableHead>
                  <TableHead>Enviado em</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLogs.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">Sem logs</TableCell></TableRow>
                ) : filteredLogs.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>{l.nome ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{l.telefone}</TableCell>
                    <TableCell>{logStatusBadge(l.status)}</TableCell>
                    <TableCell>{l.tentativas}</TableCell>
                    <TableCell>{l.enviado_at ? new Date(l.enviado_at).toLocaleString("pt-BR") : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setLogsOpen(false); carregar(); }}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDeleteId} onOpenChange={(o) => !o && setConfirmDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir campanha?</AlertDialogTitle>
            <AlertDialogDescription>Esta ação não pode ser desfeita. Os logs também serão removidos.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmDeleteId && excluir(confirmDeleteId)}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CRMLayout>
  );
}
