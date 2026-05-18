import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, GripVertical, Tag as TagIcon, Pencil, Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const PREDEFINED_COLORS = [
  "#3b82f6", "#22c55e", "#6b7280", "#8b5cf6", "#ef4444", 
  "#f97316", "#eab308", "#06b6d4", "#6366f1", "#a855f7", 
  "#ec4899", "#f43f5e"
];

interface TagType {
  id: string;
  nome: string;
  cor: string;
  count?: number;
}

interface StageType {
  id: string;
  nome: string;
  cor: string;
  ordem: number;
  count?: number;
}

const SortableStage = ({ stage, onEdit, onDelete }: { stage: StageType; onEdit: (s: StageType) => void; onDelete: (id: string) => void }) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: stage.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-3 p-3 border rounded-lg bg-card group shadow-sm">
      <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing">
        <GripVertical className="text-muted-foreground w-4 h-4" />
      </div>
      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: stage.cor }} />
      <span className="font-medium flex-1">{stage.nome}</span>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button variant="ghost" size="icon" onClick={() => onEdit(stage)} className="h-8 w-8">
          <Pencil className="w-3.5 h-3.5" />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => onDelete(stage.id)} className="h-8 w-8 text-destructive">
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
};

const TagsFunilPage = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("tags");

  // Tag States
  const [tagName, setTagName] = useState("");
  const [tagColor, setTagColor] = useState(PREDEFINED_COLORS[0]);

  // Stage States
  const [stageName, setStageName] = useState("");
  const [stageColor, setStageColor] = useState(PREDEFINED_COLORS[0]);

  // Queries
  const { data: tags = [], isLoading: loadingTags } = useQuery({
    queryKey: ["tags-management-data"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tags" as any)
        .select("*")
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      
      if (!data || data.length === 0) {
        return [
          { id: "default-1", nome: "Lead", cor: "#3b82f6", count: 0 },
          { id: "default-2", nome: "Cliente Ativo", cor: "#22c55e", count: 0 },
          { id: "default-3", nome: "Inativo", cor: "#6b7280", count: 0 },
          { id: "default-4", nome: "VIP", cor: "#8b5cf6", count: 0 },
        ];
      }
      return data as unknown as TagType[];
    },
    enabled: !!user?.id
  });

  const { data: stages = [], isLoading: loadingStages } = useQuery({
    queryKey: ["funil-estagios-config-data"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("funil_estagios" as any)
        .select("*")
        .order("ordem", { ascending: true });
      if (error) throw error;

      if (!data || data.length === 0) {
        const defaults = [
          "Novo Lead", "Qualificado", "Proposta Enviada", 
          "Negociação", "Fechado", "Perdido"
        ];
        return defaults.map((nome, i) => ({
          id: `default-s-${i}`,
          nome,
          cor: PREDEFINED_COLORS[i % PREDEFINED_COLORS.length],
          ordem: i,
          count: 0
        }));
      }
      return data as unknown as StageType[];
    },
    enabled: !!user?.id
  });

  // Mutations
  const createTagMutation = useMutation({
    mutationFn: async (newTag: { nome: string; cor: string }) => {
      const { error } = await supabase.from("tags" as any).insert([{ ...newTag, user_id: user?.id }]);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tags-management-data"] });
      setTagName("");
      toast.success("Tag criada!");
    }
  });

  const createStageMutation = useMutation({
    mutationFn: async (newStage: { nome: string; cor: string }) => {
      const { error } = await supabase.from("funil_estagios" as any).insert([{
        ...newStage,
        user_id: user?.id,
        ordem: stages.length
      }]);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["funil-estagios-config-data"] });
      setStageName("");
      toast.success("Estágio criado!");
    }
  });

  const deleteStageMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("funil_estagios" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["funil-estagios-config-data"] });
      toast.success("Estágio removido");
    }
  });

  const reorderMutation = useMutation({
    mutationFn: async (newStages: StageType[]) => {
      const updates = newStages.map((s, i) => ({
        id: s.id,
        ordem: i,
        user_id: user?.id,
        nome: s.nome,
        cor: s.cor
      }));
      const { error } = await supabase.from("funil_estagios" as any).upsert(updates);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["funil-estagios-config-data"] })
  });

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (active.id !== over?.id) {
      const oldIndex = stages.findIndex((s) => s.id === active.id);
      const newIndex = stages.findIndex((s) => s.id === over?.id);
      const newOrder = arrayMove(stages, oldIndex, newIndex);
      reorderMutation.mutate(newOrder);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">Gerenciamento de Tags e Funil</h1>
        <p className="text-muted-foreground">Personalize a organização dos seus leads e contatos.</p>
      </div>
      
      <Tabs defaultValue="tags" value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="tags">Tags de Identificação</TabsTrigger>
          <TabsTrigger value="estagios">Estágios do Funil</TabsTrigger>
        </TabsList>

        <TabsContent value="tags" className="space-y-6 pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Nova Tag</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col md:flex-row gap-4 items-end">
                <div className="flex-1 space-y-2">
                  <label className="text-sm font-medium">Nome da Tag</label>
                  <Input 
                    placeholder="Ex: Cliente VIP" 
                    value={tagName}
                    onChange={(e) => setTagName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Cor</label>
                  <div className="flex flex-wrap gap-2 p-2 border rounded-md">
                    {PREDEFINED_COLORS.map(color => (
                      <button
                        key={color}
                        onClick={() => setTagColor(color)}
                        className={`w-6 h-6 rounded-full transition-all ${tagColor === color ? 'ring-2 ring-primary ring-offset-2 scale-110' : 'hover:scale-105'}`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
                <Button 
                  onClick={() => createTagMutation.mutate({ nome: tagName, cor: tagColor })}
                  disabled={!tagName || createTagMutation.isPending}
                  className="gradient-brand"
                >
                  <Plus className="w-4 h-4 mr-2" /> Criar Tag
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {tags.map((tag) => (
              <Card key={tag.id} className="group overflow-hidden">
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: tag.cor }} />
                    <span className="font-medium">{tag.nome}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-[10px]">{tag.count || 0} contatos</Badge>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive opacity-0 group-hover:opacity-100 transition-opacity">
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="estagios" className="space-y-6 pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Novo Estágio</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col md:flex-row gap-4 items-end">
                <div className="flex-1 space-y-2">
                  <label className="text-sm font-medium">Nome do Estágio</label>
                  <Input 
                    placeholder="Ex: Negociação Final" 
                    value={stageName}
                    onChange={(e) => setStageName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Cor</label>
                  <div className="flex flex-wrap gap-2 p-2 border rounded-md">
                    {PREDEFINED_COLORS.map(color => (
                      <button
                        key={color}
                        onClick={() => setStageColor(color)}
                        className={`w-6 h-6 rounded-full transition-all ${stageColor === color ? 'ring-2 ring-primary ring-offset-2 scale-110' : 'hover:scale-105'}`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
                <Button 
                  onClick={() => createStageMutation.mutate({ nome: stageName, cor: stageColor })}
                  disabled={!stageName || createStageMutation.isPending}
                >
                  <Plus className="w-4 h-4 mr-2" /> Adicionar Estágio
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="max-w-2xl">
            <DndContext 
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={stages.map(s => s.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {stages.map((stage) => (
                    <SortableStage 
                      key={stage.id} 
                      stage={stage} 
                      onEdit={() => {}} 
                      onDelete={(id) => deleteStageMutation.mutate(id)} 
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default TagsFunilPage;
