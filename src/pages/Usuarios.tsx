import { useEffect, useState } from "react";
import { CRMLayout } from "@/components/CRMLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { Shield, ShieldOff, Loader2, Users } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

interface UserRow {
  user_id: string;
  email: string;
  display_name: string | null;
  created_at: string;
  is_admin: boolean;
}

export default function UsuariosPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data: profiles } = await supabase.from("profiles").select("user_id, email, display_name, created_at").order("created_at", { ascending: false });
    const { data: roles } = await supabase.from("user_roles").select("user_id, role");
    const adminSet = new Set((roles ?? []).filter((r) => r.role === "admin").map((r) => r.user_id));
    setUsers((profiles ?? []).map((p) => ({ ...p, is_admin: adminSet.has(p.user_id) })));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const toggleAdmin = async (u: UserRow) => {
    if (u.is_admin) {
      const { error } = await supabase.from("user_roles").delete().eq("user_id", u.user_id).eq("role", "admin");
      if (error) return toast.error(error.message);
      toast.success(`${u.email} não é mais admin`);
    } else {
      const { error } = await supabase.from("user_roles").insert({ user_id: u.user_id, role: "admin" });
      if (error) return toast.error(error.message);
      toast.success(`${u.email} agora é admin`);
    }
    load();
  };

  return (
    <CRMLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3"><Users className="h-8 w-8 text-primary" /> Usuários</h1>
          <p className="text-muted-foreground mt-1">Gerencie quem tem acesso e quem é administrador</p>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-lg">{users.length} usuários cadastrados</CardTitle></CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
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
                  {users.map((u) => (
                    <TableRow key={u.user_id}>
                      <TableCell className="font-medium">
                        <div>{u.display_name ?? "—"}</div>
                        <div className="sm:hidden text-xs text-muted-foreground truncate max-w-[140px]">{u.email}</div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">{u.email}</TableCell>
                      <TableCell>
                        {u.is_admin ? <Badge className="bg-primary/15 text-primary border-0">Admin</Badge> : <Badge variant="secondary">Usuário</Badge>}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-muted-foreground text-sm">{new Date(u.created_at).toLocaleDateString("pt-BR")}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" onClick={() => toggleAdmin(u)} disabled={u.user_id === currentUser?.id}>
                          {u.is_admin ? <><ShieldOff className="h-4 w-4 sm:mr-1" /><span className="hidden sm:inline">Remover admin</span></> : <><Shield className="h-4 w-4 sm:mr-1" /><span className="hidden sm:inline">Tornar admin</span></>}
                        </Button>
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
    </CRMLayout>
  );
}
