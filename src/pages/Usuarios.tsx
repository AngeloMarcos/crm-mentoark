import { useEffect, useState } from "react";
import { getAuthToken } from "@/lib/api-token";
import { CRMLayout } from "@/components/CRMLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Users, UserPlus, Pencil, Trash2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

const API_BASE = (import.meta.env.VITE_API_URL as string) || "https://api.mentoark.com.br";
const token = () => getAuthToken();

interface UserRow {
  user_id: string;
  email: string;
  display_name: string | null;
  cargo_nome: string | null;
  active: boolean;
  created_at: string;
  modulos: string[];
}

export default function UsuariosPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const load = async () => {
    setLoading(true);
    const r = await fetch(`${API_BASE}/api/profiles?search=${encodeURIComponent(search)}`, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    if (r.ok) {
      const data = await r.json();
      setUsers(data);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [search]);

  return (
    <CRMLayout>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Gerenciar Usuários</h1>
            <p className="text-muted-foreground">Adicione, edite e gerencie os membros da sua equipe</p>
          </div>
          <Button className="bg-primary hover:bg-primary/90 gap-2">
            <UserPlus className="h-4 w-4" /> Adicionar Novo Usuário
          </Button>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <CardTitle className="text-lg">Lista de Usuários</CardTitle>
            <div className="relative w-64">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Buscar por nome ou e-mail..." 
                className="pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-8"><Loader2 className="animate-spin" /></div>
            ) : (
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
                          <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center font-bold">
                            {(u.display_name?.[0] || u.email[0]).toUpperCase()}
                          </div>
                          <div>
                            <div>{u.display_name}</div>
                            <div className="text-xs text-muted-foreground">{u.email}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{u.cargo_nome || "—"}</TableCell>
                      <TableCell>{u.modulos?.join(', ') || "—"}</TableCell>
                      <TableCell>
                        <Badge variant={u.active ? "default" : "secondary"} className={u.active ? "bg-green-600" : ""}>
                          {u.active ? "Ativo" : "Inativo"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button variant="ghost" size="icon"><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="text-destructive"><Trash2 className="h-4 w-4" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </CRMLayout>
  );
}
