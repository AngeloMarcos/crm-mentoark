import { useState, useEffect, useCallback } from "react";
import { CRMLayout } from "@/components/CRMLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Images, Upload, Trash2, Copy, Loader2, Check, X, Pencil, Tag } from "lucide-react";
import { toast } from "sonner";

const API_BASE = (import.meta.env.VITE_API_URL as string) || "https://api.mentoark.com.br";
const token = () => localStorage.getItem("access_token") || "";

interface GaleriaImagem {
  id: string;
  url: string;
  filename: string;
  tamanho: number | null;
  tipo: string;
  tags: string[];
  titulo: string | null;
  created_at: string;
}

export default function GaleriaPage() {
  const [imagens, setImagens]         = useState<GaleriaImagem[]>([]);
  const [total, setTotal]             = useState(0);
  const [loading, setLoading]         = useState(true);
  const [uploading, setUploading]     = useState(false);
  const [tags, setTags]               = useState<string[]>([]);
  const [filtroTag, setFiltroTag]     = useState("");
  const [busca, setBusca]             = useState("");
  const [selecionadas, setSelecionadas] = useState<string[]>([]);
  const [modoSelecao, setModoSelecao] = useState(false);
  const [imagemEditando, setImagemEditando] = useState<GaleriaImagem | null>(null);
  const [formEdit, setFormEdit] = useState({ titulo: "", tags: "" });

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "60", offset: "0" });
      if (filtroTag) params.set("tag", filtroTag);
      if (busca)     params.set("q", busca);
      const r = await fetch(`${API_BASE}/api/galeria?${params}`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (r.ok) {
        const d = await r.json();
        setImagens(d.images ?? []);
        setTotal(d.total ?? 0);
      }
    } finally {
      setLoading(false);
    }
  }, [filtroTag, busca]);

  const carregarTags = async () => {
    const r = await fetch(`${API_BASE}/api/galeria/tags`, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    if (r.ok) setTags(await r.json());
  };

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => { carregarTags(); }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    setUploading(true);
    const formData = new FormData();
    Array.from(e.target.files).forEach(f => formData.append("imagens", f));
    try {
      const r = await fetch(`${API_BASE}/api/galeria/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token()}` },
        body: formData,
      });
      if (!r.ok) throw new Error((await r.json()).message);
      toast.success(`${e.target.files.length} imagem(ns) enviada(s)`);
      carregar();
      carregarTags();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const deletarImagem = async (id: string) => {
    await fetch(`${API_BASE}/api/galeria/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token()}` },
    });
    toast.success("Imagem removida");
    carregar();
  };

  const deletarSelecionadas = async () => {
    for (const id of selecionadas) {
      await fetch(`${API_BASE}/api/galeria/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token()}` },
      });
    }
    toast.success(`${selecionadas.length} imagem(ns) removida(s)`);
    setSelecionadas([]);
    setModoSelecao(false);
    carregar();
  };

  const handleSalvarEdicao = async () => {
    if (!imagemEditando) return;
    try {
      const tagsArray = formEdit.tags.split(",").map(t => t.trim()).filter(Boolean);
      const r = await fetch(`${API_BASE}/api/galeria/${imagemEditando.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token()}`,
        },
        body: JSON.stringify({ titulo: formEdit.titulo, tags: tagsArray }),
      });
      if (r.ok) {
        toast.success("Imagem atualizada");
        setImagemEditando(null);
        carregar();
        carregarTags();
      }
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const toggleSelecao = (id: string) => {
    setSelecionadas(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  return (
    <CRMLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
              <Images className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Galeria de Imagens</h1>
              <p className="text-sm text-muted-foreground">{total} imagem{total !== 1 ? "s" : ""}</p>
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            {modoSelecao && selecionadas.length > 0 && (
              <Button variant="destructive" size="sm" onClick={deletarSelecionadas}>
                <Trash2 className="h-4 w-4 mr-1" />
                Deletar ({selecionadas.length})
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setModoSelecao(v => !v); setSelecionadas([]); }}
            >
              {modoSelecao ? <><X className="h-4 w-4 mr-1" />Cancelar</> : "Selecionar"}
            </Button>
            <label>
              <Button asChild disabled={uploading}>
                <span className="cursor-pointer">
                  {uploading
                    ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    : <Upload className="h-4 w-4 mr-2" />}
                  {uploading ? "Enviando..." : "Upload"}
                </span>
              </Button>
              <input type="file" hidden multiple accept="image/*" onChange={handleUpload} />
            </label>
          </div>
        </div>

        {/* Filtros */}
        <div className="flex gap-2 flex-wrap items-center">
          <Input
            placeholder="Buscar por nome..."
            value={busca}
            onChange={e => setBusca(e.target.value)}
            className="w-48"
          />
          <Button
            variant={!filtroTag ? "default" : "outline"}
            size="sm"
            onClick={() => setFiltroTag("")}
          >
            Todas
          </Button>
          {tags.map(tag => (
            <Button
              key={tag}
              variant={filtroTag === tag ? "default" : "outline"}
              size="sm"
              onClick={() => setFiltroTag(filtroTag === tag ? "" : tag)}
            >
              {tag}
            </Button>
          ))}
        </div>

        {/* Grid */}
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="animate-spin h-8 w-8 text-primary" />
          </div>
        ) : imagens.length === 0 ? (
          <div className="text-center py-20 space-y-4">
            <Images className="mx-auto h-12 w-12 text-muted-foreground" />
            <p className="text-muted-foreground">Nenhuma imagem ainda</p>
            <label>
              <Button asChild>
                <span className="cursor-pointer">
                  <Upload className="h-4 w-4 mr-2" /> Fazer upload
                </span>
              </Button>
              <input type="file" hidden multiple accept="image/*" onChange={handleUpload} />
            </label>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {imagens.map(img => {
              const sel = selecionadas.includes(img.id);
              return (
                <div
                  key={img.id}
                  className={`relative group cursor-pointer rounded-lg overflow-hidden border-2 transition-all
                    ${sel
                      ? "border-primary ring-2 ring-primary"
                      : "border-transparent hover:border-muted-foreground/30"
                    }`}
                  onClick={() => modoSelecao && toggleSelecao(img.id)}
                >
                  {/* Imagem */}
                  <div className="aspect-square bg-muted">
                    <img
                      src={img.url}
                      alt={img.titulo || img.filename}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  </div>

                  {/* Overlay hover */}
                  {!modoSelecao && (
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 p-2">
                      <p className="text-white text-xs text-center truncate w-full px-1">
                        {img.titulo || img.filename}
                      </p>
                      <div className="flex gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-white hover:bg-white/20"
                          onClick={e => {
                            e.stopPropagation();
                            navigator.clipboard.writeText(img.url);
                            toast.success("URL copiada");
                          }}
                          title="Copiar URL"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-white hover:bg-white/20"
                          onClick={e => {
                            e.stopPropagation();
                            setImagemEditando(img);
                            setFormEdit({ titulo: img.titulo || "", tags: img.tags?.join(", ") || "" });
                          }}
                          title="Editar"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-white hover:text-red-400 hover:bg-white/20"
                          onClick={e => { e.stopPropagation(); if(confirm("Remover imagem?")) deletarImagem(img.id); }}
                          title="Deletar"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Checkbox seleção */}
                  {modoSelecao && (
                    <div className={`absolute top-1.5 left-1.5 h-5 w-5 rounded-full border-2 flex items-center justify-center transition-colors
                      ${sel ? "bg-primary border-primary" : "bg-white/80 border-gray-400"}`}>
                      {sel && <Check className="h-3 w-3 text-white" />}
                    </div>
                  )}

                  {/* Tags */}
                  {img.tags?.length > 0 && (
                    <div className="absolute bottom-0 left-0 right-0 bg-black/50 px-1 py-0.5 flex gap-1 flex-wrap">
                      {img.tags.slice(0, 2).map(t => (
                        <span key={t} className="text-[10px] text-white bg-white/20 rounded px-1">{t}</span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal de Edição */}
      <Dialog open={!!imagemEditando} onOpenChange={(o) => !o && setImagemEditando(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar Imagem</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Título</Label>
              <Input
                value={formEdit.titulo}
                onChange={e => setFormEdit({ ...formEdit, titulo: e.target.value })}
                placeholder="Ex: Banner Natal"
              />
            </div>
            <div className="space-y-2">
              <Label>Tags (separadas por vírgula)</Label>
              <div className="relative">
                <Tag className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  value={formEdit.tags}
                  onChange={e => setFormEdit({ ...formEdit, tags: e.target.value })}
                  placeholder="Ex: produto, natal, azul"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImagemEditando(null)}>Cancelar</Button>
            <Button onClick={handleSalvarEdicao}>Salvar Alterações</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CRMLayout>
  );
}
