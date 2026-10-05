/**
 * ScoreInstancia.tsx — Score de Saúde da instância (card em WhatsApp → Instâncias).
 *
 * [AUDITORIA] LÓGICA (Etapa A — Saúde de Instâncias, 2026-10-05): o score deixou de ser a soma de
 * 4 fatores de 0-25 e passou a começar em 100 e descontar sinais de risco do NÚMERO (histórico de
 * ban, quedas, idade, opt-out, resposta, falhas — ver backend/src/services/saudeNumero.ts). Os
 * descontos vêm em `fatores.itens` (`score_fatores.versao = 2`) e aparecem no detalhe. Faixas:
 * 85+ Saudável, 65-84 Atenção, 40-64 Risco, 0-39 Crítico (Crítico bloqueia disparo). Linhas ainda
 * no formato antigo (antes do 1º recálculo) mostram só o número, com aviso.
 *
 * Desconectado / ainda não calculado continuam com tela própria (nunca "Saudável" sem dado real).
 */
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Info, Ban, CheckCircle2, AlertTriangle } from "lucide-react";

interface ItemScore {
  fator: string;
  pontos: number;
  info: string;
}

interface ScoreInstanciaProps {
  score: number;
  // v2: { versao: 2, rotulo, itens }; v1 (legado): { volume_diario, taxa_resposta, ... }
  fatores: unknown;
  onRefresh?: () => void;
  desconectado?: boolean;
  naoCalculado?: boolean;
}

function faixaScore(s: number): { rotulo: string; cor: string; barra: string } {
  if (s >= 85) return { rotulo: "Saudável", cor: "text-emerald-600", barra: "bg-emerald-500" };
  if (s >= 65) return { rotulo: "Atenção", cor: "text-yellow-600", barra: "bg-yellow-500" };
  if (s >= 40) return { rotulo: "Risco", cor: "text-orange-600", barra: "bg-orange-500" };
  return { rotulo: "Crítico", cor: "text-red-600", barra: "bg-red-500" };
}

const FAIXAS = [
  { faixa: "85-100", rotulo: "Saudável", regra: "Disparo conforme a fase do número" },
  { faixa: "65-84", rotulo: "Atenção", regra: "Metade do limite da fase" },
  { faixa: "40-64", rotulo: "Risco", regra: "Só contatos que já conversaram com o número" },
  { faixa: "0-39", rotulo: "Crítico", regra: "Disparo bloqueado" },
];

export function ScoreInstancia({ score, fatores, desconectado, naoCalculado }: ScoreInstanciaProps) {
  const [aberto, setAberto] = useState(false);

  if (desconectado) {
    return (
      <div className="space-y-2 py-2">
        <div className="flex flex-col items-center justify-center py-2 gap-1">
          <Ban className="h-8 w-8 text-red-500" />
          <span className="text-sm font-black text-red-600 uppercase tracking-wide">Desconectado</span>
        </div>
        <p className="text-[11px] text-center text-muted-foreground leading-snug">
          Instância não está conectada agora — pode ser queda temporária ou banimento. Score de
          Saúde não é exibido enquanto desconectada: reconecte para voltar a calcular.
        </p>
      </div>
    );
  }

  if (naoCalculado) {
    return (
      <div className="space-y-2 py-2">
        <div className="flex flex-col items-center justify-center py-2 gap-1">
          <Info className="h-8 w-8 text-muted-foreground/50" />
          <span className="text-sm font-bold text-muted-foreground uppercase tracking-wide">Ainda não calculado</span>
        </div>
        <p className="text-[11px] text-center text-muted-foreground leading-snug">
          O cálculo automático roda a cada 15 minutos para instâncias conectadas — a primeira leitura ainda não passou por esta.
        </p>
      </div>
    );
  }

  const v2 = (fatores as { versao?: number })?.versao === 2;
  const itens: ItemScore[] = v2 ? ((fatores as { itens?: ItemScore[] }).itens ?? []) : [];
  const f = faixaScore(score);
  const descontos = itens.filter(i => i.pontos < 0);

  return (
    <>
      <button type="button" className="w-full space-y-2 text-left group" onClick={() => setAberto(true)}>
        <div className="flex flex-col items-center justify-center py-1">
          <span className={`text-4xl font-black ${f.cor}`}>{score}</span>
          <span className={`text-[11px] font-bold uppercase tracking-wide ${f.cor}`}>{f.rotulo}</span>
        </div>
        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
          <div className={`h-full ${f.barra} transition-all duration-500`} style={{ width: `${score}%` }} />
        </div>
        {v2 ? (
          descontos.length > 0 ? (
            <ul className="space-y-0.5">
              {descontos.slice(0, 3).map((i, k) => (
                <li key={k} className="text-[10px] text-muted-foreground flex justify-between gap-2">
                  <span className="truncate">{i.fator}</span>
                  <span className="font-bold text-red-600 shrink-0">{i.pontos}</span>
                </li>
              ))}
              {descontos.length > 3 && (
                <li className="text-[10px] text-muted-foreground">+{descontos.length - 3} outro(s) — clique para ver</li>
              )}
            </ul>
          ) : (
            <p className="text-[10px] text-center text-muted-foreground">Nenhum sinal de risco encontrado</p>
          )
        ) : (
          <p className="text-[10px] text-center text-muted-foreground">Recalculando com o novo critério…</p>
        )}
      </button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Score de Saúde: {score} ({f.rotulo})</DialogTitle>
            <DialogDescription>
              Começa em 100 e desconta cada sinal de risco do número. É uma estimativa do CRM, não uma
              métrica oficial do WhatsApp.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {itens.length === 0 ? (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Nenhum desconto aplicado.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {itens.map((i, k) => (
                  <li key={k} className="flex items-start justify-between gap-3 text-sm border-b pb-1.5 last:border-0">
                    <div>
                      <p className="font-medium flex items-center gap-1.5">
                        {i.pontos < 0 ? <AlertTriangle className="h-3.5 w-3.5 text-orange-500" /> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
                        {i.fator}
                      </p>
                      <p className="text-xs text-muted-foreground">{i.info}</p>
                    </div>
                    <span className={`font-bold shrink-0 ${i.pontos < 0 ? "text-red-600" : "text-emerald-600"}`}>
                      {i.pontos > 0 ? `+${i.pontos}` : i.pontos}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="rounded-md bg-muted/50 p-2 space-y-1">
              {FAIXAS.map(x => (
                <p key={x.faixa} className="text-[11px] flex justify-between gap-2">
                  <span><b>{x.faixa}</b> {x.rotulo}</span>
                  <span className="text-muted-foreground text-right">{x.regra}</span>
                </p>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
