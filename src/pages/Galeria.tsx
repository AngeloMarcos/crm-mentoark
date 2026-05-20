import { useState, useEffect, useCallback } from "react";
import { CRMLayout } from "@/components/CRMLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Images, Upload, Trash2, Copy, Loader2, Check, X,
  Pencil, LayoutGrid, List, FileText, Music, Image,
  Sparkles, Tag, Info,
} from "lucide-react";
import { toast } from "sonner";
import { BackgroundRemoverModal } from "@/components/catalogo/BackgroundRemoverModal";

const API_BASE = (import.meta.env.VITE_API_URL as string) || "https://api.mentoark.com.br";
const token = () => localStorage.getItem("access_token") || "";

interface GaleriaItem {
  id: string;
  url: string;
  filename: string;
  tamanho: number | null;
  tipo: string;
  tags: string[];
  titulo: string | null;
  descricao: string | null;
  created_at: string;
}

type FiltroTipo = "todos" | "imagem" | "pdf" | "audio";
type Visualizacao = "grade" | "lista";

// ── Helpers ──────────────────────────────────────────────────────────────────

function tipoCategoria(tipo: string): "imagem" | "pdf" | "audio" {
  if (tipo.startsWith("image/")) return "imagem";
  if (tipo.includes("pdf"))      return "pdf";
  if (tipo.startsWith("audio/")) return "audio";
  return "imagem";
}

function formatarTamanho(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const TIPO_CONFIG = {
  imagem: { icon: Image,    label: "Imagem",  cor: "text-blue-500",   bg: "bg-blue-500/10"  },
  pdf:    { icon: FileText, label: "PDF",     cor: "text-red-500",    bg: "bg-red-500/10"   },
  audio:  { icon: Music,    label: "Áudio",   cor: "text-green-500",  bg: "bg-green-500/10" },
};

// ── Card de imagem (grade) ────────────────────────────────────────────────────

function CardImagem({ item, selecionado, modoSelecao, onToggle, onEditar, onDeletar }: {
  item: GaleriaItem; selecionado: boolean; modoSelecao: boolean;
  onToggle: () => void; onEditar: () => void; onDeletar: () => void;
}) {
  const cat = tipoCategoria(item.tipo);
  const cfg = TIPO_CONFIG[cat];
  const IconeTipo = cfg.icon;

  return (
    <div
      className={`relative group rounded-lg overflow-hidden border transition-all cursor-pointer
        ${selecionado
          ? "border-primary ring-2 ring-primary/50"
          : "border-border hover:border-muted-foreground/40"
        }`}
      onClick={() => modoSelecao && onToggle()}
    >
      {/* Preview */}
      <div className="aspect-square bg-muted flex items-center justify-center overflow-hidden">
        {cat === "imagem" ? (
          <img src={item.url} alt={item.titulo || item.filename}
            className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className={`flex flex-col items-center gap-2 p-4 ${cfg.bg} w-full h-full justify-center`}>
            <IconeTipo className={`h-10 w-10 ${cfg.cor}`} />
            <p className="text-xs text-center text-muted-foreground font-medium truncate w-full px-2">
              {item.titulo || item.filename}
            </p>
          </div>
        )}
      </div>

      {/* Tipo badge */}
      <div className="absolute top-1.5 right-1.5">
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${cfg.bg} ${cfg.cor} border border-current/20`}>
          {cfg.label}
        </span>
      </div>

      {/* Indicador IA */}
      {item.descricao && (
        <div className="absolute top-1.5 left-1.5">
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-400 border border-purple-500/20 flex items-center gap-0.5">
            <Sparkles className="h-2.5 w-2.5" /> IA
          </span>
        </div>
      )}

      {/* Hover overlay */}
      {!modoSelecao && (
        <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 p-2">
          <p className="text-white text-xs text-center line-clamp-2 px-1">
            {item.titulo || item.filename}
          </p>
          {item.descricao && (
            <p className="text-white/60 text-[10px] text-center line-clamp-2 px-1 italic">
              {item.descricao}
            </p>
          )}
          <div className="flex gap-1 mt-1">
            <Button size="icon" variant="ghost" className="h-7 w-7 text-white hover:bg-white/20"
              onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(item.url); toast.success("URL copiada!"); }}
              title="Copiar URL">
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-white hover:bg-white/20"
              onClick={e => { e.stopPropagation(); onEditar(); }}
              title="Editar">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-white hover:text-red-400 hover:bg-white/20"
              onClick={e => { e.stopPropagation(); if (confirm("Remover este arquivo?")) onDeletar(); }}
              title="Deletar">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Checkbox seleção */}
      {modoSelecao && (
        <div className={`absolute top-1.5 left-1.5 h-5 w-5 rounded-full border-2 flex items-center justify-center transition-colors
          ${selecionado ? "bg-primary border-primary" : "bg-white/80 border-gray-400"}`}>
          {selecionado && <Check className="h-3 w-3 text-white" />}
        </div>
      )}

      {/* Tags */}
      {item.tags?.length > 0 && (
        <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1.5 py-1 flex gap-1 flex-wrap">
          {item.tags.slice(0, 2).map(t => (
            <span key={t} className="text-[10px] text-white/80 bg-white/10 rounded px-1">{t}</span>
          ))}
          {item.tags.length > 2 && (
            <span className="text-[10px] text-white/50">+{item.tags.length - 2}</span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Linha de lista ────────────────────────────────────────────────────────────

function LinhaLista({ item, selecionado, modoSelecao, onToggle, onEditar, onDeletar }: {
  item: GaleriaItem; selecionado: boolean; modoSelecao: boolean;
  onToggle: () => void; onEditar: () => void; onDeletar: () => void;
}) {
  const cat = tipoCategoria(item.tipo);
  const cfg = TIPO_CONFIG[cat];
  const IconeTipo = cfg.icon;

  return (
    <div
      className={`flex items-center gap-3 p-3 rounded-lg border transition-all group
        ${selecionado
          ? "border-primary bg-primary/5"
          : "border-border hover:border-muted-foreground/30 hover:bg-muted/30"
        } ${modoSelecao ? "cursor-pointer" : ""}`}
      onClick={() => modoSelecao && onToggle()}
    >
      {/* Checkbox */}
      {modoSelecao && (
        <div className={`h-5 w-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors
          ${selecionado ? "bg-primary border-primary" : "border-muted-foreground/40"}`}>
          {selecionado && <Check className="h-3 w-3 text-white" />}
        </div>
      )}

      {/* Thumb / ícone */}
      <div className={`w-10 h-10 rounded-lg shrink-0 flex items-center justify-center overflow-hidden ${cfg.bg}`}>
        {cat === "imagem"
          ? <img src={item.url} alt="" className="w-full h-full object-cover rounded-lg" />
          : <IconeTipo className={`h-5 w-5 ${cfg.cor}`} />
        }
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium text-sm truncate">{item.titulo || item.filename}</p>
          <Badge variant="outline" className={`text-[10px] ${cfg.cor} border-current/30 shrink-0`}>
            {cfg.label}
          </Badge>
          {item.descricao && (
            <Badge variant="outline" className="text-[10px] text-purple-400 border-purple-500/30 shrink-0 gap-0.5">
              <Sparkles className="h-2.5 w-2.5" /> IA
            </Badge>
          )}
        </div>
        {item.descricao && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate italic">{item.descricao}</p>
        )}
        <div className="flex items-center gap-3 mt-0.5">
          {item.tags?.length > 0 && (
            <div className="flex gap-1 flex-wrap">
              {item.tags.slice(0, 3).map(t => (
                <span key={t} className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{t}</span>
              ))}
            </div>
          )}
          {item.tamanho && (
            <span className="text-[10px] text-muted-foreground">{formatarTamanho(item.tamanho)}</span>
          )}
        </div>
      </div>

      {/* Ações */}
      {!modoSelecao && (
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <Button size="icon" variant="ghost" className="h-7 w-7"
            onClick={() => { navigator.clipboard.writeText(item.url); toast.success("URL copiada!"); }}
            title="Copiar URL">
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7"
            onClick={onEditar} title="Editar">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 hover:text-red-500"
            onClick={() => { if (confirm("Remover este arquivo?")) onDeletar(); }}
            title="Deletar">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────

export default function GaleriaPage() {
  const [itens, setItens]                   = useState<GaleriaItem[]>([]);
  const [total, setTotal]                   = useState(0);
  const [loading, setLoading]               = useState(true);
  const [uploading, setUploading]           = useState(false);
  const [tags, setTags]                     = useState<string[]>([]);
  const [filtroTag, setFiltroTag]           = useState("");
  const [filtroTipo, setFiltroTipo]         = useState<FiltroTipo>("todos");
  const [busca, setBusca]                   = useState("");
  const [visualizacao, setVisualizacao]     = useState<Visualizacao>("grade");
  const [selecionados, setSelecionados]     = useState<string[]>([]);
  const [modoSelecao, setModoSelecao]       = useState(false);
  const [editando, setEditando]             = useState<GaleriaItem | null>(null);
  const [formEdit, setFormEdit]             = useState({ titulo: "", tags: "", descricao: "" });
  const [modalRemover, setModalRemover]     = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "100", offset: "0" });
      if (filtroTag)                       params.set("tag", filtroTag);
      if (busca)                           params.set("q", busca);
      if (filtroTipo !== "todos")          params.set("tipo", filtroTipo);
      const r = await fetch(`${API_BASE}/api/galeria?${params}`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (r.ok) {
        const d = await r.json();
        setItens(d.images ?? []);
        setTotal(d.total ?? 0);
      }
    } finally {
      setLoading(false);
    }
  }, [filtroTag, busca, filtroTipo]);

  const carregarTags = async () => {
    const r = await fetch(`${API_BASE}/api/galeria/tags`, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    if (r.ok) setTags(await r.json());
  };

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => { carregarTags(); }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    setUploading(true);
    const formData = new FormData();
    // Campo aceito pelo backend: "imagens" para qualquer tipo
    Array.from(e.target.files).forEach(f => formData.append("imagens", f));
    try {
      const r = await fetch(`${API_BASE}/api/galeria/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token()}` },
        body: formData,
      });
      if (!r.ok) throw new Error((await r.json()).message);
      toast.success(`${e.target.files.length} arquivo(s) enviado(s) com sucesso`);
      carregar(); carregarTags();
    } catch (err: any) {
      toast.error(err.message || "Erro no upload");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleProcessed = async (blob: Blob) => {
    setUploading(true);
    const formData = new FormData();
    formData.append("imagens", blob, "sem-fundo.png");
    formData.append("tags", JSON.stringify(["sem-fundo"]));
    try {
      const r = await fetch(`${API_BASE}/api/galeria/upload`, {
        method: "POST", headers: { Authorization: `Bearer ${token()}` }, body: formData,
      });
      if (r.ok) { toast.success("Imagem enviada para a galeria"); carregar(); carregarTags(); }
    } catch { toast.error("Erro ao enviar imagem processada"); }
    finally { setUploading(false); }
  };

  const deletarItem = async (id: string) => {
    await fetch(`${API_BASE}/api/galeria/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token()}` } });
    toast.success("Arquivo removido");
    carregar();
  };

  const deletarSelecionados = async () => {
    await Promise.all(selecionados.map(id =>
      fetch(`${API_BASE}/api/galeria/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token()}` } })
    ));
    toast.success(`${selecionados.length} arquivo(s) removido(s)`);
    setSelecionados([]); setModoSelecao(false); carregar();
  };

  const handleSalvarEdicao = async () => {
    if (!editando) return;
    try {
      const tagsArray = formEdit.tags.split(",").map(t => t.trim()).filter(Boolean);
      const r = await fetch(`${API_BASE}/api/galeria/${editando.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ titulo: formEdit.titulo, tags: tagsArray, descricao: formEdit.descricao }),
      });
      if (r.ok) {
        toast.success("Arquivo atualizado");
        setEditando(null); carregar(); carregarTags();
      }
    } catch { toast.error("Erro ao salvar"); }
  };

  const toggleSelecao = (id: string) =>
    setSelecionados(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);

  const abrirEdicao = (item: GaleriaItem) => {
    setEditando(item);
    setFormEdit({ titulo: item.titulo || "", tags: item.tags?.join(", ") || "", descricao: item.descricao || "" });
  };

  // Contagens por tipo
  const contagens = {
    todos:  itens.length,
    imagem: itens.filter(i => tipoCategoria(i.tipo) === "imagem").length,
    pdf:    itens.filter(i => tipoCategoria(i.tipo) === "pdf").length,
    audio:  itens.filter(i => tipoCategoria(i.tipo) === "audio").length,
  };

  return (
    <CRMLayout>
      <div className="space-y-5">

        {/* ── Header ── */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <Images className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Galeria de Mídias</h1>
              <p className="text-sm text-muted-foreground">{total} arquivo{total !== 1 ? "s" : ""}</p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            {modoSelecao && selecionados.length > 0 && (
              <Button variant="destructive" size="sm" onClick={deletarSelecionados}>
                <Trash2 className="h-4 w-4 mr-1.5" /> Remover ({selecionados.length})
              </Button>
            )}
            <Button variant="outline" size="sm"
              onClick={() => { setModoSelecao(v => !v); setSelecionados([]); }}>
              {modoSelecao ? <><X className="h-4 w-4 mr-1.5" />Cancelar</> : "Selecionar"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setModalRemover(true)}>
              Remover Fundo
            </Button>
            {/* Toggle de visualização */}
            <div className="flex border border-border rounded-md overflow-hidden">
              <button
                className={`p-1.5 transition-colors ${visualizacao === "grade" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setVisualizacao("grade")} title="Grade">
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                className={`p-1.5 transition-colors ${visualizacao === "lista" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setVisualizacao("lista")} title="Lista">
                <List className="h-4 w-4" />
              </button>
            </div>
            <label>
              <Button asChild size="sm" disabled={uploading}>
                <span className="cursor-pointer gap-1.5">
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {uploading ? "Enviando..." : "Upload"}
                </span>
              </Button>
              {/* Aceita imagem, PDF e áudio */}
              <input type="file" hidden multiple accept="image/*,application/pdf,audio/*" onChange={handleUpload} />
            </label>
          </div>
        </div>

        {/* ── Filtros ── */}
        <div className="flex gap-2 flex-wrap items-center">
          <Input placeholder="Buscar por nome..."
            value={busca} onChange={e => setBusca(e.target.value)} className="w-44" />

          {/* Filtro por tipo */}
          <div className="flex gap-1 border border-border rounded-lg p-0.5">
            {(["todos", "imagem", "pdf", "audio"] as FiltroTipo[]).map(t => (
              <button key={t}
                onClick={() => setFiltroTipo(t)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all capitalize
                  ${filtroTipo === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                {t === "todos" ? `Todos (${contagens.todos})` : t === "imagem" ? `Img (${contagens.imagem})` : t === "pdf" ? `PDF (${contagens.pdf})` : `Áudio (${contagens.audio})`}
              </button>
            ))}
          </div>

          {/* Tags */}
          <Button variant={!filtroTag ? "default" : "outline"} size="sm"
            onClick={() => setFiltroTag("")} className="h-7 text-xs">Todas as tags</Button>
          {tags.map(tag => (
            <Button key={tag} variant={filtroTag === tag ? "default" : "outline"} size="sm"
              onClick={() => setFiltroTag(filtroTag === tag ? "" : tag)}
              className="h-7 text-xs">
              {tag}
            </Button>
          ))}
        </div>

        {/* ── Grid / Lista ── */}
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="animate-spin h-8 w-8 text-primary" />
          </div>
        ) : itens.length === 0 ? (
          <div className="text-center py-20 space-y-3">
            <Images className="mx-auto h-12 w-12 text-muted-foreground/40" />
            <p className="text-muted-foreground">Nenhum arquivo encontrado</p>
            <label>
              <Button asChild size="sm">
                <span className="cursor-pointer gap-1.5">
                  <Upload className="h-4 w-4" /> Fazer upload
                </span>
              </Button>
              <input type="file" hidden multiple accept="image/*,application/pdf,audio/*" onChange={handleUpload} />
            </label>
          </div>
        ) : visualizacao === "grade" ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {itens.map(item => (
              <CardImagem key={item.id} item={item}
                selecionado={selecionados.includes(item.id)}
                modoSelecao={modoSelecao}
                onToggle={() => toggleSelecao(item.id)}
                onEditar={() => abrirEdicao(item)}
                onDeletar={() => deletarItem(item.id)} />
            ))}
          </div>
        ) : (
          <div className="space-y-1.5">
            {itens.map(item => (
              <LinhaLista key={item.id} item={item}
                selecionado={selecionados.includes(item.id)}
                modoSelecao={modoSelecao}
                onToggle={() => toggleSelecao(item.id)}
                onEditar={() => abrirEdicao(item)}
                onDeletar={() => deletarItem(item.id)} />
            ))}
          </div>
        )}
      </div>

      {/* ── Modal de Edição ── */}
      <Dialog open={!!editando} onOpenChange={o => !o && setEditando(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-4 w-4" />
              Editar arquivo
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">

            {/* Preview */}
            {editando && tipoCategoria(editando.tipo) === "imagem" && (
              <img src={editando.url} alt="" className="w-full h-32 object-contain rounded-lg bg-muted" />
            )}

            {/* Título */}
            <div className="space-y-1.5">
              <Label>Título</Label>
              <Input value={formEdit.titulo}
                onChange={e => setFormEdit({ ...formEdit, titulo: e.target.value })}
                placeholder="Ex: Catálogo Verão 2025" />
            </div>

            {/* Tags */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <Tag className="h-3.5 w-3.5" /> Tags
              </Label>
              <Input value={formEdit.tags}
                onChange={e => setFormEdit({ ...formEdit, tags: e.target.value })}
                placeholder="catalogo, produto, promocao (separadas por vírgula)" />
            </div>

            {/* Descrição para IA */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-purple-500" />
                Descrição para o Agente IA
              </Label>
              <Textarea
                value={formEdit.descricao}
                onChange={e => setFormEdit({ ...formEdit, descricao: e.target.value })}
                placeholder="Descreva quando o agente deve enviar este arquivo. Ex: Enviar quando o cliente solicitar o catálogo de produtos ou quiser ver os preços."
                rows={3}
              />
              <div className="flex items-start gap-1.5 rounded-md bg-purple-500/10 border border-purple-500/20 p-2.5">
                <Info className="h-3.5 w-3.5 text-purple-400 shrink-0 mt-0.5" />
                <p className="text-xs text-purple-300">
                  Esta descrição é usada pelo n8n para decidir automaticamente qual arquivo enviar ao cliente. Seja específico sobre o contexto de uso.
                </p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditando(null)}>Cancelar</Button>
            <Button onClick={handleSalvarEdicao}>Salvar alterações</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BackgroundRemoverModal
        open={modalRemover}
        onOpenChange={setModalRemover}
        onProcessed={handleProcessed}
      />
    </CRMLayout>
  );
}
