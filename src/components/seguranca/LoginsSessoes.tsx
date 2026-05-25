import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ShieldCheck,
  Clock,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCcw,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { authHeader } from "@/lib/api-token";
import { toast } from "sonner";

const API_URL = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";
const PAGE_SIZE = 10;

interface LoginRow {
  user_id: string;
  email: string | null;
  created_at: string;
  expires_at: string;
  revoked: boolean;
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function statusFor(row: LoginRow): { label: string; tone: "ok" | "expired" | "revoked" } {
  if (row.revoked) return { label: "Revogado", tone: "revoked" };
  if (new Date(row.expires_at) < new Date()) return { label: "Expirado", tone: "expired" };
  return { label: "Ativo", tone: "ok" };
}

export function LoginsSessoes() {
  const [rows, setRows] = useState<LoginRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const carregar = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/seguranca/logins-recentes`, {
        headers: authHeader(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
      setPage(1);
    } catch (e: any) {
      toast.error("Erro ao carregar logins recentes", { description: e.message });
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregar();
  }, []);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const paginated = useMemo(
    () => rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [rows, page]
  );

  const stats = useMemo(() => {
    const ativos = rows.filter((r) => statusFor(r).tone === "ok").length;
    const revogados = rows.filter((r) => r.revoked).length;
    const expirados = rows.filter((r) => statusFor(r).tone === "expired").length;
    return { ativos, revogados, expirados, total: rows.length };
  }, [rows]);

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total (últimos 50)", value: stats.total, icon: ShieldCheck, color: "text-primary" },
          { label: "Sessões ativas", value: stats.ativos, icon: CheckCircle2, color: "text-success" },
          { label: "Expirados", value: stats.expirados, icon: Clock, color: "text-warning" },
          { label: "Revogados", value: stats.revogados, icon: XCircle, color: "text-destructive" },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`h-9 w-9 rounded-lg bg-muted flex items-center justify-center ${k.color}`}>
                <k.icon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{k.label}</p>
                <p className="text-xl font-bold">{k.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Logins Recentes
          </CardTitle>
          <Button variant="outline" size="sm" onClick={carregar} disabled={loading} className="gap-2">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
            Atualizar
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center items-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : rows.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              Nenhum login registrado ainda.
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Usuário</TableHead>
                    <TableHead>Login em</TableHead>
                    <TableHead>Expira em</TableHead>
                    <TableHead className="text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginated.map((r, idx) => {
                    const s = statusFor(r);
                    return (
                      <TableRow key={`${r.user_id}-${r.created_at}-${idx}`}>
                        <TableCell className="font-medium">
                          {r.email || <span className="text-muted-foreground italic">sem email</span>}
                          <div className="text-[10px] text-muted-foreground font-mono">{r.user_id.slice(0, 8)}…</div>
                        </TableCell>
                        <TableCell className="text-sm">{formatDate(r.created_at)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{formatDate(r.expires_at)}</TableCell>
                        <TableCell className="text-right">
                          <Badge
                            variant={s.tone === "ok" ? "default" : "secondary"}
                            className={
                              s.tone === "ok"
                                ? "bg-success/15 text-success border-success/20"
                                : s.tone === "revoked"
                                ? "bg-destructive/15 text-destructive border-destructive/20"
                                : "bg-warning/15 text-warning border-warning/20"
                            }
                          >
                            {s.label}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              <div className="flex items-center justify-between p-3 border-t">
                <p className="text-xs text-muted-foreground">
                  Página {page} de {totalPages} · {rows.length} registros
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
