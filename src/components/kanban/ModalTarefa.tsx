import React, { useEffect, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Calendar as CalendarIcon,
  MessageSquare,
  Plus,
  Send,
  Trash2,
  X,
  User as UserIcon,
  Search,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { api } from "@/integrations/database/client";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { Tarefa } from "./KanbanCard";
import { toast } from "sonner";

interface ModalTarefaProps {
  aberto: boolean;
  tarefa?: Tarefa;
  colunas: { id: string; nome: string }[];
  colunaInicial?: string;
  onFechar: () => void;
  onSalvar: (dados: any) => Promise<void>;
  onExcluir?: (id: string) => Promise<void>;
}

const ModalTarefa = ({
  aberto,
  tarefa,
  colunas,
  colunaInicial,
  onFechar,
  onSalvar,
  onExcluir,
}: ModalTarefaProps) => {
  const { user } = useAuth();
  const [form, setForm] = useState<any>({
    titulo: "",
    descricao: "",
    coluna_id: "",
    prioridade: "media",
    atribuido_a: "",
    contato_id: "",
    tags: [] as string[],
    data_limite: undefined as Date | undefined,
  });

  const [tagInput, setTagInput] = useState("");
  const [membros, setMembros] = useState<any[]>([]);
  const [contatos, setContatos] = useState<any[]>([]);
  const [buscaContato, setBuscaContato] = useState("");
  const [comentarios, setComentarios] = useState<any[]>([]);
  const [novoComentario, setNovoComentario] = useState("");
  const [loadingComentarios, setLoadingComentarios] = useState(false);
  const [enviandoComentario, setEnviandoComentario] = useState(false);

  useEffect(() => {
    if (aberto) {
      if (tarefa) {
        setForm({
          titulo: tarefa.titulo || "",
          descricao: tarefa.descricao || "",
          coluna_id: tarefa.coluna_id || "",
          prioridade: tarefa.prioridade || "media",
          atribuido_a: tarefa.atribuido_a || "none",
          contato_id: tarefa.contato_id || "none",
          tags: tarefa.tags || [],
          data_limite: tarefa.data_limite ? new Date(tarefa.data_limite) : undefined,
        });
        carregarComentarios(tarefa.id);
      } else {
        setForm({
          titulo: "",
          descricao: "",
          coluna_id: colunaInicial || colunas[0]?.id || "",
          prioridade: "media",
          atribuido_a: "none",
          contato_id: "none",
          tags: [],
          data_limite: undefined,
        });
        setComentarios([]);
      }
      carregarMembros();
      carregarContatos();
    }
  }, [aberto, tarefa, colunas, colunaInicial]);

  const carregarMembros = async () => {
    try {
      const { data } = await api.from("sub_perfis").select("*").eq("ativo", true);
      setMembros(data || []);
    } catch (err) {
      console.error("Erro ao carregar membros", err);
    }
  };

  const carregarContatos = async (busca = "") => {
    try {
      let query = api.from("contatos").select("id, nome, email").limit(10);
      if (busca) query = query.ilike("nome", `%${busca}%`);
      const { data } = await query;
      setContatos(data || []);
    } catch (err) {
      console.error("Erro ao carregar contatos", err);
    }
  };

  const carregarComentarios = async (tarefaId: string) => {
    setLoadingComentarios(true);
    try {
      const { data } = await api.get(`/api/kanban/tarefas/${tarefaId}/comentarios`);
      setComentarios(data || []);
    } catch (err) {
      console.error("Erro ao carregar comentários", err);
    } finally {
      setLoadingComentarios(false);
    }
  };

  const handleAddTag = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && tagInput.trim()) {
      e.preventDefault();
      if (!form.tags.includes(tagInput.trim())) {
        setForm({ ...form, tags: [...form.tags, tagInput.trim()] });
      }
      setTagInput("");
    }
  };

  const removeTag = (tag: string) => {
    setForm({ ...form, tags: form.tags.filter((t: string) => t !== tag) });
  };

  const handleComentar = async () => {
    if (!novoComentario.trim() || !tarefa) return;
    setEnviandoComentario(true);
    try {
      await api.post(`/api/kanban/tarefas/${tarefa.id}/comentarios`, { conteudo: novoComentario });
      setNovoComentario("");
      carregarComentarios(tarefa.id);
    } catch (err) {
      toast.error("Erro ao enviar comentário");
    } finally {
      setEnviandoComentario(false);
    }
  };

  const handleSalvar = () => {
    if (!form.titulo.trim()) {
      toast.error("Título é obrigatório");
      return;
    }
    const dados = {
      ...form,
      atribuido_a: form.atribuido_a === "none" ? null : form.atribuido_a,
      contato_id: form.contato_id === "none" ? null : form.contato_id,
    };
    onSalvar(dados);
  };

  return (
    <Dialog open={aberto} onOpenChange={onFechar}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="p-6 pb-0">
          <DialogTitle>{tarefa ? "Editar Tarefa" : "Nova Tarefa"}</DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 px-6 py-4">
          <div className="space-y-6">
            {/* Título */}
            <div className="space-y-2">
              <Label htmlFor="titulo">Título</Label>
              <Input
                id="titulo"
                placeholder="O que precisa ser feito?"
                value={form.titulo}
                onChange={(e) => setForm({ ...form, titulo: e.target.value })}
              />
            </div>

            {/* Descrição */}
            <div className="space-y-2">
              <Label htmlFor="descricao">Descrição</Label>
              <Textarea
                id="descricao"
                placeholder="Detalhes da tarefa..."
                className="min-h-[100px] resize-none"
                value={form.descricao}
                onChange={(e) => setForm({ ...form, descricao: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Coluna */}
              <div className="space-y-2">
                <Label>Coluna</Label>
                <Select
                  value={form.coluna_id}
                  onValueChange={(val) => setForm({ ...form, coluna_id: val })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a coluna" />
                  </SelectTrigger>
                  <SelectContent>
                    {colunas.map((col) => (
                      <SelectItem key={col.id} value={col.id}>
                        {col.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Prioridade */}
              <div className="space-y-2">
                <Label>Prioridade</Label>
                <Select
                  value={form.prioridade}
                  onValueChange={(val) => setForm({ ...form, prioridade: val })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="baixa">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-gray-400" /> Baixa
                      </div>
                    </SelectItem>
                    <SelectItem value="media">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-blue-500" /> Média
                      </div>
                    </SelectItem>
                    <SelectItem value="alta">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-orange-500" /> Alta
                      </div>
                    </SelectItem>
                    <SelectItem value="urgente">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-red-500" /> Urgente
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Atribuir */}
              <div className="space-y-2">
                <Label>Atribuir para</Label>
                <Select
                  value={form.atribuido_a}
                  onValueChange={(val) => setForm({ ...form, atribuido_a: val })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Ninguém" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Ninguém</SelectItem>
                    {membros.map((m) => (
                      <SelectItem key={m.membro_id} value={m.membro_id}>
                        {m.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Data Limite */}
              <div className="space-y-2">
                <Label>Data Limite</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant={"outline"}
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !form.data_limite && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {form.data_limite ? (
                        format(form.data_limite, "PPP", { locale: ptBR })
                      ) : (
                        <span>Selecione uma data</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={form.data_limite}
                      onSelect={(date) => setForm({ ...form, data_limite: date })}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {/* Contato Vinculado */}
            <div className="space-y-2">
              <Label>Contato vinculado</Label>
              <Select
                value={form.contato_id}
                onValueChange={(val) => setForm({ ...form, contato_id: val })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Buscar contato..." />
                </SelectTrigger>
                <SelectContent>
                  <div className="flex items-center px-3 pb-2 pt-2 sticky top-0 bg-popover z-10">
                    <Search className="w-4 h-4 mr-2 text-muted-foreground" />
                    <Input
                      placeholder="Filtrar..."
                      className="h-8"
                      value={buscaContato}
                      onChange={(e) => {
                        setBuscaContato(e.target.value);
                        carregarContatos(e.target.value);
                      }}
                    />
                  </div>
                  <SelectItem value="none">Nenhum</SelectItem>
                  {contatos.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome} ({c.email})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Tags */}
            <div className="space-y-2">
              <Label>Tags</Label>
              <div className="flex flex-wrap gap-2 mb-2">
                {form.tags.map((tag: string) => (
                  <Badge key={tag} variant="secondary" className="gap-1">
                    {tag}
                    <button onClick={() => removeTag(tag)}>
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
              </div>
              <Input
                placeholder="Pressione Enter para adicionar tags"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleAddTag}
              />
            </div>

            {/* Resumo IA */}
            {tarefa?.resumo_ia && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Resumo da IA</Label>
                  <Badge className="bg-purple-100 text-purple-700 hover:bg-purple-100 border-none">
                    ✨ Gerado por IA
                  </Badge>
                </div>
                <div className="p-3 rounded-md bg-purple-50/50 border border-purple-100 text-sm text-slate-600 italic">
                  {tarefa.resumo_ia}
                </div>
              </div>
            )}

            {/* Seção de Comentários (modo edição) */}
            {tarefa && (
              <div className="space-y-4 pt-6 border-t">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <MessageSquare className="w-4 h-4" /> Comentários
                </h3>
                
                <div className="space-y-4">
                  {comentarios.map((com) => (
                    <div key={com.id} className="flex gap-3">
                      <Avatar className="w-8 h-8">
                        <AvatarFallback className="text-xs bg-slate-100">
                          {com.display_name?.substring(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold">{com.display_name}</span>
                          <span className="text-[10px] text-slate-400">
                            {format(new Date(com.created_at), "dd/MM HH:mm")}
                          </span>
                        </div>
                        <p className="text-sm text-slate-600 bg-slate-50 p-2 rounded-md border border-slate-100">
                          {com.conteudo}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2 pt-2">
                  <Input
                    placeholder="Escreva um comentário..."
                    value={novoComentario}
                    onChange={(e) => setNovoComentario(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleComentar()}
                  />
                  <Button 
                    size="icon" 
                    onClick={handleComentar} 
                    disabled={enviandoComentario || !novoComentario.trim()}
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="p-6 pt-2 bg-slate-50/50 border-t flex items-center justify-between sm:justify-between">
          <div>
            {tarefa && onExcluir && (
              <Button
                variant="ghost"
                className="text-red-500 hover:text-red-600 hover:bg-red-50 gap-2"
                onClick={() => onExcluir(tarefa.id)}
              >
                <Trash2 className="w-4 h-4" /> Excluir
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onFechar}>Cancelar</Button>
            <Button onClick={handleSalvar}>Salvar</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ModalTarefa;
