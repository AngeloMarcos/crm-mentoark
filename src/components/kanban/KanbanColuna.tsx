import React from "react";
import { Plus, ListTodo } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import KanbanCard, { Tarefa } from "./KanbanCard";
import { cn } from "@/lib/utils";

interface Coluna {
  id: string;
  nome: string;
  cor: string;
  limite_wip?: number | null;
}

interface KanbanColunaProps {
  coluna: Coluna;
  tarefas: Tarefa[];
  onAdicionarTarefa: (colunaId: string) => void;
  onEditarTarefa: (tarefa: Tarefa) => void;
  onMoverTarefa: (tarefaId: string, colunaId: string, ordem: number) => void;
}

const KanbanColuna = ({
  coluna,
  tarefas,
  onAdicionarTarefa,
  onEditarTarefa,
}: KanbanColunaProps) => {
  const isWipExceeded = coluna.limite_wip ? tarefas.length > coluna.limite_wip : false;

  return (
    <div className="w-80 flex flex-col bg-card/60 backdrop-blur-sm rounded-lg border border-border h-full max-h-full overflow-hidden shrink-0">
      {/* Header */}
      <div className="p-3 flex items-center justify-between border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex items-center gap-2 overflow-hidden">
          <div
            className="w-3 h-3 rounded-full shrink-0 ring-2 ring-background"
            style={{ backgroundColor: coluna.cor || 'hsl(var(--muted-foreground))' }}
          />
          <h3 className="font-semibold text-sm text-foreground truncate">
            {coluna.nome}
          </h3>
          <Badge
            variant="secondary"
            className={cn(
              "text-[10px] px-1.5 py-0 h-5",
              isWipExceeded
                ? "bg-destructive/15 text-destructive"
                : "bg-muted text-muted-foreground"
            )}
          >
            {tarefas.length}
            {coluna.limite_wip ? `/${coluna.limite_wip}` : ''}
          </Badge>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-primary hover:bg-muted"
          onClick={() => onAdicionarTarefa(coluna.id)}
        >
          <Plus className="w-4 h-4" />
        </Button>
      </div>

      {/* Lista de Cards */}
      <ScrollArea className="flex-1 p-3">
        <div className="flex flex-col gap-3 min-h-[100px]">
          {tarefas.length > 0 ? (
            tarefas.map((tarefa) => (
              <KanbanCard
                key={tarefa.id}
                tarefa={tarefa}
                onEditar={onEditarTarefa}
              />
            ))
          ) : (
            <div className="flex flex-col items-center justify-center py-10 px-4 border-2 border-dashed border-border rounded-lg text-muted-foreground">
              <ListTodo className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-xs font-medium">Nenhuma tarefa</p>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Rodapé */}
      <div className="p-2 border-t border-border bg-muted/20">
        <Button
          variant="ghost"
          className="w-full justify-start text-xs text-muted-foreground hover:text-primary hover:bg-muted gap-2 h-8"
          onClick={() => onAdicionarTarefa(coluna.id)}
        >
          <Plus className="w-3.5 h-3.5" />
          Adicionar tarefa
        </Button>
      </div>
    </div>
  );
};

export default KanbanColuna;
