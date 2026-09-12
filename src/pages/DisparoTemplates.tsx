import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { CRMLayout } from "@/components/CRMLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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

// [AUDITORIA] LÓGICA (Sprint Editor Template WhatsApp, 2026-09-04): esta tela ficou só com
// listar/buscar/excluir — criar e editar viraram uma página própria (`DisparoTemplateEditor.tsx`,
// rota `/disparos/templates/:id`, `:id === "novo"` pra criação) por causa do tamanho novo do
// formulário (header/corpo/footer/botões/preview lado a lado não cabe razoavelmente num modal).
// O modal antigo (upload de galeria embutido, campos de mensagem/legenda) saiu inteiro daqui.

interface DisparoTemplate {
  id: string;
  nome: string;
  tipo_midia: "texto" | "imagem" | "audio" | "documento";
  mensagem: string;
  legenda_midia: string | null;
  footer: string | null;
  botoes: unknown[] | null;
  created_at: string;
}

const MEDIA_ICONS: Record<string, typeof MessageSquare> = {
  texto: MessageSquare,
  imagem: ImageIcon,
  audio: Headphones,
  documento: FileText,
};

export default function DisparoTemplatesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<DisparoTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

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
          <Button onClick={() => navigate("/disparos/templates/novo")} className="gap-2">
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
                <Button onClick={() => navigate("/disparos/templates/novo")} className="gap-2">
                  <Plus className="h-4 w-4" /> Criar primeiro template
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtrados.map(tpl => {
              const MediaIcon = MEDIA_ICONS[tpl.tipo_midia] ?? MessageSquare;
              return (
                <Card
                  key={tpl.id}
                  className="group hover:border-primary/30 transition-colors cursor-pointer"
                  onClick={() => navigate(`/disparos/templates/${tpl.id}`)}
                >
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm truncate">{tpl.nome}</p>
                        <div className="flex items-center gap-1.5 flex-wrap mt-1">
                          <Badge variant="outline" className="text-[10px] gap-1 capitalize">
                            <MediaIcon className="h-2.5 w-2.5" />{tpl.tipo_midia}
                          </Badge>
                          {!!tpl.footer && <Badge variant="outline" className="text-[10px]">footer</Badge>}
                          {!!tpl.botoes?.length && <Badge variant="outline" className="text-[10px]">{tpl.botoes.length} botão(ões)</Badge>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost" size="icon" className="h-7 w-7" title="Editar"
                          onClick={e => { e.stopPropagation(); navigate(`/disparos/templates/${tpl.id}`); }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" title="Excluir"
                              onClick={e => e.stopPropagation()}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent onClick={e => e.stopPropagation()}>
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
    </CRMLayout>
  );
}
