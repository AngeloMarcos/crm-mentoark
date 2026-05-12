import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { CRMLayout } from "@/components/CRMLayout";
import { api } from "@/integrations/database/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, LayoutGrid, Pencil, Trash2, Loader2, ImageOff } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

interface Catalogo {
  id: string;
  nome: string;
  descricao: string | null;
  ativo: boolean;
  total_produtos: string;
}

export default function CatalogoPage() {
  const [catalogos, setCatalogos] = useState<Catalogo[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<Catalogo | null>(null);
  const [form, setForm] = useState({ nome: "", descricao: "", ativo: true });
  const navigate = useNavigate();

  const carregar = async () => {
    setLoading(true);
    const { data, error } = await api.from("catalogos").select("*");
    if (error) toast.error("Erro ao carregar catálogos");
    else setCatalogos((data as Catalogo[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { carregar(); }, []);

  const salvar = async () => {
    if (!form.nome) return;
    if (editing) {
      await api.from("catalogos").update(form).eq("id", editing.id);
      toast.success("Catálogo atualizado");
    } else {
      await api.from("catalogos").insert([form]);
      toast.success("Catálogo criado");
    }
    setModal(false);
    carregar();
  };

  return (
    <CRMLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
              <LayoutGrid className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Catálogo de Produtos</h1>
            </div>
          </div>
          <Button onClick={() => { setEditing(null); setForm({ nome: "", descricao: "", ativo: true }); setModal(true); }}>
            <Plus className="h-4 w-4 mr-2" /> Novo Catálogo
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="animate-spin" /></div>
        ) : catalogos.length === 0 ? (
          <Card className="py-20 text-center">
            <LayoutGrid className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <Button onClick={() => setModal(true)}>Criar primeiro catálogo</Button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {catalogos.map((c) => (
              <Card key={c.id}>
                <CardContent className="p-4 space-y-4">
                  <div className="flex justify-between items-start">
                    <h3 className="font-semibold">{c.nome}</h3>
                    <Badge variant={c.ativo ? "default" : "secondary"}>{c.ativo ? "Ativo" : "Inativo"}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-2">{c.descricao}</p>
                  <div className="flex items-center justify-between">
                    <Badge variant="outline">{c.total_produtos} produtos</Badge>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={() => navigate(`/catalogo/${c.id}`)}>Ver</Button>
                      <Button variant="ghost" size="sm" onClick={() => { setEditing(c); setForm({ nome: c.nome, descricao: c.descricao || "", ativo: c.ativo }); setModal(true); }}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="sm" onClick={async () => { await api.from("catalogos").delete().eq("id", c.id); carregar(); }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={modal} onOpenChange={setModal}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Editar" : "Novo"} Catálogo</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <Input placeholder="Nome" value={form.nome} onChange={(e) => setForm({...form, nome: e.target.value})} />
            <Textarea placeholder="Descrição" value={form.descricao} onChange={(e) => setForm({...form, descricao: e.target.value})} />
            <div className="flex items-center gap-2"><Switch checked={form.ativo} onCheckedChange={(v) => setForm({...form, ativo: v})} /> Ativo</div>
          </div>
          <DialogFooter><Button onClick={salvar}>Salvar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </CRMLayout>
  );
}