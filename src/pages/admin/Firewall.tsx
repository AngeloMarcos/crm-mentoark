import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CRMLayout } from "@/components/CRMLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  AlertTriangle, Info, Plus, Trash2, ShieldCheck, ShieldOff, Search, Loader2,
} from "lucide-react";
import { adminFetch } from "@/lib/adminApi";

interface FwConfig { firewall_ligado: boolean; modo_simulacao: boolean }
interface FwIp {
  id: string;
  ip: string;
  tipo: "blocked" | "allowed" | "monitored";
  motivo: string | null;
  ativo: boolean;
  created_at: string;
}
interface FwStats {
  config: FwConfig;
  counts: {
    total: number; bloqueados: number; permitidos: number;
    monitorados: number; ativos: number;
  };
  recentes: FwIp[];
}

const PAGE_SIZE = 50;

const RE_IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const RE_IPV6 = /^[0-9a-fA-F:]{2,39}$/;
const RE_CIDR = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
const isValidIp = (v: string) => {
  const s = v.trim();
  return RE_IPV4.test(s) || RE_IPV6.test(s) || RE_CIDR.test(s);
};

function tipoBadge(tipo: FwIp["tipo"]) {
  if (tipo === "blocked") return <Badge variant="destructive">Bloqueado</Badge>;
  if (tipo === "allowed")
    return <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white">Permitido</Badge>;
  return <Badge className="bg-amber-500 hover:bg-amber-500 text-black">Monitorado</Badge>;
}

export default function FirewallPage() {
  const qc = useQueryClient();
  const [tipoFilter, setTipoFilter] = useState<string>("todos");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);

  const statsQ = useQuery({
    queryKey: ["fw-stats"],
    queryFn: () => adminFetch<FwStats>("/api/admin/firewall/stats"),
    refetchInterval: 15000,
  });

  const configQ = useQuery({
    queryKey: ["fw-config"],
    queryFn: () => adminFetch<FwConfig>("/api/admin/firewall/config"),
  });

  const ipsQ = useQuery({
    queryKey: ["fw-ips", tipoFilter, search, offset],
    queryFn: () =>
      adminFetch<{ items: FwIp[]; total: number }>("/api/admin/firewall/ips", {
        params: {
          limit: PAGE_SIZE,
          offset,
          tipo: tipoFilter !== "todos" ? tipoFilter : undefined,
          search: search || undefined,
        },
      }),
  });

  const configMut = useMutation({
    mutationFn: (patch: Partial<FwConfig>) =>
      adminFetch("/api/admin/firewall/config", { method: "PUT", body: patch }),
    onSuccess: () => {
      toast.success("Configuração atualizada");
      qc.invalidateQueries({ queryKey: ["fw-config"] });
      qc.invalidateQueries({ queryKey: ["fw-stats"] });
    },
  });

  const toggleAtivoMut = useMutation({
    mutationFn: ({ id, ativo }: { id: string; ativo: boolean }) =>
      adminFetch(`/api/admin/firewall/${id}`, { method: "PATCH", body: { ativo } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fw-ips"] });
      qc.invalidateQueries({ queryKey: ["fw-stats"] });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) =>
      adminFetch(`/api/admin/firewall/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("IP removido");
      qc.invalidateQueries({ queryKey: ["fw-ips"] });
      qc.invalidateQueries({ queryKey: ["fw-stats"] });
    },
  });

  const config = configQ.data ?? statsQ.data?.config;
  const counts = statsQ.data?.counts;
  const items = ipsQ.data?.items ?? [];
  const total = ipsQ.data?.total ?? 0;

  return (
    <CRMLayout>
      <div className="space-y-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-7 w-7 text-primary" />
            <h1 className="text-2xl font-bold">Firewall de Rede</h1>
          </div>
          <div className="flex gap-2">
            <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white">
              Simulação Ativa
            </Badge>
            {config?.firewall_ligado ? (
              <Badge variant="destructive">Firewall Ligado</Badge>
            ) : (
              <Badge variant="secondary" className="bg-slate-200 text-slate-600">Firewall Desligado</Badge>
            )}
          </div>
        </div>

        {/* Config Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Controle do Firewall</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="font-medium">Firewall Ligado</p>
                <p className="text-sm text-muted-foreground">
                  Ativa o motor de inspeção de tráfego.
                </p>
              </div>
              <Switch
                checked={!!config?.firewall_ligado}
                disabled={configMut.isPending || !config}
                onCheckedChange={(v) => configMut.mutate({ firewall_ligado: v })}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="font-medium">Modo Simulação</p>
                <p className="text-sm text-muted-foreground">
                  Apenas registra eventos, sem bloquear nada.
                </p>
              </div>
              <Switch
                checked={!!config?.modo_simulacao}
                disabled={configMut.isPending || !config}
                onCheckedChange={(v) => configMut.mutate({ modo_simulacao: v })}
              />
            </div>

            {config?.firewall_ligado && !config?.modo_simulacao && (
              <div className="flex gap-2 items-start rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
                <span>
                  <strong>Modo bloqueio ativo</strong> — IPs marcados serão rejeitados.
                </span>
              </div>
            )}
            {config?.modo_simulacao && (
              <div className="flex gap-2 items-start rounded-lg border border-sky-500/40 bg-sky-500/10 p-3 text-sm">
                <Info className="h-5 w-5 text-sky-500 shrink-0" />
                <span>
                  <strong>Modo simulação</strong> — apenas log visual, sem bloqueio real.
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Stats */}
        <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
          <StatCard label="Total" value={counts?.total} />
          <StatCard label="Bloqueados" value={counts?.bloqueados} tone="destructive" />
          <StatCard label="Permitidos" value={counts?.permitidos} tone="success" />
          <StatCard label="Monitorados" value={counts?.monitorados} tone="warning" />
          <StatCard label="Ativos" value={counts?.ativos} />
        </div>

        {/* Table */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-base">IPs registrados</CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <Select
                value={tipoFilter}
                onValueChange={(v) => { setTipoFilter(v); setOffset(0); }}
              >
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os tipos</SelectItem>
                  <SelectItem value="blocked">Bloqueados</SelectItem>
                  <SelectItem value="allowed">Permitidos</SelectItem>
                  <SelectItem value="monitored">Monitorados</SelectItem>
                </SelectContent>
              </Select>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8 w-56"
                  placeholder="Buscar IP ou motivo"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setOffset(0); }}
                />
              </div>
              <RegisterIpDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                onSaved={() => {
                  qc.invalidateQueries({ queryKey: ["fw-ips"] });
                  qc.invalidateQueries({ queryKey: ["fw-stats"] });
                }}
              />
            </div>
          </CardHeader>
          <CardContent>
            <div className="border rounded-md overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>IP</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Motivo</TableHead>
                    <TableHead>Ativo</TableHead>
                    <TableHead>Registrado em</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ipsQ.isLoading && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8">
                        <Loader2 className="h-5 w-5 animate-spin inline" />
                      </TableCell>
                    </TableRow>
                  )}
                  {!ipsQ.isLoading && items.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        Nenhum IP registrado.
                      </TableCell>
                    </TableRow>
                  )}
                  {items.map((it) => (
                    <TableRow key={it.id}>
                      <TableCell className="font-mono">{it.ip}</TableCell>
                      <TableCell>{tipoBadge(it.tipo)}</TableCell>
                      <TableCell className="max-w-xs truncate">{it.motivo || "—"}</TableCell>
                      <TableCell>
                        <Switch
                          checked={it.ativo}
                          disabled={toggleAtivoMut.isPending}
                          onCheckedChange={(v) =>
                            toggleAtivoMut.mutate({ id: it.id, ativo: v })
                          }
                        />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(it.created_at).toLocaleString("pt-BR")}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            if (confirm(`Remover IP ${it.ip}?`)) deleteMut.mutate(it.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-center justify-between mt-3 text-sm text-muted-foreground">
              <span>
                Exibindo {items.length} de {total}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline" size="sm"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  Anterior
                </Button>
                <Button
                  variant="outline" size="sm"
                  disabled={offset + PAGE_SIZE >= total}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  Próxima
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </CRMLayout>
  );
}

function StatCard({
  label, value, tone,
}: { label: string; value?: number; tone?: "destructive" | "success" | "warning" }) {
  const color =
    tone === "destructive" ? "text-destructive"
    : tone === "success" ? "text-emerald-500"
    : tone === "warning" ? "text-amber-500"
    : "text-foreground";
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className={`text-2xl font-bold mt-1 ${color}`}>{value ?? "—"}</p>
      </CardContent>
    </Card>
  );
}

function RegisterIpDialog({
  open, onOpenChange, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const [ip, setIp] = useState("");
  const [tipo, setTipo] = useState<"blocked" | "allowed" | "monitored">("monitored");
  const [motivo, setMotivo] = useState("");
  const [ativo, setAtivo] = useState(false);
  const [saving, setSaving] = useState(false);

  const valid = isValidIp(ip);

  const reset = () => {
    setIp(""); setTipo("monitored"); setMotivo(""); setAtivo(false);
  };

  const handleSave = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      await adminFetch("/api/admin/firewall", {
        method: "POST",
        body: { ip: ip.trim(), tipo, motivo: motivo.trim() || undefined, ativo },
      });
      toast.success("IP registrado");
      reset();
      onOpenChange(false);
      onSaved();
    } catch {
      // toast handled in adminFetch
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4 mr-1" /> Registrar IP
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar IP</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>IP (IPv4, IPv6 ou CIDR)</Label>
            <Input
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              placeholder="192.168.0.1 ou 10.0.0.0/24"
            />
            {ip && !valid && (
              <p className="text-xs text-destructive mt-1">Formato de IP inválido</p>
            )}
          </div>
          <div>
            <Label>Tipo</Label>
            <Select value={tipo} onValueChange={(v: any) => setTipo(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="blocked">Bloqueado</SelectItem>
                <SelectItem value="allowed">Permitido</SelectItem>
                <SelectItem value="monitored">Monitorado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Motivo (opcional)</Label>
            <Textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Descreva o motivo do registro"
              rows={3}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="font-medium text-sm">Ativo</p>
              <p className="text-xs text-muted-foreground">
                Quando ligado, a regra entra em vigor.
              </p>
            </div>
            <Switch checked={ativo} onCheckedChange={setAtivo} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={!valid || saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
