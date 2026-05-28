/**
 * KanbanCard.tsx — Card individual do quadro Kanban
 *
 * Responsabilidades:
 *  - Exibir título, prioridade, data limite, comentários e atribuição
 *  - Ser arrastável via @dnd-kit/sortable (useSortable hook)
 *  - Separar handle de drag (ícone grip) do clique para editar
 *
 * Design:
 *  - Barra colorida lateral indica prioridade visualmente
 *  - Cards de IA têm badge "✨ IA" em roxo
 *  - Opacidade 40% enquanto sendo arrastado (feedback visual)
 */

import React from "react";
import { format, isPast } from "date-fns";
import { ptBR } from "date-fns/locale";
import { MessageSquare, Calendar, GripVertical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export interface Tarefa {
  id: string;
  titulo: string;
  descricao?: string;
  resumo_ia?: string;
  prioridade: 'baixa' | 'media' | 'alta' | 'urgente';
  ordem: number;
  atribuido_a?: string;
  atribuido_nome?: string;
  atribuido_email?: string;
  sub_perfil_id?: string;
  contato_id?: string;
  contato_nome?: string;
  contato_telefone?: string;
  conversa_id?: string;
  data_limite?: string;
  tags?: string[];
  origem?: string;
  total_comentarios?: number;
  coluna_id: string;
}

interface KanbanCardProps {
  tarefa: Tarefa;
  onEditar: (tarefa: Tarefa) => void;
}

const PRIORIDADE_COLOR: Record<string, string> = {
  urgente: "bg-red-500",
  alta:    "bg-orange-500",
  media:   "bg-blue-500",
  baixa:   "bg-slate-400",
};

const PRIORIDADE_BADGE: Record<string, string> = {
  urgente: "bg-red-100 text-red-700 border-red-200",
  alta:    "bg-orange-100 text-orange-700 border-orange-200",
  media:   "bg-blue-100 text-blue-700 border-blue-200",
  baixa:   "bg-slate-100 text-slate-600 border-slate-200",
};

const PRIORIDADE_LABEL: Record<string, string> = {
  urgente: "Urgente", alta: "Alta", media: "Média", baixa: "Baixa",
};

const KanbanCard = ({ tarefa, onEditar }: KanbanCardProps) => {
  const {
    attributes, listeners, setNodeRef,
    transform, transition, isDragging,
  } = useSortable({ id: tarefa.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const dataVencida = tarefa.data_limite
    ? isPast(new Date(tarefa.data_limite)) && !tarefa.data_limite.includes("T00:00")
    : false;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "bg-card rounded-lg border border-border shadow-sm transition-all duration-150 group",
        isDragging
          ? "opacity-40 scale-95 shadow-xl ring-2 ring-primary/30"
          : "hover:border-primary/30 hover:shadow-md cursor-pointer"
      )}
    >
      {/* Barra de prioridade */}
      <div className={cn("h-1 rounded-t-lg w-full", PRIORIDADE_COLOR[tarefa.prioridade] || "bg-slate-400")} />

      <div className="p-3">
        {/* Header: título + handle de drag */}
        <div className="flex items-start gap-1.5 mb-2">
          <div
            {...attributes}
            {...listeners}
            className="mt-0.5 shrink-0 text-muted-foreground/40 hover:text-muted-foreground cursor-grab active:cursor-grabbing"
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="w-3.5 h-3.5" />
          </div>
          <h4
            className="text-sm font-medium text-foreground line-clamp-2 flex-1 leading-snug"
            onClick={() => onEditar(tarefa)}
          >
            {tarefa.titulo}
          </h4>
        </div>

        {/* Resumo IA */}
        {tarefa.resumo_ia && (
          <p
            className="text-[11px] text-muted-foreground italic line-clamp-2 mb-2 leading-relaxed cursor-pointer"
            onClick={() => onEditar(tarefa)}
          >
            {tarefa.resumo_ia}
          </p>
        )}

        {/* Tags */}
        {tarefa.tags && tarefa.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2" onClick={() => onEditar(tarefa)}>
            {tarefa.tags.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                {tag}
              </Badge>
            ))}
          </div>
        )}

        {/* Footer */}
        <div
          className="flex items-center justify-between mt-2 pt-2 border-t border-border/40"
          onClick={() => onEditar(tarefa)}
        >
          <div className="flex items-center gap-2.5">
            {/* Badge prioridade */}
            <span className={cn(
              "text-[10px] font-medium px-1.5 py-0.5 rounded border",
              PRIORIDADE_BADGE[tarefa.prioridade]
            )}>
              {PRIORIDADE_LABEL[tarefa.prioridade] || tarefa.prioridade}
            </span>

            {/* Data */}
            {tarefa.data_limite && (
              <div className={cn(
                "flex items-center gap-1 text-[10px]",
                dataVencida ? "text-red-500 font-semibold" : "text-muted-foreground"
              )}>
                <Calendar className="w-3 h-3" />
                {format(new Date(tarefa.data_limite), "dd/MM", { locale: ptBR })}
              </div>
            )}

            {/* Comentários */}
            {(tarefa.total_comentarios ?? 0) > 0 && (
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <MessageSquare className="w-3 h-3" />
                {tarefa.total_comentarios}
              </div>
            )}
          </div>

          {/* Badges direita */}
          <div className="flex items-center gap-1.5">
            {tarefa.origem === 'ia' || tarefa.origem === 'n8n' ? (
              <Badge variant="secondary" className="bg-violet-500/15 text-violet-600 border-none text-[10px] px-1.5 h-5 gap-0.5">
                ✨ IA
              </Badge>
            ) : null}

            {tarefa.atribuido_nome && (
              <Avatar className="w-5 h-5 border border-background">
                <AvatarFallback className="text-[9px] bg-primary/15 text-primary font-bold">
                  {tarefa.atribuido_nome.substring(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default KanbanCard;
