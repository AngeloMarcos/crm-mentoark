import { useEffect, useMemo, useState } from "react";
import { getAuthToken } from "@/lib/api-token";
import { CRMLayout } from "@/components/CRMLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, UserPlus, Pencil, Trash2, Search, Eye, EyeOff, LayoutGrid, IdCard, ShieldCheck, KeyRound } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

const API_BASE = (import.meta.env.VITE_API_URL as string) || "https://api.mentoark.com.br";
const token = () => getAuthToken();
const authHeaders = () => ({ Authorization: `Bearer ${token()}`, "Content-Type": "application/json" });

interface UserRow {
  user_id: string;
  email: string;
  display_name: string | null;
  cargo_id: string | null;
  cargo_nome: string | null;
  role: string;
  active: boolean;
  created_at: string;
  modulos: string[];
}

interface Cargo { id: string; nome: string; permissoes: string[]; }
interface ModuloCatalogo { key: string; label: string; padrao: boolean; adminOnly: boolean; }

export default function UsuariosPage() {
  const navigate = useNavigate();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [catalogo, setCatalogo] = useState<ModuloCatalogo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  // ── Modal ──────────────────────────────────────────────────────────────────
  const [modal, setModal] = useState(false);
  const [userEdit, setUserEdit] = useState<UserRow | null>(null);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmSenha, setConfirmSenha] = useState("");
  const [cargoId, setCargoId] = useState("");
  const [modSel, setModSel] = useState<Set<string>>(new Set());
  const [ativo, setAtivo] = useState(true);
  const [showSenha, setShowSenha] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const load = async () => {
    setLoading(true);
    const offset = page * 15;
    const r = await fetch(`${API_BASE}/api/profiles?search=${encodeURIComponent(search)}&limit=15&offset=${offset}`, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    if (r.ok) setUsers(await r.json());
    setLoading(false);
  };

  const loadAux = async () => {
    const [rc, rm] = await Promise.all([
      fetch(`${API_BASE}/api/cargos`, { headers: { Authorization: `Bearer ${token()}` } }),
      fetch(`${API_BASE}/api/modulos/lista`, { headers: { Authorization: `Bearer ${token()}` } }),
    ]);
    if (rc.ok) setCargos(await rc.json());
    if (rm.ok) setCatalogo(await rm.json());
  };

  useEffect(() => { load(); }, [search, page]);
  useEffect(() => { loadAux(); }, []);

  const resetForm = () => {
    setUserEdit(null);
    setNome(""); setEmail(""); setSenha(""); setConfirmSenha("");
    setCargoId(""); setModSel(new Set()); setAtivo(true); setShowSenha(false);
  };

  const handleEdit = (u: UserRow) => {
    setUserEdit(u);
    setNome(u.display_name || "");
    setEmail(u.email);
    setSenha(""); setConfirmSenha("");
    setCargoId(u.cargo_id || "");
    setModSel(new Set(u.modulos || []));
    setAtivo(u.active);
    setShowSenha(false);
    setModal(true);
  };

  const toggleMod = (key: string) =>
    setModSel(prev => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });

  const aplicarPermissoesDoCargo = (cId: string) => {
    const c = cargos.find(x => x.id === cId);
    if (c && Array.isArray(c.permissoes)) setModSel(new Set(c.permissoes));
  };

  const salvarModulos = async (userId: string): Promise<boolean> => {
    const r = await fetch(`${API_BASE}/api/modulos/usuario/${userId}`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ modulos: [...modSel] }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => null);
      toast.error(e?.message || "Erro ao salvar permissões de módulo");
      return false;
    }
    return true;
  };

  const save = async () => {
    if (!nome.trim() || !email.trim()) return toast.error("Nome e e-mail são obrigatórios");
    const trocaSenha = !!senha || !!confirmSenha;
    if (!userEdit && !senha) return toast.error("Defina uma senha para o novo usuário");
    if ((trocaSenha || !userEdit) && senha !== confirmSenha) return toast.error("As senhas não coincidem");
    if ((trocaSenha || !userEdit) && senha.length < 6) return toast.error("A senha precisa de pelo menos 6 caracteres");

    setSalvando(true);
    try {
      if (userEdit) {
        const rp = await fetch(`${API_BASE}/api/profiles/${userEdit.user_id}`, {
          method: "PATCH",
          headers: authHeaders(),
          body: JSON.stringify({ display_name: nome.trim(), cargo_id: cargoId || null, active: ativo }),
        });
        if (!rp.ok) { const e = await rp.json().catch(() => ({})); throw new Error(e.message || "Erro ao atualizar usuário"); }

        if (!(await salvarModulos(userEdit.user_id))) { setSalvando(false); return; }

        if (trocaSenha) {
          const rs = await fetch(`${API_BASE}/api/profiles/${userEdit.user_id}/reset-password`, {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({ new_password: senha }),
          });
          if (!rs.ok) { const e = await rs.json().catch(() => ({})); throw new Error(e.message || "Erro ao redefinir a senha"); }
        }
        toast.success("Usuário atualizado");
      } else {
        const rc = await fetch(`${API_BASE}/api/profiles`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ email: email.trim(), password: senha, display_name: nome.trim(), cargo_id: cargoId || null }),
        });
        if (!rc.ok) { const e = await rc.json().catch(() => ({})); throw new Error(e.message || "Erro ao criar usuário"); }
        const novo = await rc.json();
        if (modSel.size) await salvarModulos(novo.user_id);
        toast.success("Usuário criado");
      }
      setModal(false);
      load();
    } catch (e: any) {
      toast.error(e.message || "Erro na comunicação com o servidor");
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
    if (r.ok) { toast.success("Usuário excluído"); load(); }
    else toast.error("Não foi possível excluir");
  };

  const modsNormais = useMemo(() => catalogo.filter(m => !m.adminOnly), [catalogo]);
  const modsAdmin = useMemo(() => catalogo.filter(m => m.adminOnly), [catalogo]);
  const senhaMismatch = (senha || confirmSenha) && senha !== confirmSenha;

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
                          <Badge variant="outline" className="font-normal">{u.cargo_nome || "Sem Cargo"}</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1 max-w-[300px]">
                            {u.modulos?.slice(0, 3).map(m => (
                              <Badge key={m} variant="secondary" className="text-[10px] px-1.5 py-0">{m}</Badge>
                            ))}
                            {(u.modulos?.length || 0) > 3 && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">+{u.modulos.length - 3}</Badge>
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
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{userEdit ? "Editar perfil do usuário" : "Adicionar novo usuário"}</DialogTitle>
            <DialogDescription>Dados de acesso, cargo e permissões de módulo.</DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-2">
            {/* Identificação */}
            <section className="space-y-3">
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary">
                <IdCard className="h-4 w-4" /> Identificação
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="nome">Nome completo *</Label>
                  <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: João Silva" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email">E-mail (login) *</Label>
                  <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!!userEdit} placeholder="exemplo@email.com" />
                </div>
              </div>
            </section>

            {/* Cargo & permissões */}
            <section className="space-y-3">
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary">
                <ShieldCheck className="h-4 w-4" /> Cargo & permissões
              </p>
              <div className="grid gap-3 sm:grid-cols-2 sm:items-end">
                <div className="space-y-1.5">
                  <Label htmlFor="cargo">Cargo</Label>
                  <Select value={cargoId} onValueChange={(v) => setCargoId(v)}>
                    <SelectTrigger id="cargo"><SelectValue placeholder="Selecione um cargo" /></SelectTrigger>
                    <SelectContent>
                      {cargos.map(c => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {cargoId && (
                  <Button type="button" variant="outline" size="sm" className="w-fit"
                    onClick={() => aplicarPermissoesDoCargo(cargoId)}>
                    Aplicar permissões do cargo
                  </Button>
                )}
              </div>

              <div className="rounded-lg border p-3 space-y-3">
                <p className="text-[11px] text-muted-foreground">
                  Módulos que este usuário pode acessar. O cargo é só um atalho — o que vale é o que está marcado aqui.
                </p>
                <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
                  {modsNormais.map(m => (
                    <label key={m.key} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox checked={modSel.has(m.key)} onCheckedChange={() => toggleMod(m.key)} />
                      <span>{m.label}</span>
                      {m.padrao && <span className="text-[10px] text-muted-foreground">(padrão)</span>}
                    </label>
                  ))}
                </div>
                {modsAdmin.length > 0 && (
                  <div className="border-t pt-2">
                    <p className="mb-1.5 text-[10px] font-bold uppercase text-muted-foreground">Requer perfil admin</p>
                    <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
                      {modsAdmin.map(m => (
                        <label key={m.key} className="flex items-center gap-2 text-sm cursor-pointer">
                          <Checkbox checked={modSel.has(m.key)} onCheckedChange={() => toggleMod(m.key)} />
                          <span>{m.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* Segurança & acesso */}
            <section className="space-y-3">
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary">
                <KeyRound className="h-4 w-4" /> Segurança & acesso
              </p>

              {userEdit && (
                <div className="space-y-1.5">
                  <Label>Status da conta</Label>
                  <Select value={ativo ? "ativo" : "inativo"} onValueChange={(v) => setAtivo(v === "ativo")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ativo">Ativo — pode acessar o sistema</SelectItem>
                      <SelectItem value="inativo">Inativo — acesso bloqueado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="senha">{userEdit ? "Nova senha" : "Senha *"}</Label>
                  <div className="relative">
                    <Input id="senha" type={showSenha ? "text" : "password"} value={senha}
                      onChange={(e) => setSenha(e.target.value)}
                      placeholder={userEdit ? "deixe em branco para não alterar" : ""} />
                    <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0 h-full"
                      onClick={() => setShowSenha(!showSenha)}>
                      {showSenha ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirmSenha">Confirmar senha{userEdit ? "" : " *"}</Label>
                  <Input id="confirmSenha" type={showSenha ? "text" : "password"} value={confirmSenha}
                    onChange={(e) => setConfirmSenha(e.target.value)} />
                </div>
              </div>
              {senhaMismatch && <p className="text-xs text-destructive">As senhas não coincidem.</p>}
            </section>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setModal(false)}>Cancelar</Button>
            <Button onClick={save} disabled={salvando || !!senhaMismatch}>
              {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {userEdit ? "Salvar alterações" : "Criar usuário"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CRMLayout>
  );
}
