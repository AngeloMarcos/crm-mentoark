import { useCallback, useEffect, useState } from "react";
import { CRMLayout } from "@/components/CRMLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import {
  Users,
  MessageCircle,
  Activity,
  RefreshCw,
  Bot,
  CirclePause,
  ExternalLink,
} from "lucide-react";

interface DashboardStats {
  totalContatos: number;
  iaAtiva: number;
  iaPausada: number;
  conversasHoje: number;
  recentes: any[];
}

const initialStats: DashboardStats = {
  totalContatos: 0,
  iaAtiva: 0,
  iaPausada: 0,
  conversasHoje: 0,
  recentes: [],
};

function KpiCard({
  title,
  value,
  icon: Icon,
  accent,
  loading,
}: {
  title: string;
  value: string | number;
  icon: any;
  accent?: boolean;
  loading?: boolean;
}) {
  return (
    <Card className={`${accent ? "glow-primary border-primary/30" : ""}`}>
      <CardContent className="flex items-center gap-4 p-5">
        <div
          className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
            accent ? "gradient-brand text-white shadow-sm" : "bg-muted text-muted-foreground"
          }`}
        >
          <Icon className="h-6 w-6" />
        </div>
        <div className="flex-1">
          <p className="text-sm text-muted-foreground">{title}</p>
          {loading ? (
            <Skeleton className="h-7 w-16 mt-1" />
          ) : (
            <p className="text-2xl font-bold tracking-tight">{value}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats>(initialStats);
  const [loadingDash, setLoadingDash] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const carregar = useCallback(async () => {
    setLoadingDash(true);
    try {
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      const hojeIso = hoje.toISOString();

      const [
        totalRes,
        iaAtivaRes,
        iaPausadaRes,
        msgHojeRes,
        recentesRes
      ] = await Promise.all([
        supabase.from("dados_cliente").select("id", { count: "exact", head: true }),
        supabase.from("dados_cliente").select("id", { count: "exact", head: true }).eq("atendimento_ia", true),
        supabase.from("dados_cliente").select("id", { count: "exact", head: true }).eq("atendimento_ia", false),
        supabase.from("chat_messages").select("id", { count: "exact", head: true }).gte("created_at", hojeIso),
        supabase.from("dados_cliente").select("*").order("created_at", { ascending: false }).limit(5)
      ]);

      setStats({
        totalContatos: totalRes.count || 0,
        iaAtiva: iaAtivaRes.count || 0,
        iaPausada: iaPausadaRes.count || 0,
        conversasHoje: msgHojeRes.count || 0,
        recentes: recentesRes.data || [],
      });
      setLastUpdated(new Date());
    } catch (error) {
      console.error("Dashboard error:", error);
      toast.error("Erro ao carregar indicadores");
    } finally {
      setLoadingDash(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await carregar();
    setRefreshing(false);
    toast.success("Dados atualizados");
  };

  return (
    <CRMLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Dashboard</h1>
            <p className="text-muted-foreground text-sm">
              Indicadores de atendimento e contatos
            </p>
          </div>
          <div className="flex items-center gap-3">
            {lastUpdated && (
              <span className="text-xs text-muted-foreground hidden sm:block">
                Atualizado às{" "}
                {lastUpdated.toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              <RefreshCw
                className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`}
              />
              Atualizar
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            title="Total de Contatos"
            value={stats.totalContatos}
            icon={Users}
            accent
            loading={loadingDash}
          />
          <KpiCard
            title="IA Ativa"
            value={stats.iaAtiva}
            icon={Bot}
            loading={loadingDash}
          />
          <KpiCard
            title="IA Pausada"
            value={stats.iaPausada}
            icon={CirclePause}
            loading={loadingDash}
          />
          <KpiCard
            title="Conversas Hoje"
            value={stats.conversasHoje}
            icon={MessageCircle}
            loading={loadingDash}
          />
        </div>

        <Card className="card-gradient-border">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg font-semibold flex items-center gap-2">
                <Activity className="h-5 w-5 text-primary" />
                Contatos Recentes
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => navigate("/contatos")} className="text-xs">
                Ver todos
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {loadingDash ? (
              <div className="space-y-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : stats.recentes.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">
                Nenhum contato cadastrado ainda.
              </div>
            ) : (
              <div className="relative overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>Telefone</TableHead>
                      <TableHead>Setor</TableHead>
                      <TableHead>Status IA</TableHead>
                      <TableHead className="text-right">Ação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stats.recentes.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium truncate max-w-[150px]">
                          {c.nomewpp || "Sem nome"}
                        </TableCell>
                        <TableCell>{c.telefone || "—"}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px] uppercase">
                            {c.Setor || "N/A"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge 
                            variant="secondary" 
                            className={c.atendimento_ia ? "bg-success/10 text-success border-success/20" : "bg-destructive/10 text-destructive border-destructive/20"}
                          >
                            {c.atendimento_ia ? "Ativa" : "Pausada"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={() => navigate(`/contatos/${c.id}`)}
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Button>
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
    </CRMLayout>
  );
}
