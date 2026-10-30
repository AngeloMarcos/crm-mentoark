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
import { indexarConhecimentoAgora, reindexarConhecimento } from "@/lib/baseConhecimento";

interface DocumentoRAG {
  id: number;
  content: string;
  metadata: { tipo?: string; categoria?: string; campo?: string };
  // 2026-10-30: indexação automática (services/indexacao.ts). Trechos gerados a partir das abas
  // Persona/Negócio/FAQs... têm conhecimento_id e não aparecem aqui (são geridos lá).
  conhecimento_id?: string | null;
  status_indexacao?: string | null;
  erro_indexacao?: string | null;
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

  const [openUpload, setOpenUpload] = useState(false);
  const [reindexando, setReindexando] = useState(false);

  const carregar = async () => {
    setLoading(true);
    const { data, error } = await (api as any)
      .from("documents")
      .select("id, content, metadata, conhecimento_id, status_indexacao, erro_indexacao")
      .order("id", { ascending: false });
    if (error) {
      toast.error("Erro ao carregar base vetorial: " + error.message);
      setDocs([]);
    } else {
      setDocs(((data ?? []) as DocumentoRAG[]).filter((d) => !d.conhecimento_id));
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
    toast.success("Documento adicionado. Ele é indexado sozinho em até 2 minutos.");
    setNovoCampo(""); setNovaCategoria(""); setNovoConteudo("");
    setOpenAdd(false);
    indexarConhecimentoAgora().catch(() => {}).finally(carregar);
  };

  // 2026-10-30: antes chamava um webhook do n8n (desligado); agora indexa no próprio backend.
  const reindexar = async () => {
    setReindexando(true);
    try {
      const r = await reindexarConhecimento({});
      if (r.erros) toast.error(`${r.erros} ${r.erros === 1 ? "item não foi indexado" : "itens não foram indexados"}. Confira a integração OpenAI em Integrações.`);
      else toast.success(`Reindexação concluída: ${r.indexados} ${r.indexados === 1 ? "item" : "itens"}.`);
    } catch (e: unknown) {
      toast.error((e as Error).message);
    } finally {
      setReindexando(false);
      carregar();
    }
  };

  return (
    <div className="space-y-4">
      {/* Header com contagens */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            {docs.length} {docs.length === 1 ? "documento" : "documentos"} · {docs.filter((d) => d.status_indexacao === "indexado").length} indexados
          </p>
          <div className="flex flex-wrap gap-2 mt-2">
            {TIPOS.map((t) => (
              <Badge key={t.value} className={t.className}>{t.label}: {contagemPorTipo[t.value] ?? 0}</Badge>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={reindexar} disabled={reindexando}>
            {reindexando ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />} Reindexar tudo
          </Button>
          <Button variant="outline" size="sm" onClick={() => setOpenUpload(true)}><FileUp className="h-4 w-4 mr-1" /> Upload Documentos</Button>
          <Dialog open={openAdd} onOpenChange={setOpenAdd}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Adicionar documento</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Novo documento manual</DialogTitle>
                <DialogDescription>Insere um texto na base. Ele é indexado sozinho em até 2 minutos e passa a ser consultado pela IA.</DialogDescription>
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
              <h3 className="text-lg font-semibold">Nenhum documento avulso ainda</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-md">
                Envie arquivos (PDF, texto) ou adicione textos longos aqui. O que você preenche nas outras abas também é indexado sozinho.
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
                  <TableHead className="w-28">Status</TableHead>
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
                    <TableCell>
                      {d.status_indexacao === "indexado" ? (
                        <Badge className="bg-success/15 text-success border-0">Indexado</Badge>
                      ) : d.status_indexacao === "erro" ? (
                        <Badge className="bg-destructive/15 text-destructive border-0" title={d.erro_indexacao ?? undefined}>Erro</Badge>
                      ) : (
                        <Badge className="bg-warning/15 text-warning border-0">Aguardando</Badge>
                      )}
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

      {/* Upload de Documentos — os trechos enviados são indexados em seguida */}
      <UploadDocumentos open={openUpload} onOpenChange={setOpenUpload}
        onUploaded={() => { indexarConhecimentoAgora().catch(() => {}).finally(carregar); }} />
    </div>
  );
}

export const BaseVetorialIcon = Database;
