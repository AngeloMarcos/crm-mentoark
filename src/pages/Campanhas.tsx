import { useEffect, useState } from "react";
import { CRMLayout } from "@/components/CRMLayout";
import { api } from "@/integrations/database/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
} from "recharts";
import {
  DollarSign,
  MousePointerClick,
  Users,
  TrendingUp,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Target,
  RefreshCw,
  Megaphone,
  BadgeCheck,
  Smartphone,
  MessageSquareText,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";

type Infraestrutura = "api" | "qrcode" | "sms";

const INFRA_OPTIONS: {
  key: Infraestrutura;
  titulo: string;
  descricao: string;
  icon: any;
  iconBg: string;
  iconColor: string;
  badge?: any;
}[] = [
  {
    key: "api",
    titulo: "Números Oficiais (API)",
    descricao: "Use números conectados à API da Meta. Maior segurança contra banimentos e envios de altíssimo volume.",
    icon: MessageSquareText,
    iconBg: "bg-emerald-500/10",
    iconColor: "text-emerald-600",
    badge: BadgeCheck,
  },
  {
    key: "qrcode",
    titulo: "Aparelhos Físicos (QR Code)",
    descricao: "Envie usando as suas próprias instâncias de WhatsApp escaneadas. Ideal para aquecimento de chips e envios orgânicos.",
    icon: Smartphone,
    iconBg: "bg-green-500/10",
    iconColor: "text-green-600",
  },
  {
    key: "sms",
    titulo: "Mensagem de Texto (SMS)",
    descricao: "Alcance direto na operadora. Sem bloqueios de internet. Excelente para alertas, cobranças e engajamento.",
    icon: MessageSquareText,
    iconBg: "bg-purple-500/10",
    iconColor: "text-purple-600",
  },
];

type CampanhaStatus = "ativa" | "pausada" | "finalizada";

interface Campanha {
  id: string;
  user_id: string;
  nome: string;
  status: CampanhaStatus;
  plataforma: string;
  investimento: number;
  impressoes: number;
  cliques: number;
  ctr: number;
  leads_gerados: number;
  cpl: number;
  conversoes: number;
  periodo: string | null;
  created_at: string;
  updated_at: string;
}

const statusColor: Record<string, string> = {
  ativa: "bg-success/15 text-success",
  pausada: "bg-warning/15 text-warning",
  finalizada: "bg-muted text-muted-foreground",
};

const PLATAFORMAS = ["Meta Ads", "Google Ads", "TikTok Ads", "LinkedIn Ads", "Orgânico"];

const formInicial = {
  nome: "",
  plataforma: "Meta Ads",
  status: "ativa" as CampanhaStatus,
  periodo: "",
  investimento: 0,
  impressoes: 0,
  cliques: 0,
  leads_gerados: 0,
  conversoes: 0,
};

export default function CampanhasPage() {
  const { user } = useAuth();
  const [campanhas, setCampanhas] = useState<Campanha[]>([]);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [modalCampanha, setModalCampanha] = useState(false);
  const [modalInfra, setModalInfra] = useState(false);
  const [infraSelecionada, setInfraSelecionada] = useState<Infraestrutura | null>(null);
  const [editing, setEditing] = useState<Campanha | null>(null);
  const [form, setForm] = useState(formInicial);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const carregar = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await api
      .from("campanhas")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) {
      toast.error(`Erro ao carregar campanhas: ${error.message}`);
    } else {
      setCampanhas((data ?? []) as Campanha[]);
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
    setInfraSelecionada(null);
    setModalInfra(true);
  };

  const escolherInfra = (infra: Infraestrutura) => {
    setInfraSelecionada(infra);
    setModalInfra(false);
    setModalCampanha(true);
  };

  const abrirEditar = (c: Campanha) => {
    setEditing(c);
    setForm({
      nome: c.nome,
      plataforma: c.plataforma,
      status: c.status,
      periodo: c.periodo ?? "",
      investimento: Number(c.investimento) || 0,
      impressoes: c.impressoes || 0,
      cliques: c.cliques || 0,
      leads_gerados: c.leads_gerados || 0,
      conversoes: c.conversoes || 0,
    });
    setModalCampanha(true);
  };

  const calcularDerivados = () => {
    const ctr =
      form.impressoes > 0
        ? Number(((form.cliques / form.impressoes) * 100).toFixed(2))
        : 0;
    const cpl =
      form.leads_gerados > 0
        ? Number((form.investimento / form.leads_gerados).toFixed(2))
        : 0;
    return { ctr, cpl };
  };

  const salvar = async () => {
    if (!user) return;
    if (!form.nome.trim()) {
      toast.error("Informe o nome da campanha");
      return;
    }
    if (form.cliques > form.impressoes && form.impressoes > 0) {
      toast.error("Cliques não podem ser maiores que impressões.");
      return;
    }
    if (Number(form.investimento) < 0) {
      toast.error("Investimento não pode ser negativo");
      return;
    }
    if (Number(form.leads_gerados) < 0 || Number(form.conversoes) < 0) {
      toast.error("Leads e conversões não podem ser negativos");
      return;
    }
    setSalvando(true);
    const { ctr, cpl } = calcularDerivados();
    const payload = {
      nome: form.nome.trim(),
      plataforma: form.plataforma,
      status: form.status,
      periodo: form.periodo.trim() || null,
      investimento: form.investimento,
      impressoes: form.impressoes,
      cliques: form.cliques,
      leads_gerados: form.leads_gerados,
      conversoes: form.conversoes,
      ctr,
      cpl,
    };

    if (editing) {
      const { error } = await api
        .from("campanhas")
        .update(payload)
        .eq("id", editing.id);
      setSalvando(false);
      if (error) {
        toast.error(`Erro ao editar: ${error.message}`);
        return;
      }
      toast.success("Campanha atualizada!");
    } else {
      const { error } = await api
        .from("campanhas")
        .insert([{ ...payload, user_id: user.id }]);
      setSalvando(false);
      if (error) {
        toast.error(`Erro ao criar: ${error.message}`);
        return;
      }
      toast.success("Campanha criada!");
    }
    setModalCampanha(false);
    setEditing(null);
    setForm(formInicial);
    carregar();
  };

  const remover = async (id: string) => {
    const { error } = await api.from("campanhas").delete().eq("id", id);
    if (error) {
      toast.error(`Erro ao remover: ${error.message}`);
      return;
    }
    toast.success("Campanha removida");
    carregar();
  };

  const ativas = campanhas.filter((c) => c.status === "ativa");
  const totalInvestimento = ativas.reduce((s, c) => s + Number(c.investimento || 0), 0);
  const totalLeads = ativas.reduce((s, c) => s + (c.leads_gerados || 0), 0);
  const totalConversoes = ativas.reduce((s, c) => s + (c.conversoes || 0), 0);
  const cplMedio = totalLeads > 0 ? Number((totalInvestimento / totalLeads).toFixed(2)) : 0;
  const roas = totalInvestimento > 0 ? (totalConversoes / totalInvestimento).toFixed(2) : "—";
  const taxaConversao =
    totalLeads > 0 ? ((totalConversoes / totalLeads) * 100).toFixed(1) + "%" : "—";

  const chartData = campanhas.map((c) => ({
    nome: c.nome.length > 15 ? c.nome.slice(0, 15) + "..." : c.nome,
    leads: c.leads_gerados,
    conversoes: c.conversoes,
    cpl: Number(c.cpl),
  }));

  const derivados = calcularDerivados();

  return (
    <CRMLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Campanhas</h1>
            <p className="text-muted-foreground text-sm">
              Performance de campanhas e mídia paga
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={carregar} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
            <Button onClick={abrirCriar}>
              <Plus className="h-4 w-4" /> Nova Campanha
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 md:gap-4">
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="w-10 h-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
                <DollarSign className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Investimento (ativas)</p>
                <p className="text-lg font-bold">
                  R$ {totalInvestimento.toLocaleString("pt-BR")}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="w-10 h-10 rounded-xl bg-success/15 text-success flex items-center justify-center">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Leads (ativas)</p>
                <p className="text-lg font-bold">{totalLeads}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="w-10 h-10 rounded-xl bg-accent/15 text-accent flex items-center justify-center">
                <TrendingUp className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Conversões (ativas)</p>
                <p className="text-lg font-bold">{totalConversoes}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="w-10 h-10 rounded-xl bg-warning/15 text-warning flex items-center justify-center">
                <MousePointerClick className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">CPL Médio</p>
                <p className="text-lg font-bold">R$ {cplMedio.toLocaleString("pt-BR")}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="w-10 h-10 rounded-xl bg-info/15 text-info flex items-center justify-center">
                <TrendingUp className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">ROAS</p>
                <p className="text-lg font-bold">{roas}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="w-10 h-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
                <Target className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Taxa de Conversão</p>
                <p className="text-lg font-bold">{taxaConversao}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Leads por Campanha</CardTitle>
            </CardHeader>
            <CardContent className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,20%,20%)" />
                  <XAxis dataKey="nome" stroke="hsl(220,10%,55%)" fontSize={10} />
                  <YAxis stroke="hsl(220,10%,55%)" fontSize={12} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(222,25%,11%)",
                      border: "1px solid hsl(220,20%,18%)",
                      borderRadius: "8px",
                      color: "hsl(220,15%,90%)",
                    }}
                  />
                  <Bar dataKey="leads" fill="hsl(217,91%,55%)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="conversoes" fill="hsl(24,95%,53%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">CPL por Campanha</CardTitle>
            </CardHeader>
            <CardContent className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,20%,20%)" />
                  <XAxis dataKey="nome" stroke="hsl(220,10%,55%)" fontSize={10} />
                  <YAxis stroke="hsl(220,10%,55%)" fontSize={12} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(222,25%,11%)",
                      border: "1px solid hsl(220,20%,18%)",
                      borderRadius: "8px",
                      color: "hsl(220,15%,90%)",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="cpl"
                    stroke="hsl(24,95%,53%)"
                    strokeWidth={2}
                    dot={{ fill: "hsl(24,95%,53%)" }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Todas as Campanhas</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : campanhas.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground">
                Nenhuma campanha ainda. Clique em <strong>Nova Campanha</strong> para começar.
              </div>
            ) : (
              <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Campanha</TableHead>
                    <TableHead>Plataforma</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Investimento</TableHead>
                    <TableHead className="text-right">Impressões</TableHead>
                    <TableHead className="text-right">Cliques</TableHead>
                    <TableHead className="text-right">CTR</TableHead>
                    <TableHead className="text-right">Leads</TableHead>
                    <TableHead className="text-right">CPL</TableHead>
                    <TableHead className="text-right">Conversões</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {campanhas.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">
                        {c.nome}
                        {c.periodo && (
                          <span className="block text-xs text-muted-foreground">
                            {c.periodo}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {c.plataforma}
                      </TableCell>
                      <TableCell>
                        <Badge className={`${statusColor[c.status]} text-xs border-0`}>
                          {c.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        R$ {Number(c.investimento).toLocaleString("pt-BR")}
                      </TableCell>
                      <TableCell className="text-right">
                        {c.impressoes.toLocaleString("pt-BR")}
                      </TableCell>
                      <TableCell className="text-right">
                        {c.cliques.toLocaleString("pt-BR")}
                      </TableCell>
                      <TableCell className="text-right">{Number(c.ctr)}%</TableCell>
                      <TableCell className="text-right">{c.leads_gerados}</TableCell>
                      <TableCell className="text-right">
                        R$ {Number(c.cpl).toLocaleString("pt-BR")}
                      </TableCell>
                      <TableCell className="text-right">{c.conversoes}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => abrirEditar(c)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setConfirmDeleteId(c.id)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Modal: escolha da infraestrutura */}
      <Dialog open={modalInfra} onOpenChange={setModalInfra}>
        <DialogContent className="w-[95vw] max-w-md">
          <DialogHeader className="items-center text-center space-y-3">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
              <Megaphone className="h-6 w-6" />
            </div>
            <DialogTitle className="text-xl">Nova Campanha</DialogTitle>
            <DialogDescription className="text-sm">
              Selecione qual a infraestrutura de envio que você deseja utilizar.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 pt-2">
            {INFRA_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const Badge = opt.badge;
              return (
                <button
                  key={opt.key}
                  onClick={() => escolherInfra(opt.key)}
                  className="w-full text-left flex items-start gap-3 p-4 rounded-xl border bg-card hover:border-primary/40 hover:shadow-md hover:bg-primary/[0.02] transition-all group"
                >
                  <div className={`w-11 h-11 rounded-xl ${opt.iconBg} ${opt.iconColor} flex items-center justify-center shrink-0`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1">
                      <p className="font-semibold text-sm">{opt.titulo}</p>
                      {Badge && <Badge className="h-4 w-4 text-primary" />}
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{opt.descricao}</p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground self-center group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                </button>
              );
            })}
          </div>

          <DialogFooter className="sm:justify-center pt-2">
            <Button variant="outline" onClick={() => setModalInfra(false)} className="rounded-full px-8">
              Cancelar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={modalCampanha}
        onOpenChange={(o) => {
          setModalCampanha(o);
          if (!o) {
            setEditing(null);
            setForm(formInicial);
          }
        }}
      >
        <DialogContent className="w-[95vw] max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Editar campanha" : "Nova campanha"}
              {!editing && infraSelecionada && (
                <span className="ml-2 text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                  {INFRA_OPTIONS.find((o) => o.key === infraSelecionada)?.titulo}
                </span>
              )}
            </DialogTitle>
            <DialogDescription>
              CTR e CPL são calculados automaticamente.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2 space-y-1.5">
              <Label>Nome *</Label>
              <Input
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
                placeholder="Ex: Black Friday 2026"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Plataforma</Label>
              <Select
                value={form.plataforma}
                onValueChange={(v) => setForm({ ...form, plataforma: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLATAFORMAS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) =>
                  setForm({ ...form, status: v as CampanhaStatus })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ativa">Ativa</SelectItem>
                  <SelectItem value="pausada">Pausada</SelectItem>
                  <SelectItem value="finalizada">Finalizada</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Período</Label>
              <Input
                value={form.periodo}
                onChange={(e) => setForm({ ...form, periodo: e.target.value })}
                placeholder="Ex: Jan/2026"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Investimento (R$)</Label>
              <Input
                type="number"
                min={0}
                value={form.investimento}
                onChange={(e) =>
                  setForm({ ...form, investimento: Number(e.target.value) })
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label>Impressões</Label>
              <Input
                type="number"
                min={0}
                value={form.impressoes}
                onChange={(e) =>
                  setForm({ ...form, impressoes: Number(e.target.value) })
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label>Cliques</Label>
              <Input
                type="number"
                min={0}
                value={form.cliques}
                onChange={(e) =>
                  setForm({ ...form, cliques: Number(e.target.value) })
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label>Leads Gerados</Label>
              <Input
                type="number"
                min={0}
                value={form.leads_gerados}
                onChange={(e) =>
                  setForm({ ...form, leads_gerados: Number(e.target.value) })
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label>Conversões</Label>
              <Input
                type="number"
                min={0}
                value={form.conversoes}
                onChange={(e) =>
                  setForm({ ...form, conversoes: Number(e.target.value) })
                }
              />
            </div>

            <div className="md:col-span-2 grid grid-cols-2 gap-4 rounded-md bg-muted/40 p-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">CTR (auto)</p>
                <p className="font-semibold">{derivados.ctr}%</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">CPL (auto)</p>
                <p className="font-semibold">
                  R$ {derivados.cpl.toLocaleString("pt-BR")}
                </p>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setModalCampanha(false)}>
              Cancelar
            </Button>
            <Button onClick={salvar} disabled={salvando}>
              {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? "Salvar alterações" : "Criar campanha"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!confirmDeleteId}
        onOpenChange={(o) => !o && setConfirmDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir campanha?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação é irreversível. Todos os dados desta campanha serão removidos permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmDeleteId) remover(confirmDeleteId);
                setConfirmDeleteId(null);
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CRMLayout>
  );
}
