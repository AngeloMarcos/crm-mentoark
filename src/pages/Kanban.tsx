import { useEffect, useState, useMemo, useRef } from "react";
import {
  LayoutGrid, Plus, Search, X, SlidersHorizontal, Check,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/integrations/database/client";
import { CRMLayout } from "@/components/CRMLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import {
  DndContext, DragEndEvent, DragOverEvent, DragStartEvent,
  PointerSensor, useSensor, useSensors, DragOverlay,
  closestCorners,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import KanbanColuna from "@/components/kanban/KanbanColuna";
import KanbanCard, { Tarefa } from "@/components/kanban/KanbanCard";
import ModalTarefa from "@/components/kanban/ModalTarefa";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Coluna {
  id: string;
  nome: string;
  cor: string;
  ordem: number;
  limite_wip?: number | null;
}

const CORES_COLUNA = [
  "#f1f5f9", "#dbeafe", "#fef9c3", "#dcfce7",
  "#fce7f3", "#ede9fe", "#ffedd5", "#e0f2fe",
];

const KanbanPage = () => {
  const { session } = useAuth();

  const [colunas, setColunas]   = useState<Coluna[]>([]);
  const [tarefas, setTarefas]   = useState<Tarefa[]>([]);
  const [membros, setMembros]   = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Filtros
  const [busca, setBusca]                   = useState("");
  const [filtroMembro, setFiltroMembro]     = useState<string | null>(null);
  const [filtroPrioridade, setFiltroPrioridade] = useState<string | null>(null);
  const [filtroOrigem, setFiltroOrigem]     = useState<string | null>(null);
  const [filtroOpen, setFiltroOpen]         = useState(false);

  // Modal de tarefa
  const [modalAberto, setModalAberto]         = useState(false);
  const [tarefaEditando, setTarefaEditando]   = useState<Tarefa | undefined>();
  const [colunaInicial, setColunaInicial]     = useState<string | undefined>();

  // Modal nova coluna
  const [novaColOpen, setNovaColOpen]   = useState(false);
  const [novaColNome, setNovaColNome]   = useState("");
  const [novaColCor, setNovaColCor]     = useState(CORES_COLUNA[0]);
  const [salvandoCol, setSalvandoCol]   = useState(false);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // ── Dados ─────────────────────────────────────────────────────────────────

  const carregarDados = async () => {
    setLoading(true);
    try {
      const [colRes, tarRes, memRes] = await Promise.all([
        api.get("/api/kanban/colunas"),
        api.get("/api/kanban/tarefas"),
        api.from("sub_perfis").select("*").eq("ativo", true),
      ]);
      setColunas((colRes.data || []).sort((a: Coluna, b: Coluna) => a.ordem - b.ordem));
      setTarefas(tarRes.data || []);
      setMembros(memRes.data || []);
    } catch {
      toast.error("Erro ao carregar o Kanban");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { carregarDados(); }, []);

  // ── Filtros ───────────────────────────────────────────────────────────────

  const tarefasFiltradas = useMemo(() => {
    return tarefas.filter((t) => {
      const q = busca.toLowerCase();
      const matchBusca   = !busca || t.titulo.toLowerCase().includes(q) || (t.descricao || "").toLowerCase().includes(q);
      const matchMembro  = !filtroMembro || t.atribuido_a === filtroMembro;
      const matchPrio    = !filtroPrioridade || t.prioridade === filtroPrioridade;
      const matchOrigem  = !filtroOrigem || (t.origem || "manual") === filtroOrigem;
      return matchBusca && matchMembro && matchPrio && matchOrigem;
    });
  }, [tarefas, busca, filtroMembro, filtroPrioridade, filtroOrigem]);

  const filtrosAtivos = [filtroMembro, filtroPrioridade, filtroOrigem].filter(Boolean).length;

  const limparFiltros = () => {
    setFiltroMembro(null);
    setFiltroPrioridade(null);
    setFiltroOrigem(null);
    setBusca("");
  };

  // ── CRUD tarefas ──────────────────────────────────────────────────────────

  const handleCriarInline = async (colunaId: string, titulo: string) => {
    const { data: nova } = await api.post("/api/kanban/tarefas", {
      titulo, coluna_id: colunaId, prioridade: "media", origem: "manual",
    });
    setTarefas((prev) => [...prev, nova]);
    toast.success("Tarefa criada");
  };

  const handleSalvarTarefa = async (dados: any) => {
    try {
      if (tarefaEditando) {
        const { data: atualizada } = await api.patch(`/api/kanban/tarefas/${tarefaEditando.id}`, dados);
        setTarefas((prev) => prev.map((t) => (t.id === tarefaEditando.id ? atualizada : t)));
        toast.success("Tarefa atualizada");
      } else {
        const { data: nova } = await api.post("/api/kanban/tarefas", { ...dados, origem: "manual" });
        setTarefas((prev) => [...prev, nova]);
        toast.success("Tarefa criada");
      }
      setModalAberto(false);
    } catch {
      toast.error("Erro ao salvar tarefa");
    }
  };

  const handleExcluirTarefa = async (id: string) => {
    try {
      await api.delete(`/api/kanban/tarefas/${id}`);
      setTarefas((prev) => prev.filter((t) => t.id !== id));
      toast.success("Tarefa excluída");
      setModalAberto(false);
    } catch {
      toast.error("Erro ao excluir tarefa");
    }
  };

  // ── CRUD colunas ──────────────────────────────────────────────────────────

  const handleCriarColuna = async () => {
    if (!novaColNome.trim()) return;
    setSalvandoCol(true);
    try {
      const { data: nova } = await api.post("/api/kanban/colunas", {
        nome: novaColNome.trim(),
        cor: novaColCor,
        ordem: colunas.length,
      });
      setColunas((prev) => [...prev, nova]);
      setNovaColOpen(false);
      setNovaColNome("");
      toast.success("Coluna criada");
    } catch {
      toast.error("Erro ao criar coluna");
    } finally {
      setSalvandoCol(false);
    }
  };

  const handleRenomearColuna = async (id: string, nome: string) => {
    await api.patch(`/api/kanban/colunas/${id}`, { nome });
    setColunas((prev) => prev.map((c) => (c.id === id ? { ...c, nome } : c)));
  };

  const handleExcluirColuna = async (id: string) => {
    await api.delete(`/api/kanban/colunas/${id}`);
    setColunas((prev) => prev.filter((c) => c.id !== id));
    toast.success("Coluna excluída");
  };

  // ── Drag & Drop ───────────────────────────────────────────────────────────

  const handleDragStart = ({ active }: DragStartEvent) => {
    setActiveId(active.id as string);
  };

  const handleDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    const activeCard = tarefas.find((t) => t.id === active.id);
    if (!activeCard) return;

    const overId = over.id as string;
    const overIsColuna = colunas.some((c) => c.id === overId);
    const overCard = tarefas.find((t) => t.id === overId);

    const targetColunaId = overIsColuna ? overId : overCard?.coluna_id;
    if (!targetColunaId || targetColunaId === activeCard.coluna_id) return;

    // Mover optimisticamente para nova coluna
    setTarefas((prev) => prev.map((t) =>
      t.id === activeCard.id ? { ...t, coluna_id: targetColunaId } : t
    ));
  };

  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    if (!over || active.id === over.id) return;

    const activeCard = tarefas.find((t) => t.id === active.id);
    if (!activeCard) return;

    const overId = over.id as string;
    const overIsColuna = colunas.some((c) => c.id === overId);
    const overCard = tarefas.find((t) => t.id === overId);

    const targetColunaId = overIsColuna ? overId : overCard?.coluna_id ?? activeCard.coluna_id;
    const colTarefas = tarefas.filter((t) => t.coluna_id === targetColunaId);

    let newOrdem: number;
    if (overIsColuna || !overCard) {
      newOrdem = colTarefas.length;
    } else {
      newOrdem = overCard.ordem;
    }

    // Reordenar estado local
    if (!overIsColuna && overCard && targetColunaId === activeCard.coluna_id) {
      const oldIdx = colTarefas.findIndex((t) => t.id === active.id);
      const newIdx = colTarefas.findIndex((t) => t.id === over.id);
      if (oldIdx !== -1 && newIdx !== -1) {
        const reordenadas = arrayMove(colTarefas, oldIdx, newIdx).map((t, i) => ({ ...t, ordem: i }));
        setTarefas((prev) => {
          const outras = prev.filter((t) => t.coluna_id !== targetColunaId);
          return [...outras, ...reordenadas];
        });
      }
    }

    // Salvar no servidor
    try {
      await api.patch(`/api/kanban/tarefas/${active.id}/mover`, {
        coluna_id: targetColunaId,
        ordem: newOrdem,
      });
    } catch {
      toast.error("Erro ao mover tarefa");
      carregarDados();
    }
  };

  const activeTarefa = activeId ? tarefas.find((t) => t.id === activeId) : null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <CRMLayout>
      <div className="flex flex-col h-full gap-4 p-4">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-border bg-card/60 backdrop-blur-sm px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <LayoutGrid className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground leading-tight">Quadro de Tarefas</h1>
              <p className="text-xs text-muted-foreground">{tarefas.length} tarefas em {colunas.length} colunas</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Busca */}
            <div className="relative w-full sm:w-52">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Pesquisar..."
                className="pl-9 h-8 text-sm"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>

            {/* Filtros */}
            <Popover open={filtroOpen} onOpenChange={setFiltroOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1.5 relative">
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  Filtrar
                  {filtrosAtivos > 0 && (
                    <Badge className="absolute -top-1.5 -right-1.5 h-4 w-4 p-0 flex items-center justify-center text-[9px]">
                      {filtrosAtivos}
                    </Badge>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 p-3 space-y-3">
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Prioridade</Label>
                  <div className="flex flex-wrap gap-1">
                    {["alta", "media", "baixa"].map((p) => (
                      <Badge
                        key={p}
                        variant={filtroPrioridade === p ? "default" : "outline"}
                        className="cursor-pointer capitalize text-[11px]"
                        onClick={() => setFiltroPrioridade(filtroPrioridade === p ? null : p)}
                      >
                        {p === "media" ? "Média" : p.charAt(0).toUpperCase() + p.slice(1)}
                        {filtroPrioridade === p && <Check className="ml-1 w-2.5 h-2.5" />}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Origem</Label>
                  <div className="flex gap-1">
                    {["manual", "ia"].map((o) => (
                      <Badge
                        key={o}
                        variant={filtroOrigem === o ? "default" : "outline"}
                        className="cursor-pointer capitalize text-[11px]"
                        onClick={() => setFiltroOrigem(filtroOrigem === o ? null : o)}
                      >
                        {o === "ia" ? "✨ IA" : "Manual"}
                        {filtroOrigem === o && <Check className="ml-1 w-2.5 h-2.5" />}
                      </Badge>
                    ))}
                  </div>
                </div>
                {filtrosAtivos > 0 && (
                  <Button variant="ghost" size="sm" className="w-full text-xs h-7 text-muted-foreground" onClick={limparFiltros}>
                    <X className="w-3 h-3 mr-1" /> Limpar filtros
                  </Button>
                )}
              </PopoverContent>
            </Popover>

            {/* Avatares de membros */}
            {membros.length > 0 && (
              <div className="flex -space-x-1.5">
                <button
                  onClick={() => setFiltroMembro(null)}
                  className={cn(
                    "z-10 w-7 h-7 rounded-full border-2 border-background bg-muted text-[9px] font-bold flex items-center justify-center",
                    !filtroMembro && "ring-2 ring-primary"
                  )}
                >ALL</button>
                {membros.slice(0, 5).map((m) => (
                  <button
                    key={m.membro_id}
                    onClick={() => setFiltroMembro(filtroMembro === m.membro_id ? null : m.membro_id)}
                    className={cn(
                      "w-7 h-7 rounded-full border-2 border-background overflow-hidden hover:scale-110 transition-transform",
                      filtroMembro === m.membro_id && "ring-2 ring-primary z-20"
                    )}
                    title={m.nome}
                  >
                    <Avatar className="w-full h-full">
                      <AvatarFallback className="text-[9px] bg-primary/15 text-primary">
                        {m.nome?.substring(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  </button>
                ))}
              </div>
            )}

            <Button size="sm" className="h-8 gap-1.5" onClick={() => { setTarefaEditando(undefined); setColunaInicial(undefined); setModalAberto(true); }}>
              <Plus className="w-3.5 h-3.5" /> Nova Tarefa
            </Button>
          </div>
        </div>

        {/* Board */}
        <div className="flex-1 rounded-xl border border-border bg-muted/5 overflow-hidden min-h-0">
          {loading ? (
            <div className="flex gap-3 p-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="w-72 space-y-2 shrink-0">
                  <Skeleton className="h-10 w-full rounded-xl" />
                  <Skeleton className="h-28 w-full rounded-lg" />
                  <Skeleton className="h-20 w-full rounded-lg" />
                  <Skeleton className="h-24 w-full rounded-lg" />
                </div>
              ))}
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCorners}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
            >
              <ScrollArea className="h-full w-full">
                <div className="flex gap-3 p-4 min-h-full items-start">
                  {colunas.map((coluna) => (
                    <KanbanColuna
                      key={coluna.id}
                      coluna={coluna}
                      tarefas={tarefasFiltradas.filter((t) => t.coluna_id === coluna.id)}
                      onAdicionarTarefa={(id) => { setTarefaEditando(undefined); setColunaInicial(id); setModalAberto(true); }}
                      onCriarInline={handleCriarInline}
                      onEditarTarefa={(t) => { setTarefaEditando(t); setModalAberto(true); }}
                      onMoverTarefa={() => {}}
                      onRenomearColuna={handleRenomearColuna}
                      onExcluirColuna={handleExcluirColuna}
                    />
                  ))}

                  {/* Botão nova coluna */}
                  <button
                    onClick={() => setNovaColOpen(true)}
                    className="w-72 shrink-0 h-12 rounded-xl border-2 border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary hover:bg-muted/30 transition-all flex items-center justify-center gap-2 text-sm font-medium"
                  >
                    <Plus className="w-4 h-4" /> Nova coluna
                  </button>
                </div>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>

              {/* Overlay do card sendo arrastado */}
              <DragOverlay dropAnimation={{ duration: 200, easing: "ease" }}>
                {activeTarefa && (
                  <div className="rotate-2 opacity-90 w-72">
                    <KanbanCard tarefa={activeTarefa} onEditar={() => {}} />
                  </div>
                )}
              </DragOverlay>
            </DndContext>
          )}
        </div>

        {/* Modal de tarefa */}
        <ModalTarefa
          aberto={modalAberto}
          tarefa={tarefaEditando}
          colunas={colunas}
          colunaInicial={colunaInicial}
          onFechar={() => setModalAberto(false)}
          onSalvar={handleSalvarTarefa}
          onExcluir={handleExcluirTarefa}
        />

        {/* Modal nova coluna */}
        <Dialog open={novaColOpen} onOpenChange={setNovaColOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Nova Coluna</DialogTitle>
              <DialogDescription>Crie uma nova coluna para organizar tarefas.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Nome</Label>
                <Input
                  placeholder="Ex: Em Aprovação"
                  value={novaColNome}
                  onChange={(e) => setNovaColNome(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCriarColuna()}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label>Cor</Label>
                <div className="flex gap-2 flex-wrap">
                  {CORES_COLUNA.map((cor) => (
                    <button
                      key={cor}
                      className={cn(
                        "w-7 h-7 rounded-full border-2 transition-transform hover:scale-110",
                        novaColCor === cor ? "border-foreground scale-110" : "border-transparent"
                      )}
                      style={{ backgroundColor: cor }}
                      onClick={() => setNovaColCor(cor)}
                    />
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setNovaColOpen(false)} disabled={salvandoCol}>Cancelar</Button>
              <Button onClick={handleCriarColuna} disabled={salvandoCol || !novaColNome.trim()}>
                {salvandoCol ? "Criando..." : "Criar Coluna"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </CRMLayout>
  );
};

export default KanbanPage;
