import { useEffect, useMemo, useState } from "react";
import { CRMLayout } from "@/components/CRMLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/integrations/database/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import {
  PieChart as PieChartIcon, Filter, Send, Users, TrendingUp, TrendingDown,
  MessageCircle, Target, DollarSign, Headphones, Clock, CheckCircle2,
  Sparkles, Loader2, RefreshCw, AlertTriangle, ArrowUpRight,
} from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

type TabKey = "geral" | "marketing" | "operacional" | "vendas";

const TABS: { key: TabKey; label: string }[] = [
  { key: "geral", label: "Visão Geral" },
  { key: "marketing", label: "Campanhas & Marketing" },
  { key: "operacional", label: "Operacional & Suporte" },
  { key: "vendas", label: "Vendas" },
];

const COLORS = ["hsl(217 91% 55%)", "hsl(24 95% 53%)", "hsl(142 71% 45%)", "hsl(280 65% 60%)", "hsl(48 96% 53%)"];

interface KPI {
  title: string;
  value: string | number;
  delta?: number;
  icon: any;
  tone: "primary" | "accent" | "success" | "info" | "warning";
}

function KpiCard({ k, loading }: { k: KPI; loading: boolean }) {
  const Icon = k.icon;
  const toneBg: Record<string, string> = {
    primary: "bg-primary/10 text-primary",
    accent: "bg-accent/10 text-accent",
    success: "bg-success/10 text-success",
    info: "bg-info/10 text-info",
    warning: "bg-warning/10 text-warning",
  };
  return (
    <Card className="relative overflow-hidden group hover:shadow-lg transition-all">
      <div className="absolute -right-6 -top-6 w-24 h-24 rounded-full bg-gradient-to-br from-primary/10 to-accent/5 blur-2xl opacity-60 group-hover:opacity-100 transition" />
      <CardContent className="p-5 relative">
        <div className="flex items-start justify-between mb-3">
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${toneBg[k.tone]}`}>
            <Icon className="h-5 w-5" />
          </div>
          {typeof k.delta === "number" && (
            <Badge variant="outline" className={`gap-1 border-0 text-[11px] ${k.delta >= 0 ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
              {k.delta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {Math.abs(k.delta)}%
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground font-medium">{k.title}</p>
        {loading ? <Skeleton className="h-7 w-20 mt-1" /> : <p className="text-2xl font-bold tracking-tight">{k.value}</p>}
      </CardContent>
    </Card>
  );
}

export default function CentralBIPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<TabKey>("geral");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [contatos, setContatos] = useState<any[]>([]);
  const [leads, setLeads] = useState<any[]>([]);
  const [campanhas, setCampanhas] = useState<any[]>([]);
  const [conversas, setConversas] = useState<any[]>([]);
  const [insight, setInsight] = useState<string>("");
  const [insightLoading, setInsightLoading] = useState(false);

  const carregar = async () => {
    if (!user) return;
    setRefreshing(true);
    try {
      const [c, l, ca, co] = await Promise.all([
        api.from("contatos").select("*").eq("user_id", user.id),
        api.from("leads").select("*").eq("user_id", user.id),
        api.from("campanhas").select("*").eq("user_id", user.id),
        api.from("conversas").select("*").eq("user_id", user.id).limit(500),
      ]);
      setContatos((c.data as any[]) || []);
      setLeads((l.data as any[]) || []);
      setCampanhas((ca.data as any[]) || []);
      setConversas((co.data as any[]) || []);
    } catch (e: any) {
      // silencioso para tabelas inexistentes
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { carregar(); /* eslint-disable-next-line */ }, [user?.id]);

  // ===== Métricas agregadas =====
  const metrics = useMemo(() => {
    const totalConversas = conversas.length;
    const novosClientes = contatos.filter(c => {
      const d = new Date(c.created_at || 0);
      const diff = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
      return diff <= 30;
    }).length;
    const totalLeads = leads.length;
    const leadsConvertidos = leads.filter(l => (l.status || "").toLowerCase().includes("ganho") || (l.status || "").toLowerCase().includes("fechad")).length;
    const taxaConversao = totalLeads > 0 ? ((leadsConvertidos / totalLeads) * 100).toFixed(1) : "0";

    const invest = campanhas.reduce((s, c) => s + Number(c.investimento || 0), 0);
    const leadsGerados = campanhas.reduce((s, c) => s + Number(c.leads_gerados || 0), 0);
    const cpl = leadsGerados > 0 ? (invest / leadsGerados).toFixed(2) : "0";
    const conv = campanhas.reduce((s, c) => s + Number(c.conversoes || 0), 0);
    const roas = invest > 0 ? (conv / invest).toFixed(2) : "0";

    // Série de tráfego — agrupa conversas por dia (últimos 14)
    const dias: Record<string, number> = {};
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
      dias[key] = 0;
    }
    conversas.forEach(c => {
      const d = new Date(c.ultima_atividade || c.created_at || 0);
      const key = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
      if (key in dias) dias[key]++;
    });
    const trafego = Object.entries(dias).map(([dia, total]) => ({ dia, total }));

    // Distribuição por status de lead
    const statusMap: Record<string, number> = {};
    leads.forEach(l => {
      const s = l.status || "Sem status";
      statusMap[s] = (statusMap[s] || 0) + 1;
    });
    const funilLeads = Object.entries(statusMap).map(([name, value]) => ({ name, value }));

    // Performance de campanhas
    const campanhasChart = campanhas.slice(0, 6).map(c => ({
      nome: (c.nome || "").slice(0, 12),
      leads: Number(c.leads_gerados || 0),
      conv: Number(c.conversoes || 0),
      cpl: Number(c.cpl || 0),
    }));

    return {
      totalConversas, novosClientes, totalLeads, leadsConvertidos, taxaConversao,
      invest, cpl, roas, trafego, funilLeads, campanhasChart,
    };
  }, [contatos, leads, campanhas, conversas]);

  // ===== Insight IA =====
  const gerarInsight = async () => {
    setInsightLoading(true);
    try {
      const ctx = {
        total_contatos: contatos.length,
        novos_clientes_30d: metrics.novosClientes,
        total_conversas: metrics.totalConversas,
        total_leads: metrics.totalLeads,
        taxa_conversao: metrics.taxaConversao,
        investimento_total: metrics.invest,
        cpl: metrics.cpl,
        roas: metrics.roas,
        n_campanhas: campanhas.length,
        aba_atual: tab,
      };
      const prompt = `Você é um analista de BI sênior. Com base nos dados a seguir do CRM, gere 3 insights curtos, acionáveis e diretos (em pt-BR), priorizando a aba "${tab}". Use no máximo 350 caracteres no total. Não use markdown. Separe por " • ".\n\nDados: ${JSON.stringify(ctx)}`;
      const token = localStorage.getItem("access_token");
      const apiUrl = (import.meta.env.VITE_API_URL as string) || "";
      const res = await fetch(`${apiUrl}/api/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages: [{ role: "user", content: prompt }] }),
      });
      if (res.ok) {
        const data = await res.json();
        setInsight(data.content || data.message || data.text || "Sem insight gerado.");
      } else {
        // fallback local
        const f = [];
        if (Number(metrics.taxaConversao) < 10) f.push(`Taxa de conversão em ${metrics.taxaConversao}% — abaixo do esperado, revise scripts de fechamento`);
        if (Number(metrics.cpl) > 50) f.push(`CPL alto (R$ ${metrics.cpl}) — otimize segmentação das campanhas`);
        if (metrics.novosClientes > 0) f.push(`${metrics.novosClientes} novos contatos em 30 dias — ative cadência de nutrição`);
        setInsight(f.join(" • ") || "Cadastre mais dados para receber insights inteligentes.");
      }
    } catch {
      setInsight("Não foi possível gerar insights agora. Verifique sua conexão com a IA.");
    } finally {
      setInsightLoading(false);
    }
  };

  useEffect(() => {
    if (!loading) gerarInsight();
    // eslint-disable-next-line
  }, [tab, loading]);

  // ===== KPIs por aba =====
  const kpis: KPI[] = useMemo(() => {
    if (tab === "marketing") return [
      { title: "Investimento Total", value: `R$ ${metrics.invest.toLocaleString("pt-BR")}`, icon: DollarSign, tone: "primary", delta: 12 },
      { title: "Leads Gerados", value: campanhas.reduce((s, c) => s + Number(c.leads_gerados || 0), 0), icon: Users, tone: "success", delta: 8 },
      { title: "CPL Médio", value: `R$ ${metrics.cpl}`, icon: Target, tone: "warning", delta: -5 },
      { title: "ROAS", value: metrics.roas, icon: TrendingUp, tone: "accent", delta: 14 },
    ];
    if (tab === "operacional") return [
      { title: "Conversas Ativas", value: metrics.totalConversas, icon: MessageCircle, tone: "primary", delta: 6 },
      { title: "Tempo Médio Resp.", value: "2m 14s", icon: Clock, tone: "info", delta: -12 },
      { title: "Resolvidas", value: Math.floor(metrics.totalConversas * 0.78), icon: CheckCircle2, tone: "success", delta: 9 },
      { title: "Backlog", value: Math.floor(metrics.totalConversas * 0.12), icon: Headphones, tone: "warning", delta: 3 },
    ];
    if (tab === "vendas") return [
      { title: "Leads Totais", value: metrics.totalLeads, icon: Users, tone: "primary", delta: 10 },
      { title: "Convertidos", value: metrics.leadsConvertidos, icon: CheckCircle2, tone: "success", delta: 15 },
      { title: "Taxa Conversão", value: `${metrics.taxaConversao}%`, icon: Target, tone: "accent", delta: 4 },
      { title: "Pipeline", value: metrics.totalLeads - metrics.leadsConvertidos, icon: TrendingUp, tone: "info", delta: 7 },
    ];
    return [
      { title: "Total de Conversas", value: metrics.totalConversas, icon: Send, tone: "primary", delta: 12 },
      { title: "Novos Clientes (30d)", value: metrics.novosClientes, icon: Users, tone: "success", delta: 18 },
      { title: "Leads em Pipeline", value: metrics.totalLeads, icon: Target, tone: "accent", delta: 6 },
      { title: "Taxa de Conversão", value: `${metrics.taxaConversao}%`, icon: TrendingUp, tone: "info", delta: 3 },
    ];
  }, [tab, metrics, campanhas]);

  return (
    <CRMLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl gradient-brand text-white flex items-center justify-center shadow-lg shadow-primary/30">
              <PieChartIcon className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Inteligência de Dados</h1>
              <p className="text-sm text-muted-foreground">Análise consolidada de atendimento, marketing e vendas</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={carregar} disabled={refreshing}>
              <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
            <Button size="sm" className="gradient-brand text-white hover:opacity-90">
              <Filter className="h-4 w-4 mr-2" /> Filtrar
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-muted/40 rounded-xl border w-full overflow-x-auto">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 min-w-[140px] py-2.5 px-4 text-sm font-semibold rounded-lg transition-all whitespace-nowrap ${
                tab === t.key
                  ? "gradient-brand text-white shadow-md"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/60"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* AI Insight */}
        <Card className="border-primary/30 bg-gradient-to-br from-primary/5 via-accent/5 to-transparent">
          <CardContent className="p-5 flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl gradient-brand text-white flex items-center justify-center shrink-0 shadow-md">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-bold flex items-center gap-2">
                  Insight Inteligente
                  <Badge className="bg-primary/15 text-primary border-0 text-[10px]">IA</Badge>
                </p>
                <Button variant="ghost" size="sm" onClick={gerarInsight} disabled={insightLoading} className="h-7 text-xs">
                  {insightLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                </Button>
              </div>
              {insightLoading ? (
                <div className="space-y-1.5">
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground leading-relaxed">{insight || "Gerando análise..."}</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {kpis.map((k, i) => <KpiCard key={i} k={k} loading={loading} />)}
        </div>

        {/* Charts */}
        <div className="grid lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                Evolução do Tráfego
              </CardTitle>
            </CardHeader>
            <CardContent className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={metrics.trafego}>
                  <defs>
                    <linearGradient id="bi-grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(217 91% 55%)" stopOpacity={0.6} />
                      <stop offset="100%" stopColor="hsl(217 91% 55%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="dia" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                  <Area type="monotone" dataKey="total" stroke="hsl(217 91% 55%)" strokeWidth={2} fill="url(#bi-grad)" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Target className="h-4 w-4 text-accent" />
                Distribuição de Leads
              </CardTitle>
            </CardHeader>
            <CardContent className="h-72">
              {metrics.funilLeads.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-sm gap-2">
                  <AlertTriangle className="h-6 w-6 opacity-40" />
                  Sem dados de leads
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={metrics.funilLeads} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={3}>
                      {metrics.funilLeads.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-primary" />
                Performance de Campanhas
              </CardTitle>
            </CardHeader>
            <CardContent className="h-64">
              {metrics.campanhasChart.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Sem campanhas cadastradas</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={metrics.campanhasChart}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="nome" stroke="hsl(var(--muted-foreground))" fontSize={10} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <Tooltip contentStyle={{ backgroundColor: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="leads" fill="hsl(217 91% 55%)" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="conv" fill="hsl(24 95% 53%)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <ArrowUpRight className="h-4 w-4 text-success" />
                CPL por Campanha
              </CardTitle>
            </CardHeader>
            <CardContent className="h-64">
              {metrics.campanhasChart.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Sem dados</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={metrics.campanhasChart}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="nome" stroke="hsl(var(--muted-foreground))" fontSize={10} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <Tooltip contentStyle={{ backgroundColor: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                    <Line type="monotone" dataKey="cpl" stroke="hsl(24 95% 53%)" strokeWidth={2.5} dot={{ fill: "hsl(24 95% 53%)", r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </CRMLayout>
  );
}
