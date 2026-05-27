import { useEffect, useMemo, useState } from "react";
import { CRMLayout } from "@/components/CRMLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Users, Shield, UserPlus, Copy, Trash2, Plus } from "lucide-react";

const API_BASE = (import.meta.env.VITE_API_URL as string) || "https://api.mentoark.com.br";

function authHeaders(): HeadersInit {
  const t = localStorage.getItem("access_token");
  return t
    ? { "Content-Type": "application/json", Authorization: `Bearer ${t}` }
    : { "Content-Type": "application/json" };
}

async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers: { ...authHeaders(), ...(init.headers || {}) } });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.message || `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as any;
  return res.json();
}

// ── Tipos ─────────────────────────────────────────────────────
interface Role {
  id: string;
  nome: string;
  cor: string;
  descricao?: string;
  is_system: boolean;
  permissions: { modulo: string; acao: string }[];
}
interface Member {
  id: string;
  email: string;
  nome: string;
  cargo?: string;
  avatar_url?: string;
  status: "convidado" | "ativo" | "inativo";
  convite_token?: string;
  roles: { id: string; nome: string; cor: string }[];
}

const MODULOS = [
  { key: "leads", label: "Leads" },
  { key: "funil", label: "Funil" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "disparos", label: "Disparos" },
  { key: "campanhas", label: "Campanhas" },
  { key: "integracoes", label: "Integrações" },
  { key: "equipe", label: "Equipe" },
  { key: "chat", label: "Chat" },
  { key: "relatorios", label: "Relatórios" },
  { key: "configuracoes", label: "Configurações" },
];
const ACOES = ["view", "create", "edit", "delete", "manage"] as const;

// ─────────────────────────────────────────────────────────────
export default function EquipePage() {
  return (
    <CRMLayout>
      <div className="p-6 space-y-6">
        <header className="flex items-center gap-3">
          <Users className="w-7 h-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Equipe</h1>
            <p className="text-sm text-muted-foreground">Pessoas, perfis e permissões do seu workspace.</p>
          </div>
        </header>

        <Tabs defaultValue="pessoas" className="w-full">
          <TabsList>
            <TabsTrigger value="pessoas"><Users className="w-4 h-4 mr-2" />Pessoas</TabsTrigger>
            <TabsTrigger value="perfis"><Shield className="w-4 h-4 mr-2" />Perfis & permissões</TabsTrigger>
          </TabsList>
          <TabsContent value="pessoas"><PessoasTab /></TabsContent>
          <TabsContent value="perfis"><PerfisTab /></TabsContent>
        </Tabs>
      </div>
    </CRMLayout>
  );
}

// ───────────────────────── PESSOAS ───────────────────────────
function PessoasTab() {
  const [members, setMembers] = useState<Member[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [m, r] = await Promise.all([api<Member[]>("/api/team/members"), api<Role[]>("/api/team/roles")]);
      setMembers(m);
      setRoles(r);
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => { setEditing(null); setOpen(true); }}>
          <UserPlus className="w-4 h-4 mr-2" />Convidar pessoa
        </Button>
      </div>

      <Card className="overflow-hidden">
        <div className="grid grid-cols-12 gap-3 px-4 py-2 text-xs font-medium text-muted-foreground border-b">
          <div className="col-span-4">Pessoa</div>
          <div className="col-span-2">Cargo</div>
          <div className="col-span-3">Perfis</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-1 text-right">Ações</div>
        </div>
        {loading && <div className="p-6 text-sm text-muted-foreground">Carregando...</div>}
        {!loading && members.length === 0 && (
          <div className="p-6 text-sm text-muted-foreground">Nenhuma pessoa cadastrada ainda. Clique em "Convidar pessoa".</div>
        )}
        {members.map((m) => (
          <div key={m.id} className="grid grid-cols-12 gap-3 px-4 py-3 border-b items-center hover:bg-muted/30">
            <div className="col-span-4 flex items-center gap-3 min-w-0">
              <Avatar className="h-9 w-9">
                {m.avatar_url && <AvatarImage src={m.avatar_url} />}
                <AvatarFallback>{m.nome.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{m.nome}</div>
                <div className="text-xs text-muted-foreground truncate">{m.email}</div>
              </div>
            </div>
            <div className="col-span-2 text-sm">{m.cargo || "—"}</div>
            <div className="col-span-3 flex flex-wrap gap-1">
              {m.roles.length === 0 && <span className="text-xs text-muted-foreground">Sem perfil</span>}
              {m.roles.map((r) => (
                <Badge key={r.id} variant="secondary" style={{ backgroundColor: r.cor + "22", color: r.cor, borderColor: r.cor + "55" }}>
                  {r.nome}
                </Badge>
              ))}
            </div>
            <div className="col-span-2">
              <StatusBadge status={m.status} />
            </div>
            <div className="col-span-1 flex justify-end gap-1">
              {m.status === "convidado" && m.convite_token && (
                <Button size="icon" variant="ghost" onClick={() => copyInvite(m.convite_token!)} title="Copiar link de convite">
                  <Copy className="w-4 h-4" />
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => { setEditing(m); setOpen(true); }}>Editar</Button>
            </div>
          </div>
        ))}
      </Card>

      <MemberDialog
        open={open}
        onClose={() => setOpen(false)}
        roles={roles}
        member={editing}
        onSaved={load}
      />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    ativo:     { label: "Ativo",     cls: "bg-green-500/15 text-green-500 border-green-500/30" },
    convidado: { label: "Convidado", cls: "bg-amber-500/15 text-amber-500 border-amber-500/30" },
    inativo:   { label: "Inativo",   cls: "bg-muted text-muted-foreground border-muted-foreground/20" },
  };
  const s = map[status] || map.inativo;
  return <Badge variant="outline" className={s.cls}>{s.label}</Badge>;
}

function copyInvite(token: string) {
  const url = `${window.location.origin}/convite/${token}`;
  navigator.clipboard.writeText(url);
  toast.success("Link de convite copiado");
}

function MemberDialog({ open, onClose, roles, member, onSaved }: {
  open: boolean; onClose: () => void; roles: Role[]; member: Member | null; onSaved: () => void;
}) {
  const [form, setForm] = useState({ email: "", nome: "", cargo: "", role_ids: [] as string[] });
  const [saving, setSaving] = useState(false);
  const isEdit = !!member;

  useEffect(() => {
    if (open) {
      setForm({
        email: member?.email || "",
        nome: member?.nome || "",
        cargo: member?.cargo || "",
        role_ids: member?.roles.map(r => r.id) || [],
      });
    }
  }, [open, member]);

  const toggleRole = (id: string) => {
    setForm(f => ({ ...f, role_ids: f.role_ids.includes(id) ? f.role_ids.filter(x => x !== id) : [...f.role_ids, id] }));
  };

  const save = async () => {
    if (!form.email || !form.nome) { toast.error("Email e nome são obrigatórios"); return; }
    setSaving(true);
    try {
      if (isEdit) {
        await api(`/api/team/members/${member!.id}`, { method: "PATCH", body: JSON.stringify({
          nome: form.nome, cargo: form.cargo, role_ids: form.role_ids,
        })});
        toast.success("Pessoa atualizada");
      } else {
        const r = await api<any>("/api/team/members", { method: "POST", body: JSON.stringify(form) });
        toast.success("Convite criado");
        if (r.invite_url) {
          navigator.clipboard.writeText(r.invite_url);
          toast.message("Link copiado", { description: r.invite_url });
        }
      }
      onSaved(); onClose();
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const remove = async () => {
    if (!member) return;
    if (!confirm("Remover esta pessoa da equipe?")) return;
    try {
      await api(`/api/team/members/${member.id}`, { method: "DELETE" });
      toast.success("Pessoa removida");
      onSaved(); onClose();
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar pessoa" : "Convidar pessoa"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Nome</Label>
              <Input value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} />
            </div>
            <div>
              <Label>Email</Label>
              <Input type="email" value={form.email} disabled={isEdit} onChange={e => setForm({ ...form, email: e.target.value })} />
            </div>
          </div>
          <div>
            <Label>Cargo</Label>
            <Input placeholder="Ex: SDR, Closer, Gerente" value={form.cargo} onChange={e => setForm({ ...form, cargo: e.target.value })} />
          </div>
          <div>
            <Label>Perfis</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {roles.map(r => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => toggleRole(r.id)}
                  className={`text-xs px-3 py-1 rounded-full border transition ${
                    form.role_ids.includes(r.id) ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"
                  }`}
                  style={form.role_ids.includes(r.id) ? { color: r.cor, borderColor: r.cor } : {}}
                >
                  {r.nome}
                </button>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter className="flex sm:justify-between">
          {isEdit ? (
            <Button variant="ghost" className="text-destructive" onClick={remove}>
              <Trash2 className="w-4 h-4 mr-2" />Remover
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>{isEdit ? "Salvar" : "Convidar"}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────── PERFIS ────────────────────────────
function PerfisTab() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [newOpen, setNewOpen] = useState(false);
  const [newRole, setNewRole] = useState({ nome: "", cor: "#3b82f6", descricao: "" });

  const load = async () => {
    setLoading(true);
    try {
      const r = await api<Role[]>("/api/team/roles");
      setRoles(r);
      if (!selectedId && r.length) setSelectedId(r[0].id);
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const selected = useMemo(() => roles.find(r => r.id === selectedId), [roles, selectedId]);

  const createRole = async () => {
    if (!newRole.nome) { toast.error("Nome obrigatório"); return; }
    try {
      const r = await api<Role>("/api/team/roles", { method: "POST", body: JSON.stringify(newRole) });
      toast.success("Perfil criado");
      setNewOpen(false);
      setNewRole({ nome: "", cor: "#3b82f6", descricao: "" });
      await load();
      setSelectedId(r.id);
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="grid grid-cols-12 gap-4">
      <Card className="col-span-12 md:col-span-4 p-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold">Perfis</h3>
          <Button size="sm" variant="ghost" onClick={() => setNewOpen(true)}><Plus className="w-4 h-4" /></Button>
        </div>
        {loading && <div className="text-sm text-muted-foreground p-2">Carregando...</div>}
        <div className="space-y-1">
          {roles.map(r => (
            <button
              key={r.id}
              onClick={() => setSelectedId(r.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition ${
                selectedId === r.id ? "bg-primary/10" : "hover:bg-muted"
              }`}
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: r.cor }} />
              <span className="flex-1 text-sm">{r.nome}</span>
              {r.is_system && <Badge variant="outline" className="text-[10px]">sistema</Badge>}
            </button>
          ))}
        </div>
      </Card>

      <Card className="col-span-12 md:col-span-8 p-4">
        {selected ? <PermissionsMatrix role={selected} onChanged={load} /> : (
          <div className="text-sm text-muted-foreground">Selecione um perfil.</div>
        )}
      </Card>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Novo perfil</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Nome</Label>
              <Input value={newRole.nome} onChange={e => setNewRole({ ...newRole, nome: e.target.value })} placeholder="Ex: Closer" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Cor</Label>
                <Input type="color" value={newRole.cor} onChange={e => setNewRole({ ...newRole, cor: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Descrição</Label>
              <Textarea value={newRole.descricao} onChange={e => setNewRole({ ...newRole, descricao: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>Cancelar</Button>
            <Button onClick={createRole}>Criar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PermissionsMatrix({ role, onChanged }: { role: Role; onChanged: () => void }) {
  const initial = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const p of role.permissions) {
      if (!map.has(p.modulo)) map.set(p.modulo, new Set());
      map.get(p.modulo)!.add(p.acao);
    }
    return map;
  }, [role]);

  const [matrix, setMatrix] = useState<Map<string, Set<string>>>(initial);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setMatrix(initial); }, [initial]);

  const isLocked = role.nome === "Owner";

  const toggle = (modulo: string, acao: string) => {
    if (isLocked) return;
    setMatrix(prev => {
      const next = new Map(prev);
      const set = new Set(next.get(modulo) || []);
      if (set.has(acao)) set.delete(acao); else set.add(acao);
      next.set(modulo, set);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const permissions: any[] = [];
      matrix.forEach((set, modulo) => set.forEach(acao => permissions.push({ modulo, acao })));
      await api(`/api/team/roles/${role.id}/permissions`, { method: "PUT", body: JSON.stringify({ permissions }) });
      toast.success("Permissões salvas");
      onChanged();
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const removeRole = async () => {
    if (!confirm(`Remover o perfil "${role.nome}"?`)) return;
    try {
      await api(`/api/team/roles/${role.id}`, { method: "DELETE" });
      toast.success("Perfil removido");
      onChanged();
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: role.cor }} />
            <h3 className="text-lg font-semibold">{role.nome}</h3>
            {role.is_system && <Badge variant="outline" className="text-[10px]">sistema</Badge>}
          </div>
          {role.descricao && <p className="text-sm text-muted-foreground mt-1">{role.descricao}</p>}
          {isLocked && <p className="text-xs text-muted-foreground mt-1">Owner tem acesso total e não pode ser alterado.</p>}
        </div>
        <div className="flex gap-2">
          {!role.is_system && <Button variant="ghost" className="text-destructive" onClick={removeRole}><Trash2 className="w-4 h-4 mr-2" />Remover</Button>}
          {!isLocked && <Button onClick={save} disabled={saving}>Salvar permissões</Button>}
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Módulo</th>
              {ACOES.map(a => <th key={a} className="px-3 py-2 font-medium text-center capitalize">{a}</th>)}
            </tr>
          </thead>
          <tbody>
            {MODULOS.map(m => (
              <tr key={m.key} className="border-t">
                <td className="px-3 py-2">{m.label}</td>
                {ACOES.map(a => (
                  <td key={a} className="px-3 py-2 text-center">
                    <Checkbox
                      checked={matrix.get(m.key)?.has(a) || false}
                      disabled={isLocked}
                      onCheckedChange={() => toggle(m.key, a)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
