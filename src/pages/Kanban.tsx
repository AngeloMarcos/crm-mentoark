import { useEffect, useState, useMemo } from "react";
import { LayoutGrid, Plus, Search, X, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/integrations/database/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import KanbanColuna from "@/components/kanban/KanbanColuna";
import ModalTarefa from "@/components/kanban/ModalTarefa";
import { Tarefa } from "@/components/kanban/KanbanCard";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface Coluna {
  id: string;
  nome: string;
  cor: string;
  limite_wip?: number | null;
}

const KanbanPage = () => {
  const { user } = useAuth();
  const [colunas, setColunas] = useState<Coluna[]>([]);
  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  const [membros, setMembros] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Filtros
  const [filtroMembro, setFiltroMembro] = useState<string | null>(null);
  const [filtroPrioridade, setFiltroPrioridade] = useState<string | null>(null);
  const [busca, setBusca] = useState("");

  // Modais
  const [modalAberto, setModalAberto] = useState(false);
  const [tarefaEditando, setTarefaEditando] = useState<Tarefa | undefined>();
  const [colunaInicial, setColunaInicial] = useState<string | undefined>();

  const carregarDados = async () => {
    setLoading(true);
    try {
      const [colRes, tarRes, memRes] = await Promise.all([
        api.get("/api/kanban/colunas"),
        api.get("/api/kanban/tarefas"),
        api.from("sub_perfis").select("*").eq("ativo", true)
      ]);
      setColunas(colRes.data);
      setTarefas(tarRes.data);
      setMembros(memRes.data || []);
    } catch (err) {
      toast.error("Erro ao carregar o Kanban");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarDados();
  }, []);

  const tarefasFiltradas = useMemo(() => {
    return tarefas.filter(t => {
      const matchMembro = !filtroMembro || t.atribuido_a === filtroMembro;
      const matchPrioridade = !filtroPrioridade || t.prioridade === filtroPrioridade;
      const matchBusca = !busca || 
        t.titulo.toLowerCase().includes(busca.toLowerCase()) || 
        (t.descricao && t.descricao.toLowerCase().includes(busca.toLowerCase()));
      return matchMembro && matchPrioridade && matchBusca;
    });
  }, [tarefas, filtroMembro, filtroPrioridade, busca]);

  const handleSalvarTarefa = async (dados: any) => {
    try {
      if (tarefaEditando) {
        await api.patch(`/api/kanban/tarefas/${tarefaEditando.id}`, dados);
        toast.success("Tarefa atualizada");
      } else {
        await api.post("/api/kanban/tarefas", dados);
        toast.success("Tarefa criada");
      }
      setModalAberto(false);
      carregarDados();
    } catch (err) {
      toast.error("Erro ao salvar tarefa");
    }
  };

  const handleExcluirTarefa = async (id: string) => {
    try {
      await api.delete(`/api/kanban/tarefas/${id}`);
      toast.success("Tarefa excluída");
      setModalAberto(false);
      carregarDados();
    } catch (err) {
      toast.error("Erro ao excluir tarefa");
    }
  };

  const handleMoverTarefa = async (tarefaId: string, novaColunaId: string, ordem: number) => {
    try {
      await api.patch(`/api/kanban/tarefas/${tarefaId}/mover`, { 
        coluna_id: novaColunaId, 
        ordem 
      });
      carregarDados();
    } catch (err) {
      toast.error("Erro ao mover tarefa");
    }
  };

  const limparFiltros = () => {
    setFiltroMembro(null);
    setFiltroPrioridade(null);
    setBusca("");
  };

  if (loading && colunas.length === 0) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex justify-between items-center">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="flex gap-4 overflow-hidden">
          {[1, 2, 3].map(i => (
            <div key={i} className="w-80 space-y-4">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] overflow-hidden">
      {/* Header */}
      <div className="p-6 pb-4 border-b bg-white flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <LayoutGrid className="w-6 h-6 text-primary" />
            Kanban da Equipe
          </h1>
          <p className="text-sm text-slate-500">Gerencie as tarefas e fluxos da sua equipe</p>
        </div>
        <Button onClick={() => {
          setTarefaEditando(undefined);
          setColunaInicial(undefined);
          setModalAberto(true);
        }} className="gap-2">
          <Plus className="w-4 h-4" /> Nova Tarefa
        </Button>
      </div>

      {/* Filtros */}
      <div className="px-6 py-3 border-b bg-slate-50/50 flex flex-wrap items-center gap-4 shrink-0">
        {/* Membros */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-400 uppercase">Membros:</span>
          <div className="flex -space-x-2">
            <button 
              onClick={() => setFiltroMembro(null)}
              className={cn(
                "relative z-10 w-8 h-8 rounded-full border-2 border-white bg-slate-200 text-[10px] font-bold flex items-center justify-center hover:bg-slate-300 transition-colors",
                !filtroMembro && "ring-2 ring-primary ring-offset-1"
              )}
            >
              ALL
            </button>
            {membros.map((m) => (
              <button
                key={m.membro_id}
                onClick={() => setFiltroMembro(m.membro_id)}
                className={cn(
                  "relative w-8 h-8 rounded-full border-2 border-white overflow-hidden hover:scale-105 transition-transform",
                  filtroMembro === m.membro_id && "ring-2 ring-primary ring-offset-1 z-20"
                )}
                title={m.nome}
              >
                <Avatar className="w-full h-full">
                  <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                    {m.nome.substring(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </button>
            ))}
          </div>
        </div>

        <div className="h-6 w-px bg-slate-200" />

        {/* Prioridade */}
        <div className="flex items-center gap-1.5">
          {["Todas", "Urgente", "Alta", "Média", "Baixa"].map((p) => (
            <Badge
              key={p}
              variant={
                (p === "Todas" && !filtroPrioridade) || 
                (p.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") === filtroPrioridade) 
                ? "default" : "outline"
              }
              className="cursor-pointer capitalize text-[11px]"
              onClick={() => {
                if (p === "Todas") setFiltroPrioridade(null);
                else setFiltroPrioridade(p.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
              }}
            >
              {p}
            </Badge>
          ))}
        </div>

        <div className="h-6 w-px bg-slate-200" />

        {/* Busca */}
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input 
            placeholder="Buscar tarefas..." 
            className="pl-9 h-9 bg-white"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>

        {(filtroMembro || filtroPrioridade || busca) && (
          <Button 
            variant="ghost" 
            size="sm" 
            className="text-xs text-slate-500 hover:text-red-500 gap-1"
            onClick={limparFiltros}
          >
            <X className="w-3 h-3" /> Limpar
          </Button>
        )}
      </div>

      {/* Board */}
      <div className="flex-1 bg-slate-50 overflow-hidden relative">
        <ScrollArea className="h-full w-full">
          <div className="flex p-6 gap-6 h-full min-h-[calc(100vh-250px)]">
            {colunas.map((coluna) => (
              <KanbanColuna
                key={coluna.id}
                coluna={coluna}
                tarefas={tarefasFiltradas.filter(t => t.coluna_id === coluna.id)}
                onAdicionarTarefa={(colId) => {
                  setTarefaEditando(undefined);
                  setColunaInicial(colId);
                  setModalAberto(true);
                }}
                onEditarTarefa={(tarefa) => {
                  setTarefaEditando(tarefa);
                  setModalAberto(true);
                }}
                onMoverTarefa={handleMoverTarefa}
              />
            ))}
            {/* Coluna extra para manter espaçamento no final */}
            <div className="w-1 shrink-0" />
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>

        {/* Floating Action Button */}
        <Button 
          className="absolute bottom-6 right-6 w-14 h-14 rounded-full shadow-lg ring-4 ring-white"
          onClick={() => {
            setTarefaEditando(undefined);
            setColunaInicial(undefined);
            setModalAberto(true);
          }}
        >
          <Plus className="w-6 h-6" />
        </Button>
      </div>

      <ModalTarefa
        aberto={modalAberto}
        tarefa={tarefaEditando}
        colunas={colunas}
        colunaInicial={colunaInicial}
        onFechar={() => setModalAberto(false)}
        onSalvar={handleSalvarTarefa}
        onExcluir={handleExcluirTarefa}
      />
    </div>
  );
};

export default KanbanPage;
