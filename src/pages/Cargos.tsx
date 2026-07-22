import { useEffect, useState } from "react";
import { getAuthToken } from "@/lib/api-token";
import { CRMLayout } from "@/components/CRMLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Plus, Pencil, Trash2, ArrowLeft } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

const API_BASE = (import.meta.env.VITE_API_URL as string) || "https://api.mentoark.com.br";
const token = () => getAuthToken();

interface Cargo {
  id: string;
  nome: string;
  permissoes: string[];
}

interface ModuloInfo {
  key: string;
  label: string;
  padrao: boolean;
  adminOnly: boolean;
}

export default function CargosPage() {
  const navigate = useNavigate();
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [todosModulos, setTodosModulos] = useState<ModuloInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [cargoEdit, setCargoEdit] = useState<Cargo | null>(null);

  const [nome, setNome] = useState("");
  const [permissoes, setPermissoes] = useState<string[]>([]);
  const [salvando, setSalvando] = useState(false);

  const load = async () => {
    setLoading(true);
    const r = await fetch(`${API_BASE}/api/cargos`, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    if (r.ok) {
      const data = await r.json();
      setCargos(data);
    }
    setLoading(false);
  };

  const loadModulos = async () => {
    const r = await fetch(`${API_BASE}/api/modulos/lista`, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    if (r.ok) setTodosModulos(await r.json());
  };

  useEffect(() => { load(); loadModulos(); }, []);

  const resetForm = () => {
    setNome("");
    setPermissoes([]);
    setCargoEdit(null);
  };

  const save = async () => {
    if (!nome.trim()) return toast.error("Nome é obrigatório");
    setSalvando(true);
    const method = cargoEdit ? "PATCH" : "POST";
    const url = cargoEdit ? `${API_BASE}/api/cargos/${cargoEdit.id}` : `${API_BASE}/api/cargos`;
    
    const r = await fetch(url, {
      method,
      headers: { 
        Authorization: `Bearer ${token()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ nome, permissoes })
    });

    if (r.ok) {
      toast.success(cargoEdit ? "Cargo atualizado" : "Cargo criado");
      setModal(false);
      load();
    } else {
      toast.error("Erro ao salvar cargo");
    }
    setSalvando(false);
  };

  const deleteCargo = async (id: string) => {
    if (!confirm("Tem certeza?")) return;
    const r = await fetch(`${API_BASE}/api/cargos/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token()}` },
    });
    if (r.ok) {
      toast.success("Cargo excluído");
      load();
    }
  };

  return (
    <CRMLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate("/usuarios")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-3xl font-bold">Gerenciar Cargos</h1>
              <p className="text-muted-foreground">Defina papéis e permissões de acesso</p>
            </div>
          </div>
          <Button onClick={() => { resetForm(); setModal(true); }} className="gap-2">
            <Plus className="h-4 w-4" /> Adicionar Novo Cargo
          </Button>
        </div>

        <Card>
          <CardContent className="pt-6">
            {loading ? (
              <div className="flex justify-center py-8"><Loader2 className="animate-spin" /></div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome do Cargo</TableHead>
                    <TableHead>Permissões</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cargos.map(c => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.nome}</TableCell>
                      <TableCell className="max-w-md truncate">
                        {c.permissoes.join(", ") || "Nenhuma"}
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button variant="ghost" size="icon" onClick={() => {
                          setCargoEdit(c);
                          setNome(c.nome);
                          setPermissoes(c.permissoes);
                          setModal(true);
                        }}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => deleteCargo(c.id)} className="text-destructive"><Trash2 className="h-4 w-4" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={modal} onOpenChange={setModal}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{cargoEdit ? "Editar Cargo" : "Adicionar Novo Cargo"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-6 py-4">
            <div className="space-y-2">
              <Label htmlFor="nome">Nome do Cargo*</Label>
              <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} />
            </div>
            
            <div className="space-y-4">
              <Label className="text-lg font-semibold">Permissões de Acesso</Label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {[
                  { nome: "Módulos", itens: todosModulos.filter(m => !m.adminOnly) },
                  { nome: "Administração", itens: todosModulos.filter(m => m.adminOnly) },
                ].map(grupo => (
                  <div key={grupo.nome} className="space-y-3 p-4 rounded-lg bg-muted/30">
                    <h3 className="font-bold border-b pb-2">{grupo.nome}</h3>
                    <div className="space-y-2">
                      {grupo.itens.map(m => (
                        <div key={m.key} className="flex items-center space-x-2">
                          <Checkbox
                            id={m.key}
                            checked={permissoes.includes(m.key)}
                            onCheckedChange={(checked) => {
                              if (checked) setPermissoes([...permissoes, m.key]);
                              else setPermissoes(permissoes.filter(p => p !== m.key));
                            }}
                          />
                          <Label htmlFor={m.key}>{m.label}</Label>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setModal(false)}>Cancelar</Button>
            <Button onClick={save} disabled={salvando}>
              {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar Cargo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CRMLayout>
  );
}
