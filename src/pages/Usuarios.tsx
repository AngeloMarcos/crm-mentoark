import { useEffect, useState } from "react";
import { CRMLayout } from "@/components/CRMLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { api } from "@/integrations/database/client";
import { Shield, ShieldOff, Loader2, Users, LayoutGrid } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

const API_BASE = (import.meta.env.VITE_API_URL as string) || "https://api.mentoark.com.br";
const token = () => localStorage.getItem("access_token") || "";

interface UserRow {
  user_id: string;
  email: string;
  display_name: string | null;
  created_at: string;
  is_admin: boolean;
}

interface ModuloInfo {
  key: string;
  label: string;
  padrao: boolean;
}

export default function UsuariosPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers]       = useState<UserRow[]>([]);
  const [loading, setLoading]   = useState(true);

  // Módulos
  const [todosModulos, setTodosModulos]         = useState<ModuloInfo[]>([]);
  const [userModulos, setUserModulos]           = useState<Record<string, boolean>>({});
  const [modulosUsuarioId, setModulosUsuarioId] = useState<string | null>(null);
  const [nomeUsuarioModulos, setNomeUsuarioModulos] = useState("");
  const [modulosLoading, setModulosLoading]     = useState(false);
  const [salvandoModulo, setSalvandoModulo]     = useState<string | null>(null);
  const [modalModulos, setModalModulos]         = useState(false);

  /* ── Carregar usuários ──────────────────────────────────────── */
  const load = async () => {
    setLoading(true);
    const { data: profiles } = await api
      .from("profiles")
      .select("user_id, email, display_name, created_at")
      .order("created_at", { ascending: false });
    const { data: roles } = await api.from("user_roles").select("user_id, role");
    const adminSet = new Set(
      (roles ?? []).filter(r => r.role === "admin").map(r => r.user_id)
    );
    setUsers((profiles ?? []).map(p => ({ ...p, is_admin: adminSet.has(p.user_id) })));
    setLoading(false);
  };

  /* ── Carregar lista canônica de módulos ─────────────────────── */
  useEffect(() => {
    load();
    fetch(`${API_BASE}/api/modulos/lista`, {
      headers: { Authorization: `Bearer ${token()}` },
    })
      .then(r => r.ok ? r.json() : [])
      .then(setTodosModulos);
  }, []);

  /* ── Toggle admin ───────────────────────────────────────────── */
  const toggleAdmin = async (u: UserRow) => {
    if (u.is_admin) {
      const { error } = await api.from("user_roles").delete().eq("user_id", u.user_id).eq("role", "admin");
      if (error) return toast.error(error.message);
      toast.success(`${u.email} não é mais admin`);
    } else {
      const { error } = await api.from("user_roles").insert({ user_id: u.user_id, role: "admin" });
      if (error) return toast.error(error.message);
      toast.success(`${u.email} agora é admin`);
    }
    load();
  };

  /* ── Abrir painel de módulos ────────────────────────────────── */
  const abrirModulos = async (userId: string, nome: string) => {
    setModulosUsuarioId(userId);
    setNomeUsuarioModulos(nome);
    setModalModulos(true);
    setModulosLoading(true);

    const r = await fetch(`${API_BASE}/api/modulos/usuario/${userId}`, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    if (r.ok) {
      const rows: { modulo: string; ativo: boolean }[] = await r.json();
      const map: Record<string, boolean> = {};
      todosModulos.forEach(m => { map[m.key] = false; });
      rows.forEach(row => { map[row.modulo] = row.ativo; });
      setUserModulos(map);
    }
    setModulosLoading(false);
  };

  /* ── Toggle de módulo individual ───────────────────────────── */
  const toggleModulo = async (key: string, novoValor: boolean) => {
    if (!modulosUsuarioId) return;
    setSalvandoModulo(key);
    setUserModulos(prev => ({ ...prev, [key]: novoValor }));

    try {
      const r = await fetch(`${API_BASE}/api/modulos/usuario/${modulosUsuarioId}/toggle`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ modulo: key, ativo: novoValor }),
      });
      if (!r.ok) {
        setUserModulos(prev => ({ ...prev, [key]: !novoValor }));
        toast.error("Erro ao salvar permissão");
      }
    } catch {
      setUserModulos(prev => ({ ...prev, [key]: !novoValor }));
      toast.error("Erro de conexão");
    } finally {
      setSalvandoModulo(null);
    }
  };

  /* ── Reset para padrão ──────────────────────────────────────── */
  const aplicarPadrao = async () => {
    if (!modulosUsuarioId) return;
    const padrao = todosModulos.filter(m => m.padrao).map(m => m.key);
    const r = await fetch(`${API_BASE}/api/modulos/usuario/${modulosUsuarioId}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ modulos: padrao }),
    });
    if (r.ok) {
      const map: Record<string, boolean> = {};
      todosModulos.forEach(m => { map[m.key] = padrao.includes(m.key); });
      setUserModulos(map);
      toast.success("Permissões resetadas para o padrão");
    }
  };

  /* ── Ativar todos ───────────────────────────────────────────── */
  const darTodosModulos = async () => {
    if (!modulosUsuarioId) return;
    const todos = todosModulos.map(m => m.key);
    const r = await fetch(`${API_BASE}/api/modulos/usuario/${modulosUsuarioId}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ modulos: todos }),
    });
    if (r.ok) {
      const map: Record<string, boolean> = {};
      todosModulos.forEach(m => { map[m.key] = true; });
      setUserModulos(map);
      toast.success("Todos os módulos ativados");
    }
  };

  /* ── Render ─────────────────────────────────────────────────── */
  return (
    <CRMLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Users className="h-8 w-8 text-primary" /> Usuários
          </h1>
          <p className="text-muted-foreground mt-1">
            Gerencie acesso, papéis e módulos de cada usuário
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{users.length} usuários cadastrados</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead className="hidden sm:table-cell">E-mail</TableHead>
                      <TableHead>Papel</TableHead>
                      <TableHead className="hidden md:table-cell">Cadastrado em</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map(u => (
                      <TableRow key={u.user_id}>
                        <TableCell className="font-medium">
                          <div>{u.display_name ?? "—"}</div>
                          <div className="sm:hidden text-xs text-muted-foreground truncate max-w-[140px]">
                            {u.email}
                          </div>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">{u.email}</TableCell>
                        <TableCell>
                          {u.is_admin
                            ? <Badge className="bg-primary/15 text-primary border-0">Admin</Badge>
                            : <Badge variant="secondary">Usuário</Badge>}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-muted-foreground text-sm">
                          {new Date(u.created_at).toLocaleDateString("pt-BR")}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-2 justify-end flex-wrap">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => abrirModulos(u.user_id, u.display_name || u.email)}
                              title="Gerenciar módulos"
                            >
                              <LayoutGrid className="h-4 w-4 sm:mr-1" />
                              <span className="hidden sm:inline">Módulos</span>
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => toggleAdmin(u)}
                              disabled={u.user_id === currentUser?.id}
                            >
                              {u.is_admin
                                ? <><ShieldOff className="h-4 w-4 sm:mr-1" /><span className="hidden sm:inline">Remover admin</span></>
                                : <><Shield className="h-4 w-4 sm:mr-1" /><span className="hidden sm:inline">Tornar admin</span></>}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Modal de módulos */}
      <Dialog open={modalModulos} onOpenChange={setModalModulos}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LayoutGrid className="h-5 w-5 text-primary" />
              Módulos — {nomeUsuarioModulos}
            </DialogTitle>
            <DialogDescription>
              Ative ou desative módulos para este usuário. As alterações são salvas imediatamente.
            </DialogDescription>
          </DialogHeader>

          {modulosLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : (
            <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto pr-1">
              {/* Módulos Padrão */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Módulos Padrão
                </p>
                <div className="space-y-1">
                  {todosModulos.filter(m => m.padrao).map(m => (
                    <div key={m.key} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-muted/50">
                      <Label htmlFor={`mod-${m.key}`} className="cursor-pointer flex-1 font-normal">
                        {m.label}
                      </Label>
                      {salvandoModulo === m.key ? (
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      ) : (
                        <Switch
                          id={`mod-${m.key}`}
                          checked={userModulos[m.key] ?? false}
                          onCheckedChange={v => toggleModulo(m.key, v)}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t" />

              {/* Módulos Avançados */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Módulos Avançados
                </p>
                <div className="space-y-1">
                  {todosModulos.filter(m => !m.padrao).map(m => (
                    <div key={m.key} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-muted/50">
                      <Label htmlFor={`mod-${m.key}`} className="cursor-pointer flex-1 font-normal">
                        {m.label}
                      </Label>
                      {salvandoModulo === m.key ? (
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      ) : (
                        <Switch
                          id={`mod-${m.key}`}
                          checked={userModulos[m.key] ?? false}
                          onCheckedChange={v => toggleModulo(m.key, v)}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="flex gap-2 flex-wrap sm:flex-nowrap">
            <Button variant="outline" size="sm" onClick={aplicarPadrao} className="flex-1 sm:flex-none">
              Resetar padrão
            </Button>
            <Button variant="outline" size="sm" onClick={darTodosModulos} className="flex-1 sm:flex-none">
              Ativar todos
            </Button>
            <Button onClick={() => setModalModulos(false)} className="flex-1 sm:flex-none">
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CRMLayout>
  );
}
