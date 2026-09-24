import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export interface RecorteAudiencia {
  selecionados: number;
  elegiveis: number;
  excluidos: Record<string, number>;
  rotulos: Record<string, string>;
  comPropensao: number;
}

export interface OpcoesRecorte { excluirRobos: boolean; excluirSemNome: boolean }

/** Recorte real da audiência antes de disparar: quem entra, quem sai e por quê (nada some em silêncio). */
export function RecorteCard({
  recorte, opcoes, onChange, carregando,
}: { recorte: RecorteAudiencia | null; opcoes: OpcoesRecorte; onChange: (o: OpcoesRecorte) => void; carregando: boolean }) {
  if (!recorte && !carregando) return null;
  const motivos = Object.entries(recorte?.excluidos ?? {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const totalExcluidos = motivos.reduce((s, [, n]) => s + n, 0);

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-sm font-semibold">Recorte da audiência</span>
        {recorte && (
          <span className="text-sm text-muted-foreground">
            {recorte.selecionados} selecionados → <strong className="text-foreground">{recorte.elegiveis} elegíveis</strong>
            {totalExcluidos > 0 && <> · {totalExcluidos} de fora</>}
          </span>
        )}
      </div>

      {motivos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {motivos.map(([m, n]) => (
            <Badge key={m} variant="secondary" className="font-normal">
              {n} {recorte?.rotulos?.[m] ?? m}
            </Badge>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-x-6 gap-y-2 pt-1">
        <div className="flex items-center gap-2">
          <Checkbox id="rc-robos" checked={opcoes.excluirRobos} onCheckedChange={v => onChange({ ...opcoes, excluirRobos: v === true })} />
          <Label htmlFor="rc-robos" className="font-normal text-sm">Excluir empresas com atendimento automático (robô)</Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="rc-nome" checked={opcoes.excluirSemNome} onCheckedChange={v => onChange({ ...opcoes, excluirSemNome: v === true })} />
          <Label htmlFor="rc-nome" className="font-normal text-sm">Excluir contatos sem nome (só o número)</Label>
        </div>
      </div>

      {recorte && recorte.comPropensao > 0 && (
        <p className="text-xs text-muted-foreground">
          Os envios começam pelos contatos com maior chance estimada de resposta (histórico das suas campanhas).
        </p>
      )}
    </div>
  );
}
