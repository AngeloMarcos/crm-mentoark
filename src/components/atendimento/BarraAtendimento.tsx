import { useEffect, useState } from "react";
import { ArrowRightLeft, CheckCircle2, Hand, Loader2, RotateCcw, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import {
  abrirAtendimento, acaoAtendimento, listarAtendentes,
  type Atendente, type ConversaAtendimento, type EstadoAtendimento,
} from "@/lib/atendimento";
import { DialogoMotivo, type ResultadoMotivo } from "./DialogoMotivo";

const ESTADOS: Record<EstadoAtendimento, { rotulo: string; classe: string }> = {
  aberto: { rotulo: "Aberto", classe: "bg-success/15 text-success border-success/30" },
  aguardando: { rotulo: "Aguardando humano", classe: "bg-warning/15 text-warning border-warning/40" },
  resolvido: { rotulo: "Resolvido", classe: "bg-muted text-muted-foreground border-border" },
};

const nomeDe = (a: Atendente) => a.display_name || a.email;

interface Props {
  dados: ConversaAtendimento | null;
  instancia: string;
  jid: string;
  onMudou: () => void;
}

/** Faixa abaixo do cabeçalho da conversa: estado, atendente e as ações do atendimento. */
export function BarraAtendimento({ dados, instancia, jid, onMudou }: Props) {
  const { user } = useAuth();
  const [atendentes, setAtendentes] = useState<Atendente[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [dialogo, setDialogo] = useState<"transferir" | "resolver" | null>(null);

  useEffect(() => { listarAtendentes().then(setAtendentes).catch(() => setAtendentes([])); }, []);

  const executar = async (fn: () => Promise<unknown>, sucesso: string) => {
    setSalvando(true);
    try {
      await fn();
      toast.success(sucesso);
      onMudou();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSalvando(false);
    }
  };

  if (!dados) return null;
  const at = dados.atendimento;

  if (!at) {
    return (
      <div className="flex items-center justify-between gap-2 border-b bg-card/40 px-3 sm:px-4 py-1.5 shrink-0">
        <span className="text-xs text-muted-foreground">Sem atendimento em andamento</span>
        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={salvando}
          onClick={() => executar(() => abrirAtendimento(instancia, jid), "Atendimento iniciado")}>
          {salvando ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Hand className="h-3.5 w-3.5 mr-1.5" />}
          Iniciar atendimento
        </Button>
      </div>
    );
  }

  const estado = ESTADOS[at.estado];
  const resolvido = at.estado === "resolvido";
  const outros = atendentes.filter(a => a.id !== at.atendente_id);
  const concluir = async (acao: string, corpo: ResultadoMotivo, sucesso: string) => {
    await acaoAtendimento(at.id, acao, { ...corpo });
    toast.success(sucesso);
    setDialogo(null);
    onMudou();
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b bg-card/40 px-3 sm:px-4 py-1.5 shrink-0">
      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${estado.classe}`}>{estado.rotulo}</span>
      <span className="inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
        <UserRound className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate max-w-[140px] sm:max-w-[220px]">{at.atendente_nome || "Sem atendente"}</span>
      </span>

      <div className="ml-auto flex items-center gap-1">
        {resolvido ? (
          <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={salvando}
            onClick={() => executar(() => acaoAtendimento(at.id, "reabrir"), "Atendimento reaberto")}>
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Reabrir
          </Button>
        ) : (
          <>
            {at.atendente_id !== user?.id && (
              <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={salvando}
                onClick={() => executar(() => acaoAtendimento(at.id, "atribuir"), "Atendimento assumido")}>
                <Hand className="h-3.5 w-3.5 mr-1.5" /> Assumir
              </Button>
            )}
            {atendentes.length > 1 && !at.atendente_id && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={salvando}>
                    <UserRound className="h-3.5 w-3.5 mr-1.5" /> Atribuir
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {atendentes.map(a => (
                    <DropdownMenuItem key={a.id} onClick={() => executar(() => acaoAtendimento(at.id, "atribuir", { atendente_id: a.id }), `Atribuído a ${nomeDe(a)}`)}>
                      {nomeDe(a)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {at.atendente_id && outros.length > 0 && (
              <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={salvando} onClick={() => setDialogo("transferir")}>
                <ArrowRightLeft className="h-3.5 w-3.5 mr-1.5" /> Transferir
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-7 text-xs text-success hover:text-success" disabled={salvando} onClick={() => setDialogo("resolver")}>
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Resolver
            </Button>
          </>
        )}
      </div>

      {dialogo === "transferir" && (
        <DialogoMotivo
          titulo="Transferir atendimento"
          descricao="A conversa passa para outra pessoa da equipe e o histórico registra o motivo."
          botao="Transferir"
          tipo="transferencia"
          atendentes={outros}
          onConfirmar={r => concluir("transferir", r, "Atendimento transferido")}
          onFechar={() => setDialogo(null)}
        />
      )}
      {dialogo === "resolver" && (
        <DialogoMotivo
          titulo="Resolver atendimento"
          descricao="A próxima mensagem do cliente abre um novo atendimento."
          botao="Resolver"
          tipo="resolucao"
          oferecerManterPausa
          onConfirmar={r => concluir("resolver", r, "Atendimento resolvido")}
          onFechar={() => setDialogo(null)}
        />
      )}
    </div>
  );
}
