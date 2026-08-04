/**
 * KanbanBoard.tsx — Board Kanban reutilizável (sem CRMLayout)
 *
 * [AUDITORIA] BUG (achado 2026-08-04): o comentário original aqui dizia "Usado em /kanban e
 * dentro da aba 'Tarefas' de Equipe" — falso, checado via grep: nenhum arquivo importava este
 * componente, `Kanban.tsx` (rota real `/kanban`) tinha sua PRÓPRIA cópia duplicada de ~450
 * linhas da mesma lógica (state, handlers, JSX), e `Equipe.tsx` não referencia nenhum dos dois.
 * Era código morto de fato. [AUDITORIA] FIX APLICADO: `Kanban.tsx` agora só renderiza este
 * componente (dedup real) — daqui em diante, qualquer mudança no quadro (esta sprint: sensores
 * de toque, filtros rápidos, drag/drop estilo Jira) vive num lugar só.
 */
import { useEffect, useState, useMemo, useRef } from "react";
import { LayoutGrid, Plus, Search, X, SlidersHorizontal, Check, User, Flame } from "lucide-react";
import { api } from "@/integrations/database/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import {
  DndContext, DragEndEvent, DragOverEvent, DragStartEvent,
  PointerSensor, TouchSensor, useSensor, useSensors, DragOverlay, closestCorners,
} from "@dnd-kit/core";
import { useAuth } from "@/hooks/useAuth";
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

// [AUDITORIA] LÓGICA (pedido do usuário, 2026-08-04): eram só 8 tons pastel claros — ampliado
// pra 24, cobrindo uma faixa mais completa (inclui tons mais saturados/escuros, úteis pra quem
// usa cor pra sinalizar urgência/status, não só decoração). O color picker nativo abaixo
// (`<input type="color">`) cobre qualquer cor fora desta lista — os presets continuam sendo o
// caminho rápido pra quem só quer "uma cor diferente", sem abrir o seletor do sistema.
const CORES_COLUNA = [
  "#f1f5f9", "#dbeafe", "#fef9c3", "#dcfce7",
  "#fce7f3", "#ede9fe", "#ffedd5", "#e0f2fe",
  "#fecaca", "#fed7aa", "#fde68a", "#bbf7d0",
  "#a5f3fc", "#c7d2fe", "#f5d0fe", "#fbcfe8",
  "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#06b6d4", "#6366f1", "#a855f7", "#64748b",
];

interface KanbanBoardProps {
  /** Título exibido no header */
  titulo?: string;
  /** Subtítulo opcional */
  subtitulo?: string;
  /** Pré-filtrar por origem (ex: "ia" para tarefas vindas do WhatsApp) */
  filtroOrigemInicial?: "manual" | "ia" | null;
  /** Altura do container — default usa h-full */
  className?: string;
}

export default function KanbanBoard({
  titulo = "Quadro de Tarefas",
  subtitulo,
  filtroOrigemInicial = null,
  className,
}: KanbanBoardProps) {
  const { session } = useAuth();
  const [colunas, setColunas] = useState<Coluna[]>([]);
  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  const [membros, setMembros] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);

  const [busca, setBusca] = useState("");
  const [filtroMembro, setFiltroMembro] = useState<string | null>(null);
  const [filtroPrioridade, setFiltroPrioridade] = useState<string | null>(null);
  const [filtroOrigem, setFiltroOrigem] = useState<string | null>(filtroOrigemInicial);
  // [AUDITORIA] LÓGICA (Sprint Kanban estilo Jira, 2026-08-04): "Apenas minhas tarefas" reaproveita
  // o filtro por membro já existente (mesmo campo `atribuido_a`, que é FK direta pra `users.id` —
  // confirmado em backend/src/routes/kanban.ts) em vez de criar um filtro paralelo. Um toggle não
  // pode conviver com o filtro-por-avatar normal (os dois escrevem no mesmo estado por design —
  // clicar num avatar específico enquanto "Minhas tarefas" está ativo naturalmente troca pra
  // aquele membro), então não precisa de estado extra nem de reconciliar dois filtros que fariam
  // a mesma coisa.
  const minhasTarefasAtivo = !!session?.user?.id && filtroMembro === session.user.id;
  const [filtroOpen, setFiltroOpen] = useState(false);

  const [modalAberto, setModalAberto] = useState(false);
  const [tarefaEditando, setTarefaEditando] = useState<Tarefa | undefined>();
  const [colunaInicial, setColunaInicial] = useState<string | undefined>();

  const [novaColOpen, setNovaColOpen] = useState(false);
  const [novaColNome, setNovaColNome] = useState("");
  const [novaColCor, setNovaColCor] = useState(CORES_COLUNA[0]);
  const [salvandoCol, setSalvandoCol] = useState(false);

  // [AUDITORIA] LÓGICA (Sprint seleção múltipla, 2026-08-04): seleção é só um Set de ids —
  // marcada via checkbox em cada KanbanCard (nunca pelo clique normal, que continua abrindo o
  // modal). `idsGrupoArrastando` (ref, não state — não precisa re-render) guarda, só durante um
  // drag em andamento, quais ids devem se mover JUNTO com o card fisicamente arrastado: se o
  // card arrastado faz parte da seleção E a seleção tem mais de 1 item, todo o grupo vai junto;
  // senão, o drag continua exatamente como sempre foi (1 card só, comportamento inalterado).
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const idsGrupoArrastandoRef = useRef<string[]>([]);

  const toggleSelecionado = (id: string) => {
    setSelecionados((prev) => {
      const novo = new Set(prev);
      novo.has(id) ? novo.delete(id) : novo.add(id);
      return novo;
    });
  };
  const limparSelecao = () => setSelecionados(new Set());

  // [AUDITORIA] BUG (achado 2026-08-04 — quadro inutilizável em toque/iPad): só existia
  // PointerSensor com activationConstraint por distância (5px) — em touch, qualquer arraste de
  // dedo pra rolar a coluna (que é vertical, sobre os próprios cards) já passa de 5px quase
  // instantaneamente e o dnd-kit sequestra o gesto como início de drag, bloqueando o scroll
  // nativo do iOS/iPadOS. [AUDITORIA] FIX APLICADO: TouchSensor dedicado com ativação por DELAY
  // (250ms de toque sustentado antes de iniciar o drag, não por distância) — dá tempo do
  // navegador decidir se é um scroll ou um drag de propósito, igual Trello/Jira mobile.
  // `tolerance: 5` cancela o drag se o dedo tremer mais que 5px durante a janela de delay (evita
  // iniciar drag por engano num toque impreciso). PointerSensor continua current pra mouse
  // (sem delay — não faz sentido pra quem usa mouse/trackpad).
  const sensors = useSensors(
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 5 },
    }),
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

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

  const tarefasFiltradas = useMemo(() => {
    return tarefas.filter((t) => {
      const q = busca.toLowerCase();
      const matchBusca = !busca || t.titulo.toLowerCase().includes(q) || (t.descricao || "").toLowerCase().includes(q);
      const matchMembro = !filtroMembro || t.atribuido_a === filtroMembro;
      const matchPrio = !filtroPrioridade || t.prioridade === filtroPrioridade;
      const matchOrigem = !filtroOrigem || (t.origem || "manual") === filtroOrigem;
      return matchBusca && matchMembro && matchPrio && matchOrigem;
    });
  }, [tarefas, busca, filtroMembro, filtroPrioridade, filtroOrigem]);

  const filtrosAtivos = [filtroMembro, filtroPrioridade, filtroOrigem].filter(Boolean).length;
  const limparFiltros = () => {
    setFiltroMembro(null); setFiltroPrioridade(null); setFiltroOrigem(null); setBusca("");
  };

  const handleCriarInline = async (colunaId: string, titulo: string) => {
    const { data: nova } = await api.post("/api/kanban/tarefas", {
      titulo, coluna_id: colunaId, prioridade: "media",
      origem: filtroOrigemInicial === "ia" ? "ia" : "manual",
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
        const { data: nova } = await api.post("/api/kanban/tarefas", {
          ...dados,
          origem: dados.origem || (filtroOrigemInicial === "ia" ? "ia" : "manual"),
        });
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
    } catch { toast.error("Erro ao excluir tarefa"); }
  };

  const handleCriarColuna = async () => {
    if (!novaColNome.trim()) return;
    setSalvandoCol(true);
    try {
      const { data: nova } = await api.post("/api/kanban/colunas", {
        nome: novaColNome.trim(), cor: novaColCor, ordem: colunas.length,
      });
      setColunas((prev) => [...prev, nova]);
      setNovaColOpen(false); setNovaColNome("");
      toast.success("Coluna criada");
    } catch { toast.error("Erro ao criar coluna"); }
    finally { setSalvandoCol(false); }
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

  // [AUDITORIA] LÓGICA (Sprint seleção múltipla, 2026-08-04): dnd-kit só permite arrastar UM
  // draggable por vez de verdade (é o card sob o dedo/mouse que carrega o sensor) — "arrastar
  // vários" aqui significa: o card físico sob o cursor guia o gesto, e todo o resto da seleção
  // muda de coluna JUNTO quando o drag termina, calculado a partir deste card guia. Se o card
  // arrastado não fizer parte de uma seleção com 2+ itens, o comportamento é IDÊNTICO ao de
  // antes desta sprint (grupo de 1 = só o próprio card).
  const handleDragStart = ({ active }: DragStartEvent) => {
    const id = active.id as string;
    idsGrupoArrastandoRef.current = (selecionados.has(id) && selecionados.size > 1)
      ? Array.from(selecionados)
      : [id];
    setActiveId(id);
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
    // Move o card guia E o resto do grupo (se houver) pra coluna de destino, optimisticamente —
    // mesma ideia de antes, só que aplicada a `idsGrupo` em vez de só `activeCard.id`.
    const idsGrupo = idsGrupoArrastandoRef.current;
    setTarefas((prev) => prev.map((t) =>
      idsGrupo.includes(t.id) ? { ...t, coluna_id: targetColunaId } : t
    ));
  };

  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    const idsGrupo = idsGrupoArrastandoRef.current;
    idsGrupoArrastandoRef.current = [];
    if (!over || active.id === over.id) return;
    const activeCard = tarefas.find((t) => t.id === active.id);
    if (!activeCard) return;
    const overId = over.id as string;
    const overIsColuna = colunas.some((c) => c.id === overId);
    const overCard = tarefas.find((t) => t.id === overId);
    const targetColunaId = overIsColuna ? overId : overCard?.coluna_id ?? activeCard.coluna_id;

    if (idsGrupo.length > 1) {
      // [AUDITORIA] LÓGICA: grupo sempre entra no FIM da coluna de destino, em sequência —
      // reordenar múltiplos cards pra um índice exato no meio de outros cards (o que o drag de
      // 1 card já faz abaixo) complicaria bastante sem ganho real: mover vários de uma vez já é
      // uma ação em lote, o operador normalmente só quer "isso tudo pra essa coluna", não uma
      // posição milimétrica entre dois cards específicos. Chamadas sequenciais (não paralelas)
      // pro endpoint de mover já existente e testado — cada chamada reabre/fecha os buracos de
      // ordem corretamente (ver backend/src/routes/kanban.ts), paralelo correria risco de duas
      // transações disputarem o mesmo recálculo de ordem ao mesmo tempo.
      const colunaDestinoAtual = tarefas.filter((t) => t.coluna_id === targetColunaId && !idsGrupo.includes(t.id));
      let ordemBase = colunaDestinoAtual.length;
      try {
        for (const id of idsGrupo) {
          await api.patch(`/api/kanban/tarefas/${id}/mover`, { coluna_id: targetColunaId, ordem: ordemBase });
          ordemBase++;
        }
        toast.success(`${idsGrupo.length} tarefas movidas`);
        limparSelecao();
      } catch {
        toast.error("Erro ao mover tarefas selecionadas");
      } finally {
        carregarDados();
      }
      return;
    }

    // Caminho de 1 card só — inalterado desde antes desta sprint.
    const colTarefas = tarefas.filter((t) => t.coluna_id === targetColunaId);
    let newOrdem: number;
    if (overIsColuna || !overCard) newOrdem = colTarefas.length;
    else newOrdem = overCard.ordem;
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
    try {
      await api.patch(`/api/kanban/tarefas/${active.id}/mover`, {
        coluna_id: targetColunaId, ordem: newOrdem,
      });
    } catch { toast.error("Erro ao mover tarefa"); carregarDados(); }
  };

  const activeTarefa = activeId ? tarefas.find((t) => t.id === activeId) : null;

  return (
    <div className={cn("flex flex-col h-full gap-4", className)}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-border bg-card/60 backdrop-blur-sm px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <LayoutGrid className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground leading-tight">{titulo}</h1>
            <p className="text-xs text-muted-foreground">
              {subtitulo || `${tarefas.length} tarefas em ${colunas.length} colunas`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative w-full sm:w-52">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input placeholder="Pesquisar..." className="pl-9 h-8 text-sm" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>

          {/* [AUDITORIA] LÓGICA (Sprint Kanban estilo Jira, 2026-08-04): filtros de 1 clique na
              barra principal, sem precisar abrir o Popover "Filtrar" — mesmo padrão do Jira
              (chips de atalho pra "assigned to me" e prioridade alta ficam sempre visíveis, o
              resto das opções continua dentro do Popover). Mesmo estado de sempre
              (filtroMembro/filtroPrioridade) — só um atalho visual pro que já existia dentro do
              Popover, então os dois ficam sincronizados (clicar num ou no outro reflete igual).
              "Alta" aqui é só `prioridade==='alta'`, não inclui 'urgente' — mesmo critério exato
              já usado pelo chip "Alta" dentro do Popover, sem inventar um critério novo. */}
          <Button
            variant={minhasTarefasAtivo ? "default" : "outline"}
            size="sm"
            className="h-8 gap-1.5 text-xs shrink-0"
            disabled={!session?.user?.id}
            onClick={() => setFiltroMembro(minhasTarefasAtivo ? null : (session!.user!.id as string))}
          >
            <User className="w-3.5 h-3.5" /> Minhas tarefas
          </Button>
          <Button
            variant={filtroPrioridade === "alta" ? "default" : "outline"}
            size="sm"
            className="h-8 gap-1.5 text-xs shrink-0"
            onClick={() => setFiltroPrioridade(filtroPrioridade === "alta" ? null : "alta")}
          >
            <Flame className="w-3.5 h-3.5" /> Alta prioridade
          </Button>

          <Popover open={filtroOpen} onOpenChange={setFiltroOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 relative">
                <SlidersHorizontal className="w-3.5 h-3.5" />
                Filtrar
                {filtrosAtivos > 0 && (
                  <Badge className="absolute -top-1.5 -right-1.5 h-4 w-4 p-0 flex items-center justify-center text-[9px]">{filtrosAtivos}</Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-3 space-y-3">
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Prioridade</Label>
                <div className="flex flex-wrap gap-1">
                  {["alta", "media", "baixa"].map((p) => (
                    <Badge key={p} variant={filtroPrioridade === p ? "default" : "outline"}
                      className="cursor-pointer capitalize text-[11px]"
                      onClick={() => setFiltroPrioridade(filtroPrioridade === p ? null : p)}>
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
                    <Badge key={o} variant={filtroOrigem === o ? "default" : "outline"}
                      className="cursor-pointer capitalize text-[11px]"
                      onClick={() => setFiltroOrigem(filtroOrigem === o ? null : o)}>
                      {o === "ia" ? "✨ WhatsApp/IA" : "Manual"}
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

          {membros.length > 0 && (
            <div className="flex -space-x-1.5">
              <button onClick={() => setFiltroMembro(null)}
                className={cn("z-10 w-7 h-7 rounded-full border-2 border-background bg-muted text-[9px] font-bold flex items-center justify-center",
                  !filtroMembro && "ring-2 ring-primary")}>ALL</button>
              {membros.slice(0, 5).map((m) => (
                <button key={m.membro_id} onClick={() => setFiltroMembro(filtroMembro === m.membro_id ? null : m.membro_id)}
                  className={cn("w-7 h-7 rounded-full border-2 border-background overflow-hidden hover:scale-110 transition-transform",
                    filtroMembro === m.membro_id && "ring-2 ring-primary z-20")}
                  title={m.nome}>
                  <Avatar className="w-full h-full">
                    <AvatarFallback className="text-[9px] bg-primary/15 text-primary">
                      {m.nome?.substring(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </button>
              ))}
            </div>
          )}

          <Button size="sm" className="h-8 gap-1.5"
            onClick={() => { setTarefaEditando(undefined); setColunaInicial(undefined); setModalAberto(true); }}>
            <Plus className="w-3.5 h-3.5" /> Nova Tarefa
          </Button>
        </div>
      </div>

      {/* [AUDITORIA] LÓGICA (Sprint seleção múltipla, 2026-08-04): barra só aparece com seleção
          ativa — não ocupa espaço/atenção no uso normal do quadro. */}
      {selecionados.size > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2">
          <p className="text-sm font-medium text-foreground">
            {selecionados.size} {selecionados.size === 1 ? "tarefa selecionada" : "tarefas selecionadas"} — arraste qualquer uma delas pra mover todas juntas
          </p>
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={limparSelecao}>
            <X className="w-3 h-3" /> Limpar seleção
          </Button>
        </div>
      )}

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
          <DndContext sensors={sensors} collisionDetection={closestCorners}
            onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
            <ScrollArea className="h-full w-full">
              <div className="flex gap-3 p-4 min-h-full items-start">
                {colunas.map((coluna) => (
                  <KanbanColuna key={coluna.id} coluna={coluna}
                    tarefas={tarefasFiltradas.filter((t) => t.coluna_id === coluna.id)}
                    onAdicionarTarefa={(id) => { setTarefaEditando(undefined); setColunaInicial(id); setModalAberto(true); }}
                    onCriarInline={handleCriarInline}
                    onEditarTarefa={(t) => { setTarefaEditando(t); setModalAberto(true); }}
                    onMoverTarefa={() => {}}
                    onRenomearColuna={handleRenomearColuna}
                    onExcluirColuna={handleExcluirColuna}
                    selecionados={selecionados}
                    onToggleSelecionado={toggleSelecionado} />
                ))}
                <button onClick={() => setNovaColOpen(true)}
                  className="w-72 shrink-0 h-12 rounded-xl border-2 border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary hover:bg-muted/30 transition-all flex items-center justify-center gap-2 text-sm font-medium">
                  <Plus className="w-4 h-4" /> Nova coluna
                </button>
              </div>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
            {/* [AUDITORIA] LÓGICA (Sprint Kanban estilo Jira, 2026-08-04): rotação reduzida de 2°
                pra 1.5° e sombra elevada pra shadow-2xl (era shadow-xl, herdado do próprio
                KanbanCard) — o "cartão erguido" some do fluxo normal e vira só esta cópia
                flutuante enquanto arrasta, então a elevação visual mora aqui, não no card
                original (que fica com o estilo de isDragging tratado em KanbanCard.tsx). */}
            <DragOverlay dropAnimation={{ duration: 200, easing: "ease" }}>
              {activeTarefa && (
                <div className="relative rotate-[1.5deg] opacity-90 w-72 shadow-2xl rounded-lg cursor-grabbing">
                  <KanbanCard tarefa={activeTarefa} onEditar={() => {}} />
                  {/* [AUDITORIA] LÓGICA (Sprint seleção múltipla, 2026-08-04): só o card guia é
                      renderizado de verdade no overlay (dnd-kit não suporta "arrastar N nodes"
                      nativamente) — este badge é o sinal visual de que o resto da seleção está
                      vindo junto, senão o operador não teria feedback nenhum de que é um drag
                      em grupo até soltar. */}
                  {selecionados.has(activeTarefa.id) && selecionados.size > 1 && (
                    <span className="absolute -top-2.5 -right-2.5 h-6 min-w-6 px-1.5 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center shadow-md">
                      +{selecionados.size - 1}
                    </span>
                  )}
                </div>
              )}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      <ModalTarefa aberto={modalAberto} tarefa={tarefaEditando} colunas={colunas}
        colunaInicial={colunaInicial} onFechar={() => setModalAberto(false)}
        onSalvar={handleSalvarTarefa} onExcluir={handleExcluirTarefa} />

      <Dialog open={novaColOpen} onOpenChange={setNovaColOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Nova Coluna</DialogTitle>
            <DialogDescription>Crie uma nova coluna para organizar tarefas.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input placeholder="Ex: Em Aprovação" value={novaColNome}
                onChange={(e) => setNovaColNome(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCriarColuna()} autoFocus />
            </div>
            <div className="space-y-2">
              <Label>Cor</Label>
              <div className="flex gap-2 flex-wrap">
                {CORES_COLUNA.map((cor) => (
                  <button key={cor}
                    className={cn("w-7 h-7 rounded-full border-2 transition-transform hover:scale-110",
                      novaColCor === cor ? "border-foreground scale-110" : "border-transparent")}
                    style={{ backgroundColor: cor }} onClick={() => setNovaColCor(cor)} />
                ))}
                {/* [AUDITORIA] LÓGICA (pedido do usuário, 2026-08-04): input nativo type="color" —
                    cobre qualquer cor fora dos 24 presets acima, sem precisar de biblioteca de
                    color-picker nova. `<input type="color">` já tem suporte universal (inclusive
                    Safari iOS) e abre o seletor de cor nativo do sistema/navegador. Estilizado
                    pra parecer mais um swatch (redondo, mesmo tamanho dos outros) do que um
                    input de formulário — o quadrado colorido cru do `<input>` fica "escondido"
                    dentro do wrapper redondo via overflow-hidden. */}
                <label
                  className={cn(
                    "relative w-7 h-7 rounded-full border-2 transition-transform hover:scale-110 overflow-hidden cursor-pointer",
                    "bg-[conic-gradient(from_0deg,#ef4444,#f97316,#eab308,#22c55e,#06b6d4,#6366f1,#a855f7,#ef4444)]",
                    !CORES_COLUNA.includes(novaColCor) ? "border-foreground scale-110" : "border-transparent"
                  )}
                  title="Cor personalizada"
                >
                  <input
                    type="color"
                    value={novaColCor}
                    onChange={(e) => setNovaColCor(e.target.value)}
                    className="absolute -top-1 -left-1 w-9 h-9 cursor-pointer opacity-0"
                  />
                </label>
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
  );
}
