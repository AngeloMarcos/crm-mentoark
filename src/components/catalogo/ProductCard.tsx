import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Pencil, Trash2, Image as ImageIcon, Send, Star, GripVertical } from "lucide-react";

interface Produto {
  id: string;
  nome: string;
  descricao: string | null;
  preco: number | null;
  preco_promocional: number | null;
  codigo: string | null;
  estoque: number | null;
  ativo: boolean;
  marcador?: string;
  custom_fields?: any;
  imagens: Array<{ id: string; url: string; legenda: string | null; principal: boolean }>;
}

interface ProductCardProps {
  produto: Produto;
  onSend: () => void;
  onImages: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function ProductCard({ produto, onSend, onImages, onEdit, onDelete }: ProductCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: produto.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 1,
    opacity: isDragging ? 0.5 : 1,
  };

  const principal = produto.imagens?.find(img => img.principal) || produto.imagens?.[0];

  return (
    <div ref={setNodeRef} style={style}>
      <Card className="h-full flex flex-col overflow-hidden group">
        <div className="aspect-square relative bg-muted flex items-center justify-center">
          {principal ? (
            <img src={principal.url} className="w-full h-full object-cover" />
          ) : <ImageIcon className="h-10 w-10 text-muted-foreground" />}
          
          {/* Drag Handle */}
          <div 
            {...attributes} 
            {...listeners}
            className="absolute top-2 right-2 p-1.5 bg-background/80 rounded-md cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity border shadow-sm"
          >
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </div>
          
          {!produto.ativo && (
            <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
              <Badge variant="secondary">Inativo</Badge>
            </div>
          )}
        </div>
        <CardContent className="p-4 flex-1 flex flex-col">
          <div className="flex-1 space-y-2">
            <div className="flex items-center justify-between gap-1">
              <h3 className="font-semibold text-sm line-clamp-1">{produto.nome}</h3>
              {produto.marcador && (
                <Badge variant="outline" className="text-[8px] h-4 px-1 uppercase">{produto.marcador}</Badge>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground line-clamp-2 min-h-[2.5rem]">{produto.descricao}</p>
            <div className="flex items-center justify-between">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-bold text-primary">R$ {Number(produto.preco || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                {produto.preco_promocional && (
                  <span className="text-[10px] line-through opacity-50">R$ {Number(produto.preco_promocional).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                )}
              </div>
              {produto.custom_fields?.linha_produto && (
                <span className="text-[9px] font-medium opacity-70 bg-secondary px-1 rounded">{produto.custom_fields.linha_produto}</span>
              )}
            </div>
          </div>
          
          <div className="pt-4 flex gap-1 flex-wrap mt-auto">
            <Button variant="outline" size="sm" className="h-8 w-8 p-0" title="Enviar via WhatsApp" onClick={onSend}><Send className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={onImages}>Fotos</Button>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 ml-auto" onClick={onEdit}><Pencil className="h-4 w-4" /></Button>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onDelete}><Trash2 className="h-4 w-4 text-destructive" /></Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
