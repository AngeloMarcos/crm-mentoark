import { useEffect, useState } from "react";
import { getAuthToken } from "@/lib/api-token";
import { CRMLayout } from "@/components/CRMLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, UserPlus, Pencil, Trash2, Search, Eye, EyeOff, LayoutGrid } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

const API_BASE = (import.meta.env.VITE_API_URL as string) || "https://api.mentoark.com.br";
const token = () => getAuthToken();

interface UserRow {
  user_id: string;
  email: string;
  display_name: string | null;
  cargo_id: string | null;
  cargo_nome: string | null;
  active: boolean;
  created_at: string;
  modulos: string[];
}

interface Cargo {
  id: string;
  nome: string;
  permissoes: string[];
}

export default function UsuariosPage() {
  const navigate = useNavigate();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  // Modal State
  const [modal, setModal] = useState(false);
  const [userEdit, setUserEdit] = useState<UserRow | null>(null);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmSenha, setConfirmSenha] = useState("");
  const [cargoId, setCargoId] = useState("");
  const [showSenha, setShowSenha] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const load = async () => {
    setLoading(true);
    const offset = page * 15;
    const r = await fetch(`${API_BASE}/api/profiles?search=${encodeURIComponent(search)}&limit=15&offset=${offset}`, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    if (r.ok) {
      const data = await r.json();
      setUsers(data);
    }
    setLoading(false);
  };

  const loadCargos = async () => {
    const r = await fetch(`${API_BASE}/api/cargos`, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    if (r.ok) {
      const data = await r.json();
      setCargos(data);
    }
  };

  useEffect(() => { load(); }, [search, page]);
  useEffect(() => { loadCargos(); }, []);

  const resetForm = () => {
    setUserEdit(null);
    setNome("");
    setEmail("");
    setSenha("");
    setConfirmSenha("");
    setCargoId("");
    setShowSenha(false);
  };

  const handleEdit = (u: UserRow) => {
    setUserEdit(u);
    setNome(u.display_name || "");
    setEmail(u.email);
    setSenha("");
    setConfirmSenha("");
    setCargoId(u.cargo_id || "");
    setModal(true);
  };

  const syncModulesWithRole = async (userId: string, cId: string) => {
    const selectedCargo = cargos.find(c => c.id === cId);
    if (!selectedCargo) return;

    await fetch(`${API_BASE}/api/modulos/usuario/${userId}`, {
      method: "PUT",
      headers: { 
        Authorization: `Bearer ${token()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ modulos: selectedCargo.permissoes })
    });
  };

  const save = async () => {
    if (!nome || !email || (!userEdit && !senha)) {
      return toast.error("Preencha todos os campos obrigatórios");
    }
    if (!userEdit && senha !== confirmSenha) {
      return toast.error("As senhas não coincidem");
    }

    setSalvando(true);
    try {
      if (userEdit) {
        // Edit Profile
        const r = await fetch(`${API_BASE}/api/profiles/${userEdit.user_id}`, {
          method: "PATCH",
          headers: { 
            Authorization: `Bearer ${token()}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ display_name: nome, cargo_id: cargoId || null })
        });
        if (r.ok) {
          if (cargoId) await syncModulesWithRole(userEdit.user_id, cargoId);
          toast.success("Usuário atualizado");
          setModal(false);
          load();
        }
      } else {
        // Create Profile
        const r = await fetch(`${API_BASE}/api/profiles`, {
          method: "POST",
          headers: { 
            Authorization: `Bearer ${token()}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ email, password: senha, display_name: nome, cargo_id: cargoId || null })
        });
        if (r.ok) {
          const newUser = await r.json();
          if (cargoId) await syncModulesWithRole(newUser.user_id, cargoId);
          toast.success("Usuário criado");
          setModal(false);
          load();
        } else {
          const err = await r.json();
          toast.error(err.message || "Erro ao criar usuário");
        }
      }
    } catch (e) {
      toast.error("Erro na comunicação com o servidor");
    } finally {
      setSalvando(false);
    }
  };

  const deleteUser = async (id: string) => {
    if (!confirm("Tem certeza que deseja excluir este usuário?")) return;
    const r = await fetch(`${API_BASE}/api/profiles/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token()}` },
    });
    if (r.ok) {
      toast.success("Usuário excluído");
      load();
    }
  };

  return (
    <CRMLayout>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Gerenciar Usuários</h1>
            <p className="text-muted-foreground">Adicione, edite e gerencie os membros da sua equipe</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate("/usuarios/cargos")} className="gap-2">
              <LayoutGrid className="h-4 w-4" /> Gerenciar Cargos
            </Button>
            <Button onClick={() => { resetForm(); setModal(true); }} className="bg-primary hover:bg-primary/90 gap-2">
              <UserPlus className="h-4 w-4" /> Adicionar Novo Usuário
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <CardTitle className="text-lg">Equipe</CardTitle>
            <div className="relative w-64">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Buscar por nome ou e-mail..." 
                className="pl-8"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              />
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-8"><Loader2 className="animate-spin" /></div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>USUÁRIO</TableHead>
                      <TableHead>CARGO</TableHead>
                      <TableHead>MÓDULOS ATIVOS</TableHead>
                      <TableHead>STATUS</TableHead>
                      <TableHead className="text-right">AÇÕES</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map(u => (
                      <TableRow key={u.user_id}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center font-bold text-primary">
                              {(u.display_name?.[0] || u.email[0]).toUpperCase()}
                            </div>
                            <div>
                              <div className="font-semibold">{u.display_name}</div>
                              <div className="text-xs text-muted-foreground">{u.email}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-normal">
                            {u.cargo_nome || "Sem Cargo"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1 max-w-[300px]">
                            {u.modulos?.slice(0, 3).map(m => (
                              <Badge key={m} variant="secondary" className="text-[10px] px-1.5 py-0">
                                {m}
                              </Badge>
                            ))}
                            {(u.modulos?.length || 0) > 3 && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                +{u.modulos.length - 3}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={u.active ? "default" : "secondary"} className={u.active ? "bg-green-500/10 text-green-500 border-green-500/20" : "bg-gray-500/10 text-gray-500 border-gray-500/20"}>
                            {u.active ? "Ativo" : "Inativo"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right space-x-1">
                          <Button variant="ghost" size="icon" onClick={() => handleEdit(u)}><Pencil className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => deleteUser(u.user_id)} className="text-destructive"><Trash2 className="h-4 w-4" /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                
                <div className="flex items-center justify-end space-x-2 pt-4">
                  <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>Anterior</Button>
                  <span className="text-sm text-muted-foreground">Página {page + 1}</span>
                  <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={users.length < 15}>Próxima</Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={modal} onOpenChange={setModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{userEdit ? "Editar Usuário" : "Adicionar Novo Usuário"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="nome">Nome Completo*</Label>
              <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: João Silva" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">E-mail (Login)*</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!!userEdit} placeholder="exemplo@email.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cargo">Cargo*</Label>
              <Select value={cargoId} onValueChange={setCargoId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um cargo" />
                </SelectTrigger>
                <SelectContent>
                  {cargos.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            {!userEdit && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="senha">Senha Nova*</Label>
                  <div className="relative">
                    <Input id="senha" type={showSenha ? "text" : "password"} value={senha} onChange={(e) => setSenha(e.target.value)} />
                    <Button variant="ghost" size="icon" className="absolute right-0 top-0 h-full" onClick={() => setShowSenha(!showSenha)}>
                      {showSenha ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmSenha">Confirmar Senha*</Label>
                  <Input id="confirmSenha" type={showSenha ? "text" : "password"} value={confirmSenha} onChange={(e) => setConfirmSenha(e.target.value)} />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setModal(false)}>Cancelar</Button>
            <Button onClick={save} disabled={salvando}>
              {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {userEdit ? "Salvar Alterações" : "Criar Usuário"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CRMLayout>
  );
}
