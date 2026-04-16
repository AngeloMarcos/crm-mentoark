import { CRMLayout } from "@/components/CRMLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { dashboardData, mockCampanhas } from "@/data/mockData";
import {
  Users, UserPlus, Headphones, CheckCircle2, TrendingUp, DollarSign, Megaphone,
  MessageCircle, Activity,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, PieChart, Pie, Cell, FunnelChart, Funnel, LabelList,
} from "recharts";

const COLORS = ["hsl(217,91%,55%)", "hsl(24,95%,53%)", "hsl(142,70%,45%)", "hsl(38,92%,55%)", "hsl(280,70%,55%)", "hsl(0,84%,60%)", "hsl(180,60%,45%)"];

function KpiCard({ title, value, icon: Icon, accent }: { title: string; value: string | number; icon: any; accent?: boolean }) {
  return (
    <Card className={`${accent ? "glow-primary border-primary/30" : ""}`}>
      <CardContent className="flex items-center gap-4 p-5">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${accent ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
          <Icon className="h-6 w-6" />
        </div>
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="text-2xl font-bold tracking-tight">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const d = dashboardData;

  return (
    <CRMLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground text-sm">Visão geral da operação comercial</p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <KpiCard title="Total de Leads" value={d.totalLeads} icon={Users} accent />
          <KpiCard title="Novos Hoje" value={d.novosHoje} icon={UserPlus} />
          <KpiCard title="Em Atendimento" value={d.emAtendimento} icon={Headphones} />
          <KpiCard title="Convertidos" value={d.convertidos} icon={CheckCircle2} />
          <KpiCard title="Taxa de Conversão" value={`${d.taxaConversao}%`} icon={TrendingUp} accent />
          <KpiCard title="CPL Médio" value={`R$ ${d.custoMedioLead}`} icon={DollarSign} />
          <KpiCard title="Campanhas Ativas" value={d.campanhasAtivas} icon={Megaphone} />
          <KpiCard title="Msgs WhatsApp" value={d.mensagensWhatsApp} icon={MessageCircle} />
          <KpiCard title="Atendimentos" value={d.atendimentosAndamento} icon={Activity} />
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Evolução Semanal</CardTitle></CardHeader>
            <CardContent className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={d.evolucaoSemanal}>
                  <defs>
                    <linearGradient id="colorLeads" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(217,91%,55%)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(217,91%,55%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,20%,20%)" />
                  <XAxis dataKey="semana" stroke="hsl(220,10%,55%)" fontSize={12} />
                  <YAxis stroke="hsl(220,10%,55%)" fontSize={12} />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(222,25%,11%)", border: "1px solid hsl(220,20%,18%)", borderRadius: "8px", color: "hsl(220,15%,90%)" }} />
                  <Area type="monotone" dataKey="leads" stroke="hsl(217,91%,55%)" fillOpacity={1} fill="url(#colorLeads)" strokeWidth={2} />
                  <Area type="monotone" dataKey="conversoes" stroke="hsl(24,95%,53%)" fill="none" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Leads por Origem</CardTitle></CardHeader>
            <CardContent className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={d.leadsPorOrigem} dataKey="quantidade" nameKey="origem" cx="50%" cy="50%" outerRadius={90} label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={11}>
                    {d.leadsPorOrigem.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: "hsl(222,25%,11%)", border: "1px solid hsl(220,20%,18%)", borderRadius: "8px", color: "hsl(220,15%,90%)" }} />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Conversão por Etapa (Funil)</CardTitle></CardHeader>
            <CardContent className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.conversaoPorEtapa} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,20%,20%)" />
                  <XAxis type="number" stroke="hsl(220,10%,55%)" fontSize={12} />
                  <YAxis dataKey="etapa" type="category" stroke="hsl(220,10%,55%)" fontSize={11} width={80} />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(222,25%,11%)", border: "1px solid hsl(220,20%,18%)", borderRadius: "8px", color: "hsl(220,15%,90%)" }} />
                  <Bar dataKey="total" fill="hsl(217,91%,55%)" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Ranking de Campanhas</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {mockCampanhas.sort((a, b) => b.leads_gerados - a.leads_gerados).slice(0, 5).map((c, i) => (
                  <div key={c.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                    <div className="flex items-center gap-3">
                      <span className="w-6 h-6 rounded-full bg-primary/15 text-primary text-xs font-bold flex items-center justify-center">{i + 1}</span>
                      <div>
                        <p className="text-sm font-medium">{c.nome}</p>
                        <p className="text-xs text-muted-foreground">{c.leads_gerados} leads · CPL R$ {c.cpl}</p>
                      </div>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.status === "ativa" ? "bg-success/15 text-success" : c.status === "pausada" ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground"}`}>
                      {c.status}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </CRMLayout>
  );
}
