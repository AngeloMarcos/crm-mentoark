import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Info, AlertTriangle, CheckCircle2, History, MessageSquare, BarChart3, Ban } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface ScoreFatores {
  volume_diario: number;
  taxa_resposta: number;
  reclamacoes: number;
  tempo_conta: number;
}

interface ScoreInstanciaProps {
  score: number;
  fatores: ScoreFatores;
  onRefresh?: () => void;
  // [AUDITORIA] LÓGICA (Sprint Score Real + Maturador, 2026-08-09): override crítico do achado
  // original — uma instância desconectada/banida (`state !== 'open'` em
  // `InstanceManagementPanel.tsx`, dado real e fresco, poll a cada 30s direto na Evolution) NUNCA
  // pode mostrar "Saudável", independente do que os 4 fatores calculariam. `desconectado=true`
  // troca a exibição inteira por um aviso vermelho — o número por baixo continua existindo (não é
  // zerado), só deixa de ser a fonte da verdade visual enquanto a instância não está `open`.
  desconectado?: boolean;
  // `whatsapp_score`/`score_fatores` nunca foram calculados de verdade pra esta instância ainda
  // (`agentes.score_updated_at IS NULL` — cron de 15min ainda não passou por ela, ou é uma
  // conexão nova). Antes desta sprint, esse caso caía no fallback `?? 100` e mostrava "Saudável"
  // sem nenhum dado real — a raiz do bug reportado. Agora mostra "Ainda não calculado" em vez de
  // inventar um número.
  naoCalculado?: boolean;
}

export function ScoreInstancia({ score, fatores, desconectado, naoCalculado }: ScoreInstanciaProps) {
  const [isOpen, setIsOpen] = useState(false);

  const getScoreColor = (s: number) => {
    if (s <= 40) return "bg-red-500";
    if (s <= 70) return "bg-yellow-500";
    return "bg-green-500";
  };

  const getScoreText = (s: number) => {
    if (s <= 40) return "Risco Alto";
    if (s <= 70) return "Atenção";
    return "Saudável";
  };

  // [AUDITORIA] FIX APLICADO (Sprint Score Real + Maturador, 2026-08-09): override renderizado
  // ANTES de qualquer cálculo baseado em `score` — desconexão/banimento é sempre a informação
  // mais importante e mais fresca disponível, tem prioridade sobre um score que pode estar
  // desatualizado em até 15min (cadência do cron, ver `cron.ts`).
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

  const getFactorColor = (val: number) => {
    if (val >= 20) return "text-green-500";
    if (val >= 10) return "text-yellow-500";
    return "text-red-500";
  };

  const getFactorIcon = (val: number) => {
    if (val >= 20) return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    if (val >= 10) return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    return <Ban className="h-4 w-4 text-red-500" />;
  };

  // [AUDITORIA] FIX APLICADO (Sprint Score Real + Maturador, 2026-08-09): a causa raiz do achado
  // original — `whatsapp_score ?? 100` no componente pai mostrava "Saudável" sem NENHUM cálculo
  // ter rodado. Agora o pai passa `naoCalculado=true` explicitamente nesse caso, em vez de
  // inventar um valor — mostra um estado neutro (cinza, sem nota), não "Saudável" nem "Risco".
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

  return (
    <TooltipProvider>
      <div 
        className="space-y-3 cursor-pointer group"
        onClick={() => setIsOpen(true)}
      >
        <div className="flex flex-col items-center justify-center py-2">
          <span className={`text-4xl font-black ${getFactorColor(score / 4)}`}>
            {score}
          </span>
          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
            <span>Score de Saúde</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3 w-3 opacity-50 group-hover:opacity-100 transition-opacity" />
              </TooltipTrigger>
              <TooltipContent>
                Score calculado com base em volume de disparos, taxa de resposta e histórico de bloqueios
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full ${getScoreColor(score)} transition-all duration-500`}
              style={{ width: `${score}%` }}
            />
          </div>
          <div className="flex justify-between items-center text-[10px] font-medium uppercase tracking-wider">
            <span className={getFactorColor(score / 4)}>{getScoreText(score)}</span>
            <span className="text-muted-foreground">{score}/100</span>
          </div>
        </div>

        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" />
                Detalhes do Score de Saúde
              </DialogTitle>
              <DialogDescription>
                Análise detalhada dos fatores que compõem a saúde anti-ban da sua instância.
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-4 py-4">
              <Card className="p-4 space-y-2 border-l-4 border-l-blue-500">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-semibold">Volume Diário</span>
                  </div>
                  <span className={`text-sm font-bold ${getFactorColor(fatores.volume_diario)}`}>
                    {fatores.volume_diario}/25
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Quantidade de mensagens enviadas por dia. Manter abaixo de 150 é recomendado.
                </p>
                {getFactorIcon(fatores.volume_diario)}
              </Card>

              <Card className="p-4 space-y-2 border-l-4 border-l-purple-500">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-semibold">Taxa de Resposta</span>
                  </div>
                  <span className={`text-sm font-bold ${getFactorColor(fatores.taxa_resposta)}`}>
                    {fatores.taxa_resposta}/25
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  % de destinatários que responderam. Altas taxas diminuem risco de ban.
                </p>
                {getFactorIcon(fatores.taxa_resposta)}
              </Card>

              <Card className="p-4 space-y-2 border-l-4 border-l-red-500">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Ban className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-semibold">Reclamações</span>
                  </div>
                  <span className={`text-sm font-bold ${getFactorColor(fatores.reclamacoes)}`}>
                    {fatores.reclamacoes}/25
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Pessoas que bloquearam ou reportaram o número recentemente.
                </p>
                {getFactorIcon(fatores.reclamacoes)}
              </Card>

              <Card className="p-4 space-y-2 border-l-4 border-l-green-500">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <History className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-semibold">Maturidade</span>
                  </div>
                  <span className={`text-sm font-bold ${getFactorColor(fatores.tempo_conta)}`}>
                    {fatores.tempo_conta}/25
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Tempo de uso e histórico de atividade da conta conectada.
                </p>
                {getFactorIcon(fatores.tempo_conta)}
              </Card>
            </div>

            <div className="space-y-3">
              <h4 className="text-sm font-bold flex items-center gap-2">
                <Info className="h-4 w-4 text-primary" />
                Recomendações
              </h4>
              <div className="space-y-2">
                {fatores.volume_diario < 15 && (
                  <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-xs flex gap-3">
                    <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />
                    <p>
                      <strong>Volume alto:</strong> Reduza o volume diário para menos de 100 mensagens e use delays de 15-45 segundos entre envios.
                    </p>
                  </div>
                )}
                {fatores.taxa_resposta < 15 && (
                  <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-xs flex gap-3">
                    <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />
                    <p>
                      <strong>Taxa de resposta baixa:</strong> Mensagens sem resposta aumentam o risco de ban. Melhore a segmentação da lista e personalize o conteúdo.
                    </p>
                  </div>
                )}
                {fatores.reclamacoes < 15 && (
                  <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs flex gap-3">
                    <Ban className="h-4 w-4 text-red-500 shrink-0" />
                    <p>
                      <strong>Reclamações detectadas:</strong> Número com reclamações detectadas. Pause os disparos por 48h e revise a lista de contatos.
                    </p>
                  </div>
                )}
                {fatores.tempo_conta < 15 && (
                  <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg text-xs flex gap-3">
                    <History className="h-4 w-4 text-blue-500 shrink-0" />
                    <p>
                      <strong>Conta nova:</strong> Faça aquecimento gradual: Semana 1: max 20 msg/dia, Semana 2: max 50 msg/dia, Semana 3: max 100 msg/dia.
                    </p>
                  </div>
                )}
                {score >= 90 && (
                  <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg text-xs flex gap-3">
                    <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                    <p>Sua instância está operando em condições ideais de segurança.</p>
                  </div>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
