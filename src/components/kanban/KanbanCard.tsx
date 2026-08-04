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
import { Checkbox } from "@/components/ui/checkbox";
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
  /** Sprint seleção múltipla (2026-08-04): true quando este card faz parte da seleção atual. */
  selecionado?: boolean;
  /** Alterna a seleção deste card — sempre via checkbox, nunca pelo clique normal no corpo do
   * card (que continua abrindo o modal de edição, comportamento inalterado). */
  onToggleSelecionado?: () => void;
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

const KanbanCard = ({ tarefa, onEditar, selecionado = false, onToggleSelecionado }: KanbanCardProps) => {
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
        "bg-card rounded-lg border transition-all duration-150 group",
        isDragging
          ? // [AUDITORIA] BUG (achado 2026-08-04 — pedido de "drop indicator" estilo Jira): antes
            // disto, o slot que o card ocupava enquanto era arrastado mostrava o próprio conteúdo
            // do card (só com opacity-40 + scale-95) — funcional, mas não é o "box tracejado
            // limpo" pedido. [AUDITORIA] FIX APLICADO: o wrapper troca pro estilo de placeholder
            // (borda tracejada, sem sombra, sem borda de cor); o conteúdo interno (abaixo) fica
            // `invisible` — não `hidden` — de propósito: `invisible` preserva a altura real do
            // layout (título de 1 linha vs. 2, com/sem tags, etc.), então o box tracejado sai
            // sempre com a altura EXATA do card que está sendo arrastado, nunca uma altura fixa
            // que erraria pra cards de tamanho diferente.
            "border-2 border-dashed border-gray-300 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/30 shadow-none"
          : cn(
              "hover:shadow-md cursor-pointer",
              // [AUDITORIA] LÓGICA (Sprint seleção múltipla, 2026-08-04): anel de destaque quando
              // o card está selecionado (independente de estar em drag) — mesma convenção visual
              // já usada pro filtro de membro ativo (ring-2 ring-primary) no header do board.
              selecionado ? "border-primary ring-2 ring-primary/40 shadow-sm" : "border-border shadow-sm hover:border-primary/30"
            )
      )}
    >
      {/* Barra de prioridade */}
      <div className={cn("h-1 rounded-t-lg w-full", isDragging ? "invisible" : (PRIORIDADE_COLOR[tarefa.prioridade] || "bg-slate-400"))} />

      <div className={cn("p-3", isDragging && "invisible")}>
        {/* Header: título + handle de drag */}
        <div className="flex items-start gap-1.5 mb-2">
          {/* [AUDITORIA] LÓGICA (Sprint seleção múltipla, 2026-08-04): checkbox dedicado pra
              seleção — nunca o clique normal no corpo do card, que continua abrindo o modal de
              edição sem nenhuma mudança de comportamento. `stopPropagation` no wrapper evita que
              o clique no checkbox borbulhe pro drag-handle/card. Só existe se o board oferecer
              `onToggleSelecionado` (ver KanbanBoard.tsx) — em qualquer outro lugar que reaproveite
              KanbanCard sem esse prop, o checkbox simplesmente não aparece, sem quebrar nada. */}
          {onToggleSelecionado && (
            <div className="mt-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
              <Checkbox
                checked={selecionado}
                onCheckedChange={() => onToggleSelecionado()}
                className="h-4 w-4"
                aria-label="Selecionar tarefa"
              />
            </div>
          )}
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
