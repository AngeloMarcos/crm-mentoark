import { useEffect, useState } from "react";
import { CRMLayout } from "@/components/CRMLayout";
import { api } from "@/integrations/database/client";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Clock,
  User,
  Flame,
  Snowflake,
  ThermometerSun,
  Loader2,
  ArrowRight,
  ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  DragOverlay,
  DragStartEvent,
} from "@dnd-kit/core";

interface StageType {
  id: string;
  nome: string;
  cor: string;
  ordem: number;
}

interface Contato {
  id: string;
  nome: string;
  telefone: string | null;
  email: string | null;
  status: string;
  origem: string | null;
  notas: string | null;
  temperatura: string;
  valor_potencial: number;
  responsavel: string;
  updated_at: string;
}

const tempIcon: Record<string, any> = { quente: Flame, morno: ThermometerSun, frio: Snowflake };
const tempColor: Record<string, string> = {
  quente: "text-destructive",
  morno: "text-warning",
  frio: "text-info",
};

function daysSince(date: string) {
  return Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
}

function taxaCor(taxa: number | null) {
  if (taxa === null) return "bg-muted text-muted-foreground";
  if (taxa > 50) return "bg-success/15 text-success border-success/30";
  if (taxa >= 20) return "bg-warning/15 text-warning border-warning/30";
  return "bg-destructive/15 text-destructive border-destructive/30";
}

// ---------- Drag/Drop sub-components ----------
function DraggableCard({ contato, stageColor, onClick }: { contato: Contato; stageColor: string; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: contato.id });
  const TempIcon = tempIcon[contato.temperatura] || Snowflake;
  const dias = daysSince(contato.updated_at);
  return (
    <Card
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onClick}
      className={`p-3 cursor-grab active:cursor-grabbing hover:border-primary/40 transition-colors border-t-2 ${isDragging ? "opacity-30" : ""}`}
      style={{ borderTopColor: stageColor }}
    >
      <div className="space-y-2 min-w-0">
        <div className="flex items-start justify-between gap-2 min-w-0">
          <p className="font-medium text-sm break-words line-clamp-2 min-w-0 flex-1">{contato.nome}</p>
          <TempIcon className={`h-4 w-4 shrink-0 ${tempColor[contato.temperatura] || "text-info"}`} />
        </div>
        {contato.origem && (
          <div className="flex flex-wrap gap-1">
            <Badge variant="outline" className="text-xs">
              {contato.origem}
            </Badge>
          </div>
        )}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <User className="h-3 w-3" />
            {contato.responsavel}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {dias}d
          </span>
        </div>
        {Number(contato.valor_potencial) > 0 && (
          <p className="text-xs font-medium text-primary">
            R$ {Number(contato.valor_potencial).toLocaleString("pt-BR")}
          </p>
        )}
      </div>
    </Card>
  );
}

function DroppableColumn({ stageId, children }: { stageId: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: stageId });
  return (
    <div
      ref={setNodeRef}
      className={`space-y-2 flex-1 min-h-[120px] rounded-lg p-1 transition-colors ${isOver ? "bg-primary/5 ring-2 ring-primary/30" : ""}`}
    >
      {children}
    </div>
  );
}

export default function FunilPage() {
  const { user } = useAuth();
  const [contatos, setContatos] = useState<Contato[]>([]);
  const [stages, setStages] = useState<StageType[]>([]);
  const [loading, setLoading] = useState(true);
  const [selecionado, setSelecionado] = useState<Contato | null>(null);
  const [movendo, setMovendo] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const carregar = async () => {
    if (!user) return;
    setLoading(true);

    // Carregar estágios do funil personalizados
    const { data: stageData, error: stageError } = await supabase
      .from("funil_estagios" as any)
      .select("*")
      .order("ordem", { ascending: true });

    if (stageError) {
      toast.error("Erro ao carregar estágios do funil");
    } else if (stageData && stageData.length > 0) {
      setStages(stageData as any);
    } else {
      // Estágios padrão se não houver configurados
      const defaults = [
        { id: "novo", nome: "Novo", cor: "#3b82f6", ordem: 0 },
        { id: "contatado", nome: "Contatado", cor: "#6366f1", ordem: 1 },
        { id: "qualificado", nome: "Qualificado", cor: "#22c55e", ordem: 2 },
        { id: "agendado", nome: "Agendado", cor: "#8b5cf6", ordem: 3 },
        { id: "fechado", nome: "Fechado", cor: "#10b981", ordem: 4 },
        { id: "perdido", nome: "Perdido", cor: "#ef4444", ordem: 5 },
      ];
      setStages(defaults);
    }

    const { data, error } = await api
      .from("contatos")
      .select("*")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });

    if (error) {
      toast.error("Erro ao carregar contatos");
    } else {
      setContatos((data ?? []) as Contato[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    carregar();
  }, [user?.id]);

  const moverParaEtapa = async (contatoId: string, novaEtapaId: string) => {
    const anterior = contatos.find((c) => c.id === contatoId);
    if (!anterior || anterior.status === novaEtapaId) return;

    setContatos((prev) =>
      prev.map((c) => (c.id === contatoId ? { ...c, status: novaEtapaId } : c)),
    );

    const { error } = await api
      .from("contatos")
      .update({ status: novaEtapaId })
      .eq("id", contatoId);

    if (error) {
      toast.error("Erro ao mover");
      carregar();
    } else {
      const stage = stages.find(s => s.id === novaEtapaId);
      toast.success(`Movido para ${stage?.nome || novaEtapaId}`);
    }
  };

  const handleDragStart = (e: DragStartEvent) => {
    setActiveId(String(e.active.id));
  };

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const novaEtapaId = String(over.id);
    moverParaEtapa(String(active.id), novaEtapaId);
  };

  const proximaEtapaId = (status: string) => {
    const idx = stages.findIndex(s => s.id === status);
    return (idx !== -1 && idx < stages.length - 1) ? stages[idx + 1].id : null;
  };

  const etapaAnteriorId = (status: string) => {
    const idx = stages.findIndex(s => s.id === status);
    return (idx > 0) ? stages[idx - 1].id : null;
  };

  const getStageName = (id: string) => stages.find(s => s.id === id)?.nome || id;

  const moverProximaEtapa = async () => {
    if (!selecionado) return;
    const prox = proximaEtapaId(selecionado.status);
    if (!prox) return;
    setMovendo(true);
    await moverParaEtapa(selecionado.id, prox);
    setMovendo(false);
    setSelecionado(null);
  };

  const moverEtapaAnterior = async () => {
    if (!selecionado) return;
    const ant = etapaAnteriorId(selecionado.status);
    if (!ant) return;
    setMovendo(true);
    await moverParaEtapa(selecionado.id, ant);
    setMovendo(false);
    setSelecionado(null);
  };

  const taxas = stages.slice(0, -1).map((s, i) => {
    const a = contatos.filter((c) => c.status === s.id).length;
    const b = contatos.filter((c) => c.status === stages[i + 1].id).length;
    return { de: s.nome, para: stages[i + 1].nome, taxa: a > 0 ? Math.round((b / a) * 100) : null };
  });

  const contatoArrastando = activeId ? contatos.find((c) => c.id === activeId) : null;

  return (
    <CRMLayout>
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Funil de Vendas</h1>
            <p className="text-muted-foreground text-sm">
              Pipeline visual da operação comercial
            </p>
          </div>
        </div>

        {!loading && contatos.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg bg-muted/40 border border-border">
            <span className="text-xs text-muted-foreground font-medium">Conversão:</span>
            {taxas.map((t, i) => (
              <div key={i} className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground capitalize">{t.de}</span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground capitalize">{t.para}</span>
                <Badge variant="outline" className={`text-xs border ${taxaCor(t.taxa)}`}>
                  {t.taxa === null ? "—" : `${t.taxa}%`}
                </Badge>
              </div>
            ))}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <div className="flex gap-3 overflow-x-auto pb-4 items-start">
              {stages.map((stage) => {
                const etapaContatos = contatos.filter((c) => c.status === stage.id);
                const valorTotal = etapaContatos.reduce((s, c) => s + (Number(c.valor_potencial) || 0), 0);
                return (
                  <div key={stage.id} className="min-w-[280px] w-[280px] flex-shrink-0 flex flex-col">
                    <div className="flex items-center justify-between mb-3 px-1">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: stage.cor }} />
                        <h3 className="font-semibold text-sm truncate">{stage.nome}</h3>
                        <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
                          {etapaContatos.length}
                        </Badge>
                      </div>
                      {valorTotal > 0 && (
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                          R$ {(valorTotal / 1000).toFixed(1)}k
                        </span>
                      )}
                    </div>

                    <DroppableColumn stageId={stage.id}>
                      {etapaContatos.map((contato) => (
                        <DraggableCard
                          key={contato.id}
                          contato={contato}
                          stageColor={stage.cor}
                          onClick={() => setSelecionado(contato)}
                        />
                      ))}
                      {etapaContatos.length === 0 && (
                        <div className="border border-dashed border-border rounded-lg p-6 text-center text-[10px] text-muted-foreground uppercase tracking-wider">
                          Nenhum lead
                        </div>
                      )}
                    </DroppableColumn>
                  </div>
                );
              })}
            </div>
            <DragOverlay>
              {contatoArrastando ? (
                <Card className="p-3 border-t-2 shadow-xl cursor-grabbing scale-105" style={{ borderTopColor: stages.find(s => s.id === contatoArrastando.status)?.cor }}>
                  <p className="font-medium text-sm">{contatoArrastando.nome}</p>
                </Card>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      <Dialog open={!!selecionado} onOpenChange={(o) => !o && setSelecionado(null)}>
        <DialogContent>
          {selecionado && (
            <>
              <DialogHeader>
                <DialogTitle>{selecionado.nome}</DialogTitle>
                <DialogDescription>
                  Etapa: <Badge variant="secondary" className="ml-1">{getStageName(selecionado.status)}</Badge>
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-4 text-sm">
                {selecionado.telefone && (
                  <div>
                    <p className="text-muted-foreground text-xs uppercase tracking-wider">Telefone</p>
                    <p className="font-medium">{selecionado.telefone}</p>
                  </div>
                )}
                {selecionado.email && (
                  <div>
                    <p className="text-muted-foreground text-xs uppercase tracking-wider">E-mail</p>
                    <p className="font-medium">{selecionado.email}</p>
                  </div>
                )}
                <div>
                  <p className="text-muted-foreground text-xs uppercase tracking-wider">Notas</p>
                  <p className="whitespace-pre-wrap bg-muted/50 p-3 rounded-lg mt-1">
                    {selecionado.notas || <span className="text-muted-foreground italic">Sem notas adicionais.</span>}
                  </p>
                </div>
              </div>

              <DialogFooter className="flex-wrap gap-2">
                <Button variant="outline" onClick={() => setSelecionado(null)}>Fechar</Button>
                {etapaAnteriorId(selecionado.status) && (
                  <Button variant="outline" onClick={moverEtapaAnterior} disabled={movendo}>
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    {getStageName(etapaAnteriorId(selecionado.status)!)}
                  </Button>
                )}
                {proximaEtapaId(selecionado.status) && (
                  <Button onClick={moverProximaEtapa} disabled={movendo} className="gradient-brand">
                    {movendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4 mr-2" />}
                    {getStageName(proximaEtapaId(selecionado.status)!)}
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </CRMLayout>
  );
}
