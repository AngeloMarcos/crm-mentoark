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
  LayoutTemplate,
  MessageSquare,
  Image as ImageIcon,
  Headphones,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/integrations/database/client";
import { useAuth } from "@/hooks/useAuth";

interface DisparoTemplate {
  id: string;
  nome: string;
  tipo_midia: "texto" | "imagem" | "audio" | "documento";
  mensagem: string;
  url_midia: string | null;
  legenda_midia: string | null;
  created_at: string;
}

const MEDIA_TYPES = [
  { id: "texto", label: "Texto", icon: MessageSquare },
  { id: "imagem", label: "Imagem", icon: ImageIcon },
  { id: "audio", label: "Áudio", icon: Headphones },
  { id: "documento", label: "Documento", icon: FileText },
] as const;

export default function DisparoTemplatesPage() {
  const { user } = useAuth();
  const [templates, setTemplates] = useState<DisparoTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [modal, setModal] = useState(false);
  const [editando, setEditando] = useState<DisparoTemplate | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [form, setForm] = useState({
    nome: "",
    tipo_midia: "texto" as DisparoTemplate["tipo_midia"],
    mensagem: "",
    url_midia: "",
    legenda_midia: "",
  });

  const carregar = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await (api as any)
      .from("disparo_templates")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setTemplates((data ?? []) as DisparoTemplate[]);
    setLoading(false);
  };

  useEffect(() => { carregar(); }, [user?.id]);

  const filtrados = useMemo(() => {
    const t = searchTerm.toLowerCase();
    if (!t) return templates;
    return templates.filter(tpl =>
      tpl.nome.toLowerCase().includes(t) ||
      tpl.mensagem.toLowerCase().includes(t)
    );
  }, [templates, searchTerm]);

  const abrirNovo = () => {
    setEditando(null);
    setForm({ nome: "", tipo_midia: "texto", mensagem: "", url_midia: "", legenda_midia: "" });
    setModal(true);
  };

  const abrirEdicao = (tpl: DisparoTemplate) => {
    setEditando(tpl);
    setForm({
      nome: tpl.nome,
      tipo_midia: tpl.tipo_midia,
      mensagem: tpl.mensagem,
      url_midia: tpl.url_midia ?? "",
      legenda_midia: tpl.legenda_midia ?? "",
    });
    setModal(true);
  };

  const salvar = async () => {
    if (!user) return;
    if (!form.nome.trim()) {
      toast.error("Nome do template é obrigatório");
      return;
    }
    if (form.tipo_midia === "texto" && !form.mensagem.trim()) {
      toast.error("Mensagem é obrigatória para templates de texto");
      return;
    }
    setSalvando(true);
    const payload = {
      user_id: user.id,
      nome: form.nome.trim(),
      tipo_midia: form.tipo_midia,
      mensagem: form.mensagem,
      url_midia: form.url_midia.trim() || null,
      legenda_midia: form.legenda_midia.trim() || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = editando
      ? await (api as any).from("disparo_templates").update(payload).eq("id", editando.id)
      : await (api as any).from("disparo_templates").insert(payload);
    setSalvando(false);
    if (error) { toast.error(error.message); return; }
    toast.success(editando ? "Template atualizado!" : "Template criado!");
    setModal(false);
    carregar();
  };

  const deletar = async (id: string) => {
    const { error } = await (api as any).from("disparo_templates").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Template removido");
    setTemplates(prev => prev.filter(tpl => tpl.id !== id));
  };

  return (
    <CRMLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Templates de Mensagem</h1>
            <p className="text-muted-foreground text-sm">
              Salve mensagens prontas para reaproveitar em novas campanhas de Disparos, sem digitar tudo de novo.
            </p>
          </div>
          <Button onClick={abrirNovo} className="gap-2">
            <Plus className="h-4 w-4" />
            Novo Template
          </Button>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome ou conteúdo..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtrados.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center text-center py-12 gap-3">
              <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                <LayoutTemplate className="h-6 w-6" />
              </div>
              <div>
                <p className="font-semibold">Nenhum template encontrado</p>
                <p className="text-sm text-muted-foreground">
                  {searchTerm ? "Tente outro termo de busca." : "Crie seu primeiro template de mensagem."}
                </p>
              </div>
              {!searchTerm && (
                <Button onClick={abrirNovo} className="gap-2">
                  <Plus className="h-4 w-4" /> Criar primeiro template
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtrados.map(tpl => {
              const MediaIcon = MEDIA_TYPES.find(m => m.id === tpl.tipo_midia)?.icon ?? MessageSquare;
              return (
                <Card key={tpl.id} className="group hover:border-primary/30 transition-colors">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm truncate">{tpl.nome}</p>
                        <Badge variant="outline" className="text-[10px] gap-1 mt-1 capitalize">
                          <MediaIcon className="h-2.5 w-2.5" />{tpl.tipo_midia}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => abrirEdicao(tpl)} title="Editar">
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
                              <AlertDialogTitle>Excluir template?</AlertDialogTitle>
                              <AlertDialogDescription>"{tpl.nome}" será removido permanentemente.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deletar(tpl.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Excluir</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap">
                      {tpl.tipo_midia === "texto" ? tpl.mensagem : (tpl.legenda_midia || tpl.mensagem || "(sem legenda)")}
                    </p>
                    <p className="text-[10px] text-muted-foreground/50">
                      {new Date(tpl.created_at).toLocaleDateString("pt-BR")}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={modal} onOpenChange={setModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editando ? "Editar Template" : "Novo Template"}</DialogTitle>
            <DialogDescription>
              Templates ficam disponíveis para carregar direto no passo "Mensagem" de uma nova campanha de Disparos.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nome do Template *</Label>
              <Input
                value={form.nome}
                onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
                placeholder="Ex: Promoção mensal"
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label>Tipo de Mídia</Label>
              <div className="flex gap-2 p-1 bg-muted rounded-lg w-fit">
                {MEDIA_TYPES.map(t => (
                  <Button
                    key={t.id}
                    type="button"
                    variant={form.tipo_midia === t.id ? "default" : "ghost"}
                    size="sm"
                    className="h-8 gap-2"
                    onClick={() => setForm(f => ({ ...f, tipo_midia: t.id }))}
                  >
                    <t.icon className="h-4 w-4" /> {t.label}
                  </Button>
                ))}
              </div>
            </div>

            {form.tipo_midia !== "texto" && (
              <div className="space-y-1.5">
                <Label>URL do Arquivo</Label>
                <Input
                  value={form.url_midia}
                  onChange={e => setForm(f => ({ ...f, url_midia: e.target.value }))}
                  placeholder="https://..."
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label>{form.tipo_midia === "texto" ? "Mensagem *" : "Legenda (opcional)"}</Label>
              <Textarea
                value={form.tipo_midia === "texto" ? form.mensagem : form.legenda_midia}
                onChange={e => setForm(f => (
                  f.tipo_midia === "texto"
                    ? { ...f, mensagem: e.target.value }
                    : { ...f, legenda_midia: e.target.value }
                ))}
                placeholder="Olá {{primeiro_nome}}, tudo bem?"
                className="min-h-[140px] resize-y font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Use <code className="bg-muted px-1 rounded">{"{{nome}}"}</code>, <code className="bg-muted px-1 rounded">{"{{primeiro_nome}}"}</code>, <code className="bg-muted px-1 rounded">{"{{telefone}}"}</code>, <code className="bg-muted px-1 rounded">{"{{empresa}}"}</code> — as mesmas variáveis do passo Mensagem em Disparos.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setModal(false)}>Cancelar</Button>
            <Button onClick={salvar} disabled={salvando}>
              {salvando && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              {editando ? "Salvar alterações" : "Criar template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CRMLayout>
  );
}
