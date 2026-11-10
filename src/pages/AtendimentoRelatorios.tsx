/**
 * Sprint Relatórios de Atendimento v1 (diagnosticos/SPRINT_RELATORIOS_ATENDIMENTO.md).
 * Coorte: atendimentos ABERTOS no período. Tempos em mediana (p90 no detalhe).
 */
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Hourglass, Loader2, RefreshCw, Table2, BarChart3, Info } from "lucide-react";
import { CRMLayout } from "@/components/CRMLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import {
  diaInicialDoPeriodo, formatarDuracao, lerRelatorio, lerSituacaoAgora,
  type RelatorioAtendimento, type SituacaoAgora,
} from "@/lib/atendimento";

const PERIODOS = [
  { dias: 1, rotulo: "Hoje" },
  { dias: 7, rotulo: "7 dias" },
  { dias: 30, rotulo: "30 dias" },
  { dias: 90, rotulo: "90 dias" },
];

// Paleta validada (scripts/validate_palette.js da skill dataviz) contra o card claro e o escuro do app.
const CORES_GRAFICO: ChartConfig = {
  resolvidos: { label: "Resolvidos", theme: { light: "#2a78d6", dark: "#3987e5" } },
  emAndamento: { label: "Em andamento", theme: { light: "#eb6834", dark: "#d95926" } },
};

const pct = (parte: number, total: number) => (total ? `${Math.round((parte / total) * 100)}%` : "—");
const diaCurto = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

function Indicador({ titulo, valor, detalhe }: { titulo: string; valor: string; detalhe?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-muted-foreground">{titulo}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{valor}</p>
      {detalhe && <p className="mt-0.5 text-xs text-muted-foreground">{detalhe}</p>}
    </Card>
  );
}

function PainelAgora() {
  const [agora, setAgora] = useState<SituacaoAgora | null>(null);
  const [, setTique] = useState(0);

  useEffect(() => {
    const carregar = () => { if (document.visibilityState !== "hidden") lerSituacaoAgora().then(setAgora).catch(() => {}); };
    carregar();
    const t = setInterval(() => { carregar(); setTique(n => n + 1); }, 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Agora</h2>
        <span className="text-xs text-muted-foreground">atualiza a cada 30 s</span>
      </div>
      {!agora ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
            {[["Abertos", agora.abertos], ["Aguardando humano", agora.aguardando], ["Sem atendente", agora.semAtendente]].map(([r, v]) => (
              <div key={r as string} className="rounded-lg bg-muted/40 p-2">
                <dd className="text-xl font-bold tabular-nums">{v}</dd>
                <dt className="text-[11px] text-muted-foreground">{r}</dt>
              </div>
            ))}
          </dl>
          <h3 className="mt-4 mb-2 text-xs font-semibold text-muted-foreground">Fila de quem pediu atendente (mais antigo primeiro)</h3>
          {agora.fila.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ninguém esperando por uma pessoa.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {agora.fila.map(f => (
                <li key={f.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{f.nome}</span>
                    <span className="block truncate text-xs text-muted-foreground">{f.atendente_nome || "Sem atendente"}</span>
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs tabular-nums text-muted-foreground">
                    <Hourglass className="h-3.5 w-3.5" /> {formatarDuracao((Date.now() - new Date(f.desde).getTime()) / 1000)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}

function GraficoDias({ dados }: { dados: RelatorioAtendimento["dias"] }) {
  const [tabela, setTabela] = useState(false);
  const linhas = useMemo(() => dados.map(d => ({ dia: diaCurto(d.dia), resolvidos: d.resolvidos, emAndamento: d.abertos - d.resolvidos, abertos: d.abertos })), [dados]);

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">Atendimentos por dia</h2>
          <p className="text-xs text-muted-foreground">Abertos no dia, separados pela situação atual.</p>
        </div>
        <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setTabela(t => !t)} aria-pressed={tabela}>
          {tabela ? <BarChart3 className="h-3.5 w-3.5 mr-1.5" /> : <Table2 className="h-3.5 w-3.5 mr-1.5" />}
          {tabela ? "Ver gráfico" : "Ver tabela"}
        </Button>
      </div>
      {tabela ? (
        <div className="max-h-72 overflow-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
              <tr><th className="px-3 py-2 text-left font-medium">Dia</th><th className="px-3 py-2 text-right font-medium">Abertos</th><th className="px-3 py-2 text-right font-medium">Resolvidos</th><th className="px-3 py-2 text-right font-medium">Em andamento</th></tr>
            </thead>
            <tbody className="divide-y tabular-nums">
              {linhas.map(l => (
                <tr key={l.dia}><td className="px-3 py-1.5">{l.dia}</td><td className="px-3 py-1.5 text-right">{l.abertos}</td><td className="px-3 py-1.5 text-right">{l.resolvidos}</td><td className="px-3 py-1.5 text-right">{l.emAndamento}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ChartContainer config={CORES_GRAFICO} className="h-64 w-full">
          <BarChart data={linhas} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
            <CartesianGrid vertical={false} strokeOpacity={0.4} />
            <XAxis dataKey="dia" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={16} fontSize={11} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} fontSize={11} />
            <ChartTooltip cursor={{ fillOpacity: 0.08 }} content={<ChartTooltipContent />} />
            <ChartLegend content={<ChartLegendContent />} />
            {/* Contorno da cor do card = vão de 2px entre as partes empilhadas. */}
            <Bar dataKey="resolvidos" stackId="d" fill="var(--color-resolvidos)" stroke="hsl(var(--card))" strokeWidth={2} maxBarSize={28} />
            <Bar dataKey="emAndamento" stackId="d" fill="var(--color-emAndamento)" stroke="hsl(var(--card))" strokeWidth={2} radius={[4, 4, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ChartContainer>
      )}
    </Card>
  );
}

export default function AtendimentoRelatoriosPage() {
  const [dias, setDias] = useState(7);
  const [rel, setRel] = useState<RelatorioAtendimento | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = async (n = dias) => {
    setCarregando(true);
    setErro(null);
    try {
      setRel(await lerRelatorio(diaInicialDoPeriodo(n)));
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  };
  useEffect(() => { carregar(dias); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [dias]);

  const r = rel?.resumo;
  const maxMotivo = Math.max(1, ...(rel?.motivos.map(m => m.total) ?? [1]));

  return (
    <CRMLayout>
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Relatórios de atendimento</h1>
            <p className="text-sm text-muted-foreground">Atendimentos abertos no período, de todos os números da conta.</p>
          </div>
          <div className="flex items-center gap-1">
            <div role="group" aria-label="Período" className="flex gap-1 rounded-lg bg-muted/40 p-1">
              {PERIODOS.map(p => (
                <button key={p.dias} aria-pressed={dias === p.dias} onClick={() => setDias(p.dias)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${dias === p.dias ? "bg-background text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground"}`}>
                  {p.rotulo}
                </button>
              ))}
            </div>
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => carregar()} aria-label="Atualizar relatório" disabled={carregando}>
              <RefreshCw className={`h-4 w-4 ${carregando ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {erro && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{erro}</p>}

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="min-w-0 space-y-4 lg:col-span-2">
            {!rel || !r ? (
              <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Indicador titulo="Atendimentos" valor={String(r.total)} detalhe={`${r.reabertos} ${r.reabertos === 1 ? "reaberto" : "reabertos"} (${pct(r.reabertos, r.total)})`} />
                  <Indicador titulo="Resolvidos" valor={pct(r.resolvidos, r.total)} detalhe={`${r.resolvidos} de ${r.total} · ${r.resolvidosSoIa} só pela IA`} />
                  <Indicador titulo="1ª resposta" valor={formatarDuracao(r.respostaSeg.p50)} detalhe={`IA ou pessoa · p90 ${formatarDuracao(r.respostaSeg.p90)}`} />
                  <Indicador titulo="1ª resposta humana" valor={formatarDuracao(r.respostaHumanaSeg.p50)} detalhe={`${pct(r.humanoNaMeta, r.respondidosHumano)} na meta · p90 ${formatarDuracao(r.respostaHumanaSeg.p90)}`} />
                  <Indicador titulo="Resolução" valor={formatarDuracao(r.resolucaoSeg.p50)} detalhe={`${pct(r.resolvidosNaMeta, r.resolvidos)} na meta · p90 ${formatarDuracao(r.resolucaoSeg.p90)}`} />
                  <Indicador titulo="Pediram atendente" valor={String(r.pediramHumano)} detalhe={pct(r.pediramHumano, r.total) + " dos atendimentos"} />
                  <Indicador titulo="Sem resposta" valor={String(r.total - r.respondidos)} detalhe="nenhuma resposta da IA nem de pessoa" />
                  <Indicador titulo="Sem atendente" valor={String(r.semAtendente)} detalhe="nunca atribuídos a ninguém" />
                </div>
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Tempos na mediana. As metas vêm de SLA / Gestão (1ª resposta e resolução) de cada número.
                </p>

                <GraficoDias dados={rel.dias} />

                <Card className="p-4">
                  <h2 className="mb-3 font-semibold">Por atendente</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-xs text-muted-foreground">
                        <tr className="border-b">
                          <th className="py-2 pr-3 text-left font-medium">Atendente</th>
                          <th className="px-3 py-2 text-right font-medium">Atribuídos</th>
                          <th className="px-3 py-2 text-right font-medium">Resolvidos</th>
                          <th className="px-3 py-2 text-right font-medium">1ª resposta</th>
                          <th className="py-2 pl-3 text-right font-medium">Resolução</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y tabular-nums">
                        {rel.atendentes.map(a => (
                          <tr key={a.id}>
                            <td className="max-w-[200px] truncate py-2 pr-3">{a.nome}</td>
                            <td className="px-3 py-2 text-right">{a.atribuidos}</td>
                            <td className="px-3 py-2 text-right">{a.resolvidos}</td>
                            <td className="px-3 py-2 text-right">{formatarDuracao(a.respostaHumanaSeg)}</td>
                            <td className="py-2 pl-3 text-right">{formatarDuracao(a.resolucaoSeg)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </>
            )}
          </div>

          <div className="min-w-0 space-y-4">
            <PainelAgora />
            {rel && (
              <Card className="p-4">
                <h2 className="mb-3 font-semibold">Motivos de resolução</h2>
                {rel.motivos.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum atendimento resolvido no período.</p>
                ) : (
                  <ul className="space-y-2.5">
                    {rel.motivos.map(m => (
                      <li key={m.nome}>
                        <div className="mb-1 flex justify-between gap-2 text-sm"><span className="truncate">{m.nome}</span><span className="tabular-nums text-muted-foreground">{m.total}</span></div>
                        <div className="h-2 rounded-full bg-muted/50"><div className="h-2 rounded-full bg-[#2a78d6] dark:bg-[#3987e5]" style={{ width: `${(m.total / maxMotivo) * 100}%` }} /></div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )}
          </div>
        </div>
      </div>
    </CRMLayout>
  );
}
