import { useState, useEffect, useMemo } from "react";
import { CRMLayout } from "@/components/CRMLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  Loader2,
  Zap,
  Copy,
  MessageSquare,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/integrations/database/client";
import { useAuth } from "@/hooks/useAuth";

interface RespostaRapida {
  id: string;
  titulo: string;
  conteudo: string;
  atalho: string | null;
  created_at: string;
}

export default function RespostasRapidas() {
  const { user } = useAuth();
  const [respostas, setRespostas] = useState<RespostaRapida[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [modal, setModal] = useState(false);
  const [editando, setEditando] = useState<RespostaRapida | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [form, setForm] = useState({ titulo: "", conteudo: "", atalho: "" });

  const carregar = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await (api as any)
      .from("respostas_rapidas")
      .select("*")
      .order("titulo", { ascending: true });
    if (error) toast.error(error.message);
    else setRespostas((data ?? []) as RespostaRapida[]);
    setLoading(false);
  };

  useEffect(() => { carregar(); }, [user?.id]);

  const filtradas = useMemo(() => {
    const t = searchTerm.toLowerCase();
    if (!t) return respostas;
    return respostas.filter(r =>
      r.titulo.toLowerCase().includes(t) ||
      r.conteudo.toLowerCase().includes(t) ||
      (r.atalho ?? "").toLowerCase().includes(t)
    );
  }, [respostas, searchTerm]);

  const abrirNova = () => {
    setEditando(null);
    setForm({ titulo: "", conteudo: "", atalho: "" });
    setModal(true);
  };

  const abrirEdicao = (r: RespostaRapida) => {
    setEditando(r);
    setForm({ titulo: r.titulo, conteudo: r.conteudo, atalho: r.atalho ?? "" });
    setModal(true);
  };

  const salvar = async () => {
    if (!user) return;
    if (!form.titulo.trim() || !form.conteudo.trim()) {
      toast.error("Título e conteúdo são obrigatórios");
      return;
    }
    setSalvando(true);
    const payload = {
      user_id: user.id,
      titulo: form.titulo.trim(),
      conteudo: form.conteudo.trim(),
      atalho: form.atalho.trim() ? form.atalho.trim().replace(/^\/+/, "") : null,
    };
    const { error } = editando
      ? await (api as any).from("respostas_rapidas").update(payload).eq("id", editando.id)
      : await (api as any).from("respostas_rapidas").insert(payload);
    setSalvando(false);
    if (error) { toast.error(error.message); return; }
    toast.success(editando ? "Resposta atualizada!" : "Resposta criada!");
    setModal(false);
    carregar();
  };

  const deletar = async (id: string) => {
    const { error } = await (api as any).from("respostas_rapidas").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Resposta removida");
    setRespostas(prev => prev.filter(r => r.id !== id));
  };

  const copiar = (conteudo: string) => {
    navigator.clipboard.writeText(conteudo);
    toast.success("Copiado!");
  };

  return (
    <CRMLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Respostas Rápidas</h1>
            <p className="text-muted-foreground text-sm">
              Crie modelos de mensagens para enviar rapidamente no chat. Use{" "}
              <code className="bg-muted px-1 rounded text-xs">/atalho</code> no chat para acionar.
            </p>
          </div>
          <Button onClick={abrirNova} className="gap-2">
            <Plus className="h-4 w-4" />
            Nova Resposta
          </Button>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por título, conteúdo ou atalho..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtradas.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center text-center py-12 gap-3">
              <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                <MessageSquare className="h-6 w-6" />
              </div>
              <div>
                <p className="font-semibold">Nenhuma resposta encontrada</p>
                <p className="text-sm text-muted-foreground">
                  {searchTerm ? "Tente outro termo de busca." : "Crie sua primeira resposta rápida."}
                </p>
              </div>
              {!searchTerm && (
                <Button onClick={abrirNova} className="gap-2">
                  <Plus className="h-4 w-4" /> Criar primeira resposta
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtradas.map(r => (
              <Card key={r.id} className="group hover:border-primary/30 transition-colors">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-sm truncate">{r.titulo}</p>
                      {r.atalho && (
                        <Badge variant="outline" className="text-[10px] gap-1 mt-1">
                          <Zap className="h-2.5 w-2.5" />/{r.atalho}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copiar(r.conteudo)} title="Copiar">
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => abrirEdicao(r)} title="Editar">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" title="Excluir">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Excluir resposta?</AlertDialogTitle>
                            <AlertDialogDescription>"{r.titulo}" será removida permanentemente.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={() => deletar(r.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Excluir</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap">{r.conteudo}</p>
                  <p className="text-[10px] text-muted-foreground/50">
                    {new Date(r.created_at).toLocaleDateString("pt-BR")}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={modal} onOpenChange={setModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editando ? "Editar Resposta Rápida" : "Nova Resposta Rápida"}</DialogTitle>
            <DialogDescription>
              Crie modelos de mensagens para usar no chat com atalho <code>/</code>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Título *</Label>
              <Input
                value={form.titulo}
                onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))}
                placeholder="Ex: Saudação inicial"
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label>Atalho (opcional)</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">/</span>
                <Input
                  value={form.atalho}
                  onChange={e => setForm(f => ({ ...f, atalho: e.target.value.replace(/^\/+/, "") }))}
                  placeholder="saudacao"
                  className="pl-6"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Digite <code className="bg-muted px-1 rounded">/{form.atalho || "atalho"}</code> no chat para acionar rapidamente.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Conteúdo *</Label>
              <Textarea
                value={form.conteudo}
                onChange={e => setForm(f => ({ ...f, conteudo: e.target.value }))}
                placeholder="Olá! Como posso ajudar você hoje?"
                className="min-h-[140px] resize-y"
              />
              <p className="text-xs text-muted-foreground">{form.conteudo.length} caracteres</p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setModal(false)}>Cancelar</Button>
            <Button onClick={salvar} disabled={salvando}>
              {salvando && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              {editando ? "Salvar alterações" : "Criar resposta"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CRMLayout>
  );
}
