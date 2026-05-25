import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Edit2, Copy, Trash2, Info, Zap } from "lucide-react";
import { CRMLayout } from "@/components/CRMLayout";
import { api } from "@/integrations/database/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

interface RespostaRapida {
  id: string;
  atalho: string;
  titulo: string;
  mensagem: string;
}

const RespostasRapidas = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingResponse, setEditingResponse] = useState<RespostaRapida | null>(null);

  const [atalho, setAtalho] = useState("");
  const [titulo, setTitulo] = useState("");
  const [mensagem, setMensagem] = useState("");

  const { data: responses = [], isLoading } = useQuery({
    queryKey: ["respostas-rapidas"],
    queryFn: async () => {
      const { data, error } = await api
        .from("respostas_rapidas")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as RespostaRapida[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (payload: Partial<RespostaRapida>) => {
      if (editingResponse) {
        const { error } = await api
          .from("respostas_rapidas")
          .update(payload)
          .eq("id", editingResponse.id);
        if (error) throw error;
      } else {
        const { error } = await api.from("respostas_rapidas").insert([
          {
            atalho: payload.atalho,
            titulo: payload.titulo,
            mensagem: payload.mensagem,
            user_id: user?.id,
          },
        ]);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["respostas-rapidas"] });
      toast.success(editingResponse ? "Resposta atualizada!" : "Resposta criada!");
      closeModal();
    },
    onError: (error: any) => {
      const msg = error?.message || "";
      if (msg.includes("duplicate") || error?.code === "23505") {
        toast.error("Este atalho já existe.");
      } else {
        toast.error("Erro ao salvar resposta.");
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await api.from("respostas_rapidas").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["respostas-rapidas"] });
      toast.success("Resposta excluída!");
    },
    onError: () => toast.error("Erro ao excluir resposta."),
  });

  const filteredResponses = responses.filter(
    (r) =>
      r.atalho.toLowerCase().includes(search.toLowerCase()) ||
      r.titulo.toLowerCase().includes(search.toLowerCase()) ||
      r.mensagem.toLowerCase().includes(search.toLowerCase())
  );

  const openModal = (response?: RespostaRapida) => {
    if (response) {
      setEditingResponse(response);
      setAtalho(response.atalho);
      setTitulo(response.titulo);
      setMensagem(response.mensagem);
    } else {
      setEditingResponse(null);
      setAtalho("/");
      setTitulo("");
      setMensagem("");
    }
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingResponse(null);
    setAtalho("");
    setTitulo("");
    setMensagem("");
  };

  const handleSave = () => {
    if (!atalho.startsWith("/") || atalho.length < 2) {
      toast.error("O atalho deve começar com / e ter pelo menos 2 caracteres.");
      return;
    }
    if (!/^\/[a-zA-Z0-9-]+$/.test(atalho)) {
      toast.error("O atalho só pode conter letras, números e hífen.");
      return;
    }
    if (!titulo || !mensagem) {
      toast.error("Preencha todos os campos.");
      return;
    }
    saveMutation.mutate({ atalho, titulo, mensagem });
  };

  const insertVariable = (variable: string) => {
    setMensagem((prev) => prev + `{{${variable}}}`);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Mensagem copiada!");
  };

  return (
  return (
    <CRMLayout>
    <div className="p-6 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Respostas Rápidas</h1>
          <p className="text-muted-foreground">
            Gerencie atalhos para mensagens frequentes no WhatsApp.
          </p>
        </div>
        <Button onClick={() => openModal()} className="gradient-brand shadow-lg">
          <Plus className="w-4 h-4 mr-2" />
          Nova Resposta Rápida
        </Button>
      </div>

      <div className="flex items-center gap-3 bg-primary/10 border border-primary/20 p-4 rounded-xl text-primary">
        <Info className="w-5 h-5 shrink-0" />
        <p className="text-sm">
          <strong>Dica:</strong> Durante o atendimento no WhatsApp, digite{" "}
          <code className="bg-primary/20 px-1 rounded">/</code> para buscar e inserir uma resposta rápida.
        </p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por atalho, título ou conteúdo..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10 h-12 bg-card/50"
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 bg-card animate-pulse rounded-xl border" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredResponses.map((response) => (
            <Card key={response.id} className="group hover:shadow-md transition-all border-sidebar-border/60 bg-card/50">
              <CardContent className="p-5 space-y-3">
                <div className="flex items-start justify-between">
                  <Badge variant="outline" className="font-mono text-accent bg-accent/10 border-accent/20">
                    {response.atalho}
                  </Badge>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" onClick={() => openModal(response)} className="h-8 w-8">
                      <Edit2 className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => copyToClipboard(response.mensagem)} className="h-8 w-8">
                      <Copy className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(response.id)} className="h-8 w-8 text-destructive">
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
                <div>
                  <h3 className="font-semibold text-lg">{response.titulo}</h3>
                  <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                    {response.mensagem}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {filteredResponses.length === 0 && !isLoading && (
        <div className="text-center py-12 space-y-4">
          <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto">
            <Zap className="w-8 h-8 text-muted-foreground" />
          </div>
          <p className="text-muted-foreground">Nenhuma resposta rápida encontrada.</p>
        </div>
      )}

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>{editingResponse ? "Editar" : "Nova"} Resposta Rápida</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="atalho">Atalho</Label>
                <Input
                  id="atalho"
                  placeholder="/atalho"
                  value={atalho}
                  onChange={(e) => setAtalho(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="titulo">Título Amigável</Label>
                <Input
                  id="titulo"
                  placeholder="Ex: Saudação Inicial"
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="mensagem">Mensagem</Label>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => insertVariable("nome")} className="text-[10px] h-7 px-2">
                    {"{{nome}}"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => insertVariable("telefone")} className="text-[10px] h-7 px-2">
                    {"{{telefone}}"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => insertVariable("data")} className="text-[10px] h-7 px-2">
                    {"{{data}}"}
                  </Button>
                </div>
              </div>
              <Textarea
                id="mensagem"
                placeholder="Digite o conteúdo da resposta..."
                className="min-h-[150px]"
                maxLength={1024}
                value={mensagem}
                onChange={(e) => setMensagem(e.target.value)}
              />
              <div className="flex justify-end text-[10px] text-muted-foreground uppercase tracking-wider">
                {mensagem.length} / 1024 caracteres
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeModal}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default RespostasRapidas;
