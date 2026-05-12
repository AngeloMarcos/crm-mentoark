import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { CRMLayout } from "@/components/CRMLayout";
import { api, uploadImagem } from "@/integrations/database/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, ArrowLeft, Pencil, Trash2, Loader2, ImageOff, Star, Copy, Image as ImageIcon, Send } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SendWhatsAppModal } from "@/components/catalogo/SendWhatsAppModal";

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
  const [editingProduto, setEditingProduto] = useState<Produto | null>(null);
  const [activeProduto, setActiveProduto] = useState<Produto | null>(null);
  const [modalSend, setModalSend] = useState<{ open: boolean; type: "product" | "catalog"; id: string }>({
    open: false, type: "product", id: ""
  });
  const [form, setForm] = useState({
    nome: "", descricao: "", preco: 0, preco_promocional: 0, codigo: "", estoque: 0, ativo: true
  });

  const carregar = async () => {
    setLoading(true);
    const { data, error } = await api.from("catalogos").select("*").eq("id", id).single();
    if (error) toast.error("Erro ao carregar catálogo");
    else {
      const res = await fetch(`${(import.meta.env.VITE_API_URL as string) || "http://localhost:3000"}/api/catalogo/${id}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("access_token")}` }
      });
      const dataFull = await res.json();
      setCatalogo(dataFull);
    }
    setLoading(false);
  };

  useEffect(() => { carregar(); }, [id]);

  const salvarProduto = async () => {
    if (editingProduto) {
      await api.from(`catalogos/${id}/produtos`).update(form).eq("id", editingProduto.id);
      toast.success("Produto atualizado");
    } else {
      await api.from(`catalogos/${id}/produtos`).insert([form]);
      toast.success("Produto criado");
    }
    setModalProduto(false);
    carregar();
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !activeProduto) return;
    try {
      for (let i = 0; i < e.target.files.length; i++) {
        await uploadImagem(`/api/catalogo/produtos/${activeProduto.id}/imagens`, e.target.files[i]);
      }
      toast.success("Upload concluído");
      carregar();
      // Atualiza o activeProduto com os novos dados
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

  const setPrincipal = async (imgId: string) => {
    // A rota do backend POST /api/catalogo/produtos/:produtoId/imagens cuida de resetar os outros, 
    // mas aqui não temos um PUT de imagem individual. O backend atualizado no Step 2 tem essa lógica no POST de imagem.
    // Como a sprint não definiu PUT imagem, vamos focar no que foi pedido.
  };

  if (loading) return <CRMLayout><div className="flex justify-center py-20"><Loader2 className="animate-spin" /></div></CRMLayout>;

  return (
    <CRMLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/catalogo")}><ArrowLeft /></Button>
            <h1 className="text-2xl font-bold">{catalogo?.nome}</h1>
          </div>
          <Button onClick={() => { setEditingProduto(null); setForm({ nome: "", descricao: "", preco: 0, preco_promocional: 0, codigo: "", estoque: 0, ativo: true }); setModalProduto(true); }}>
            <Plus className="h-4 w-4 mr-2" /> Novo Produto
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {catalogo?.produtos?.map((p: Produto) => {
            const principal = p.imagens?.find(img => img.principal) || p.imagens?.[0];
            return (
              <Card key={p.id}>
                <div className="aspect-square relative bg-muted flex items-center justify-center">
                  {principal ? (
                    <img src={principal.url} className="w-full h-full object-cover" />
                  ) : <ImageIcon className="h-10 w-10 text-muted-foreground" />}
                </div>
                <CardContent className="p-4 space-y-2">
                  <h3 className="font-semibold">{p.nome}</h3>
                  <p className="text-xs text-muted-foreground line-clamp-2">{p.descricao}</p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-success font-bold">R$ {p.preco}</span>
                    {p.preco_promocional && <span className="text-xs line-through opacity-50">R$ {p.preco_promocional}</span>}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setActiveProduto(p); setModalGaleria(true); }}>Imagens</Button>
                    <Button variant="ghost" size="sm" onClick={() => { setEditingProduto(p); setForm({...p, preco: p.preco||0, preco_promocional: p.preco_promocional||0, estoque: p.estoque||0, descricao: p.descricao||"", codigo: p.codigo||""}); setModalProduto(true); }}>Editar</Button>
                    <Button variant="ghost" size="sm" onClick={async () => { await api.from(`catalogos/${id}/produtos`).delete().eq("id", p.id); carregar(); }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <Dialog open={modalProduto} onOpenChange={setModalProduto}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{editingProduto ? "Editar" : "Novo"} Produto</DialogTitle></DialogHeader>
          <Tabs defaultValue="dados">
            <TabsList><TabsTrigger value="dados">Dados</TabsTrigger><TabsTrigger value="imagens">Imagens</TabsTrigger></TabsList>
            <TabsContent value="dados" className="space-y-3 pt-4">
              <Input placeholder="Nome" value={form.nome} onChange={(e) => setForm({...form, nome: e.target.value})} />
              <Textarea placeholder="Descrição" value={form.descricao} onChange={(e) => setForm({...form, descricao: e.target.value})} />
              <div className="grid grid-cols-2 gap-2">
                <Input type="number" placeholder="Preço" value={form.preco} onChange={(e) => setForm({...form, preco: Number(e.target.value)})} />
                <Input type="number" placeholder="Promocional" value={form.preco_promocional} onChange={(e) => setForm({...form, preco_promocional: Number(e.target.value)})} />
              </div>
              <Input placeholder="Código" value={form.codigo} onChange={(e) => setForm({...form, codigo: e.target.value})} />
              <div className="flex items-center gap-2"><Switch checked={form.ativo} onCheckedChange={(v) => setForm({...form, ativo: v})} /> Ativo</div>
            </TabsContent>
            <TabsContent value="imagens" className="pt-4">
              <p className="text-sm text-muted-foreground">Salve o produto primeiro para gerenciar imagens.</p>
            </TabsContent>
          </Tabs>
          <DialogFooter><Button onClick={salvarProduto}>Salvar</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={modalGaleria} onOpenChange={setModalGaleria}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Galeria: {activeProduto?.nome}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-3 gap-2 py-4">
            {activeProduto?.imagens?.map(img => (
              <div key={img.id} className="relative group">
                <img src={img.url} className="w-full aspect-square object-cover rounded" />
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-2 transition-opacity">
                  <Button size="icon" variant="ghost" onClick={() => { navigator.clipboard.writeText(img.url); toast.success("URL copiada"); }}><Copy className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={async () => { await api.from("catalogo/imagens").delete().eq("id", img.id); carregar(); }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
                {img.principal && <Star className="absolute top-1 left-1 h-4 w-4 fill-yellow-400 text-yellow-400" />}
              </div>
            ))}
            <label className="border-2 border-dashed rounded flex flex-col items-center justify-center aspect-square cursor-pointer hover:bg-muted">
              <Plus /> <span className="text-xs">Upload</span>
              <input type="file" hidden multiple accept="image/*" onChange={handleUpload} />
            </label>
          </div>
        </DialogContent>
      </Dialog>
    </CRMLayout>
  );
}