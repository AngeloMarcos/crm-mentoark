import { useEffect, useState } from "react";
import { Bot, BotOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { acaoAtendimento, tempoRestantePausa } from "@/lib/atendimento";

const OPCOES: { rotulo: string; minutos: number | null }[] = [
  { rotulo: "Por 30 minutos", minutos: 30 },
  { rotulo: "Por 1 hora", minutos: 60 },
  { rotulo: "Por 4 horas", minutos: 240 },
  { rotulo: "Até eu devolver", minutos: null },
];

interface Props {
  atendimentoId: string;
  pausada: boolean;
  ate: string | null;
  onMudou: () => void;
}

/** Botão de estado da IA no cabeçalho da conversa, com pausa por tempo e tempo restante visível. */
export function MenuPausaIA({ atendimentoId, pausada, ate, onMudou }: Props) {
  const [salvando, setSalvando] = useState(false);
  const [, setTique] = useState(0);

  useEffect(() => {
    if (!ate) return;
    const t = setInterval(() => setTique(n => n + 1), 30_000);
    return () => clearInterval(t);
  }, [ate]);

  const executar = async (acao: string, corpo: Record<string, unknown>, sucesso: string) => {
    setSalvando(true);
    try {
      await acaoAtendimento(atendimentoId, acao, corpo);
      toast.success(sucesso);
      onMudou();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSalvando(false);
    }
  };

  const restante = pausada ? tempoRestantePausa(ate) : null;
  const rotulo = !pausada ? "IA Ativa" : restante ? `IA pausada · ${restante}` : "IA Pausada";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          disabled={salvando}
          aria-label={`${rotulo}. Abrir opções de pausa da IA`}
          title={rotulo}
          className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-full text-xs font-bold border transition-all active:scale-95 ${
            pausada
              ? "bg-warning/15 border-warning/40 text-warning hover:bg-warning/25"
              : "bg-success/15 border-success/40 text-success hover:bg-success/25"
          }`}
        >
          {salvando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : pausada ? <BotOff className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline tabular-nums">{rotulo}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="text-xs">{pausada ? "Mudar a pausa da IA" : "Pausar a IA nesta conversa"}</DropdownMenuLabel>
        {OPCOES.map(o => (
          <DropdownMenuItem key={o.rotulo} onClick={() => executar("pausar-ia", { minutos: o.minutos }, o.minutos ? `IA pausada: ${o.rotulo.toLowerCase()}` : "IA pausada até você devolver")}>
            {o.rotulo}
          </DropdownMenuItem>
        ))}
        {pausada && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="font-semibold text-success" onClick={() => executar("devolver-ia", {}, "IA devolvida")}>
              <Bot className="h-4 w-4 mr-2" /> Devolver à IA
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
