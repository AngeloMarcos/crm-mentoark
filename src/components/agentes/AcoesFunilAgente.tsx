/**
 * "Ações no funil" do agente (2026-11-02, modelo atendIA): para quais etapas a IA pode mover o
 * cliente sozinha e quando. Ganho/Perdido não aparecem: a IA não fecha venda sozinha.
 * Grava em `agentes.acoes_funil`; o motor só executa depois que a resposta da IA sai.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Filter, Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { AcoesFunil, EtapaFunil, listarEtapasFunil } from "@/lib/funilAuto";

interface Props {
  valor: AcoesFunil;
  onChange: (v: AcoesFunil) => void;
}

const EXEMPLO_QUANDO =
  'Ex.: "Em conversa" quando o cliente responder com interesse; "Interessado" quando pedir preço, ' +
  'demonstração ou teste grátis; "Proposta" quando pedir orçamento ou contrato.';

export function AcoesFunilAgente({ valor, onChange }: Props) {
  const [etapas, setEtapas] = useState<EtapaFunil[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    listarEtapasFunil().then((r) => setEtapas(r.etapas)).catch((e: Error) => setErro(e.message));
  }, []);

  const mover = valor.mover;
  const set = (m: Partial<AcoesFunil["mover"]>) => onChange({ mover: { ...mover, ...m } });
  const abertas = (etapas ?? []).filter((e) => e.tipo === "aberta");
  const liberadasValidas = mover.etapas.filter((id) => abertas.some((e) => e.id === id));

  return (
    <section className="rounded-xl border bg-card p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Filter className="h-4 w-4" />
          </div>
          <div>
            <h3 className="font-semibold">Ações no funil</h3>
            <p className="text-sm text-muted-foreground">
              A IA move o cliente de etapa sozinha quando a conversa mostrar intenção. Só depois que a
              resposta dela é entregue, e só para as etapas marcadas aqui.
            </p>
          </div>
        </div>
        <Switch checked={mover.ativo} onCheckedChange={(v) => set({ ativo: v })} aria-label="Ligar ações no funil" />
      </div>

      {mover.ativo && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Etapas para onde a IA pode mover</Label>
            {erro ? (
              <p className="text-sm text-destructive">Não foi possível carregar as etapas: {erro}</p>
            ) : !etapas ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando etapas…</div>
            ) : (
              <div className="flex flex-wrap gap-3">
                {abertas.map((e) => (
                  <label key={e.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={mover.etapas.includes(e.id)}
                      onCheckedChange={(v) =>
                        set({ etapas: v === true ? [...mover.etapas, e.id] : mover.etapas.filter((id) => id !== e.id) })}
                    />
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: e.cor || "#64748b" }} />
                    {e.nome}
                  </label>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Ganho e Perdido ficam de fora: a IA não fecha venda sozinha. As etapas são as do{" "}
              <Link to="/funil" className="underline underline-offset-2">Funil de Vendas</Link>.
            </p>
            {etapas && liberadasValidas.length === 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400">Marque pelo menos uma etapa, senão a IA não move ninguém.</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="funil-quando">Quando mover (em palavras simples)</Label>
            <Textarea
              id="funil-quando"
              rows={3}
              maxLength={1000}
              value={mover.quando}
              onChange={(e) => set({ quando: e.target.value })}
              placeholder={EXEMPLO_QUANDO}
            />
            <p className="text-xs text-muted-foreground">
              Cada movimento aparece no histórico do card, com o motivo que a IA viu na conversa.
              Teste na aba Teste: ela mostra para onde moveria, sem mover ninguém.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
