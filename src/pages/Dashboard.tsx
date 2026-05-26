import { useCallback, useEffect, useMemo, useState } from "react";
import { CRMLayout } from "@/components/CRMLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/integrations/database/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Users,
  MessageCircle,
  RefreshCw,
  Megaphone,
  TrendingUp,
  Clock,
  CheckCircle2,
  CalendarDays,
  ArrowUpRight,
  Sparkles,
  ExternalLink,
  Bot,
  Pause,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

interface DashboardStats {
  totalLeads: number;
  novosLeads7d: number;
  leadsGanhos: number;
  taxaConversao: number;
  campanhasAtivas: number;
  campanhasTotal: number;
  mensagensHoje: number;
  mensagens7dSerie: { dia: string; total: number }[];
  leadsRecentes: any[];
}

const empty: DashboardStats = {
  totalLeads: 0,
  novosLeads7d: 0,
  leadsGanhos: 0,
  taxaConversao: 0,
  campanhasAtivas: 0,
  campanhasTotal: 0,
  mensagensHoje: 0,
  mensagens7dSerie: [],
  leadsRecentes: [],
};

function KpiCard({
  title,
  value,
  hint,
  icon: Icon,
  trend,
  tone = "primary",
  loading,
}: {
  title: string;
  value: string | number;
  hint?: string;
  icon: any;
  trend?: string;
  tone?: "primary" | "success" | "info" | "accent";
  loading?: boolean;
}) {
  const toneStyles: Record<string, string> = {
    primary: "from-primary/15 to-primary/5 text-primary",
    success: "from-success/15 to-success/5 text-success",
    info: "from-info/15 to-info/5 text-info",
    accent: "from-accent/15 to-accent/5 text-accent",
  };
  return (
    <Card className="overflow-hidden relative group hover:shadow-md transition-all">
      <div
        className={`absolute inset-0 bg-gradient-to-br ${toneStyles[tone]} opacity-60 pointer-events-none`}
      />
      <CardContent className="relative p-5">
        <div className="flex items-start justify-between mb-3">
          <div
            className={`w-10 h-10 rounded-xl bg-card border flex items-center justify-center ${toneStyles[tone].split(" ").pop()}`}
          >
            <Icon className="h-5 w-5" />
          </div>
          {trend && (
            <Badge variant="secondary" className="text-[10px] gap-1 bg-card">
              <ArrowUpRight className="h-3 w-3" />
              {trend}
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{title}</p>
        {loading ? (
          <Skeleton className="h-8 w-20" />
        ) : (
          <p className="text-3xl font-bold tracking-tight">{value}</p>
        )}
        {hint && !loading && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats>(empty);
  const [loadingDash, setLoadingDash] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const carregar = useCallback(async () => {
    setLoadingDash(true);
    try {
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      const hojeIso = hoje.toISOString();
      const sete = new Date(hoje);
      sete.setDate(sete.getDate() - 6);
      const seteIso = sete.toISOString();

      const [
        leadsRes,
        novos7Res,
        ganhosRes,
        campAtivasRes,
        campTotalRes,
        msgHojeRes,
        msg7dRes,
        recentesRes,
      ] = await Promise.all([
        api.from("leads").select("id", { count: "exact", head: true }),
        api.from("leads").select("id", { count: "exact", head: true }).gte("created_at", seteIso),
        api.from("leads").select("id", { count: "exact", head: true }).eq("status", "ganho"),
        api.from("campanhas").select("id", { count: "exact", head: true }).eq("status", "ativa"),
        api.from("campanhas").select("id", { count: "exact", head: true }),
        api.from("chat_messages").select("id", { count: "exact", head: true }).gte("created_at", hojeIso),
        api.from("chat_messages").select("created_at").gte("created_at", seteIso),
        api.from("leads").select("*").order("created_at", { ascending: false }).limit(6),
      ]);

      const totalLeads = leadsRes.count || 0;
      const leadsGanhos = ganhosRes.count || 0;
      const taxa = totalLeads > 0 ? (leadsGanhos / totalLeads) * 100 : 0;

      // serializa 7 dias
      const dias: Record<string, number> = {};
      for (let i = 0; i < 7; i++) {
        const d = new Date(hoje);
        d.setDate(d.getDate() - (6 - i));
        const k = d.toISOString().slice(0, 10);
        dias[k] = 0;
      }
      (msg7dRes.data || []).forEach((m: any) => {
        const k = (m.created_at || "").slice(0, 10);
        if (k in dias) dias[k]++;
      });
      const serie = Object.entries(dias).map(([k, total]) => ({
        dia: new Date(k).toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", ""),
        total,
      }));

      setStats({
        totalLeads,
        novosLeads7d: novos7Res.count || 0,
        leadsGanhos,
        taxaConversao: Math.round(taxa * 10) / 10,
        campanhasAtivas: campAtivasRes.count || 0,
        campanhasTotal: campTotalRes.count || 0,
        mensagensHoje: msgHojeRes.count || 0,
        mensagens7dSerie: serie,
        leadsRecentes: recentesRes.data || [],
      });
      setLastUpdated(new Date());
    } catch (error: any) {
      console.error("Dashboard error:", error);
      toast.error("Erro ao carregar indicadores", { description: error?.message });
    } finally {
      setLoadingDash(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const { data: followUpsHoje = [], isLoading: loadingFollowUps } = useQuery({
    queryKey: ["follow-ups-hoje"],
    queryFn: async () => {
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      const amanha = new Date(hoje);
      amanha.setDate(amanha.getDate() + 1);

      const { data, error } = await api
        .from("follow_ups")
        .select("*, contatos:contato_id(nomewpp, telefone)")
        .eq("status", "pendente")
        .gte("data_retorno", hoje.toISOString())
        .lt("data_retorno", amanha.toISOString())
        .order("data_retorno", { ascending: true });

      if (error) throw error;
      return data as any[];
    },
    enabled: !!user?.id,
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    await carregar();
    setRefreshing(false);
    toast.success("Dados atualizados");
  };

  const statusColor: Record<string, string> = {
    novo: "bg-info/15 text-info border-info/30",
    qualificado: "bg-warning/15 text-warning border-warning/30",
    ganho: "bg-success/15 text-success border-success/30",
    perdido: "bg-destructive/15 text-destructive border-destructive/30",
  };

  return (
    <CRMLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold tracking-tight gradient-brand-text inline-block">
              Dashboard
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Visão geral de leads, conversão, campanhas e WhatsApp
            </p>
          </div>
          <div className="flex items-center gap-3">
            {lastUpdated && (
              <span className="text-xs text-muted-foreground hidden sm:flex items-center gap-1">
                <Sparkles className="h-3 w-3" />
                Atualizado{" "}
                {lastUpdated.toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
              <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
          </div>
        </div>

        {/* Hero card — resumo do dia */}
        <Card className="relative overflow-hidden border-primary/15">
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "linear-gradient(135deg, hsl(var(--primary) / 0.18) 0%, hsl(var(--accent) / 0.14) 60%, hsl(var(--card)) 100%)",
            }}
          />
          <CardContent className="relative p-6 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-card border border-primary/20 flex items-center justify-center shadow-sm">
                <Sparkles className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h2 className="text-2xl font-bold tracking-tight">Resumo do dia</h2>
                <p className="text-sm text-muted-foreground">
                  {stats.novosLeads7d > 0
                    ? `${stats.novosLeads7d} novos leads esta semana · ${stats.mensagensHoje} mensagens hoje`
                    : "Acompanhe leads, conversão e WhatsApp em tempo real"}
                </p>
              </div>
            </div>
            <Button onClick={() => navigate("/funil")} className="gradient-brand text-white shadow-md">
              Abrir Funil <ArrowUpRight className="h-4 w-4 ml-1" />
            </Button>
          </CardContent>
        </Card>

        {/* KPIs principais */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            title="Total de Leads"
            value={stats.totalLeads}
            hint={`+${stats.novosLeads7d} nos últimos 7 dias`}
            icon={Users}
            tone="primary"
            loading={loadingDash}
          />
          <KpiCard
            title="Taxa de Conversão"
            value={`${stats.taxaConversao}%`}
            hint={`${stats.leadsGanhos} leads ganhos`}
            icon={TrendingUp}
            tone="success"
            loading={loadingDash}
          />
          <KpiCard
            title="Campanhas Ativas"
            value={stats.campanhasAtivas}
            hint={`de ${stats.campanhasTotal} no total`}
            icon={Megaphone}
            tone="accent"
            loading={loadingDash}
          />
          <KpiCard
            title="Mensagens Hoje"
            value={stats.mensagensHoje}
            hint="WhatsApp + IA"
            icon={MessageCircle}
            tone="info"
            loading={loadingDash}
          />
        </div>

        {/* Gráfico + Follow-ups */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <MessageCircle className="h-4 w-4 text-info" />
                  Mensagens WhatsApp — últimos 7 dias
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() => navigate("/whatsapp")}
                >
                  Abrir WhatsApp <ExternalLink className="h-3 w-3 ml-1" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {loadingDash ? (
                <Skeleton className="h-[220px] w-full" />
              ) : (
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={stats.mensagens7dSerie}>
                      <defs>
                        <linearGradient id="msgGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis
                        dataKey="dia"
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                        width={28}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                        labelStyle={{ color: "hsl(var(--foreground))" }}
                      />
                      <Area
                        type="monotone"
                        dataKey="total"
                        stroke="hsl(var(--primary))"
                        strokeWidth={2}
                        fill="url(#msgGradient)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-warning/20">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold flex items-center gap-2 text-warning">
                  <Clock className="h-4 w-4" />
                  Follow-ups de Hoje
                </CardTitle>
                <Badge variant="secondary" className="bg-warning/10 text-warning border-warning/20">
                  {followUpsHoje.length}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {loadingFollowUps ? (
                <div className="space-y-3">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : followUpsHoje.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground">
                  <CheckCircle2 className="h-8 w-8 mx-auto mb-2 opacity-20" />
                  <p className="text-sm">Tudo em dia para hoje!</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[220px] overflow-auto">
                  {followUpsHoje.map((fu) => (
                    <div
                      key={fu.id}
                      className="flex items-center justify-between p-3 rounded-lg border bg-card/50 hover:bg-card transition-colors cursor-pointer group"
                      onClick={() => navigate(`/contatos/${fu.contato_id}`)}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-warning/10 flex items-center justify-center shrink-0">
                          <Clock className="w-4 h-4 text-warning" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">
                            {fu.contatos?.nomewpp || "Contato"}
                          </p>
                          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <CalendarDays className="w-3 h-3" />
                            {new Date(fu.data_retorno).toLocaleTimeString("pt-BR", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Leads recentes */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                Leads Recentes
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => navigate("/leads")} className="text-xs">
                Ver todos <ExternalLink className="h-3 w-3 ml-1" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {loadingDash ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
            ) : stats.leadsRecentes.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">
                <Users className="h-8 w-8 mx-auto mb-2 opacity-20" />
                <p className="text-sm">Nenhum lead cadastrado ainda.</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => navigate("/leads")}
                >
                  Criar primeiro lead
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {stats.leadsRecentes.map((l) => (
                  <div
                    key={l.id}
                    className="p-3 rounded-lg border bg-card/50 hover:bg-card hover:border-primary/30 transition-all cursor-pointer group"
                    onClick={() => navigate(`/leads`)}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <p className="font-medium text-sm truncate flex-1">
                        {l.nome || l.nomewpp || "Sem nome"}
                      </p>
                      <Badge
                        variant="outline"
                        className={`text-[10px] uppercase ${statusColor[l.status] || ""}`}
                      >
                        {l.status || "novo"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {l.telefone || l.email || "—"}
                    </p>
                    {l.origem && (
                      <p className="text-[10px] text-muted-foreground mt-1">
                        via {l.origem}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </CRMLayout>
  );
}
