import React, { useRef, useState } from "react";
import { Plus, ListTodo, MoreHorizontal, Pencil, Trash2, Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
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
  onCriarInline?: (colunaId: string, titulo: string) => Promise<void>;
  onEditarTarefa: (tarefa: Tarefa) => void;
  onMoverTarefa: (tarefaId: string, colunaId: string, ordem: number) => void;
  onRenomearColuna?: (id: string, nome: string) => Promise<void>;
  onExcluirColuna?: (id: string) => Promise<void>;
}

const KanbanColuna = ({
  coluna,
  tarefas,
  onAdicionarTarefa,
  onCriarInline,
  onEditarTarefa,
  onRenomearColuna,
  onExcluirColuna,
}: KanbanColunaProps) => {
  const { setNodeRef, isOver } = useDroppable({ id: coluna.id });

  const [criandoCard, setCriandoCard] = useState(false);
  const [novoTitulo, setNovoTitulo] = useState("");
  const [salvandoCard, setSalvandoCard] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const [editandoNome, setEditandoNome] = useState(false);
  const [nomeLocal, setNomeLocal] = useState(coluna.nome);

  const isWipExceeded = coluna.limite_wip ? tarefas.length > coluna.limite_wip : false;

  const iniciarCriacao = () => {
    setCriandoCard(true);
    setNovoTitulo("");
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const confirmarCriacao = async () => {
    if (!novoTitulo.trim()) { setCriandoCard(false); return; }
    if (!onCriarInline) { onAdicionarTarefa(coluna.id); setCriandoCard(false); return; }
    setSalvandoCard(true);
    try {
      await onCriarInline(coluna.id, novoTitulo.trim());
      setNovoTitulo("");
      setCriandoCard(false);
    } finally {
      setSalvandoCard(false);
    }
  };

  const cancelarCriacao = () => {
    setCriandoCard(false);
    setNovoTitulo("");
  };

  const salvarNome = async () => {
    if (nomeLocal.trim() && nomeLocal !== coluna.nome && onRenomearColuna) {
      await onRenomearColuna(coluna.id, nomeLocal.trim()).catch(() => setNomeLocal(coluna.nome));
    }
    setEditandoNome(false);
  };

  return (
    <div className="w-72 flex flex-col bg-card/60 backdrop-blur-sm rounded-xl border border-border shrink-0 h-full max-h-full overflow-hidden">
      {/* Header da coluna */}
      <div className="px-3 py-2.5 flex items-center justify-between border-b border-border bg-card/80 sticky top-0 z-10">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: coluna.cor || "#6366f1" }}
          />
          {editandoNome ? (
            <div className="flex items-center gap-1 flex-1">
              <Input
                value={nomeLocal}
                onChange={(e) => setNomeLocal(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") salvarNome(); if (e.key === "Escape") { setEditandoNome(false); setNomeLocal(coluna.nome); } }}
                className="h-6 text-xs px-1.5 py-0"
                autoFocus
              />
              <Button size="icon" variant="ghost" className="w-5 h-5" onClick={salvarNome}><Check className="w-3 h-3" /></Button>
              <Button size="icon" variant="ghost" className="w-5 h-5" onClick={() => { setEditandoNome(false); setNomeLocal(coluna.nome); }}><X className="w-3 h-3" /></Button>
            </div>
          ) : (
            <h3 className="font-semibold text-xs text-foreground uppercase tracking-wider truncate">
              {coluna.nome}
            </h3>
          )}
          <Badge
            variant="secondary"
            className={cn(
              "text-[10px] px-1.5 py-0 h-4 shrink-0",
              isWipExceeded ? "bg-red-100 text-red-700" : "bg-muted text-muted-foreground"
            )}
          >
            {tarefas.length}{coluna.limite_wip ? `/${coluna.limite_wip}` : ""}
          </Badge>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-primary"
            onClick={iniciarCriacao}
          >
            <Plus className="w-3.5 h-3.5" />
          </Button>
          {(onRenomearColuna || onExcluirColuna) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground">
                  <MoreHorizontal className="w-3.5 h-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="text-xs">
                {onRenomearColuna && (
                  <DropdownMenuItem onClick={() => { setEditandoNome(true); setNomeLocal(coluna.nome); }}>
                    <Pencil className="w-3.5 h-3.5 mr-2" /> Renomear
                  </DropdownMenuItem>
                )}
                {onExcluirColuna && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-red-500 focus:text-red-500"
                      disabled={tarefas.length > 0}
                      onClick={() => tarefas.length === 0 && onExcluirColuna(coluna.id)}
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-2" />
                      {tarefas.length > 0 ? "Mova as tarefas antes" : "Excluir coluna"}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Lista de cards */}
      <ScrollArea className="flex-1">
        <div
          ref={setNodeRef}
          className={cn(
            "flex flex-col gap-2 p-2 min-h-[80px] transition-colors duration-150",
            isOver && "bg-primary/5"
          )}
        >
          <SortableContext items={tarefas.map((t) => t.id)} strategy={verticalListSortingStrategy}>
            {tarefas.length === 0 && !criandoCard ? (
              <div className={cn(
                "flex flex-col items-center justify-center py-8 px-3 border-2 border-dashed rounded-lg text-muted-foreground transition-colors",
                isOver ? "border-primary/40 bg-primary/5" : "border-border"
              )}>
                <ListTodo className="w-6 h-6 mb-1.5 opacity-30" />
                <p className="text-[11px]">Solte aqui ou adicione</p>
              </div>
            ) : (
              tarefas.map((tarefa) => (
                <KanbanCard key={tarefa.id} tarefa={tarefa} onEditar={onEditarTarefa} />
              ))
            )}
          </SortableContext>

          {/* Card de criação inline */}
          {criandoCard && (
            <div className="bg-card border border-primary/40 rounded-lg p-2.5 shadow-sm">
              <Input
                ref={inputRef}
                placeholder="O que precisa ser feito?"
                value={novoTitulo}
                onChange={(e) => setNovoTitulo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") confirmarCriacao();
                  if (e.key === "Escape") cancelarCriacao();
                }}
                className="text-sm border-0 shadow-none px-0 focus-visible:ring-0 bg-transparent"
                disabled={salvandoCard}
              />
              <div className="flex items-center justify-end gap-1 mt-2">
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={cancelarCriacao} disabled={salvandoCard}>
                  Cancelar
                </Button>
                <Button size="sm" className="h-7 text-xs" onClick={confirmarCriacao} disabled={salvandoCard || !novoTitulo.trim()}>
                  {salvandoCard ? "..." : "Criar"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Footer */}
      {!criandoCard && (
        <div className="p-2 border-t border-border/50">
          <Button
            variant="ghost"
            className="w-full justify-start text-[11px] text-muted-foreground hover:text-primary hover:bg-muted gap-1.5 h-7"
            onClick={iniciarCriacao}
          >
            <Plus className="w-3 h-3" /> Adicionar tarefa
          </Button>
        </div>
      )}
    </div>
  );
};

export default KanbanColuna;
