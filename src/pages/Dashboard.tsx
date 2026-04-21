import { useCallback, useEffect, useState } from "react";
import { CRMLayout } from "@/components/CRMLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import {
  Users,
  UserPlus,
  Headphones,
  CheckCircle2,
  TrendingUp,
  DollarSign,
  Megaphone,
  MessageCircle,
  Activity,
  RefreshCw,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
} from "recharts";

const COLORS = [
  "hsl(217,91%,55%)",
  "hsl(24,95%,53%)",
  "hsl(142,70%,45%)",
  "hsl(38,92%,55%)",
  "hsl(280,70%,55%)",
  "hsl(0,84%,60%)",
  "hsl(180,60%,45%)",
];

interface DashboardStats {
  totalLeads: number;
  novosHoje: number;
  emAtendimento: number;
  convertidos: number;
  taxaConversao: number;
  custoMedioLead: number;
  campanhasAtivas: number;
  mensagensWhatsApp: number;
  atendimentosAndamento: number;
  leadsPorOrigem: { origem: string; quantidade: number }[];
  evolucaoSemanal: { semana: string; leads: number; conversoes: number }[];
  conversaoPorEtapa: { etapa: string; total: number }[];
  rankingCampanhas: {
    id: string;
    nome: string;
    leads_gerados: number;
    cpl: number;
    status: string;
  }[];
}

const initialStats: DashboardStats = {
  totalLeads: 0,
  novosHoje: 0,
  emAtendimento: 0,
  convertidos: 0,
  taxaConversao: 0,
  custoMedioLead: 0,
  campanhasAtivas: 0,
  mensagensWhatsApp: 0,
  atendimentosAndamento: 0,
  leadsPorOrigem: [],
  evolucaoSemanal: [],
  conversaoPorEtapa: [],
  rankingCampanhas: [],
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

function EmptyChart({ msg = "Sem dados ainda" }: { msg?: string }) {
  return (
    <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
      {msg}
    </div>
  );
}

function startOfWeek(d: Date) {
  const date = new Date(d);
  const day = (date.getDay() + 6) % 7; // segunda = 0
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - day);
  return date;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState<DashboardStats>(initialStats);
  const [loadingDash, setLoadingDash] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const carregar = useCallback(async () => {
    if (!user) return;
    setLoadingDash(true);

    const hojeIso = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
    const seteDiasAtrasIso = new Date(
      Date.now() - 7 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const quatroSemanasAtras = startOfWeek(
      new Date(Date.now() - 21 * 24 * 60 * 60 * 1000),
    );

    const [
      contatosRes,
      campanhasRes,
      chatRes,
      chamadasRes,
    ] = await Promise.all([
      supabase
        .from("contatos")
        .select("origem, status, created_at")
        .eq("user_id", user.id),
      supabase
        .from("campanhas")
        .select("id, nome, status, leads_gerados, cpl")
        .eq("user_id", user.id),
      // tabela sem user_id — dados globais
      supabase
        .from("n8n_chat_histories")
        .select("id", { count: "exact", head: true })
        .gte("created_at", seteDiasAtrasIso),
      supabase
        .from("chamadas")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .gte("created_at", hojeIso),
    ]);

    const contatos = contatosRes.data ?? [];
    const campanhas = campanhasRes.data ?? [];

    const totalLeads = contatos.length;
    const novosHoje = contatos.filter(
      (c) => new Date(c.created_at) >= new Date(hojeIso),
    ).length;
    const convertidos = contatos.filter((c) => c.status === "fechado").length;
    const emAtendimento = contatos.filter(
      (c) => c.status !== "fechado" && c.status !== "perdido",
    ).length;
    const taxaConversao =
      totalLeads > 0 ? Number(((convertidos / totalLeads) * 100).toFixed(1)) : 0;

    const origemMap = new Map<string, number>();
    contatos.forEach((c) => {
      const o = c.origem ?? "Sem origem";
      origemMap.set(o, (origemMap.get(o) ?? 0) + 1);
    });
    const leadsPorOrigem = Array.from(origemMap, ([origem, quantidade]) => ({
      origem,
      quantidade,
    }));

    const etapaMap = new Map<string, number>();
    contatos.forEach((c) => {
      etapaMap.set(c.status, (etapaMap.get(c.status) ?? 0) + 1);
    });
    const conversaoPorEtapa = Array.from(etapaMap, ([etapa, total]) => ({
      etapa,
      total,
    }));

    const campanhasAtivas = campanhas.filter((c) => c.status === "ativa").length;
    const cplValores = campanhas
      .map((c) => Number(c.cpl) || 0)
      .filter((v) => v > 0);
    const custoMedioLead =
      cplValores.length > 0
        ? Number(
            (
              cplValores.reduce((s, v) => s + v, 0) / cplValores.length
            ).toFixed(2),
          )
        : 0;

    const rankingCampanhas = [...campanhas]
      .sort((a, b) => (b.leads_gerados ?? 0) - (a.leads_gerados ?? 0))
      .slice(0, 5)
      .map((c) => ({
        id: c.id,
        nome: c.nome,
        leads_gerados: c.leads_gerados ?? 0,
        cpl: Number(c.cpl) || 0,
        status: c.status,
      }));

    // Evolução semanal — últimas 4 semanas
    const semanas: { semana: string; leads: number; conversoes: number }[] = [];
    for (let i = 3; i >= 0; i--) {
      const inicio = startOfWeek(
        new Date(Date.now() - i * 7 * 24 * 60 * 60 * 1000),
      );
      const fim = new Date(inicio);
      fim.setDate(fim.getDate() + 7);
      const leadsSem = contatos.filter((c) => {
        const d = new Date(c.created_at);
        return d >= inicio && d < fim;
      }).length;
      const convSem = contatos.filter((c) => {
        const d = new Date(c.created_at);
        return c.status === "fechado" && d >= inicio && d < fim;
      }).length;
      semanas.push({
        semana: inicio.toLocaleDateString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
        }),
        leads: leadsSem,
        conversoes: convSem,
      });
    }
    // suprime warning unused
    void quatroSemanasAtras;

    setStats({
      totalLeads,
      novosHoje,
      emAtendimento,
      convertidos,
      taxaConversao,
      custoMedioLead,
      campanhasAtivas,
      mensagensWhatsApp: chatRes.count ?? 0,
      atendimentosAndamento: chamadasRes.count ?? 0,
      leadsPorOrigem,
      conversaoPorEtapa,
      evolucaoSemanal: semanas,
      rankingCampanhas,
    });
    setLastUpdated(new Date());
    setLoadingDash(false);
  }, [user]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await carregar();
    setRefreshing(false);
    toast.success("Dados atualizados");
  };

  const d = stats;

  return (
    <CRMLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
            <p className="text-muted-foreground text-sm">
              Visão geral da operação comercial
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
                className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
              />
              Atualizar
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <KpiCard
            title="Total de Leads"
            value={d.totalLeads}
            icon={Users}
            accent
            loading={loadingDash}
          />
          <KpiCard
            title="Novos Hoje"
            value={d.novosHoje}
            icon={UserPlus}
            loading={loadingDash}
          />
          <KpiCard
            title="Em Atendimento"
            value={d.emAtendimento}
            icon={Headphones}
            loading={loadingDash}
          />
          <KpiCard
            title="Convertidos"
            value={d.convertidos}
            icon={CheckCircle2}
            loading={loadingDash}
          />
          <KpiCard
            title="Taxa de Conversão"
            value={`${d.taxaConversao}%`}
            icon={TrendingUp}
            accent
            loading={loadingDash}
          />
          <KpiCard
            title="CPL Médio"
            value={`R$ ${d.custoMedioLead.toLocaleString("pt-BR")}`}
            icon={DollarSign}
            loading={loadingDash}
          />
          <KpiCard
            title="Campanhas Ativas"
            value={d.campanhasAtivas}
            icon={Megaphone}
            loading={loadingDash}
          />
          <KpiCard
            title="Msgs WhatsApp"
            value={d.mensagensWhatsApp}
            icon={MessageCircle}
            loading={loadingDash}
          />
          <KpiCard
            title="Atendimentos"
            value={d.atendimentosAndamento}
            icon={Activity}
            loading={loadingDash}
          />
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Evolução Semanal</CardTitle>
            </CardHeader>
            <CardContent className="h-72">
              {d.evolucaoSemanal.every((s) => s.leads === 0 && s.conversoes === 0) ? (
                <EmptyChart />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={d.evolucaoSemanal}>
                    <defs>
                      <linearGradient id="colorLeads" x1="0" y1="0" x2="0" y2="1">
                        <stop
                          offset="5%"
                          stopColor="hsl(217,91%,55%)"
                          stopOpacity={0.3}
                        />
                        <stop
                          offset="95%"
                          stopColor="hsl(217,91%,55%)"
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,20%,20%)" />
                    <XAxis dataKey="semana" stroke="hsl(220,10%,55%)" fontSize={12} />
                    <YAxis stroke="hsl(220,10%,55%)" fontSize={12} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(222,25%,11%)",
                        border: "1px solid hsl(220,20%,18%)",
                        borderRadius: "8px",
                        color: "hsl(220,15%,90%)",
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="leads"
                      stroke="hsl(217,91%,55%)"
                      fillOpacity={1}
                      fill="url(#colorLeads)"
                      strokeWidth={2}
                    />
                    <Area
                      type="monotone"
                      dataKey="conversoes"
                      stroke="hsl(24,95%,53%)"
                      fill="none"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Leads por Origem</CardTitle>
            </CardHeader>
            <CardContent className="h-72">
              {d.leadsPorOrigem.length === 0 ? (
                <EmptyChart />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={d.leadsPorOrigem}
                      dataKey="quantidade"
                      nameKey="origem"
                      cx="50%"
                      cy="50%"
                      outerRadius={90}
                      label={({ name, percent }: any) =>
                        `${name} ${(percent * 100).toFixed(0)}%`
                      }
                      labelLine={false}
                      fontSize={11}
                    >
                      {d.leadsPorOrigem.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(222,25%,11%)",
                        border: "1px solid hsl(220,20%,18%)",
                        borderRadius: "8px",
                        color: "hsl(220,15%,90%)",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Conversão por Etapa (Funil)</CardTitle>
            </CardHeader>
            <CardContent className="h-72">
              {d.conversaoPorEtapa.length === 0 ? (
                <EmptyChart />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.conversaoPorEtapa} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,20%,20%)" />
                    <XAxis type="number" stroke="hsl(220,10%,55%)" fontSize={12} />
                    <YAxis
                      dataKey="etapa"
                      type="category"
                      stroke="hsl(220,10%,55%)"
                      fontSize={11}
                      width={80}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(222,25%,11%)",
                        border: "1px solid hsl(220,20%,18%)",
                        borderRadius: "8px",
                        color: "hsl(220,15%,90%)",
                      }}
                    />
                    <Bar dataKey="total" fill="hsl(217,91%,55%)" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ranking de Campanhas</CardTitle>
            </CardHeader>
            <CardContent>
              {d.rankingCampanhas.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  Sem dados ainda
                </div>
              ) : (
                <div className="space-y-3">
                  {d.rankingCampanhas.map((c, i) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between py-2 border-b border-border last:border-0"
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-6 h-6 rounded-full bg-primary/15 text-primary text-xs font-bold flex items-center justify-center">
                          {i + 1}
                        </span>
                        <div>
                          <p className="text-sm font-medium">{c.nome}</p>
                          <p className="text-xs text-muted-foreground">
                            {c.leads_gerados} leads · CPL R${" "}
                            {c.cpl.toLocaleString("pt-BR")}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          c.status === "ativa"
                            ? "bg-success/15 text-success"
                            : c.status === "pausada"
                            ? "bg-warning/15 text-warning"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {c.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </CRMLayout>
  );
}
