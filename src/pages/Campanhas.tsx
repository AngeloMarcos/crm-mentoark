import { useEffect, useState } from "react";
import { CRMLayout } from "@/components/CRMLayout";
import { supabase } from "@/integrations/supabase/client";
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
} from "lucide-react";
import { toast } from "sonner";

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
  const [editing, setEditing] = useState<Campanha | null>(null);
  const [form, setForm] = useState(formInicial);

  const carregar = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
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
      const { error } = await supabase
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
      const { error } = await supabase
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

  const remover = async (c: Campanha) => {
    if (!confirm(`Remover a campanha "${c.nome}"?`)) return;
    const { error } = await supabase.from("campanhas").delete().eq("id", c.id);
    if (error) {
      toast.error(`Erro ao remover: ${error.message}`);
      return;
    }
    toast.success("Campanha removida");
    carregar();
  };

  const totalInvestimento = campanhas.reduce((s, c) => s + Number(c.investimento || 0), 0);
  const totalLeads = campanhas.reduce((s, c) => s + (c.leads_gerados || 0), 0);
  const totalConversoes = campanhas.reduce((s, c) => s + (c.conversoes || 0), 0);
  const cplMedio = totalLeads > 0 ? Number((totalInvestimento / totalLeads).toFixed(2)) : 0;

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
          <Button onClick={abrirCriar}>
            <Plus className="h-4 w-4" /> Nova Campanha
          </Button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="w-10 h-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
                <DollarSign className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Investimento Total</p>
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
                <p className="text-xs text-muted-foreground">Leads Gerados</p>
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
                <p className="text-xs text-muted-foreground">Conversões</p>
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
                            onClick={() => remover(c)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
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
      </div>

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
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Editar campanha" : "Nova campanha"}
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
    </CRMLayout>
  );
}
