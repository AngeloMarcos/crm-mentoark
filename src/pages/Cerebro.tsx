import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { CRMLayout } from "@/components/CRMLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Brain, Download, Plus, Trash2, Pencil, User, Building2, HelpCircle, Shield, FileText, Database, Loader2, RefreshCw, Wand2, Search, Upload, Copy } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { BaseVetorial } from "@/components/cerebro/BaseVetorial";
// GeradorPrompt removido pois agora está integrado no SetupAgente
import { SetupAgente } from "@/components/cerebro/SetupAgente";
import { api } from "@/integrations/database/client";
import { useAuth } from "@/hooks/useAuth";

// ============ TYPES ============
type TipoConhecimento = "personalidade" | "negocio" | "faq" | "objecao" | "script";

interface ConhecimentoItem {
  id: string;
  tipo: TipoConhecimento;
  categoria: string | null;
  campo: string | null;
  conteudo: string;
  contexto: string | null;
  indexado: boolean;
}

// Helper for index badge
function IndexBadge({ indexado }: { indexado: boolean }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {indexado ? (
            <Badge className="bg-success/15 text-success border-0 cursor-help">Indexado</Badge>
          ) : (
            <Badge className="bg-warning/15 text-warning border-0 cursor-help">Pendente</Badge>
          )}
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <p className="text-xs">
            <strong>Indexado</strong> = disponível para o agente
            <br />
            <strong>Pendente</strong> = aguardando sincronização RAG
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ============ CSV EXPORT ============
function exportCSV(itens: ConhecimentoItem[]) {
  const rows: string[][] = [["tipo", "categoria", "campo", "conteudo", "contexto"]];
  itens.forEach((i) =>
    rows.push([i.tipo, i.categoria ?? "", i.campo ?? "", i.conteudo, i.contexto ?? ""])
  );

  const escape = (v: string) => `"${(v ?? "").replace(/"/g, '""').replace(/\n/g, "\\n")}"`;
  const csv = rows.map((r) => r.map(escape).join(",")).join("\n");
  const BOM = "\uFEFF";
  const blob = new Blob([BOM + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `cerebro-agente-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast.success("CSV exportado com sucesso!");
}

// ============ SHARED HOOKS / TYPES ============
interface EditorProps {
  items: ConhecimentoItem[];
  onSave: (item: Partial<ConhecimentoItem> & { id?: string }) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
}

// ============ KEY VALUE EDITOR (personalidade / negocio) ============
function KeyValueEditor({ items, onSave, onDelete, labelCampo }: EditorProps & { labelCampo: string }) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [campo, setCampo] = useState("");
  const [conteudo, setConteudo] = useState("");
  const [saving, setSaving] = useState(false);

  const openDialog = (item?: ConhecimentoItem) => {
    if (item) {
      setEditingId(item.id);
      setCampo(item.campo ?? "");
      setConteudo(item.conteudo);
    } else {
      setEditingId(null);
      setCampo("");
      setConteudo("");
    }
    setOpen(true);
  };

  const handleSave = async () => {
    if (!campo.trim()) return toast.error("Preencha o campo");
    setSaving(true);
    await onSave({ id: editingId ?? undefined, campo, conteudo, categoria: null, contexto: null });
    setSaving(false);
    setOpen(false);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">{items.length} itens</CardTitle>
        <Button onClick={() => openDialog()} size="sm"><Plus className="h-4 w-4" /> Adicionar</Button>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-1/3">{labelCampo}</TableHead>
              <TableHead>Conteúdo</TableHead>
              <TableHead className="w-28">Status</TableHead>
              <TableHead className="w-24 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((it) => (
              <TableRow key={it.id}>
                <TableCell className="font-medium">{it.campo}</TableCell>
                <TableCell className="text-muted-foreground">{it.conteudo}</TableCell>
                <TableCell><IndexBadge indexado={it.indexado} /></TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => openDialog(it)}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => onDelete(it.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingId ? "Editar" : "Adicionar"} item</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">{labelCampo}</label>
              <Input value={campo} onChange={(e) => setCampo(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium">Conteúdo</label>
              <Textarea value={conteudo} onChange={(e) => setConteudo(e.target.value)} rows={4} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ============ FAQ EDITOR ============
function FaqEditor({ items, onSave, onDelete }: EditorProps) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [categoria, setCategoria] = useState("");
  const [pergunta, setPergunta] = useState("");
  const [resposta, setResposta] = useState("");
  const [saving, setSaving] = useState(false);

  const openDialog = (item?: ConhecimentoItem) => {
    if (item) {
      setEditingId(item.id);
      setCategoria(item.categoria ?? "");
      setPergunta(item.campo ?? "");
      setResposta(item.conteudo);
    } else {
      setEditingId(null);
      setCategoria(""); setPergunta(""); setResposta("");
    }
    setOpen(true);
  };

  const handleSave = async () => {
    if (!pergunta.trim()) return toast.error("Preencha a pergunta");
    setSaving(true);
    await onSave({ id: editingId ?? undefined, categoria, campo: pergunta, conteudo: resposta, contexto: null });
    setSaving(false);
    setOpen(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{items.length} perguntas cadastradas</p>
        <Button onClick={() => openDialog()} size="sm"><Plus className="h-4 w-4" /> Nova FAQ</Button>
      </div>
      <div className="grid gap-3">
        {items.map((f) => (
          <Card key={f.id}>
            <CardContent className="pt-4">
              <div className="flex justify-between items-start gap-2">
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    {f.categoria && <Badge variant="secondary">{f.categoria}</Badge>}
                    <IndexBadge indexado={f.indexado} />
                  </div>
                  <h4 className="font-semibold">{f.campo}</h4>
                  <p className="text-sm text-muted-foreground">{f.conteudo}</p>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => openDialog(f)}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => onDelete(f.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingId ? "Editar" : "Nova"} FAQ</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Categoria" value={categoria} onChange={(e) => setCategoria(e.target.value)} />
            <Input placeholder="Pergunta" value={pergunta} onChange={(e) => setPergunta(e.target.value)} />
            <Textarea placeholder="Resposta" value={resposta} onChange={(e) => setResposta(e.target.value)} rows={4} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============ OBJECOES EDITOR ============
function ObjecoesEditor({ items, onSave, onDelete }: EditorProps) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [objecao, setObjecao] = useState("");
  const [resposta, setResposta] = useState("");
  const [contexto, setContexto] = useState("");
  const [saving, setSaving] = useState(false);

  const openDialog = (item?: ConhecimentoItem) => {
    if (item) {
      setEditingId(item.id);
      setObjecao(item.campo ?? "");
      setResposta(item.conteudo);
      setContexto(item.contexto ?? "");
    } else {
      setEditingId(null);
      setObjecao(""); setResposta(""); setContexto("");
    }
    setOpen(true);
  };

  const handleSave = async () => {
    if (!objecao.trim()) return toast.error("Preencha a objeção");
    setSaving(true);
    await onSave({ id: editingId ?? undefined, campo: objecao, conteudo: resposta, contexto, categoria: null });
    setSaving(false);
    setOpen(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{items.length} objeções mapeadas</p>
        <Button onClick={() => openDialog()} size="sm"><Plus className="h-4 w-4" /> Nova Objeção</Button>
      </div>
      <div className="grid gap-3">
        {items.map((o) => (
          <Card key={o.id} className="border-l-4 border-l-accent">
            <CardContent className="pt-4">
              <div className="flex justify-between items-start gap-2">
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <h4 className="font-semibold text-accent">"{o.campo}"</h4>
                    <IndexBadge indexado={o.indexado} />
                  </div>
                  <p className="text-sm">{o.conteudo}</p>
                  {o.contexto && <p className="text-xs text-muted-foreground italic">Contexto: {o.contexto}</p>}
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => openDialog(o)}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => onDelete(o.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingId ? "Editar" : "Nova"} Objeção</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Objeção do lead" value={objecao} onChange={(e) => setObjecao(e.target.value)} />
            <Textarea placeholder="Resposta sugerida" value={resposta} onChange={(e) => setResposta(e.target.value)} rows={4} />
            <Input placeholder="Contexto de uso" value={contexto} onChange={(e) => setContexto(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Badge colorido por categoria (hash determinístico)
const CAT_CORES = [
  "bg-blue-100 text-blue-700 border-0",
  "bg-purple-100 text-purple-700 border-0",
  "bg-emerald-100 text-emerald-700 border-0",
  "bg-orange-100 text-orange-700 border-0",
  "bg-pink-100 text-pink-700 border-0",
  "bg-teal-100 text-teal-700 border-0",
];
function categoriaCor(cat: string) {
  let h = 0;
  for (let i = 0; i < cat.length; i++) h = (h + cat.charCodeAt(i)) % CAT_CORES.length;
  return CAT_CORES[h];
}

// ============ SCRIPTS EDITOR ============
function ScriptsEditor({ items, onSave, onDelete, onOpenBuilder }: EditorProps & { onOpenBuilder: () => void }) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [categoria, setCategoria] = useState("");
  const [conteudo, setConteudo] = useState("");
  const [preview, setPreview] = useState<ConhecimentoItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [filtroCategoria, setFiltroCategoria] = useState("todas");

  const categorias = useMemo(
    () => [...new Set(items.map((i) => i.categoria).filter(Boolean))] as string[],
    [items],
  );

  const itensFiltrados = useMemo(
    () => filtroCategoria === "todas" ? items : items.filter((i) => i.categoria === filtroCategoria),
    [items, filtroCategoria],
  );

  const openDialog = (item?: ConhecimentoItem) => {
    if (item) {
      setEditingId(item.id);
      setNome(item.campo ?? "");
      setCategoria(item.categoria ?? "");
      setConteudo(item.conteudo);
    } else {
      setEditingId(null);
      setNome(""); setCategoria(""); setConteudo("");
    }
    setOpen(true);
  };

  const handleSave = async () => {
    if (!nome.trim()) return toast.error("Preencha o nome");
    setSaving(true);
    await onSave({ id: editingId ?? undefined, campo: nome, categoria, conteudo, contexto: null });
    setSaving(false);
    setOpen(false);
  };

  const copiar = (s: ConhecimentoItem, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(s.conteudo);
    toast.success(`Script "${s.campo}" copiado!`);
  };

  return (
    <div className="space-y-4">
      {/* Cabeçalho */}
      <div className="flex flex-wrap justify-between items-center gap-2">
        <p className="text-sm text-muted-foreground">{items.length} scripts disponíveis</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onOpenBuilder}>
            <Wand2 className="h-4 w-4 mr-1" /> Usar Script Builder
          </Button>
          <Button size="sm" onClick={() => openDialog()}>
            <Plus className="h-4 w-4 mr-1" /> Novo Script
          </Button>
        </div>
      </div>

      {/* Filtro por categoria */}
      {categorias.length > 0 && (
        <Select value={filtroCategoria} onValueChange={setFiltroCategoria}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Todas as categorias" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as categorias</SelectItem>
            {categorias.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Lista de cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {itensFiltrados.map((s) => (
          <Card
            key={s.id}
            className="cursor-pointer hover:border-primary transition-colors"
            onClick={() => setPreview(s)}
          >
            <CardContent className="pt-4">
              <div className="flex justify-between items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    {s.categoria && (
                      <Badge className={categoriaCor(s.categoria)}>{s.categoria}</Badge>
                    )}
                    <IndexBadge indexado={s.indexado} />
                  </div>
                  <h4 className="font-semibold truncate">{s.campo}</h4>
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{s.conteudo}</p>
                </div>
                <div className="flex gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="icon" title="Copiar conteúdo" onClick={(e) => copiar(s, e)}>
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => openDialog(s)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => onDelete(s.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {itensFiltrados.length === 0 && (
          <p className="text-sm text-muted-foreground col-span-2 text-center py-6 border border-dashed rounded-lg">
            Nenhum script encontrado{filtroCategoria !== "todas" ? ` na categoria "${filtroCategoria}"` : ""}.
          </p>
        )}
      </div>

      {/* Preview dialog */}
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="w-[95vw] max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {preview?.campo}
              {preview?.categoria && <Badge className={categoriaCor(preview.categoria)}>{preview.categoria}</Badge>}
            </DialogTitle>
          </DialogHeader>
          <pre className="whitespace-pre-wrap font-mono text-sm bg-muted p-4 rounded-lg max-h-96 overflow-auto">
            {preview?.conteudo}
          </pre>
          <DialogFooter>
            <Button variant="outline" onClick={() => { navigator.clipboard.writeText(preview?.conteudo ?? ""); toast.success("Copiado!"); }}>
              <Copy className="h-4 w-4 mr-2" /> Copiar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit/create dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[95vw] max-w-2xl">
          <DialogHeader><DialogTitle>{editingId ? "Editar" : "Novo"} Script</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Nome do script" value={nome} onChange={(e) => setNome(e.target.value)} />
            <Input placeholder="Categoria" value={categoria} onChange={(e) => setCategoria(e.target.value)} />
            <Textarea placeholder="Conteúdo do script" value={conteudo} onChange={(e) => setConteudo(e.target.value)} rows={12} className="font-mono text-sm" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============ MAIN PAGE ============
export default function CerebroPage() {
  const { user } = useAuth();
  const [itens, setItens] = useState<ConhecimentoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupInitialStep, setSetupInitialStep] = useState(1);

  const carregar = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await (api as any)
      .from("conhecimento")
      .select("id, tipo, categoria, campo, conteudo, contexto, indexado")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });
    if (error) {
      toast.error("Erro ao carregar conhecimento: " + error.message);
      setItens([]);
    } else {
      setItens((data ?? []) as ConhecimentoItem[]);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { carregar(); }, [carregar]);

  const makeHandlers = (tipo: TipoConhecimento) => ({
    items: itens.filter((i) => i.tipo === tipo),
    onSave: async (item: Partial<ConhecimentoItem> & { id?: string }) => {
      if (!user) return toast.error("Faça login");
      if (item.id) {
        const { error } = await (api as any)
          .from("conhecimento")
          .update({
            categoria: item.categoria ?? null,
            campo: item.campo ?? null,
            conteudo: item.conteudo ?? "",
            contexto: item.contexto ?? null,
            indexado: false,
          })
          .eq("id", item.id);
        if (error) return toast.error(error.message);
        toast.success("Atualizado");
      } else {
        const { error } = await (api as any).from("conhecimento").insert({
          user_id: user.id,
          tipo,
          categoria: item.categoria ?? null,
          campo: item.campo ?? null,
          conteudo: item.conteudo ?? "",
          contexto: item.contexto ?? null,
          indexado: false,
        });
        if (error) return toast.error(error.message);
        toast.success("Adicionado");
      }
      carregar();
    },
    onDelete: async (id: string) => {
      const { error } = await (api as any).from("conhecimento").delete().eq("id", id);
      if (error) return toast.error(error.message);
      toast.success("Removido");
      setItens((prev) => prev.filter((i) => i.id !== id));
    },
  });

  const personalidade = makeHandlers("personalidade");
  const negocio = makeHandlers("negocio");
  const faqs = makeHandlers("faq");
  const objecoes = makeHandlers("objecao");
  const scripts = makeHandlers("script");

  const stats = [
    { label: "Personalidade", value: personalidade.items.length, icon: User, color: "text-primary" },
    { label: "Negócio", value: negocio.items.length, icon: Building2, color: "text-info" },
    { label: "FAQs", value: faqs.items.length, icon: HelpCircle, color: "text-success" },
    { label: "Objeções", value: objecoes.items.length, icon: Shield, color: "text-accent" },
    { label: "Scripts", value: scripts.items.length, icon: FileText, color: "text-warning" },
  ];

  // Busca global
  const [globalSearch, setGlobalSearch] = useState("");
  const buscaResultados = useMemo(() => {
    const q = globalSearch.trim().toLowerCase();
    if (!q) return [];
    return itens.filter(
      (i) =>
        (i.campo ?? "").toLowerCase().includes(q) ||
        (i.conteudo ?? "").toLowerCase().includes(q) ||
        (i.categoria ?? "").toLowerCase().includes(q),
    );
  }, [itens, globalSearch]);

  const tipoLabel: Record<TipoConhecimento, string> = {
    personalidade: "Personalidade",
    negocio: "Negócio",
    faq: "FAQ",
    objecao: "Objeção",
    script: "Script",
  };

  // Importar CSV/XLSX
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importando, setImportando] = useState(false);

  const importarArquivo = async (file: File) => {
    if (!user) {
      toast.error("Faça login");
      return;
    }
    setImportando(true);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const linhas = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

      const tiposValidos: TipoConhecimento[] = ["personalidade", "negocio", "faq", "objecao", "script"];
      const registros = linhas
        .map((l) => {
          const tipo = String(l.tipo ?? "").trim().toLowerCase() as TipoConhecimento;
          const conteudo = String(l.conteudo ?? "").trim();
          if (!tipo || !tiposValidos.includes(tipo) || !conteudo) return null;
          return {
            user_id: user.id,
            tipo,
            campo: String(l.campo ?? "").trim() || null,
            conteudo,
            categoria: String(l.categoria ?? "").trim() || null,
            contexto: String(l.contexto ?? "").trim() || null,
            indexado: false,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      if (registros.length === 0) {
        toast.error("Nenhuma linha válida. Colunas esperadas: tipo, campo, conteudo, categoria, contexto");
        return;
      }

      const { error } = await (api as any).from("conhecimento").insert(registros);
      if (error) {
        toast.error("Erro ao importar: " + error.message);
        return;
      }
      toast.success(`${registros.length} item(ns) importado(s) (${linhas.length - registros.length} ignorados)`);
      carregar();
    } catch {
      toast.error("Erro ao processar arquivo");
    } finally {
      setImportando(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <CRMLayout>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          {/* 2026-10-30 (modelo Cubo): esta página é só a BASE DE CONHECIMENTO. Prompt, modelo,
              teste e voz ficam no agente (/agentes); o número→agente fica em /canais. */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
              <Brain className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Bases de conhecimento</h1>
              <p className="text-muted-foreground text-sm">O que os seus agentes de IA sabem sobre a empresa, os produtos e as objeções.</p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importarArquivo(f);
              }}
            />
            <Button variant="outline" onClick={carregar} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Atualizar
            </Button>
            <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={importando}>
              {importando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Importar
            </Button>
            <Button variant="outline" onClick={() => exportCSV(itens)} disabled={itens.length === 0}>
              <Download className="h-4 w-4" /> Exportar
            </Button>
            <Button onClick={() => setSetupOpen(true)} className="gap-2">
              <Wand2 className="h-4 w-4" /> Preencher com assistente
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {stats.map((s) => (
            <Card key={s.label}>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                    <p className="text-2xl font-bold mt-1">{s.value}</p>
                  </div>
                  <s.icon className={`h-6 w-6 ${s.color}`} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Busca global */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar em todo o conhecimento (campo, conteúdo, categoria)..."
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {loading ? (
          <Card><CardContent className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></CardContent></Card>
        ) : globalSearch.trim() ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {buscaResultados.length} resultado(s) para "{globalSearch}"
              </CardTitle>
            </CardHeader>
            <CardContent>
              {buscaResultados.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Nenhum item encontrado
                </p>
              ) : (
                <div className="space-y-2">
                  {buscaResultados.map((r) => (
                    <div key={r.id} className="rounded-lg border border-border p-3 hover:border-primary/40 transition-colors">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <Badge variant="outline" className="text-xs">{tipoLabel[r.tipo]}</Badge>
                        {r.categoria && <Badge variant="secondary" className="text-xs">{r.categoria}</Badge>}
                        <IndexBadge indexado={r.indexado} />
                      </div>
                      {r.campo && <p className="font-medium text-sm">{r.campo}</p>}
                      <p className="text-sm text-muted-foreground line-clamp-2 mt-0.5">{r.conteudo}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <Tabs defaultValue="personalidade">
            {/* 2026-10-30 (modelo Cubo): uma linha só de abas, só conhecimento. As abas de agente
                (Fluxo IA, Testar, Prompt, Configs) e a Voz ficam no próprio agente, em /agentes. */}
            <TabsList className="grid w-full grid-cols-3 md:grid-cols-6 h-auto p-1">
              <TabsTrigger value="personalidade" className="gap-2"><User className="h-4 w-4" /> Persona</TabsTrigger>
              <TabsTrigger value="negocio" className="gap-2"><Building2 className="h-4 w-4" /> Negócio</TabsTrigger>
              <TabsTrigger value="faqs" className="gap-2"><HelpCircle className="h-4 w-4" /> FAQs</TabsTrigger>
              <TabsTrigger value="objecoes" className="gap-2"><Shield className="h-4 w-4" /> Objeções</TabsTrigger>
              <TabsTrigger value="scripts" className="gap-2"><FileText className="h-4 w-4" /> Scripts</TabsTrigger>
              <TabsTrigger value="vetorial" className="gap-2"><Database className="h-4 w-4" /> Documentos</TabsTrigger>
            </TabsList>

            <TabsContent value="personalidade" className="mt-4">
              <KeyValueEditor {...personalidade} labelCampo="Atributo" />
            </TabsContent>
            <TabsContent value="negocio" className="mt-4">
              <KeyValueEditor {...negocio} labelCampo="Informação" />
            </TabsContent>
            <TabsContent value="faqs" className="mt-4">
              <FaqEditor {...faqs} />
            </TabsContent>
            <TabsContent value="objecoes" className="mt-4">
              <ObjecoesEditor {...objecoes} />
            </TabsContent>
            <TabsContent value="scripts" className="mt-4">
              <ScriptsEditor {...scripts} onOpenBuilder={() => { setSetupInitialStep(5); setSetupOpen(true); }} />
            </TabsContent>
            <TabsContent value="vetorial" className="mt-4">
              <BaseVetorial />
            </TabsContent>
          </Tabs>
        )}
      </div>

      <SetupAgente open={setupOpen} onClose={() => setSetupOpen(false)} onConcluir={carregar} initialStep={setupInitialStep} />
    </CRMLayout>
  );
}
