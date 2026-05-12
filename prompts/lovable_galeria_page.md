# Prompt Lovable 1 — Nova página Galeria de Imagens (Biblioteca de Mídia)

## Objetivo
Criar uma nova página `src/pages/Galeria.tsx` que funcione como biblioteca central de imagens do usuário. O usuário faz upload de imagens aqui e depois as seleciona ao montar catálogos/produtos.

---

## 1. Rota e Sidebar

**Em `src/App.tsx`**, adicionar:
```tsx
import GaleriaPage from "@/pages/Galeria";
// Na lista de rotas:
<Route path="/galeria" element={<GaleriaPage />} />
```

**Em `src/components/AppSidebar.tsx`**, adicionar item após "Catálogo":
```tsx
{ title: "Galeria", url: "/galeria", icon: Images }
```
Importar `Images` do lucide-react.

---

## 2. Página Galeria.tsx completa

Criar `src/pages/Galeria.tsx` com as funcionalidades:

### Estado
```ts
const [imagens, setImagens] = useState<GaleriaImagem[]>([]);
const [total, setTotal] = useState(0);
const [loading, setLoading] = useState(true);
const [uploading, setUploading] = useState(false);
const [tags, setTags] = useState<string[]>([]);
const [filtroTag, setFiltroTag] = useState("");
const [busca, setBusca] = useState("");
const [selecionadas, setSelecionadas] = useState<string[]>([]);  // ids selecionados
const [modoSelecao, setModoSelecao] = useState(false);

interface GaleriaImagem {
  id: string; url: string; filename: string;
  tamanho: number | null; tipo: string; tags: string[];
  titulo: string | null; created_at: string;
}
```

### Carregar imagens
```ts
const BASE = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";
const token = localStorage.getItem("crm_access_token") || localStorage.getItem("access_token") || "";

const carregar = async () => {
  setLoading(true);
  const params = new URLSearchParams({ limit: "60", offset: "0" });
  if (filtroTag) params.set("tag", filtroTag);
  if (busca) params.set("q", busca);
  const r = await fetch(`${BASE}/api/galeria?${params}`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await r.json();
  setImagens(data.images ?? []);
  setTotal(data.total ?? 0);
  setLoading(false);
};

// Carregar tags disponíveis
const carregarTags = async () => {
  const r = await fetch(`${BASE}/api/galeria/tags`, { headers: { Authorization: `Bearer ${token}` } });
  if (r.ok) setTags(await r.json());
};

useEffect(() => { carregar(); carregarTags(); }, [filtroTag, busca]);
```

### Upload
```ts
const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
  if (!e.target.files) return;
  setUploading(true);
  const formData = new FormData();
  for (const file of e.target.files) formData.append("imagens", file);
  try {
    const r = await fetch(`${BASE}/api/galeria/upload`, {
      method: "POST", headers: { Authorization: `Bearer ${token}` }, body: formData,
    });
    if (!r.ok) throw new Error(await r.text());
    toast.success(`${e.target.files.length} imagem(ns) enviada(s) com sucesso`);
    carregar();
    carregarTags();
  } catch (err: any) {
    toast.error(err.message);
  } finally {
    setUploading(false);
    e.target.value = "";
  }
};
```

### Deletar selecionadas
```ts
const deletarSelecionadas = async () => {
  for (const id of selecionadas) {
    await fetch(`${BASE}/api/galeria/${id}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${token}` },
    });
  }
  toast.success(`${selecionadas.length} imagem(ns) removida(s)`);
  setSelecionadas([]);
  setModoSelecao(false);
  carregar();
};
```

### Layout da página

```tsx
<CRMLayout>
  <div className="space-y-6">
    {/* Header */}
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
          <Images className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Galeria de Imagens</h1>
          <p className="text-sm text-muted-foreground">{total} imagens</p>
        </div>
      </div>
      <div className="flex gap-2">
        {modoSelecao && selecionadas.length > 0 && (
          <Button variant="destructive" size="sm" onClick={deletarSelecionadas}>
            <Trash2 className="h-4 w-4 mr-1" /> Deletar ({selecionadas.length})
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => { setModoSelecao(!modoSelecao); setSelecionadas([]); }}>
          {modoSelecao ? "Cancelar seleção" : "Selecionar"}
        </Button>
        <label>
          <Button asChild disabled={uploading}>
            <span>
              {uploading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
              {uploading ? "Enviando..." : "Upload"}
            </span>
          </Button>
          <input type="file" hidden multiple accept="image/*" onChange={handleUpload} />
        </label>
      </div>
    </div>

    {/* Filtros */}
    <div className="flex gap-2 flex-wrap">
      <Input
        placeholder="Buscar por nome..."
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        className="w-48"
      />
      <Button
        variant={!filtroTag ? "default" : "outline"}
        size="sm"
        onClick={() => setFiltroTag("")}
      >Todas</Button>
      {tags.map(tag => (
        <Button
          key={tag}
          variant={filtroTag === tag ? "default" : "outline"}
          size="sm"
          onClick={() => setFiltroTag(filtroTag === tag ? "" : tag)}
        >{tag}</Button>
      ))}
    </div>

    {/* Grid de imagens */}
    {loading ? (
      <div className="flex justify-center py-20"><Loader2 className="animate-spin" /></div>
    ) : imagens.length === 0 ? (
      <div className="text-center py-20">
        <Images className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground mb-4">Nenhuma imagem ainda</p>
        <label>
          <Button asChild><span><Upload className="h-4 w-4 mr-2" />Fazer upload</span></Button>
          <input type="file" hidden multiple accept="image/*" onChange={handleUpload} />
        </label>
      </div>
    ) : (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {imagens.map(img => {
          const selecionada = selecionadas.includes(img.id);
          return (
            <div
              key={img.id}
              className={`relative group cursor-pointer rounded-lg overflow-hidden border-2 transition-all
                ${selecionada ? "border-primary ring-2 ring-primary" : "border-transparent hover:border-muted-foreground/30"}`}
              onClick={() => {
                if (modoSelecao) {
                  setSelecionadas(prev => selecionada ? prev.filter(i => i !== img.id) : [...prev, img.id]);
                }
              }}
            >
              <div className="aspect-square bg-muted">
                <img src={img.url} alt={img.titulo || img.filename} className="w-full h-full object-cover" loading="lazy" />
              </div>
              {/* Overlay de hover */}
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1 p-2">
                <p className="text-white text-xs text-center truncate w-full">{img.titulo || img.filename}</p>
                <div className="flex gap-1">
                  <Button
                    size="icon" variant="ghost" className="h-7 w-7 text-white hover:text-white hover:bg-white/20"
                    onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(img.url); toast.success("URL copiada"); }}
                    title="Copiar URL"
                  ><Copy className="h-3.5 w-3.5" /></Button>
                  <Button
                    size="icon" variant="ghost" className="h-7 w-7 text-white hover:text-red-400 hover:bg-white/20"
                    onClick={async (e) => {
                      e.stopPropagation();
                      await fetch(`${BASE}/api/galeria/${img.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
                      toast.success("Imagem removida");
                      carregar();
                    }}
                    title="Deletar"
                  ><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
              {/* Checkbox de seleção */}
              {modoSelecao && (
                <div className={`absolute top-1.5 left-1.5 h-5 w-5 rounded-full border-2 flex items-center justify-center
                  ${selecionada ? "bg-primary border-primary" : "bg-white/80 border-gray-400"}`}>
                  {selecionada && <Check className="h-3 w-3 text-white" />}
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
</CRMLayout>
```

### Imports necessários
```tsx
import { Images, Upload, Trash2, Copy, Loader2, Check } from "lucide-react";
import { CRMLayout } from "@/components/CRMLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
```

---

## Não alterar
Nenhum outro arquivo além dos listados acima (App.tsx, AppSidebar.tsx, e o novo Galeria.tsx).
