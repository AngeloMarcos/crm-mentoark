import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle, Eye, MousePointerClick, TrendingUp, Target, Globe, Repeat, CheckCircle2, RefreshCw, Info, DollarSign,
} from "lucide-react";
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useInsights, type InsightsDia, type PeriodoDias } from "./useInsights";

interface Props { metaConectado: boolean; }

const PERIODOS: { dias: PeriodoDias; label: string }[] = [
  { dias: 7,  label: "7 dias" },
  { dias: 14, label: "14 dias" },
  { dias: 30, label: "30 dias" },
  { dias: 90, label: "90 dias" },
];

type FormatoTipo = "numero" | "moeda" | "percentual";

// Séries disponíveis no gráfico de Performance
const SERIES: { key: keyof InsightsDia; label: string; cor: string; tipo: FormatoTipo }[] = [
  { key: "gasto",             label: "Gasto",             cor: "#f43f5e", tipo: "moeda" },
  { key: "cpm",               label: "CPM",               cor: "#8b5cf6", tipo: "moeda" },
  { key: "impressoes",        label: "Impressões",        cor: "#3b82f6", tipo: "numero" },
  { key: "cliquesLink",       label: "Cliques no link",   cor: "#06b6d4", tipo: "numero" },
  { key: "ctrLink",           label: "CTR",               cor: "#f59e0b", tipo: "percentual" },
  { key: "resultados",        label: "Resultados",        cor: "#10b981", tipo: "numero" },
  { key: "custoPorResultado", label: "Custo por resultado", cor: "#ec4899", tipo: "moeda" },
];

const SERIES_INICIAIS: (keyof InsightsDia)[] = ["gasto", "impressoes", "cliquesLink", "resultados"];

function formatarData(iso: string) {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

function MetricCard({ label, valor, icon: Icon, dica }: {
  label: string; valor: string; icon: typeof Eye; dica: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-start gap-1.5 text-sm text-muted-foreground leading-tight">
              <span>{label}</span>
              <span title={dica} className="shrink-0 cursor-help mt-px"><Info className="h-3.5 w-3.5" /></span>
            </div>
            <p className="mt-2 text-2xl font-bold tracking-tight">{valor}</p>
          </div>
          <div className="w-9 h-9 rounded-lg bg-blue-500/15 text-blue-500 flex items-center justify-center shrink-0">
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function MetricasMeta({ metaConectado }: Props) {
  const [dias, setDias] = useState<PeriodoDias>(7);
  const [campanhaId, setCampanhaId] = useState("");
  const [ativas, setAtivas] = useState<(keyof InsightsDia)[]>(SERIES_INICIAIS);
  const [listaCampanhas, setListaCampanhas] = useState<{ id: string; nome: string }[]>([]);

  const { dados, loading, erro, recarregar } = useInsights(metaConectado, dias, campanhaId);

  // Guarda a lista completa de campanhas (só atualiza com o filtro "Todas", senão a lista encolheria)
  useEffect(() => {
    if (dados && !campanhaId) setListaCampanhas(dados.campanhas);
  }, [dados, campanhaId]);

  const moeda = dados?.moeda || "BRL";
  const fmt = useMemo(() => {
    const numero = new Intl.NumberFormat("pt-BR");
    const dec = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    let brl: Intl.NumberFormat;
    try {
      brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: moeda });
    } catch {
      brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
    }
    return {
      numero: (v: number) => numero.format(v),
      decimal: (v: number) => dec.format(v),
      moeda: (v: number) => brl.format(v),
      percentual: (v: number) => `${dec.format(v)}%`,
    };
  }, [moeda]);

  const formatarPorTipo = (tipo: FormatoTipo, v: number) =>
    tipo === "moeda" ? fmt.moeda(v) : tipo === "percentual" ? fmt.percentual(v) : fmt.numero(v);

  const serieDados = useMemo(
    () => (dados?.serie ?? []).map((d) => ({ ...d, label: formatarData(d.data) })),
    [dados],
  );

  const toggleSerie = (key: keyof InsightsDia) =>
    setAtivas((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const t = dados?.totais;
  const semDados = !loading && !erro && dados && t && t.impressoes === 0;

  return (
    <div className="mt-6 space-y-4">

      {/* Banner Meta não conectado */}
      {!metaConectado && (
        <div className="flex items-start gap-2 rounded-lg border border-yellow-300 bg-yellow-50 dark:bg-yellow-950/20 p-3 text-sm text-yellow-800 dark:text-yellow-300">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <strong>Conta Meta não conectada.</strong> Acesse a aba <strong>Conta Meta</strong> para conectar e ver as métricas reais.
          </div>
        </div>
      )}

      {/* Banner erro */}
      {erro && metaConectado && (
        <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/20 p-3 text-sm text-red-800 dark:text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div><strong>Falha ao carregar:</strong> {erro}</div>
        </div>
      )}

      {/* Filtros */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-1.5 flex-wrap">
          {PERIODOS.map((p) => (
            <Button key={p.dias} size="sm" variant={dias === p.dias ? "default" : "outline"}
              onClick={() => setDias(p.dias)} disabled={!metaConectado}>
              {p.label}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Select value={campanhaId || "ALL"} onValueChange={(v) => setCampanhaId(v === "ALL" ? "" : v)} disabled={!metaConectado}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Todas as campanhas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todas as campanhas</SelectItem>
              {listaCampanhas.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="ghost" onClick={recarregar} disabled={!metaConectado || loading} className="gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Atualizar
          </Button>
        </div>
      </div>

      {/* Cards de métricas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {loading ? (
          Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[100px] rounded-xl" />)
        ) : (
          <>
            <MetricCard label="Impressões" icon={Eye} valor={t ? fmt.numero(t.impressoes) : "—"}
              dica="Número de vezes que seus anúncios foram exibidos." />
            <MetricCard label="Total de cliques no link" icon={MousePointerClick} valor={t ? fmt.numero(t.cliquesLink) : "—"}
              dica="Cliques em links dentro do anúncio que levam a destinos dentro ou fora da Meta." />
            <MetricCard label="CTR (Cliques no link)" icon={TrendingUp} valor={t ? fmt.percentual(t.ctrLink) : "—"}
              dica="Cliques no link ÷ impressões." />
            <MetricCard label="CPM Médio" icon={Target} valor={t ? fmt.moeda(t.cpm) : "—"}
              dica="Custo médio por 1.000 impressões." />
            <MetricCard label="Visualizações do site" icon={Globe} valor={t ? fmt.numero(t.visualizacoesSite) : "—"}
              dica="Vezes que a página de destino carregou por completo após o clique (exige pixel instalado)." />
            <MetricCard label="Frequência" icon={Repeat} valor={t ? fmt.decimal(t.frequencia) : "—"}
              dica="Média de vezes que cada pessoa viu o anúncio (impressões ÷ alcance)." />
            <MetricCard label="Resultados" icon={CheckCircle2} valor={t ? fmt.numero(t.resultados) : "—"}
              dica="Ações que correspondem ao objetivo de cada campanha (leads, conversas iniciadas, compras, cliques etc.)." />
            <MetricCard label="Custo por Resultado" icon={DollarSign} valor={t ? fmt.moeda(t.custoPorResultado) : "—"}
              dica="Gasto ÷ resultados." />
          </>
        )}
      </div>

      {semDados && (
        <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground text-center">
          Nenhuma entrega de anúncios no período selecionado.
        </div>
      )}

      {/* Gráfico de performance */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Performance</CardTitle>
          <div className="flex flex-wrap gap-1.5 pt-2">
            {SERIES.map((s) => {
              const on = ativas.includes(s.key);
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => toggleSerie(s.key)}
                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    on ? "border-transparent bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: on ? s.cor : "transparent", border: `1.5px solid ${s.cor}` }} />
                  {s.label}
                </button>
              );
            })}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-[320px] rounded-lg" />
          ) : serieDados.length === 0 ? (
            <div className="h-[320px] flex items-center justify-center text-sm text-muted-foreground">
              Sem dados para exibir.
            </div>
          ) : (
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={serieDados} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  {/* Cada série usa o próprio eixo (escondido), assim valores de escalas diferentes convivem no mesmo gráfico */}
                  {SERIES.filter((s) => ativas.includes(s.key)).map((s) => (
                    <YAxis key={s.key} yAxisId={s.key} hide domain={[0, "auto"]} />
                  ))}
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(valor, _nome, item) => {
                      const s = SERIES.find((x) => x.key === item?.dataKey);
                      return s ? formatarPorTipo(s.tipo, Number(valor)) : String(valor);
                    }}
                  />
                  {SERIES.filter((s) => ativas.includes(s.key)).map((s) => (
                    <Line
                      key={s.key}
                      yAxisId={s.key}
                      type="monotone"
                      dataKey={s.key}
                      name={s.label}
                      stroke={s.cor}
                      strokeWidth={2}
                      dot={serieDados.length <= 31}
                      activeDot={{ r: 4 }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
