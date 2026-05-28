import React from "react";
import { format, isPast } from "date-fns";
import { ptBR } from "date-fns/locale";
import { MessageSquare, Calendar } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

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
  onMover?: (tarefaId: string, colunaId: string) => void;
  isDragging?: boolean;
}

const KanbanCard = ({ tarefa, onEditar, isDragging }: KanbanCardProps) => {
  const getPrioridadeColor = (p: string) => {
    switch (p) {
      case "urgente": return "bg-destructive";
      case "alta": return "bg-accent";
      case "media": return "bg-primary";
      case "baixa": return "bg-muted-foreground/50";
      default: return "bg-primary";
    }
  };

  const dataVencida = tarefa.data_limite ? isPast(new Date(tarefa.data_limite)) : false;

  return (
    <div
      onClick={() => onEditar(tarefa)}
      className={cn(
        "bg-card p-3 rounded-md shadow-sm border border-border cursor-grab active:cursor-grabbing hover:border-primary/40 hover:shadow-md transition-all relative overflow-hidden group",
        isDragging && "opacity-50 grayscale"
      )}
    >
      <div className={cn("absolute left-0 top-0 bottom-0 w-1", getPrioridadeColor(tarefa.prioridade))} />

      <div className="flex justify-between items-start gap-2 mb-2 pl-1">
        <h4 className="text-sm font-semibold text-foreground line-clamp-2 flex-1">
          {tarefa.titulo}
        </h4>
        {tarefa.origem === 'ia' && (
          <Badge variant="secondary" className="bg-accent/15 text-accent hover:bg-accent/20 border-none text-[10px] px-1.5 h-5 gap-1 shrink-0">
            <span>✨</span> IA
          </Badge>
        )}
      </div>

      {tarefa.resumo_ia && (
        <p className="text-xs text-muted-foreground italic line-clamp-3 mb-3 leading-relaxed pl-1">
          {tarefa.resumo_ia}
        </p>
      )}

      {tarefa.tags && tarefa.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3 pl-1">
          {tarefa.tags.map((tag, idx) => (
            <Badge key={idx} variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-muted text-muted-foreground border-border">
              {tag}
            </Badge>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between mt-auto pt-2 border-t border-border/50 pl-1">
        <div className="flex items-center gap-3">
          {tarefa.data_limite && (
            <div className={cn(
              "flex items-center gap-1 text-[10px]",
              dataVencida ? "text-destructive font-medium" : "text-muted-foreground"
            )}>
              <Calendar className="w-3 h-3" />
              {format(new Date(tarefa.data_limite), "dd/MM", { locale: ptBR })}
            </div>
          )}

          {(tarefa.total_comentarios ?? 0) > 0 && (
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <MessageSquare className="w-3 h-3" />
              {tarefa.total_comentarios}
            </div>
          )}
        </div>

        {tarefa.atribuido_nome && (
          <Avatar className="w-5 h-5 border border-background">
            <AvatarImage src="" />
            <AvatarFallback className="text-[9px] bg-primary/15 text-primary font-bold">
              {tarefa.atribuido_nome.substring(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        )}
      </div>
    </div>
  );
};

export default KanbanCard;
