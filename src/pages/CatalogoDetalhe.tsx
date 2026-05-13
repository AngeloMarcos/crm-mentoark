import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { CRMLayout } from "@/components/CRMLayout";
import { api, uploadImagem } from "@/integrations/database/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, ArrowLeft, Pencil, Trash2, Loader2, Star, Copy, Image as ImageIcon, Send, Search, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SendWhatsAppModal } from "@/components/catalogo/SendWhatsAppModal";
import { ImportExcelModal } from "@/components/catalogo/ImportExcelModal";
import { 
  DndContext, 
  closestCenter, 
  KeyboardSensor, 
  PointerSensor, 
  useSensor, 
  useSensors 
} from "@dnd-kit/core";
import { 
  arrayMove, 
  SortableContext, 
  sortableKeyboardCoordinates, 
  rectSortingStrategy 
} from "@dnd-kit/sortable";
import { ProductCard } from "@/components/catalogo/ProductCard";

interface Produto {
  id: string;
  nome: string;
  descricao: string | null;
  preco: number | null;
  preco_promocional: number | null;
  codigo: string | null;
  estoque: number | null;
  ativo: boolean;
  imagens: Array<{ id: string; url: string; legenda: string | null; principal: boolean }>;
}

export default function CatalogoDetalhePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [catalogo, setCatalogo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [modalProduto, setModalProduto] = useState(false);
  const [modalGaleria, setModalGaleria] = useState(false);
  const [modalPicker, setModalPicker] = useState(false);
  const [modalImport, setModalImport] = useState(false);
  const [galeriaImagens, setGaleriaImagens] = useState<any[]>([]);
  const [pickerSearch, setPickerSearch] = useState("");
  const [editingProduto, setEditingProduto] = useState<Produto | null>(null);
  const [activeProduto, setActiveProduto] = useState<Produto | null>(null);
  const [modalSend, setModalSend] = useState<{ open: boolean; type: "product" | "catalog"; id: string }>({
    open: false, type: "product", id: ""
  });
  const [form, setForm] = useState({
    nome: "", descricao: "", preco: 0, preco_promocional: 0, codigo: "", estoque: 0, ativo: true
  });

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const carregar = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${(import.meta.env.VITE_API_URL as string) || "http://localhost:3000"}/api/catalogo/${id}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("access_token")}` }
      });
      if (!res.ok) throw new Error("Erro ao carregar catálogo");
      const dataFull = await res.json();
      setCatalogo(dataFull);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const carregarGaleria = async () => {
    try {
      const r = await fetch(`${(import.meta.env.VITE_API_URL as string) || "http://localhost:3000"}/api/galeria?limit=40&q=${pickerSearch}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("access_token")}` }
      });
      const d = await r.json();
      setGaleriaImagens(d.images || []);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => { carregar(); }, [id]);

  useEffect(() => {
    if (modalPicker) carregarGaleria();
  }, [modalPicker, pickerSearch]);

  const salvarProduto = async () => {
    const url = editingProduto 
      ? `/api/catalogo/${id}/produtos/${editingProduto.id}`
      : `/api/catalogo/${id}/produtos`;
    
    try {
      const r = await fetch(`${(import.meta.env.VITE_API_URL as string) || "http://localhost:3000"}${url}`, {
        method: editingProduto ? "PUT" : "POST",
        headers: { 
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("access_token")}` 
        },
        body: JSON.stringify(form)
      });
      if (r.ok) {
        toast.success(editingProduto ? "Produto atualizado" : "Produto criado");
        setModalProduto(false);
        carregar();
      }
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !activeProduto) return;
    try {
      for (let i = 0; i < e.target.files.length; i++) {
        await uploadImagem(`/api/catalogo/produtos/${activeProduto.id}/imagens`, e.target.files[i]);
      }
      toast.success("Upload concluído");
      carregar();
      const updatedRes = await fetch(`${(import.meta.env.VITE_API_URL as string) || "http://localhost:3000"}/api/catalogo/${id}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("access_token")}` }
      });
      const updatedData = await updatedRes.json();
      const updatedP = updatedData.produtos.find((p: any) => p.id === activeProduto.id);
      setActiveProduto(updatedP);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const vincularImagem = async (galeriaId: string) => {
    if (!activeProduto) return;
    try {
      const r = await fetch(`${(import.meta.env.VITE_API_URL as string) || "http://localhost:3000"}/api/galeria/produto/${activeProduto.id}`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("access_token")}` 
        },
        body: JSON.stringify({ galeria_imagem_id: galeriaId })
      });
      if (r.ok) {
        toast.success("Imagem vinculada");
        setModalPicker(false);
        carregar();
        const updatedRes = await fetch(`${(import.meta.env.VITE_API_URL as string) || "http://localhost:3000"}/api/catalogo/${id}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem("access_token")}` }
        });
        const updatedData = await updatedRes.json();
        const updatedP = updatedData.produtos.find((p: any) => p.id === activeProduto.id);
        setActiveProduto(updatedP);
      }
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleDragEnd = async (event: any) => {
    const { active, over } = event;
    if (active.id !== over.id) {
      const oldIndex = catalogo.produtos.findIndex((p: any) => p.id === active.id);
      const newIndex = catalogo.produtos.findIndex((p: any) => p.id === over.id);
      
      const newProdutos = arrayMove(catalogo.produtos, oldIndex, newIndex);
      setCatalogo({ ...catalogo, produtos: newProdutos });

      try {
        await fetch(`${(import.meta.env.VITE_API_URL as string) || "http://localhost:3000"}/api/catalogo/${id}/produtos/${active.id}`, {
          method: "PUT",
          headers: { 
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("access_token")}` 
          },
          body: JSON.stringify({ ordem: newIndex })
        });
      } catch (err) {
        console.error(err);
      }
    }
  };

  const handleImportExcel = async (data: any[]) => {
    setLoading(true);
    try {
      for (const row of data) {
        if (!row.nome) continue;
        const payload = {
          nome: String(row.nome),
          descricao: row.descricao ? String(row.descricao) : null,
          preco: row.preco ? Number(row.preco) : null,
          codigo: row.codigo ? String(row.codigo) : null,
          estoque: row.estoque ? Number(row.estoque) : null,
          ativo: true,
          custom_fields: row
        };
        await fetch(`${(import.meta.env.VITE_API_URL as string) || "http://localhost:3000"}/api/catalogo/${id}/produtos`, {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("access_token")}` 
          },
          body: JSON.stringify(payload)
        });
      }
      toast.success(`${data.length} produtos importados`);
      carregar();
    } catch (err: any) {
      toast.error("Erro na importação: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading && !catalogo) return <CRMLayout><div className="flex justify-center py-20"><Loader2 className="animate-spin" /></div></CRMLayout>;

  return (
    <CRMLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/catalogo")}><ArrowLeft /></Button>
            <h1 className="text-2xl font-bold">{catalogo?.nome}</h1>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" onClick={() => setModalSend({ open: true, type: "catalog", id: id! })}>
              <Send className="h-4 w-4 mr-2" /> Enviar Catálogo
            </Button>
            <Button variant="outline" onClick={() => setModalImport(true)}>
              <FileSpreadsheet className="h-4 w-4 mr-2" /> Importar Excel
            </Button>
            <Button onClick={() => { setEditingProduto(null); setForm({ nome: "", descricao: "", preco: 0, preco_promocional: 0, codigo: "", estoque: 0, ativo: true }); setModalProduto(true); }}>
              <Plus className="h-4 w-4 mr-2" /> Novo Produto
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1">
          <DndContext 
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext 
              items={catalogo?.produtos?.map((p: any) => p.id) || []}
              strategy={rectSortingStrategy}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {catalogo?.produtos?.map((p: Produto) => (
                  <ProductCard
                    key={p.id}
                    produto={p}
                    onSend={() => setModalSend({ open: true, type: "product", id: p.id })}
                    onImages={() => { setActiveProduto(p); setModalGaleria(true); }}
                    onEdit={() => { setEditingProduto(p); setForm({...p, preco: p.preco||0, preco_promocional: p.preco_promocional||0, estoque: p.estoque||0, descricao: p.descricao||"", codigo: p.codigo||""}); setModalProduto(true); }}
                    onDelete={async () => { if(confirm("Remover produto?")) { await fetch(`${(import.meta.env.VITE_API_URL as string) || "http://localhost:3000"}/api/catalogo/${id}/produtos/${p.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${localStorage.getItem("access_token")}` } }); carregar(); } }}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      </div>

      <Dialog open={modalProduto} onOpenChange={setModalProduto}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{editingProduto ? "Editar" : "Novo"} Produto</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-4">
            <Input placeholder="Nome" value={form.nome} onChange={(e) => setForm({...form, nome: e.target.value})} />
            <Textarea placeholder="Descrição" value={form.descricao} onChange={(e) => setForm({...form, descricao: e.target.value})} />
            <div className="grid grid-cols-2 gap-2">
              <Input type="number" placeholder="Preço" value={form.preco} onChange={(e) => setForm({...form, preco: Number(e.target.value)})} />
              <Input type="number" placeholder="Promocional" value={form.preco_promocional} onChange={(e) => setForm({...form, preco_promocional: Number(e.target.value)})} />
            </div>
            <Input placeholder="Código" value={form.codigo} onChange={(e) => setForm({...form, codigo: e.target.value})} />
            <div className="flex items-center gap-2"><Switch checked={form.ativo} onCheckedChange={(v) => setForm({...form, ativo: v})} /> Ativo</div>
          </div>
          <DialogFooter><Button onClick={salvarProduto}>Salvar</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={modalGaleria} onOpenChange={setModalGaleria}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Galeria: {activeProduto?.nome}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 py-4">
            {activeProduto?.imagens?.map(img => (
              <div key={img.id} className="relative group">
                <img src={img.url} className="w-full aspect-square object-cover rounded" />
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-2 transition-opacity">
                  <Button size="icon" variant="ghost" className="text-white hover:text-white hover:bg-white/20" onClick={() => { navigator.clipboard.writeText(img.url); toast.success("URL copiada"); }}><Copy className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" className="text-white hover:text-red-400 hover:bg-white/20" onClick={async () => { if(confirm("Remover imagem?")) { await api.from("produto_imagens").delete().eq("id", img.id); carregar(); } }}><Trash2 className="h-4 w-4" /></Button>
                </div>
                {img.principal && <Star className="absolute top-1 left-1 h-4 w-4 fill-yellow-400 text-yellow-400" />}
              </div>
            ))}
            <label className="border-2 border-dashed rounded flex flex-col items-center justify-center aspect-square cursor-pointer hover:bg-muted text-muted-foreground transition-colors text-center">
              <Plus className="h-6 w-6 mb-1" /> <span className="text-[10px]">Upload</span>
              <input type="file" hidden multiple accept="image/*" onChange={handleUpload} />
            </label>
            <Button 
              variant="outline" 
              className="border-2 border-dashed flex flex-col items-center justify-center aspect-square h-auto text-muted-foreground"
              onClick={() => setModalPicker(true)}
            >
              <ImageIcon className="h-6 w-6 mb-1" />
              <span className="text-[10px]">Galeria</span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={modalPicker} onOpenChange={setModalPicker}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Selecionar da Galeria</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Buscar na galeria..." 
                className="pl-8" 
                value={pickerSearch} 
                onChange={e => setPickerSearch(e.target.value)} 
              />
            </div>
            <ScrollArea className="h-[400px]">
              <div className="grid grid-cols-4 gap-2">
                {galeriaImagens.map(img => (
                  <div 
                    key={img.id} 
                    className="aspect-square relative group cursor-pointer border-2 border-transparent hover:border-primary rounded overflow-hidden"
                    onClick={() => vincularImagem(img.id)}
                  >
                    <img src={img.url} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                      <Plus className="text-white h-6 w-6" />
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>

      <SendWhatsAppModal
        open={modalSend.open}
        onOpenChange={(open) => setModalSend(prev => ({ ...prev, open }))}
        type={modalSend.type}
        id={modalSend.id}
      />

      <ImportExcelModal
        open={modalImport}
        onOpenChange={setModalImport}
        onImported={handleImportExcel}
      />
    </CRMLayout>
  );
}
