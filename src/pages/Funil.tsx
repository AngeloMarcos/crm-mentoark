import { useEffect, useState } from "react";
import { CRMLayout } from "@/components/CRMLayout";
import { api } from "@/integrations/database/client";
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

type FunilStatus = "novo" | "contatado" | "qualificado" | "agendado" | "fechado" | "perdido";

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

const etapas: FunilStatus[] = ["novo", "contatado", "qualificado", "agendado", "fechado", "perdido"];

const etapaLabel: Record<FunilStatus, string> = {
  novo: "Novo",
  contatado: "Contatado",
  qualificado: "Qualificado",
  agendado: "Agendado",
  fechado: "Fechado",
  perdido: "Perdido",
};

const etapaCor: Record<FunilStatus, string> = {
  novo: "border-t-info",
  contatado: "border-t-primary",
  qualificado: "border-t-success",
  agendado: "border-t-accent",
  fechado: "border-t-success",
  perdido: "border-t-destructive",
};

const tempIcon: Record<string, any> = { quente: Flame, morno: ThermometerSun, frio: Snowflake };
const tempColor: Record<string, string> = {
  quente: "text-destructive",
  morno: "text-warning",
  frio: "text-info",
};

function daysSince(date: string) {
  return Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
}

function proximaEtapa(status: string): FunilStatus | null {
  if (status === "fechado" || status === "perdido") return null;
  const idx = etapas.indexOf(status as FunilStatus);
  return idx === -1 || idx >= etapas.length - 1 ? null : etapas[idx + 1];
}

function etapaAnterior(status: string): FunilStatus | null {
  const idx = etapas.indexOf(status as FunilStatus);
  return idx > 0 ? etapas[idx - 1] : null;
}

function taxaCor(taxa: number | null) {
  if (taxa === null) return "bg-muted text-muted-foreground";
  if (taxa > 50) return "bg-success/15 text-success border-success/30";
  if (taxa >= 20) return "bg-warning/15 text-warning border-warning/30";
  return "bg-destructive/15 text-destructive border-destructive/30";
}

// ---------- Drag/Drop sub-components ----------
function DraggableCard({ contato, onClick }: { contato: Contato; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: contato.id });
  const TempIcon = tempIcon[contato.temperatura] || Snowflake;
  const dias = daysSince(contato.updated_at);
  return (
    <Card
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onClick}
      className={`p-3 cursor-grab active:cursor-grabbing hover:border-primary/40 transition-colors border-t-2 ${etapaCor[contato.status as FunilStatus] ?? ""} ${isDragging ? "opacity-30" : ""}`}
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

function DroppableColumn({ etapa, children }: { etapa: FunilStatus; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: etapa });
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
  const [loading, setLoading] = useState(true);
  const [selecionado, setSelecionado] = useState<Contato | null>(null);
  const [movendo, setMovendo] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const carregar = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await api
      .from("contatos")
      .select("*")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });

    if (error) {
      toast.error("Erro ao carregar contatos");
      setLoading(false);
      return;
    }
    setContatos((data ?? []) as Contato[]);
    setLoading(false);
  };

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const moverParaEtapa = async (contatoId: string, novaEtapa: FunilStatus) => {
    const anterior = contatos.find((c) => c.id === contatoId);
    if (!anterior || anterior.status === novaEtapa) return;
    setContatos((prev) =>
      prev.map((c) => (c.id === contatoId ? { ...c, status: novaEtapa } : c)),
    );
    const { error } = await api
      .from("contatos")
      .update({ status: novaEtapa })
      .eq("id", contatoId);
    if (error) {
      toast.error("Erro ao mover");
      carregar();
    } else {
      toast.success(`Movido para ${etapaLabel[novaEtapa]}`);
    }
  };

  const handleDragStart = (e: DragStartEvent) => {
    setActiveId(String(e.active.id));
  };

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const novaEtapa = String(over.id) as FunilStatus;
    if (!etapas.includes(novaEtapa)) return;
    moverParaEtapa(String(active.id), novaEtapa);
  };

  const moverProximaEtapa = async () => {
    if (!selecionado) return;
    const prox = proximaEtapa(selecionado.status);
    if (!prox) {
      toast.info("Este contato já está na etapa final.");
      return;
    }
    setMovendo(true);
    await moverParaEtapa(selecionado.id, prox);
    setMovendo(false);
    setSelecionado(null);
  };

  const moverEtapaAnterior = async () => {
    if (!selecionado) return;
    const ant = etapaAnterior(selecionado.status);
    if (!ant) {
      toast.info("Já está na primeira etapa.");
      return;
    }
    setMovendo(true);
    await moverParaEtapa(selecionado.id, ant);
    setMovendo(false);
    setSelecionado(null);
  };

  // Taxas de conversão entre etapas sequenciais
  const sequencia: FunilStatus[] = ["novo", "contatado", "qualificado", "agendado", "fechado"];
  const taxas = sequencia.slice(0, -1).map((e, i) => {
    const a = contatos.filter((c) => c.status === e).length;
    const b = contatos.filter((c) => c.status === sequencia[i + 1]).length;
    return { de: e, para: sequencia[i + 1], taxa: a > 0 ? Math.round((b / a) * 100) : null };
  });

  const contatoArrastando = activeId ? contatos.find((c) => c.id === activeId) : null;

  return (
    <CRMLayout>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Funil de Vendas</h1>
          <p className="text-muted-foreground text-sm">
            Pipeline visual da operação comercial — arraste cards entre colunas para mover
          </p>
        </div>

        {/* Taxa de conversão entre etapas */}
        {!loading && contatos.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg bg-muted/40 border border-border">
            <span className="text-xs text-muted-foreground font-medium">Conversão:</span>
            {taxas.map((t) => (
              <div key={t.de} className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground capitalize">{etapaLabel[t.de]}</span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground capitalize">
                  {etapaLabel[t.para]}
                </span>
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
            <div className="flex gap-3 overflow-x-auto pb-4">
              {etapas.map((etapa) => {
                const etapaContatos = contatos.filter((c) => c.status === etapa);
                const valorTotal = etapaContatos.reduce(
                  (s, c) => s + (Number(c.valor_potencial) || 0),
                  0,
                );
                return (
                  <div key={etapa} className="min-w-[260px] flex-shrink-0 flex flex-col">
                    <div className="flex items-center justify-between mb-3 px-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-sm">{etapaLabel[etapa]}</h3>
                        <Badge variant="secondary" className="text-xs">
                          {etapaContatos.length}
                        </Badge>
                      </div>
                      {valorTotal > 0 && (
                        <span className="text-xs text-muted-foreground">
                          R$ {(valorTotal / 1000).toFixed(1)}k
                        </span>
                      )}
                    </div>

                    <DroppableColumn etapa={etapa}>
                      {etapaContatos.map((contato) => (
                        <DraggableCard
                          key={contato.id}
                          contato={contato}
                          onClick={() => setSelecionado(contato)}
                        />
                      ))}
                      {etapaContatos.length === 0 && (
                        <div className="border border-dashed border-border rounded-lg p-6 text-center text-xs text-muted-foreground">
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
                <Card className="p-3 border-t-2 border-t-primary shadow-lg cursor-grabbing">
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
                  Etapa atual:{" "}
                  <Badge variant="secondary" className="ml-1">
                    {etapaLabel[selecionado.status as FunilStatus] ?? selecionado.status}
                  </Badge>
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3 text-sm">
                {selecionado.telefone && (
                  <div>
                    <p className="text-muted-foreground text-xs">Telefone</p>
                    <p>{selecionado.telefone}</p>
                  </div>
                )}
                {selecionado.email && (
                  <div>
                    <p className="text-muted-foreground text-xs">E-mail</p>
                    <p>{selecionado.email}</p>
                  </div>
                )}
                <div>
                  <p className="text-muted-foreground text-xs">Notas</p>
                  <p className="whitespace-pre-wrap">
                    {selecionado.notas || (
                      <span className="text-muted-foreground italic">Sem notas</span>
                    )}
                  </p>
                </div>
              </div>

              <DialogFooter className="flex-wrap gap-2">
                <Button variant="outline" onClick={() => setSelecionado(null)}>
                  Fechar
                </Button>
                {etapaAnterior(selecionado.status) && (
                  <Button variant="outline" onClick={moverEtapaAnterior} disabled={movendo}>
                    <ArrowLeft className="h-4 w-4" />
                    {etapaLabel[etapaAnterior(selecionado.status)!]}
                  </Button>
                )}
                {proximaEtapa(selecionado.status) && (
                  <Button onClick={moverProximaEtapa} disabled={movendo}>
                    {movendo ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ArrowRight className="h-4 w-4" />
                    )}
                    {etapaLabel[proximaEtapa(selecionado.status)!]}
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
