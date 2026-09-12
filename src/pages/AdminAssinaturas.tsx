import { useCallback, useEffect, useMemo, useState } from "react";
import { getAuthToken } from "@/lib/api-token";
import { CRMLayout } from "@/components/CRMLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, RefreshCw, CheckCircle2, Clock, XCircle, ShieldAlert, CalendarPlus, StickyNote } from "lucide-react";
import { toast } from "sonner";
import { useAssinatura } from "@/hooks/useAssinatura";

const API_BASE = (import.meta.env.VITE_API_URL as string) || "https://api.mentoark.com.br";
const authHeaders = () => {
  const t = getAuthToken();
  return { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) };
};

interface Row {
  owner_id: string;
  status: "trial" | "ativa" | "expirada";
  plano: string;
  trial_fim: string | null;
  ativada_em: string | null;
  observacao: string | null;
  updated_at: string;
  email: string;
  display_name: string | null;
  role: string;
  active: boolean;
  conta_criada_em: string;
  last_login_at: string | null;
  membros: number;
  pedidos_abertos: number;
  dias_restantes: number;
}

interface Solicitacao {
  id: string;
  owner_id: string;
  mensagem: string | null;
  created_at: string;
  dono_email: string;
  dono_nome: string | null;
  assinatura_status: string | null;
}

const STATUS_META: Record<Row["status"], { label: string; cls: string; icon: typeof Clock }> = {
  ativa: { label: "Ativa", cls: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30", icon: CheckCircle2 },
  trial: { label: "Trial", cls: "bg-amber-500/15 text-amber-600 border-amber-500/30", icon: Clock },
  expirada: { label: "Expirada", cls: "bg-red-500/15 text-red-600 border-red-500/30", icon: XCircle },
};

function fmt(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

export default function AdminAssinaturasPage() {
  const { assinatura } = useAssinatura();
  const [rows, setRows] = useState<Row[]>([]);
  const [solic, setSolic] = useState<Solicitacao[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [statusFiltro, setStatusFiltro] = useState<string>("todos");
  const [salvandoId, setSalvandoId] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (busca.trim()) qs.set("busca", busca.trim());
      if (statusFiltro !== "todos") qs.set("status", statusFiltro);
      const [r1, r2] = await Promise.all([
        fetch(`${API_BASE}/api/admin/assinaturas?${qs}`, { headers: authHeaders() }),
        fetch(`${API_BASE}/api/admin/assinaturas/solicitacoes`, { headers: authHeaders() }),
      ]);
      if (r1.ok) setRows(await r1.json());
      if (r2.ok) setSolic(await r2.json());
    } catch {
      toast.error("Falha ao carregar assinaturas");
    } finally {
      setLoading(false);
    }
  }, [busca, statusFiltro]);

  useEffect(() => { carregar(); }, [carregar]);

  const patch = async (ownerId: string, body: Record<string, unknown>, msg: string) => {
    setSalvandoId(ownerId);
    try {
      const r = await fetch(`${API_BASE}/api/admin/assinaturas/${ownerId}`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e?.message || "Falha ao salvar");
      }
      toast.success(msg);
      await carregar();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSalvandoId(null);
    }
  };

  const atenderPedido = async (id: string) => {
    try {
      await fetch(`${API_BASE}/api/admin/assinaturas/solicitacoes/${id}/atender`, {
        method: "POST",
        headers: authHeaders(),
      });
      setSolic(prev => prev.filter(s => s.id !== id));
    } catch {
      toast.error("Falha ao marcar pedido");
    }
  };

  const contadores = useMemo(() => {
    const c = { trial: 0, ativa: 0, expirada: 0 };
    for (const r of rows) c[r.status]++;
    return c;
  }, [rows]);

  if (assinatura && !assinatura.sou_master) {
    return (
      <CRMLayout>
        <div className="max-w-md mx-auto mt-20 text-center space-y-3">
          <ShieldAlert className="h-10 w-10 mx-auto text-muted-foreground" />
          <h2 className="text-lg font-bold">Acesso restrito</h2>
          <p className="text-sm text-muted-foreground">
            Esta página é exclusiva do administrador do sistema.
          </p>
        </div>
      </CRMLayout>
    );
  }

  return (
    <CRMLayout>
      <div className="space-y-6 max-w-6xl mx-auto">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black">Assinaturas</h1>
            <p className="text-sm text-muted-foreground">
              {rows.length} tenants · <span className="text-amber-600 font-medium">{contadores.trial} em trial</span> ·{" "}
              <span className="text-emerald-600 font-medium">{contadores.ativa} ativas</span> ·{" "}
              <span className="text-red-600 font-medium">{contadores.expirada} expiradas</span>
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={carregar} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-2">Atualizar</span>
          </Button>
        </div>

        {solic.length > 0 && (
          <Card className="border-amber-500/30 bg-amber-500/[0.04]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Clock className="h-4 w-4 text-amber-600" />
                Pedidos de reativação ({solic.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {solic.map(s => (
                <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border bg-background p-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold truncate">{s.dono_email}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {new Date(s.created_at).toLocaleString("pt-BR")} · status {s.assinatura_status ?? "?"}
                      {s.mensagem ? ` · "${s.mensagem}"` : ""}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => { patch(s.owner_id, { status: "ativa" }, "Conta ativada"); atenderPedido(s.id); }}
                  >
                    Ativar conta
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => atenderPedido(s.id)}>
                    Ignorar
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap gap-2">
              <Input
                placeholder="Buscar por e-mail ou nome…"
                value={busca}
                onChange={e => setBusca(e.target.value)}
                className="max-w-xs"
              />
              <Select value={statusFiltro} onValueChange={setStatusFiltro}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os status</SelectItem>
                  <SelectItem value="trial">Trial</SelectItem>
                  <SelectItem value="ativa">Ativa</SelectItem>
                  <SelectItem value="expirada">Expirada</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Conta</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Trial até</TableHead>
                    <TableHead className="text-center">Membros</TableHead>
                    <TableHead>Último login</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && rows.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                      <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                    </TableCell></TableRow>
                  )}
                  {!loading && rows.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground italic">
                      Nenhuma assinatura encontrada.
                    </TableCell></TableRow>
                  )}
                  {rows.map(r => {
                    const meta = STATUS_META[r.status];
                    const Icon = meta.icon;
                    const busy = salvandoId === r.owner_id;
                    return (
                      <TableRow key={r.owner_id}>
                        <TableCell>
                          <p className="font-semibold">{r.display_name || r.email.split("@")[0]}</p>
                          <p className="text-[11px] text-muted-foreground">{r.email}{r.role === "admin" ? " · admin" : ""}</p>
                          {r.observacao && (
                            <p className="text-[11px] text-amber-600 mt-0.5 flex items-center gap-1">
                              <StickyNote className="h-3 w-3" /> {r.observacao}
                            </p>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`gap-1 ${meta.cls}`}>
                            <Icon className="h-3 w-3" /> {meta.label}
                          </Badge>
                          {r.status === "trial" && (
                            <p className="text-[11px] text-muted-foreground mt-1">{r.dias_restantes} dia(s)</p>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">{fmt(r.trial_fim)}</TableCell>
                        <TableCell className="text-center text-sm">{r.membros}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{fmt(r.last_login_at)}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center justify-end gap-1">
                            {busy && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                            {r.status !== "ativa" && (
                              <Button size="sm" variant="default" disabled={busy}
                                onClick={() => patch(r.owner_id, { status: "ativa" }, "Conta ativada")}>
                                Ativar
                              </Button>
                            )}
                            <Button size="sm" variant="outline" disabled={busy}
                              onClick={() => patch(r.owner_id, { dias_extra: 7 }, "+7 dias de trial")}>
                              <CalendarPlus className="h-3.5 w-3.5" /> 7d
                            </Button>
                            <Button size="sm" variant="outline" disabled={busy}
                              onClick={() => patch(r.owner_id, { dias_extra: 30 }, "+30 dias de trial")}>
                              30d
                            </Button>
                            <Button size="sm" variant="ghost" disabled={busy}
                              onClick={() => {
                                const nota = window.prompt("Observação (visível só no painel):", r.observacao ?? "");
                                if (nota !== null) patch(r.owner_id, { observacao: nota }, "Observação salva");
                              }}>
                              <StickyNote className="h-3.5 w-3.5" />
                            </Button>
                            {r.status !== "expirada" && (
                              <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-600" disabled={busy}
                                onClick={() => {
                                  if (window.confirm(`Expirar a assinatura de ${r.email} agora? (a conta entra em modo somente leitura)`))
                                    patch(r.owner_id, { status: "expirada" }, "Assinatura expirada");
                                }}>
                                Expirar
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </CRMLayout>
  );
}
