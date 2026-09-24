import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/integrations/database/client";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Loader2, ShieldCheck, SlidersHorizontal, XCircle } from "lucide-react";
import { toast } from "sonner";
import { ScoreConfigDialog } from "@/components/leads/ScoreConfigDialog";

interface Job {
  id: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  etapa: string | null;
  total: number;
  processados: number;
  resultado: Record<string, number>;
  erro: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Lista atualmente filtrada em Leads ("todas" = sem filtro). */
  listaId: string;
  listaNome?: string;
  onConcluido: () => void;
}

const ETAPAS: Record<string, string> = {
  normalizando: "Normalizando telefones e nomes",
  validando: "Validando números no WhatsApp",
  enriquecendo: "Buscando perfil e WhatsApp Business",
  classificando: "Classificando nicho e calculando o score",
  concluido: "Concluído",
};

const ATIVO = (s?: string) => s === "queued" || s === "running";

export function HigienizarDialog({ open, onClose, listaId, listaNome, onConcluido }: Props) {
  const [escopo, setEscopo] = useState<"lista" | "todas">(listaId !== "todas" ? "lista" : "todas");
  const [validar, setValidar] = useState(true);
  const [enriquecer, setEnriquecer] = useState(true);
  const [classificar, setClassificar] = useState(true);
  const [configOpen, setConfigOpen] = useState(false);
  const [forcar, setForcar] = useState(false);
  const [iniciando, setIniciando] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const finalizadoRef = useRef<string | null>(null);

  const temLista = listaId !== "todas";

  const carregarJobAtivo = useCallback(async () => {
    try {
      const { data } = await api.get("/api/higienizacao/jobs");
      const lista: Job[] = Array.isArray(data) ? data : [];
      setJob(lista.find(j => ATIVO(j.status)) ?? lista[0] ?? null);
    } catch { /* silencioso: o diálogo só não mostra histórico */ }
  }, []);

  // Ao abrir: retoma o acompanhamento de um job já em andamento (retomável entre sessões).
  useEffect(() => {
    if (open) {
      setEscopo(temLista ? "lista" : "todas");
      finalizadoRef.current = null;
      carregarJobAtivo();
    }
  }, [open, temLista, carregarJobAtivo]);

  // Polling enquanto ativo.
  useEffect(() => {
    if (!open || !job || !ATIVO(job.status)) return;
    const t = setInterval(async () => {
      try {
        const { data } = await api.get(`/api/higienizacao/jobs/${job.id}`);
        setJob(data as Job);
      } catch { /* tenta de novo no próximo tick */ }
    }, 2500);
    return () => clearInterval(t);
  }, [open, job?.id, job?.status]);

  // Aviso único quando o job termina.
  useEffect(() => {
    if (!job || ATIVO(job.status) || finalizadoRef.current === job.id) return;
    if (!open) return;
    finalizadoRef.current = job.id;
    if (job.status === "done") {
      const r = job.resultado ?? {};
      toast.success("Higienização concluída", {
        description: `${r.validos ?? 0} válidos · ${r.sem_whatsapp ?? 0} sem WhatsApp · ${r.business ?? 0} Business · ${r.publico_b2b ?? 0} B2B`,
      });
      onConcluido();
    } else if (job.status === "failed") {
      toast.error("Higienização falhou", { description: job.erro ?? undefined });
    }
  }, [job, open, onConcluido]);

  const iniciar = async () => {
    setIniciando(true);
    try {
      const body: Record<string, unknown> = { validar, enriquecer, classificar, forcar };
      if (escopo === "lista" && temLista) body.lista_ids = [listaId];
      const { data } = await api.post("/api/higienizacao/executar", body);
      finalizadoRef.current = null;
      setJob(data.job as Job);
    } catch (err: any) {
      if (err?.status === 409) {
        toast.info("Já existe uma higienização em andamento");
        await carregarJobAtivo();
      } else {
        toast.error("Não foi possível iniciar", { description: err?.message });
      }
    } finally {
      setIniciando(false);
    }
  };

  const cancelar = async () => {
    if (!job) return;
    try {
      await api.post(`/api/higienizacao/jobs/${job.id}/cancelar`, {});
      toast.info("Cancelamento solicitado — para no próximo lote");
    } catch (err: any) {
      toast.error("Não foi possível cancelar", { description: err?.message });
    }
  };

  const ativo = ATIVO(job?.status);
  const pct = job && job.total > 0 ? Math.min(100, Math.round((job.processados / job.total) * 100)) : 0;
  const r = job?.resultado ?? {};

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" /> Higienizar lista
          </DialogTitle>
          <DialogDescription>
            Normaliza telefones, confere quais números têm WhatsApp e busca o perfil comercial. Roda em segundo plano — pode fechar esta janela.
          </DialogDescription>
        </DialogHeader>

        {ativo ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                {job!.status === "queued" ? "Na fila…" : (ETAPAS[job!.etapa ?? ""] ?? "Processando")}
              </span>
              <span className="text-muted-foreground">{job!.processados}/{job!.total}</span>
            </div>
            <Progress value={pct} />
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded border p-2"><div className="text-base font-semibold">{r.validos ?? 0}</div>válidos</div>
              <div className="rounded border p-2"><div className="text-base font-semibold">{r.sem_whatsapp ?? 0}</div>sem WhatsApp</div>
              <div className="rounded border p-2"><div className="text-base font-semibold">{r.business ?? 0}</div>Business</div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {job && (
              <div className="rounded border p-3 text-sm space-y-1">
                <div className="font-medium">
                  Última execução: {job.status === "done" ? "concluída" : job.status === "cancelled" ? "cancelada" : "falhou"}
                </div>
                {job.erro && <div className="text-destructive flex items-center gap-1"><XCircle className="h-4 w-4" />{job.erro}</div>}
                <div className="text-muted-foreground">
                  {r.validos ?? 0} válidos · {r.sem_whatsapp ?? 0} sem WhatsApp · {r.erros ?? 0} com erro · {r.business ?? 0} Business
                  {r.classificacao_total !== undefined && ` · ${r.publico_b2b ?? 0} B2B · ${r.publico_b2c ?? 0} B2C`}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-xs uppercase text-muted-foreground">Escopo</Label>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant={escopo === "lista" ? "default" : "outline"} disabled={!temLista} onClick={() => setEscopo("lista")}>
                  {temLista ? `Lista: ${listaNome ?? "selecionada"}` : "Selecione uma lista"}
                </Button>
                <Button type="button" size="sm" variant={escopo === "todas" ? "default" : "outline"} onClick={() => setEscopo("todas")}>
                  Todas as listas
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={validar} onCheckedChange={(v) => setValidar(v === true)} />
                <span>Validar números no WhatsApp<br /><span className="text-xs text-muted-foreground">Marca quem não tem WhatsApp e corrige o 9º dígito. Não repete quem foi checado há pouco.</span></span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={enriquecer} onCheckedChange={(v) => setEnriquecer(v === true)} />
                <span>Buscar perfil e WhatsApp Business<br /><span className="text-xs text-muted-foreground">Nome, categoria e site de contas comerciais. É a etapa mais lenta.</span></span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={classificar} onCheckedChange={(v) => setClassificar(v === true)} />
                <span>Classificar (nicho, B2B/B2C e score)<br /><span className="text-xs text-muted-foreground">Só regras e pesos, sem IA. Aplica as tags nicho:* e publico:*.
                  {" "}<button type="button" className="underline inline-flex items-center gap-1" onClick={(e) => { e.preventDefault(); setConfigOpen(true); }}>
                    <SlidersHorizontal className="h-3 w-3" />Configurar score e nichos
                  </button></span></span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={forcar} onCheckedChange={(v) => setForcar(v === true)} />
                <span>Reverificar também os já verificados<br /><span className="text-xs text-muted-foreground">Ignora a janela de revalidação.</span></span>
              </label>
            </div>
          </div>
        )}

        <DialogFooter>
          {ativo ? (
            <Button variant="outline" onClick={cancelar}>Cancelar higienização</Button>
          ) : (
            <Button onClick={iniciar} disabled={iniciando || (!validar && !enriquecer && !classificar)}>
              {iniciando ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-1" />}
              Iniciar higienização
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
      <ScoreConfigDialog open={configOpen} onClose={() => setConfigOpen(false)} />
    </Dialog>
  );
}
