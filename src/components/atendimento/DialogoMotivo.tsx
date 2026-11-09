import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { lerConfigAtendimento, listarMotivos, type Atendente, type Motivo, type TipoMotivo } from "@/lib/atendimento";

const SEM_MOTIVO = "__sem_motivo__";

export interface ResultadoMotivo { motivo_id?: string; atendente_id?: string; manter_ia_pausada?: boolean }

interface Props {
  titulo: string;
  descricao: string;
  botao: string;
  tipo: TipoMotivo;
  /** Transferir: lista de quem pode receber. */
  atendentes?: Atendente[];
  /** Resolver: oferece manter a IA pausada. */
  oferecerManterPausa?: boolean;
  onConfirmar: (r: ResultadoMotivo) => Promise<void>;
  onFechar: () => void;
}

/** Diálogo usado por Transferir e Resolver. */
export function DialogoMotivo({ titulo, descricao, botao, tipo, atendentes, oferecerManterPausa, onConfirmar, onFechar }: Props) {
  const [motivos, setMotivos] = useState<Motivo[]>([]);
  const [obrigatorio, setObrigatorio] = useState(false);
  const [motivoId, setMotivoId] = useState(SEM_MOTIVO);
  const [atendenteId, setAtendenteId] = useState("");
  const [manterPausa, setManterPausa] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    listarMotivos(tipo).then(setMotivos).catch(() => setMotivos([]));
    lerConfigAtendimento().then(c => setObrigatorio(c.motivo_obrigatorio)).catch(() => {});
  }, [tipo]);

  const faltaAtendente = !!atendentes && !atendenteId;
  const faltaMotivo = obrigatorio && motivoId === SEM_MOTIVO;

  const confirmar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      await onConfirmar({
        ...(motivoId !== SEM_MOTIVO ? { motivo_id: motivoId } : {}),
        ...(atendentes ? { atendente_id: atendenteId } : {}),
        ...(oferecerManterPausa ? { manter_ia_pausada: manterPausa } : {}),
      });
    } catch (e: any) {
      setErro(e.message);
      setSalvando(false);
    }
  };

  return (
    <Dialog open onOpenChange={o => { if (!o && !salvando) onFechar(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>{descricao}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          {atendentes && (
            <div className="space-y-1.5">
              <Label>Para quem</Label>
              <Select value={atendenteId} onValueChange={setAtendenteId}>
                <SelectTrigger><SelectValue placeholder="Escolha o atendente" /></SelectTrigger>
                <SelectContent>
                  {atendentes.map(a => <SelectItem key={a.id} value={a.id}>{a.display_name || a.email}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Motivo {obrigatorio ? <span className="text-destructive">*</span> : <span className="font-normal text-muted-foreground">(opcional)</span>}</Label>
            <Select value={motivoId} onValueChange={setMotivoId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {!obrigatorio && <SelectItem value={SEM_MOTIVO}>Sem motivo</SelectItem>}
                {obrigatorio && motivoId === SEM_MOTIVO && <SelectItem value={SEM_MOTIVO} disabled>Escolha o motivo</SelectItem>}
                {motivos.map(m => <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {oferecerManterPausa && (
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <Checkbox checked={manterPausa} onCheckedChange={v => setManterPausa(v === true)} className="mt-0.5" />
              <span>Manter a IA pausada <span className="block text-xs text-muted-foreground">Por padrão, resolver devolve a conversa para a IA.</span></span>
            </label>
          )}
          {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={salvando}>Cancelar</Button>
          <Button onClick={confirmar} disabled={salvando || faltaAtendente || faltaMotivo}>
            {salvando && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {botao}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
