import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Brain, Database, Loader2, Plus, RefreshCw, Search, Trash2, FileUp } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/integrations/database/client";
import { useAuth } from "@/hooks/useAuth";
import { UploadDocumentos } from "./UploadDocumentos";

interface DocumentoRAG {
  id: number;
  content: string;
  metadata: { tipo?: string; categoria?: string; campo?: string };
}

const TIPOS = [
  { value: "faq", label: "FAQ", className: "bg-blue-500/15 text-blue-500 border-0" },
  { value: "script", label: "Script", className: "bg-success/15 text-success border-0" },
  { value: "objecao", label: "Objeção", className: "bg-accent/15 text-accent border-0" },
  { value: "personalidade", label: "Personalidade", className: "bg-purple-500/15 text-purple-500 border-0" },
  { value: "negocio", label: "Negócio", className: "bg-muted text-muted-foreground border-0" },
] as const;

const tipoBadge = (tipo?: string) => {
  const t = TIPOS.find((x) => x.value === tipo);
  return <Badge className={t?.className ?? "bg-muted text-muted-foreground border-0"}>{t?.label ?? tipo ?? "—"}</Badge>;
};

export function BaseVetorial() {
  const { user } = useAuth();
  const [docs, setDocs] = useState<DocumentoRAG[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<string>("todos");

  const [openAdd, setOpenAdd] = useState(false);
  const [novoTipo, setNovoTipo] = useState("faq");
  const [novaCategoria, setNovaCategoria] = useState("");
  const [novoCampo, setNovoCampo] = useState("");
  const [novoConteudo, setNovoConteudo] = useState("");
  const [salvando, setSalvando] = useState(false);

  const [openWebhook, setOpenWebhook] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState(() => localStorage.getItem("n8n_webhook_indexar") ?? "");

  const carregar = async () => {
    setLoading(true);
    const { data, error } = await (api as any)
      .from("documents")
      .select("id, content, metadata")
      .order("id", { ascending: false });
    if (error) {
      toast.error("Erro ao carregar base vetorial: " + error.message);
      setDocs([]);
    } else {
      setDocs((data ?? []) as DocumentoRAG[]);
    }
    setLoading(false);
  };

  useEffect(() => { carregar(); }, []);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return docs.filter((d) => {
      if (filtroTipo !== "todos" && d.metadata?.tipo !== filtroTipo) return false;
      if (!q) return true;
      return (
        d.content?.toLowerCase().includes(q) ||
        d.metadata?.tipo?.toLowerCase().includes(q) ||
        d.metadata?.categoria?.toLowerCase().includes(q) ||
        d.metadata?.campo?.toLowerCase().includes(q)
      );
    });
  }, [docs, busca, filtroTipo]);

  const contagemPorTipo = useMemo(() => {
    const map: Record<string, number> = {};
    docs.forEach((d) => { const t = d.metadata?.tipo ?? "outro"; map[t] = (map[t] ?? 0) + 1; });
    return map;
  }, [docs]);

  const deletar = async (id: number) => {
    const { error } = await (api as any).from("documents").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Documento removido");
    setDocs((prev) => prev.filter((d) => d.id !== id));
  };

  const adicionar = async () => {
    if (!user) return toast.error("Faça login");
    if (!novoConteudo.trim() || !novoCampo.trim()) return toast.error("Preencha campo e conteúdo");
    setSalvando(true);
    const content = `${novoTipo}: ${novoCampo}\n${novoConteudo}`;
    const metadata = { tipo: novoTipo, categoria: novaCategoria, campo: novoCampo };
    const { error } = await (api as any).from("documents").insert({ user_id: user.id, content, metadata });
    setSalvando(false);
    if (error) return toast.error(error.message);
    toast.success("Documento adicionado. Lembre-se de reindexar via n8n.");
    setNovoCampo(""); setNovaCategoria(""); setNovoConteudo("");
    setOpenAdd(false);
    carregar();
  };

  const reindexar = async () => {
    const url = localStorage.getItem("n8n_webhook_indexar");
    if (!url) { setOpenWebhook(true); return; }
    try {
      await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trigger: "reindex", at: new Date().toISOString() }) });
      toast.success("Reindexação iniciada no n8n");
    } catch (e: any) {
      toast.error("Falha ao chamar webhook: " + (e?.message ?? "erro"));
    }
  };

  const salvarWebhook = () => {
    localStorage.setItem("n8n_webhook_indexar", webhookUrl.trim());
    toast.success("Webhook salvo");
    setOpenWebhook(false);
  };

  return (
    <div className="space-y-4">
      {/* Header com contagens */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{docs.length} documentos indexados</p>
          <div className="flex flex-wrap gap-2 mt-2">
            {TIPOS.map((t) => (
              <Badge key={t.value} className={t.className}>{t.label}: {contagemPorTipo[t.value] ?? 0}</Badge>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={reindexar}><RefreshCw className="h-4 w-4 mr-1" /> Reindexar tudo</Button>
          <Dialog open={openAdd} onOpenChange={setOpenAdd}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Adicionar documento</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Novo documento manual</DialogTitle>
                <DialogDescription>Insere um registro na base vetorial. O embedding será gerado depois pelo n8n.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium">Tipo</label>
                  <Select value={novoTipo} onValueChange={setNovoTipo}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TIPOS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium">Categoria</label>
                  <Input value={novaCategoria} onChange={(e) => setNovaCategoria(e.target.value)} placeholder="Ex: BPC, Abertura, Preço" />
                </div>
                <div>
                  <label className="text-sm font-medium">Campo / Nome</label>
                  <Input value={novoCampo} onChange={(e) => setNovoCampo(e.target.value)} placeholder="Ex: Quanto custa?" />
                </div>
                <div>
                  <label className="text-sm font-medium">Conteúdo</label>
                  <Textarea rows={6} value={novoConteudo} onChange={(e) => setNovoConteudo(e.target.value)} placeholder="Texto completo que será indexado..." />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpenAdd(false)}>Cancelar</Button>
                <Button onClick={adicionar} disabled={salvando}>{salvando && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Salvar</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="pt-4 flex flex-col md:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Buscar por conteúdo, tipo, categoria..." value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
          <Select value={filtroTipo} onValueChange={setFiltroTipo}>
            <SelectTrigger className="md:w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os tipos</SelectItem>
              {TIPOS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Lista */}
      <Card>
        <CardContent className="pt-4">
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : docs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Brain className="h-16 w-16 text-muted-foreground/40 mb-4" />
              <h3 className="text-lg font-semibold">Nenhum documento indexado ainda</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-md">
                Preencha as abas Personalidade, Negócio, FAQs, Objeções e Scripts, exporte o CSV e importe no workflow n8n de indexação.
              </p>
            </div>
          ) : filtrados.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">Nenhum documento encontrado para o filtro atual.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">ID</TableHead>
                  <TableHead className="w-32">Tipo</TableHead>
                  <TableHead className="w-40">Categoria</TableHead>
                  <TableHead>Conteúdo</TableHead>
                  <TableHead className="text-right w-20">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtrados.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">#{d.id}</TableCell>
                    <TableCell>{tipoBadge(d.metadata?.tipo)}</TableCell>
                    <TableCell className="text-sm">{d.metadata?.categoria || "—"}</TableCell>
                    <TableCell className="text-sm">
                      <div className="font-medium">{d.metadata?.campo}</div>
                      <div className="text-muted-foreground line-clamp-1">{d.content?.slice(0, 120)}{(d.content?.length ?? 0) > 120 ? "..." : ""}</div>
                    </TableCell>
                    <TableCell className="text-right">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive"><Trash2 className="h-4 w-4" /></Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remover documento?</AlertDialogTitle>
                            <AlertDialogDescription>Esta ação não pode ser desfeita. O documento será removido da base vetorial.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={() => deletar(d.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Remover</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Dialog config webhook */}
      <Dialog open={openWebhook} onOpenChange={setOpenWebhook}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Configurar webhook n8n</DialogTitle>
            <DialogDescription>Cole a URL do webhook do n8n responsável por reindexar a base vetorial.</DialogDescription>
          </DialogHeader>
          <Input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://n8n.seudominio.com/webhook/indexar" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenWebhook(false)}>Cancelar</Button>
            <Button onClick={salvarWebhook}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export const BaseVetorialIcon = Database;
