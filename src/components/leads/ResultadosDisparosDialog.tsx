import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";
import { api } from "@/integrations/database/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Linha {
  chave: string | number | null;
  nome?: string | null;
  nome_real?: boolean;
  enviados: number; responderam: number; humanas: number; robos: number;
  interesse: number; negativas: number; opt_outs: number;
}
interface LinhaVersao extends Linha { disparo_id: string; versao: number }
interface Metricas { janela_horas: number; geral: Linha; por_origem: Linha[]; por_hora: Linha[]; por_disparo: Linha[]; por_versao?: LinhaVersao[] }

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "—");

function Tabela({ titulo, linhas, rotulo }: { titulo: string; linhas: Linha[]; rotulo: (l: Linha) => string }) {
  if (!linhas.length) return null;
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold">{titulo}</h4>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead />
              <TableHead className="text-right">Enviados</TableHead>
              <TableHead className="text-right">Resposta humana</TableHead>
              <TableHead className="text-right">Robô</TableHead>
              <TableHead className="text-right">Interesse</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.map((l, i) => (
              <TableRow key={i}>
                <TableCell className="max-w-[220px] truncate">{rotulo(l)}</TableCell>
                <TableCell className="text-right">{l.enviados}</TableCell>
                <TableCell className="text-right">{l.humanas} <span className="text-muted-foreground">({pct(l.humanas, l.enviados)})</span></TableCell>
                <TableCell className="text-right">{l.robos}</TableCell>
                <TableCell className="text-right font-medium">{l.interesse} <span className="text-muted-foreground font-normal">({pct(l.interesse, l.enviados)})</span></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

const MIN_POR_VERSAO = 100;

/** Teste A/B: uma tabela por campanha, uma linha por versão da mensagem. */
function TesteVersoes({ linhas }: { linhas: LinhaVersao[] }) {
  if (!linhas.length) return null;
  const grupos = new Map<string, LinhaVersao[]>();
  for (const l of linhas) grupos.set(l.disparo_id, [...(grupos.get(l.disparo_id) ?? []), l]);
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold">Teste de versões da mensagem</h4>
      {[...grupos.values()].map(vs => {
        const pequena = vs.some(v => v.enviados < MIN_POR_VERSAO);
        const melhor = [...vs].sort((a, b) => b.interesse / Math.max(1, b.enviados) - a.interesse / Math.max(1, a.enviados))[0];
        return (
          <div key={vs[0].disparo_id} className="space-y-2">
            <div className="text-xs text-muted-foreground">{vs[0].nome ?? "Campanha"}</div>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Versão</TableHead>
                    <TableHead className="text-right">Enviados</TableHead>
                    <TableHead className="text-right">Resposta humana</TableHead>
                    <TableHead className="text-right">Interesse</TableHead>
                    <TableHead className="text-right">Pediram para parar</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vs.map(v => (
                    <TableRow key={v.versao}>
                      <TableCell className="font-medium">
                        Versão {String.fromCharCode(65 + v.versao)}
                        {!pequena && v === melhor && <span className="ml-2 text-xs text-emerald-600">na frente</span>}
                      </TableCell>
                      <TableCell className="text-right">{v.enviados}</TableCell>
                      <TableCell className="text-right">{v.humanas} <span className="text-muted-foreground">({pct(v.humanas, v.enviados)})</span></TableCell>
                      <TableCell className="text-right font-medium">{v.interesse} <span className="text-muted-foreground font-normal">({pct(v.interesse, v.enviados)})</span></TableCell>
                      <TableCell className="text-right">{v.opt_outs}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {pequena && (
              <p className="text-xs text-amber-600">
                Amostra pequena: com menos de {MIN_POR_VERSAO} envios por versão a diferença pode ser sorte. Espere mais envios antes de escolher uma.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Kpi({ rotulo, valor, sub }: { rotulo: string; valor: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{rotulo}</div>
      <div className="text-2xl font-bold">{valor}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function ResultadosDisparosDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [ultimo, setUltimo] = useState<string | null>(null);
  const m = useQuery({
    queryKey: ["resultados-disparos"],
    enabled: open,
    queryFn: async () => (await api.get("/api/higienizacao/respostas/metricas")).data as Metricas,
  });

  const reprocessar = useMutation({
    mutationFn: async () => (await api.post("/api/higienizacao/respostas/reprocessar", {})).data,
    onSuccess: (r: any) => {
      setUltimo(`${r.respostas?.novas ?? 0} respostas novas classificadas; propensão atualizada em ${r.propensao?.atualizados ?? 0} contatos.`);
      qc.invalidateQueries({ queryKey: ["resultados-disparos"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível reprocessar"),
  });

  const g = m.data?.geral;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Resultados dos disparos</DialogTitle>
          <DialogDescription>
            A taxa bruta de resposta engana: parte é robô de atendimento de empresas. Aqui robô fica separado e o que conta é resposta humana e interesse
            (janela de {m.data?.janela_horas ?? 72} h após o envio).
          </DialogDescription>
        </DialogHeader>

        {m.isLoading || !g ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Kpi rotulo="Enviados" valor={g.enviados} />
              <Kpi rotulo="Respostas (bruto)" valor={g.responderam} sub={pct(g.responderam, g.enviados)} />
              <Kpi rotulo="Resposta humana" valor={g.humanas} sub={pct(g.humanas, g.enviados)} />
              <Kpi rotulo="Interesse real" valor={g.interesse} sub={pct(g.interesse, g.enviados)} />
              <Kpi rotulo="Robô de atendimento" valor={g.robos} sub={pct(g.robos, g.responderam)+" das respostas"} />
              <Kpi rotulo="Recusaram" valor={g.negativas} />
              <Kpi rotulo="Pediram para parar" valor={g.opt_outs} />
            </div>

            <Tabela titulo="Por origem e nome" linhas={m.data!.por_origem}
              rotulo={l => `${l.chave} · ${l.nome_real ? "com nome" : "só número"}`} />
            <Tabela titulo="Por horário do envio" linhas={m.data!.por_hora}
              rotulo={l => `${String(l.chave).padStart(2, "0")}h`} />
            <TesteVersoes linhas={m.data!.por_versao ?? []} />
            <Tabela titulo="Por campanha" linhas={m.data!.por_disparo}
              rotulo={l => l.nome ?? String(l.chave ?? "—")} />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button variant="outline" size="sm" onClick={() => reprocessar.mutate()} disabled={reprocessar.isPending}>
            {reprocessar.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Reler respostas do histórico
          </Button>
          {ultimo && <span className="text-xs text-muted-foreground">{ultimo}</span>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
