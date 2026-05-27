// src/pages/UsoIA.tsx
// Dashboard de uso do Motor de IA nativo.
// Consome /api/ia/uso e /api/ia/execucoes. Quando o backend ainda não
// existe (404), mostra um empty state explicando que está aguardando.

import { useMemo, useState } from "react";
import { CRMLayout } from "@/components/CRMLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Activity,
  Coins,
  MessageCircle,
  Hourglass,
  RefreshCw,
  Mic,
  Image as ImageIcon,
  Type,
  Video,
  ServerCog,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { useUltimasExecucoes, useUsoIA } from "@/hooks/useUsoIA";

const RANGES = [
  { id: "7",  label: "Últimos 7 dias"  },
  { id: "30", label: "Últimos 30 dias" },
  { id: "90", label: "Últimos 90 dias" },
];

const COLORS_MODALIDADE: Record<string, string> = {
  texto:  "hsl(var(--primary))",
  audio:  "hsl(var(--accent))",
  imagem: "hsl(var(--success))",
  video:  "hsl(var(--warning))",
};

function fmtBRL(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 4 });
}

function fmtInt(n: number) {
  return n.toLocaleString("pt-BR");
}

function modalidadeIcon(m: string) {
  switch (m) {
    case "audio":  return <Mic className="h-3.5 w-3.5" />;
    case "imagem": return <ImageIcon className="h-3.5 w-3.5" />;
    case "video":  return <Video className="h-3.5 w-3.5" />;
    default:       return <Type className="h-3.5 w-3.5" />;
  }
}

export default function UsoIAPage() {
  const [rangeDias, setRangeDias] = useState("30");

  const { from, to } = useMemo(() => {
    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - Number(rangeDias));
    return { from: fromDate.toISOString(), to: toDate.toISOString() };
  }, [rangeDias]);

  const { data, loading, aguardandoBackend, reload } = useUsoIA({ from, to });
  const { items: execucoes, loading: loadingExec } = useUltimasExecucoes({ limit: 20 });

  const cards = [
    {
      label: "Mensagens",
      value: fmtInt(data.mensagens),
      icon: MessageCircle,
      hint: `nos últimos ${rangeDias} dias`,
    },
    {
      label: "Tokens (entrada)",
      value: fmtInt(data.tokens_in),
      icon: Activity,
      hint: "tokens de prompt",
    },
    {
      label: "Tokens (saída)",
      value: fmtInt(data.tokens_out),
      icon: Hourglass,
      hint: "tokens gerados",
    },
    {
      label: "Custo estimado",
      value: fmtBRL(data.custo_brl),
      icon: Coins,
      hint: "soma do período",
    },
  ];

  return (
    <CRMLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
              <ServerCog className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Uso de IA</h1>
              <p className="text-muted-foreground text-sm">
                Consumo do motor nativo — tokens, custo e modalidades
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select value={rangeDias} onValueChange={setRangeDias}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RANGES.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={reload} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {aguardandoBackend && (
          <Card className="border-dashed">
            <CardContent className="py-6 flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-muted text-muted-foreground flex items-center justify-center shrink-0">
                <ServerCog className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <p className="font-semibold">Aguardando backend do motor nativo</p>
                <p className="text-sm text-muted-foreground">
                  Os endpoints <code>GET /api/ia/uso</code> e <code>GET /api/ia/execucoes</code> ainda
                  não estão disponíveis. Assim que forem implementados no servidor, esta tela mostrará
                  os dados reais automaticamente.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {cards.map((c) => (
            <Card key={c.label}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">{c.label}</p>
                  <c.icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <p className="text-2xl font-bold tabular-nums">{c.value}</p>
                <p className="text-xs text-muted-foreground">{c.hint}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Tokens por dia</CardTitle>
            </CardHeader>
            <CardContent className="h-72">
              {data.por_dia.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                  Sem dados no período.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.por_dia}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="dia" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--popover))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="tokens"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Por modalidade</CardTitle>
            </CardHeader>
            <CardContent className="h-72">
              {data.por_modalidade.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                  Sem dados.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data.por_modalidade}
                      dataKey="count"
                      nameKey="modalidade"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                    >
                      {data.por_modalidade.map((entry, i) => (
                        <Cell
                          key={i}
                          fill={COLORS_MODALIDADE[entry.modalidade] ?? "hsl(var(--muted-foreground))"}
                        />
                      ))}
                    </Pie>
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--popover))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Últimas execuções</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {execucoes.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                {loadingExec ? "Carregando..." : "Nenhuma execução registrada ainda."}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Quando</TableHead>
                    <TableHead>Agente</TableHead>
                    <TableHead>Provedor / Modelo</TableHead>
                    <TableHead>Modalidade</TableHead>
                    <TableHead className="text-right">Tokens (in/out)</TableHead>
                    <TableHead className="text-right">Custo</TableHead>
                    <TableHead className="text-right">Latência</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {execucoes.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="text-xs whitespace-nowrap">
                        {new Date(e.created_at).toLocaleString("pt-BR")}
                      </TableCell>
                      <TableCell className="text-sm">{e.agente_nome}</TableCell>
                      <TableCell className="text-xs">
                        <Badge variant="outline">{e.provider}</Badge>{" "}
                        <span className="text-muted-foreground">{e.modelo}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="gap-1">
                          {modalidadeIcon(e.modalidade)}
                          <span className="text-xs capitalize">{e.modalidade}</span>
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {fmtInt(e.tokens_in)} / {fmtInt(e.tokens_out)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {fmtBRL(e.custo_brl)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {e.latencia_ms} ms
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={`text-xs border-0 ${
                            e.status === "ok"
                              ? "bg-success/15 text-success"
                              : "bg-destructive/15 text-destructive"
                          }`}
                        >
                          {e.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </CRMLayout>
  );
}
