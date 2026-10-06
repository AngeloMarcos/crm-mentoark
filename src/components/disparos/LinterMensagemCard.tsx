/**
 * LinterMensagemCard.tsx — nota de 0 a 100 da mensagem de disparo, com dicas, erros de formato,
 * avisos e prévia de 5 variações (Sprint 8 = Sprint 4 / H6, 2026-10-06). Regras em
 * `src/lib/linterMensagem.ts`. Não bloqueia sozinho: quem chama decide (erros de formato
 * bloqueiam salvar/avançar; nota baixa só avisa).
 */
import { useMemo, useState } from "react";
import { analisarMensagem } from "@/lib/linterMensagem";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertTriangle, XCircle, RefreshCw } from "lucide-react";

export function LinterMensagemCard({ texto, variantes, variacaoAutomatica, canalBaileys = true }: {
  texto: string; variantes?: string[]; variacaoAutomatica?: boolean; canalBaileys?: boolean;
}) {
  const [semente, setSemente] = useState(0);
  // `semente` só força recalcular as prévias (o spintax sorteia a cada análise).
  const r = useMemo(
    () => analisarMensagem(texto, { variantes, variacaoAutomatica, canalBaileys }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [texto, JSON.stringify(variantes || []), variacaoAutomatica, canalBaileys, semente],
  );
  if (!texto.trim()) return null;
  const cor = r.nota >= 80 ? "bg-emerald-600" : r.nota >= 60 ? "bg-amber-500" : "bg-red-600";

  return (
    <div className="rounded-lg border p-3 space-y-2 text-xs">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">Qualidade da mensagem</span>
        <Badge className={`${cor} text-white`}>{r.nota}/100</Badge>
        <span className="text-muted-foreground">
          {r.nota >= 80 ? "boa para disparo" : r.nota >= 60 ? "dá para melhorar" : "alto risco de denúncia"}
        </span>
      </div>
      {r.erros.map((e, i) => (
        <p key={`e${i}`} className="flex gap-1 text-red-600"><XCircle className="h-3.5 w-3.5 shrink-0 mt-px" />{e}</p>
      ))}
      {r.avisos.map((a, i) => (
        <p key={`a${i}`} className="flex gap-1 text-amber-700 dark:text-amber-400"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />{a}</p>
      ))}
      <ul className="space-y-1">
        {r.itens.map(i => (
          <li key={i.item} className="flex gap-1">
            {i.ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-px text-emerald-500" /> : <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px text-amber-500" />}
            <span><b>{i.item}</b> ({i.pontos}/{i.max}){i.dica ? ` — ${i.dica}` : ""}</span>
          </li>
        ))}
      </ul>
      <details>
        <summary className="cursor-pointer text-muted-foreground">
          Prévia de 5 variações{r.similaridadeMedia !== null ? ` (${Math.round(r.similaridadeMedia * 100)}% parecidas entre si)` : ""}
        </summary>
        <div className="mt-2 space-y-2">
          {r.previas.map((p, i) => (
            <p key={i} className="whitespace-pre-wrap rounded-md bg-muted/50 p-2">{p}</p>
          ))}
          <Button type="button" size="sm" variant="ghost" className="h-7 gap-1" onClick={() => setSemente(s => s + 1)}>
            <RefreshCw className="h-3 w-3" /> Sortear outras
          </Button>
        </div>
      </details>
    </div>
  );
}
