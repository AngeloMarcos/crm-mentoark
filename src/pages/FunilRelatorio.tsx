/**
 * Relatório do funil (diagnosticos/SPRINT_FUNIL_PERDA_RELATORIO.md). Backend: services/relatorioFunil.ts.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, RefreshCw } from "lucide-react";
import { CRMLayout } from "@/components/CRMLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { diaInicialDoPeriodo, formatarDuracao } from "@/lib/atendimento";
import { lerRelatorioFunil, type RelatorioFunil } from "@/lib/funilAuto";

const PERIODOS = [
  { dias: 7, rotulo: "7 dias" },
  { dias: 30, rotulo: "30 dias" },
  { dias: 90, rotulo: "90 dias" },
];

const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

function Indicador({ titulo, valor, detalhe }: { titulo: string; valor: string; detalhe?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-muted-foreground">{titulo}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{valor}</p>
      {detalhe && <p className="mt-0.5 text-xs text-muted-foreground">{detalhe}</p>}
    </Card>
  );
}

export default function FunilRelatorioPage() {
  const [dias, setDias] = useState(30);
  const [rel, setRel] = useState<RelatorioFunil | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = async (n = dias) => {
    setCarregando(true);
    setErro(null);
    try {
      setRel(await lerRelatorioFunil(diaInicialDoPeriodo(n)));
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  };
  useEffect(() => { carregar(dias); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [dias]);

  const r = rel?.resumo;
  const maxPerda = Math.max(1, ...(rel?.motivosPerda.map(m => m.total) ?? [1]));

  return (
    <CRMLayout>
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Button variant="ghost" size="sm" asChild className="-ml-2 mb-1 h-7 text-xs text-muted-foreground">
              <Link to="/funil"><ArrowLeft className="h-3.5 w-3.5 mr-1" /> Funil de Vendas</Link>
            </Button>
            <h1 className="text-xl font-bold">Relatório do funil</h1>
            <p className="text-sm text-muted-foreground">Movimentos feitos pela equipe, pela IA e pela API no período.</p>
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

        {!rel || !r ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
              <Indicador titulo="Entraram no funil" valor={String(r.entraram)} />
              <Indicador titulo="Ganhos" valor={String(r.ganhos)} />
              <Indicador titulo="Perdidos" valor={String(r.perdidos)} />
              <Indicador titulo="Conversão" valor={r.conversao === null ? "—" : `${Math.round(r.conversao * 100)}%`} detalhe="ganhos sobre o que fechou" />
              <Indicador titulo="Valor ganho" valor={reais(r.valorGanho)} detalhe="valor potencial dos ganhos" />
              <Indicador titulo="Ciclo de venda" valor={formatarDuracao(r.cicloSeg.p50)} detalhe={`da entrada ao ganho · p90 ${formatarDuracao(r.cicloSeg.p90)}`} />
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="min-w-0 p-4 lg:col-span-2">
                <h2 className="font-semibold">Por etapa</h2>
                <p className="mb-3 text-xs text-muted-foreground">Cards e valor de agora; saídas e tempo na etapa dentro do período (mediana).</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="whitespace-nowrap text-xs text-muted-foreground">
                      <tr className="border-b">
                        <th className="py-2 pr-3 text-left font-medium">Etapa</th>
                        <th className="px-3 py-2 text-right font-medium">Cards</th>
                        <th className="px-3 py-2 text-right font-medium">Valor</th>
                        <th className="px-3 py-2 text-right font-medium">Saíram</th>
                        <th className="py-2 pl-3 text-right font-medium">Tempo na etapa</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y tabular-nums">
                      {rel.etapas.map(e => (
                        <tr key={e.id}>
                          <td className="py-2 pr-3">
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: e.cor || "#64748b" }} />
                              <span className="truncate">{e.nome}</span>
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right">{e.cards}</td>
                          <td className="px-3 py-2 text-right">{e.valor ? reais(e.valor) : "—"}</td>
                          <td className="px-3 py-2 text-right">{e.tipo === "aberta" ? e.sairam : "—"}</td>
                          <td className="py-2 pl-3 text-right">{e.tipo === "aberta" ? formatarDuracao(e.tempoSeg) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card className="min-w-0 p-4">
                <h2 className="mb-3 font-semibold">Motivos de perda</h2>
                {rel.motivosPerda.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum negócio perdido no período.</p>
                ) : (
                  <ul className="space-y-2.5">
                    {rel.motivosPerda.map(m => (
                      <li key={m.nome}>
                        <div className="mb-1 flex justify-between gap-2 text-sm"><span className="truncate">{m.nome}</span><span className="tabular-nums text-muted-foreground">{m.total}</span></div>
                        <div className="h-2 rounded-full bg-muted/50"><div className="h-2 rounded-full bg-[#2a78d6] dark:bg-[#3987e5]" style={{ width: `${(m.total / maxPerda) * 100}%` }} /></div>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-3 text-xs text-muted-foreground">
                  Cadastre os motivos em <Link to="/atendimento/motivos" className="underline">Motivos e regras de atendimento</Link> (aba Perda).
                </p>
              </Card>
            </div>
          </>
        )}
      </div>
    </CRMLayout>
  );
}
