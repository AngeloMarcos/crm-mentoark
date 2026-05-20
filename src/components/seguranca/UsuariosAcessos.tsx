import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/integrations/database/client";
import { 
  Shield, ShieldOff, Loader2, Search, ChevronDown, ChevronUp, 
  LayoutGrid, CheckCircle2, AlertCircle, Users 
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { AnimatePresence, motion } from "framer-motion";

const API_BASE = (import.meta.env.VITE_API_URL as string) || "https://api.mentoark.com.br";
const token = () => localStorage.getItem("access_token") || "";

interface UserRow {
  user_id: string;
  email: string;
  display_name: string | null;
  created_at: string;
  is_admin: boolean;
  modulos_count: number;
}

interface ModuloInfo {
  key: string;
  label: string;
  padrao: boolean;
}

export function UsuariosAcessos() {
  const { user: currentUser } = useAuth();
  const [users, setUsers]       = useState<UserRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [busca, setBusca]       = useState("");
  const [filtroRole, setFiltroRole] = useState<"todos" | "admin" | "usuario">("todos");
  
  // Módulos
  const [todosModulos, setTodosModulos] = useState<ModuloInfo[]>([]);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [userModulos, setUserModulos]   = useState<Record<string, boolean>>({});
  const [modulosLoading, setModulosLoading] = useState(false);
  const [salvandoModulo, setSalvandoModulo] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data: profiles } = await api
      .from("profiles")
      .select("user_id, email, display_name, created_at")
      .order("created_at", { ascending: false });
    
    const { data: roles } = await api.from("user_roles").select("user_id, role");
    const { data: userModulosData } = await api.from("user_modulos").select("user_id, modulo, ativo");

    const adminSet = new Set((roles ?? []).filter(r => r.role === "admin").map(r => r.user_id));
    
    const modulosCountMap: Record<string, number> = {};
    (userModulosData ?? []).forEach(m => {
      if (m.ativo) {
        modulosCountMap[m.user_id] = (modulosCountMap[m.user_id] || 0) + 1;
      }
    });

    setUsers((profiles ?? []).map(p => ({ 
      ...p, 
      is_admin: adminSet.has(p.user_id),
      modulos_count: modulosCountMap[p.user_id] || 0
    })));
    setLoading(false);
  };

  useEffect(() => {
    load();
    fetch(`${API_BASE}/api/modulos/lista`, {
      headers: { Authorization: `Bearer ${token()}` },
    })
      .then(r => r.ok ? r.json() : [])
      .then(setTodosModulos);
  }, []);

  const toggleAdmin = async (u: UserRow) => {
    try {
      if (u.is_admin) {
        const { error } = await api.from("user_roles").delete().eq("user_id", u.user_id).eq("role", "admin");
        if (error) throw error;
        toast.success(`${u.email} não é mais admin`);
      } else {
        const { error } = await api.from("user_roles").insert({ user_id: u.user_id, role: "admin" });
        if (error) throw error;
        toast.success(`${u.email} agora é admin`);
      }
      load();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleExpand = async (userId: string) => {
    if (expandedUser === userId) {
      setExpandedUser(null);
      return;
    }
    setExpandedUser(userId);
    setModulosLoading(true);
    
    try {
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
    } finally {
      setModulosLoading(false);
    }
  };

  const toggleModulo = async (userId: string, key: string, novoValor: boolean) => {
    setSalvandoModulo(key);
    setUserModulos(prev => ({ ...prev, [key]: novoValor }));

    try {
      const r = await fetch(`${API_BASE}/api/modulos/usuario/${userId}/toggle`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ modulo: key, ativo: novoValor }),
      });
      if (!r.ok) throw new Error();
      
      // Update count in local state
      setUsers(prev => prev.map(u => u.user_id === userId 
        ? { ...u, modulos_count: u.modulos_count + (novoValor ? 1 : -1) } 
        : u
      ));
    } catch {
      setUserModulos(prev => ({ ...prev, [key]: !novoValor }));
      toast.error("Erro ao salvar permissão");
    } finally {
      setSalvandoModulo(null);
    }
  };

  const filteredUsers = users.filter(u => {
    const matchBusca = u.email.toLowerCase().includes(busca.toLowerCase()) || 
                       (u.display_name || "").toLowerCase().includes(busca.toLowerCase());
    const matchRole = filtroRole === "todos" || 
                      (filtroRole === "admin" && u.is_admin) || 
                      (filtroRole === "usuario" && !u.is_admin);
    return matchBusca && matchRole;
  });

  const adminsCount = users.filter(u => u.is_admin).length;

  return (
    <div className="space-y-6">
      {/* Cards de resumo */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {[
          { label: "Total de usuários", valor: users.length, icon: Users, color: "text-blue-500" },
          { label: "Administradores", valor: adminsCount, icon: Shield, color: "text-purple-500" },
          { label: "Módulos delegáveis", valor: todosModulos.length, icon: LayoutGrid, color: "text-emerald-500" },
          { label: "Módulos padrão", valor: todosModulos.filter(m => m.padrao).length, icon: ShieldOff, color: "text-orange-500" },
        ].map((item) => (
          <Card key={item.label}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{item.label}</p>
                  <p className="text-2xl font-bold mt-1">{item.valor}</p>
                </div>
                <item.icon className={`h-8 w-8 ${item.color} opacity-20`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="bg-white/5 border-white/10 overflow-hidden">
        <CardHeader className="border-b border-white/5 pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <CardTitle className="text-lg font-semibold">Usuários & Acessos</CardTitle>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar usuário..."
                  value={busca}
                  onChange={e => setBusca(e.target.value)}
                  className="pl-9 w-full sm:w-64 bg-white/5 border-white/10 text-white"
                />
              </div>
              <div className="flex border border-white/10 rounded-md p-0.5">
                {(["todos", "admin", "usuario"] as const).map(role => (
                  <button
                    key={role}
                    onClick={() => setFiltroRole(role)}
                    className={`px-3 py-1 text-xs rounded-sm transition-all capitalize ${
                      filtroRole === role ? "bg-white/10 text-white" : "text-muted-foreground hover:text-white"
                    }`}
                  >
                    {role}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow className="border-white/5 hover:bg-transparent">
              <TableHead className="text-muted-foreground font-medium">Usuário</TableHead>
              <TableHead className="text-muted-foreground font-medium">Papel</TableHead>
              <TableHead className="text-muted-foreground font-medium">Módulos</TableHead>
              <TableHead className="text-muted-foreground font-medium">Cadastro</TableHead>
              <TableHead className="text-right text-muted-foreground font-medium">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" />
                </TableCell>
              </TableRow>
            ) : filteredUsers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                  Nenhum usuário encontrado.
                </TableCell>
              </TableRow>
            ) : (
              filteredUsers.map(u => (
                <AnimatePresence key={u.user_id} mode="popLayout">
                  <TableRow 
                    className={`border-white/5 cursor-pointer transition-colors ${
                      expandedUser === u.user_id ? "bg-white/5" : "hover:bg-white/[0.02]"
                    }`}
                    onClick={() => handleExpand(u.user_id)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-xs">
                          {(u.display_name || u.email).substring(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-white truncate">{u.display_name || "Sem nome"}</p>
                          <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {u.is_admin ? (
                        <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30 font-normal">
                          Admin
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground border-white/10 font-normal">
                          Usuário
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="bg-white/5 text-white/70 font-normal">
                        {u.modulos_count} ativos
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(u.created_at).toLocaleDateString("pt-BR")}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2" onClick={e => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-white"
                          onClick={() => toggleAdmin(u)}
                          disabled={u.user_id === currentUser?.id}
                          title={u.is_admin ? "Remover admin" : "Tornar admin"}
                        >
                          {u.is_admin ? <ShieldOff className="h-4 w-4" /> : <Shield className="h-4 w-4" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-white"
                          onClick={() => handleExpand(u.user_id)}
                        >
                          {expandedUser === u.user_id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  {expandedUser === u.user_id && (
                    <TableRow className="border-white/5 bg-white/[0.03] hover:bg-white/[0.03]">
                      <TableCell colSpan={5} className="p-0">
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="p-6 grid grid-cols-2 sm:grid-cols-4 gap-4">
                            {modulosLoading ? (
                              <div className="col-span-full py-8 text-center">
                                <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" />
                              </div>
                            ) : (
                              todosModulos.map(m => (
                                <div key={m.key} className="flex items-center justify-between p-2 rounded border border-white/5 bg-black/20">
                                  <Label htmlFor={`mod-${u.user_id}-${m.key}`} className="text-xs cursor-pointer flex-1 truncate pr-2 text-white/70">
                                    {m.label}
                                  </Label>
                                  {salvandoModulo === m.key ? (
                                    <Loader2 className="h-3 w-3 animate-spin text-primary" />
                                  ) : (
                                    <Switch
                                      id={`mod-${u.user_id}-${m.key}`}
                                      checked={userModulos[m.key] ?? false}
                                      onCheckedChange={v => toggleModulo(u.user_id, m.key, v)}
                                      className="scale-75 origin-right"
                                    />
                                  )}
                                </div>
                              ))
                            )}
                          </div>
                        </motion.div>
                      </TableCell>
                    </TableRow>
                  )}
                </AnimatePresence>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
