import { useState, useEffect } from "react";
import { CRMLayout } from "@/components/CRMLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { 
  Users, UserPlus, Trash2, Pencil, Check, X, MessageSquare, 
  Settings2, Copy, RefreshCw, Shield, LayoutGrid, MessageCircle, 
  UserPlus2, Users2, BarChart3, Send, Loader2, Search
} from "lucide-react";
import { useEquipe, type Membro } from "@/hooks/useEquipe";
import { useAuth } from "@/hooks/useAuth";
import { ChatEquipe } from "@/components/equipe/ChatEquipe";
import { api } from "@/integrations/database/client";
import { cn } from "@/lib/utils";

function iniciais(nome?: string, email?: string) {
  const base = (nome || email || "?").trim();
  const parts = base.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

export default function EquipePage() {
  const { user } = useAuth();
  const { equipe, membros, loading, criarEquipe, adicionarMembro, removerMembro } = useEquipe();

  if (loading) {
    return (
      <CRMLayout>
        <div className="p-6 text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando equipe...
        </div>
      </CRMLayout>
    );
  }

  return (
    <CRMLayout>
      <div className="p-6">
        {!equipe ? (
          <Onboarding onCreate={criarEquipe} />
        ) : (
          <Tabs defaultValue="geral" className="space-y-6">
            <div className="flex items-center justify-between">
              <TabsList>
                <TabsTrigger value="geral" className="gap-2">
                  <Users2 className="w-4 h-4" /> Geral
                </TabsTrigger>
                {(user?.role === 'admin' || user?.role === 'gerente') && (
                  <TabsTrigger value="membros" className="gap-2">
                    <UserPlus2 className="w-4 h-4" /> Membros
                  </TabsTrigger>
                )}
              </TabsList>
            </div>

            <TabsContent value="geral">
              <Painel
                equipe={equipe}
                membros={membros}
                onAdicionar={adicionarMembro}
                onRemover={removerMembro}
              />
            </TabsContent>

            <TabsContent value="membros">
              <GestaoMembros />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </CRMLayout>
  );
}

function Onboarding({ onCreate }: { onCreate: (nome: string) => Promise<any> }) {
  const [nome, setNome] = useState("");
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!nome.trim()) {
      toast.error("Digite o nome da equipe");
      return;
    }
    setSaving(true);
    try {
      await onCreate(nome.trim());
      toast.success("Equipe criada com sucesso!");
    } catch (e: any) {
      toast.error(e.message || "Erro ao criar equipe");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <Card className="w-full max-w-md p-8 space-y-6">
        <div className="text-center space-y-2">
          <div className="mx-auto w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
            <Users className="w-7 h-7 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">Crie sua equipe</h1>
          <p className="text-sm text-muted-foreground">
            Convide colegas e gerencie sua equipe em um só lugar
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="nome-equipe">Nome da equipe</Label>
          <Input
            id="nome-equipe"
            placeholder="Ex: Imobiliária Santos"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            autoFocus
          />
        </div>

        <Button className="w-full" onClick={handleCreate} disabled={saving}>
          {saving ? "Criando..." : "Criar Equipe"}
        </Button>
      </Card>
    </div>
  );
}

function Painel({
  equipe,
  membros,
  onAdicionar,
  onRemover,
}: {
  equipe: { id: string; nome: string; owner_id: string };
  membros: Membro[];
  onAdicionar: (userId: string, role: string) => Promise<void>;
  onRemover: (userId: string) => Promise<void>;
}) {
  const { user, session } = useAuth();
  const isOwner = user?.id === equipe.owner_id;
  const [conviteOpen, setConviteOpen] = useState(false);

  const API_BASE = (import.meta.env.VITE_API_URL as string) || "https://api.mentoark.com.br";

  const [editingNome, setEditingNome] = useState(false);
  const [nomeLocal, setNomeLocal] = useState(equipe.nome);
  const [savingNome, setSavingNome] = useState(false);

  const salvarNome = async () => {
    if (!nomeLocal.trim() || nomeLocal === equipe.nome) {
      setEditingNome(false);
      setNomeLocal(equipe.nome);
      return;
    }
    setSavingNome(true);
    try {
      const res = await fetch(`${API_BASE}/api/equipes/${equipe.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ nome: nomeLocal.trim() }),
      });
      if (!res.ok) throw new Error("Erro ao atualizar nome");
      equipe.nome = nomeLocal.trim();
      toast.success("Nome atualizado");
      setEditingNome(false);
    } catch (e: any) {
      toast.error(e.message);
      setNomeLocal(equipe.nome);
    } finally {
      setSavingNome(false);
    }
  };

  const mudarRole = async (userId: string, role: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/equipes/${equipe.id}/membros/${userId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) throw new Error("Erro ao atualizar papel");
      toast.success("Papel atualizado");
      window.location.reload();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const removerComConfirm = async (m: Membro) => {
    if (!confirm(`Remover ${m.display_name || m.email} da equipe?`)) return;
    try {
      await onRemover(m.user_id);
      toast.success("Membro removido");
    } catch (e: any) {
      toast.error(e.message || "Erro ao remover");
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <Users className="w-7 h-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Equipe</h1>
          <p className="text-sm text-muted-foreground">
            Gerencie membros e converse com seu time
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between gap-2 pb-3 border-b">
            {editingNome ? (
              <div className="flex items-center gap-2 flex-1">
                <Input
                  value={nomeLocal}
                  onChange={(e) => setNomeLocal(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && salvarNome()}
                  autoFocus
                  disabled={savingNome}
                />
                <Button size="icon" variant="ghost" onClick={salvarNome} disabled={savingNome}>
                  <Check className="w-4 h-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    setEditingNome(false);
                    setNomeLocal(equipe.nome);
                  }}
                  disabled={savingNome}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <>
                <h2 className="text-lg font-semibold truncate">{equipe.nome}</h2>
                {isOwner && (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setEditingNome(true)}
                    title="Editar nome"
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                )}
              </>
            )}
          </div>

          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-muted-foreground">
              Membros ({membros.length})
            </h3>
            <Button size="sm" onClick={() => setConviteOpen(true)}>
              <UserPlus className="w-4 h-4 mr-2" />
              Adicionar Corretor
            </Button>
          </div>

          <div className="space-y-2">
            {membros.length === 0 && (
              <div className="text-sm text-muted-foreground py-4 text-center">
                Nenhum membro ainda. Convide alguém para começar.
              </div>
            )}
            {membros.map((m) => {
              const isOwnerMembro = m.user_id === equipe.owner_id;
              return (
                <div
                  key={m.user_id}
                  className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/30 transition"
                >
                  <Avatar className="h-10 w-10">
                    <AvatarFallback>{iniciais(m.display_name, m.email)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {m.display_name || m.email}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{m.email}</div>
                  </div>

                  {isOwner && !isOwnerMembro ? (
                    <Select
                      value={m.role}
                      onValueChange={(v) => mudarRole(m.user_id, v)}
                    >
                      <SelectTrigger className="w-32 h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="membro">Membro</SelectItem>
                        <SelectItem value="gerente">Gerente</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge variant={m.role === "gerente" ? "default" : "secondary"}>
                      {m.role === "gerente" ? "Gerente" : "Membro"}
                    </Badge>
                  )}

                  {isOwner && !isOwnerMembro && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => removerComConfirm(m)}
                      title="Remover"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="p-5 flex flex-col min-h-[400px]">
          <div className="flex items-center gap-2 pb-3 border-b mb-4">
            <MessageSquare className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Chat da Equipe</h2>
          </div>
          <ChatEquipe equipeId={equipe.id} />
        </Card>
      </div>

      <AdicionarCorretorDialog
        open={conviteOpen}
        equipe={equipe}
        onClose={() => setConviteOpen(false)}
        onAdd={onAdicionar}
        membrosAtuais={membros}
      />
    </div>
  );
}

function AdicionarCorretorDialog({
  equipe,
  onClose,
  onAdd,
  membrosAtuais,
}: {
  open: boolean;
  equipe: { id: string } | null;
  onClose: () => void;
  onAdd: (userId: string, role: string) => Promise<void>;
  membrosAtuais: Membro[];
}) {
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("membro");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const fetchProfiles = async () => {
    setLoading(true);
    try {
      const API_BASE = (import.meta.env.VITE_API_URL as string) || "https://api.mentoark.com.br";
      const token = localStorage.getItem('access_token');
      
      const res = await fetch(`${API_BASE}/api/equipes/${equipe?.id}/membros-disponiveis`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Erro ao buscar corretores disponíveis");
      const data = await res.json();
      
      setProfiles(data || []);
    } catch (e) {
      console.error("Erro ao buscar perfis", e);
      toast.error("Erro ao carregar lista de corretores");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      fetchProfiles();
      setSearch("");
      setSelectedIds([]);
      setRole("membro");
    }
  }, [open]);

  const filteredProfiles = profiles.filter((p) => {
    const term = search.toLowerCase();
    return (
      (p.display_name?.toLowerCase().includes(term) || false) ||
      p.email.toLowerCase().includes(term)
    );
  });

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleAdd = async () => {
    if (selectedIds.length === 0) return;
    setSaving(true);
    try {
      for (const userId of selectedIds) {
        await onAdd(userId, role);
      }
      toast.success(`${selectedIds.length} membro(s) adicionado(s)`);
      onClose();
    } catch (e: any) {
      toast.error(e.message || "Erro ao adicionar membros");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Adicionar Corretor à Equipe</DialogTitle>
          <DialogDescription>
            Selecione um ou mais corretores para adicionar ao seu time.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome ou email..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="border rounded-md overflow-hidden bg-muted/20">
            <div className="max-h-[300px] overflow-y-auto">
              {loading ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin mx-auto mb-2" />
                  Carregando corretores...
                </div>
              ) : filteredProfiles.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  {profiles.length === 0 ? (
                    <>
                      Nenhum corretor disponível.<br />
                      Cadastre usuários primeiro em Gerenciar Usuários.
                    </>
                  ) : (
                    "Nenhum usuário encontrado para esta busca."
                  )}
                </div>
              ) : (
                <div className="divide-y">
                  {filteredProfiles.map((p) => (
                    <div
                      key={p.user_id}
                      className={cn(
                        "flex items-center gap-3 p-3 hover:bg-muted/50 transition cursor-pointer",
                        selectedIds.includes(p.user_id) && "bg-primary/5"
                      )}
                      onClick={() => toggleSelect(p.user_id)}
                    >
                      <Checkbox
                        checked={selectedIds.includes(p.user_id)}
                        onCheckedChange={() => toggleSelect(p.user_id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="text-[10px]">
                          {iniciais(p.display_name || "", p.email)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">
                          {p.display_name || "Sem nome"}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {p.email}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Papel na equipe (aplica a todos os selecionados)</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="membro">Membro</SelectItem>
                <SelectItem value="gerente">Gerente</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button 
            onClick={handleAdd} 
            disabled={saving || selectedIds.length === 0}
            className="gap-2"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <UserPlus className="w-4 h-4" />
            )}
            Adicionar Selecionados ({selectedIds.length})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────
// GESTÃO DE MEMBROS (USUÁRIOS CRIADOS PELO ADMIN)
// ─────────────────────────────────────────────────────────────
interface Profile {
  user_id: string;
  email: string;
  display_name: string | null;
  role: string;
  active: boolean;
  created_at: string;
  modulos: string[];
}

function GestaoMembros() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalAdicionar, setModalAdicionar] = useState(false);
  const [modalPermissoes, setModalPermissoes] = useState<Profile | null>(null);

  const carregar = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/api/profiles");
      setProfiles(data || []);
    } catch (err) {
      console.error("Erro ao carregar perfis", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregar();
  }, []);

  const MODULOS_DISPONIVEIS = [
    { id: "dashboard", label: "Dashboard", icon: LayoutGrid, color: "text-blue-500" },
    { id: "leads", label: "Leads", icon: Send, color: "text-indigo-500" },
    { id: "whatsapp", label: "WhatsApp", icon: MessageCircle, color: "text-green-500" },
    { id: "kanban", label: "Kanban", icon: LayoutGrid, color: "text-orange-500" },
    { id: "contatos", label: "Contatos", icon: Users, color: "text-purple-500" },
    { id: "relatorios", label: "Relatórios", icon: BarChart3, color: "text-cyan-500" },
    { id: "disparos", label: "Disparos", icon: Send, color: "text-sky-500" },
  ];

  const handleToggleAtivo = async (id: string, ativo: boolean) => {
    try {
      await api.patch(`/api/profiles/${id}`, { active: ativo });
      setProfiles(prev => prev.map(p => p.user_id === id ? { ...p, active: ativo } : p));
      toast.success(ativo ? "Acesso ativado" : "Acesso desativado");
    } catch (err: any) {
      toast.error(err.message || "Erro ao alterar status");
    }
  };

  const handleExcluir = async (userId: string) => {
    if (!confirm("Excluir este usuário permanentemente?")) return;
    try {
      await api.delete(`/api/profiles/${userId}`);
      setProfiles(prev => prev.filter(p => p.user_id !== userId));
      toast.success("Usuário excluído");
    } catch (err: any) {
      toast.error(err.message || "Erro ao excluir");
    }
  };

  const handleSaveModulos = async (userId: string, modulos: string[]) => {
    const API_BASE = (import.meta.env.VITE_API_URL as string) || "https://api.mentoark.com.br";
    const token = localStorage.getItem('access_token');
    
    try {
      const r = await fetch(`${API_BASE}/api/modulos/usuario/${userId}`, {
        method: "PUT",
        headers: { 
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ modulos }),
      });
      if (!r.ok) throw new Error("Erro ao salvar permissões");
      
      setProfiles(prev => prev.map(p => p.user_id === userId ? { ...p, modulos } : p));
      toast.success("Permissões atualizadas");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Corretores e Membros</h2>
          <p className="text-sm text-muted-foreground">Gerencie os acessos que você criou</p>
        </div>
        <Button onClick={() => setModalAdicionar(true)} className="gap-2">
          <UserPlus2 className="w-4 h-4" /> Adicionar Corretor
        </Button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          <div className="col-span-full py-20 text-center text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
            Carregando membros...
          </div>
        ) : profiles.length === 0 ? (
          <div className="col-span-full py-20 text-center text-muted-foreground border-2 border-dashed rounded-lg">
            Nenhum corretor cadastrado ainda.
          </div>
        ) : (
          profiles.map((p) => (
            <Card key={p.user_id} className={cn("p-4 space-y-4", !p.active && "opacity-60 grayscale")}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar className="h-10 w-10 border-2 border-primary/20">
                    <AvatarFallback className="bg-primary/10 text-primary">
                      {iniciais(p.display_name || "", p.email)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold truncate">{p.display_name || "Sem nome"}</h3>
                    <p className="text-xs text-muted-foreground truncate">{p.email}</p>
                  </div>
                </div>
                <Switch 
                  checked={p.active} 
                  onCheckedChange={(v) => handleToggleAtivo(p.user_id, v)}
                />
              </div>

              <div className="flex flex-wrap gap-1.5">
                {(p.modulos || []).map((m) => (
                  <Badge key={m} variant="secondary" className="text-[10px] capitalize px-1.5 py-0 h-5">
                    {m}
                  </Badge>
                ))}
                {(!p.modulos || p.modulos.length === 0) && (
                  <span className="text-[10px] text-muted-foreground italic">Sem módulos</span>
                )}
              </div>

              <div className="flex items-center justify-between pt-2 border-t">
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="text-xs h-8 gap-1.5"
                  onClick={() => setModalPermissoes(p)}
                >
                  <Settings2 className="w-3.5 h-3.5" /> Permissões
                </Button>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="text-xs h-8 text-destructive hover:text-destructive gap-1.5"
                  onClick={() => handleExcluir(p.user_id)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </Card>
          ))
        )}
      </div>

      <ModalAdicionarCorretor 
        open={modalAdicionar} 
        onClose={() => setModalAdicionar(false)} 
        onSuccess={carregar} 
      />

      {modalPermissoes && (
        <ModalPermissoes 
          profile={modalPermissoes} 
          modulosDisponiveis={MODULOS_DISPONIVEIS}
          onClose={() => setModalPermissoes(null)} 
          onSave={handleSaveModulos}
        />
      )}
    </div>
  );
}

function ModalAdicionarCorretor({ open, onClose, onSuccess }: { open: boolean, onClose: () => void, onSuccess: () => void }) {
  const [form, setForm] = useState({
    nome: "",
    email: "",
    senha: "",
  });
  const [saving, setSaving] = useState(false);

  const handleSalvar = async () => {
    if (!form.nome || !form.email || !form.senha) {
      toast.error("Preencha todos os campos");
      return;
    }
    setSaving(true);
    try {
      await api.post("/api/profiles", {
        display_name: form.nome,
        email: form.email,
        password: form.senha
      });
      toast.success("Corretor criado e adicionado à equipe!");
      onSuccess();
      onClose();
      setForm({ nome: "", email: "", senha: "" });
    } catch (err: any) {
      toast.error(err.message || "Erro ao criar corretor");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adicionar Corretor</DialogTitle>
          <DialogDescription>
            Crie um novo acesso. Ele terá acesso aos módulos Dashboard, Leads e WhatsApp por padrão.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Nome Completo</Label>
            <Input 
              placeholder="Ex: João Silva" 
              value={form.nome} 
              onChange={e => setForm({...form, nome: e.target.value})}
            />
          </div>
          <div className="space-y-2">
            <Label>E-mail</Label>
            <Input 
              type="email" 
              placeholder="joao@exemplo.com" 
              value={form.email} 
              onChange={e => setForm({...form, email: e.target.value})}
            />
          </div>
          <div className="space-y-2">
            <Label>Senha de Acesso</Label>
            <div className="flex gap-2">
              <Input 
                type="text" 
                placeholder="Mínimo 6 caracteres" 
                value={form.senha} 
                onChange={e => setForm({...form, senha: e.target.value})}
              />
              <Button variant="outline" size="icon" onClick={() => setForm({...form, senha: Math.random().toString(36).slice(-8)})} title="Gerar senha">
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSalvar} disabled={saving}>
            {saving ? "Salvando..." : "Criar e Adicionar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModalPermissoes({ 
  profile, 
  modulosDisponiveis, 
  onClose, 
  onSave 
}: { 
  profile: Profile, 
  modulosDisponiveis: any[], 
  onClose: () => void, 
  onSave: (id: string, mods: string[]) => Promise<void> 
}) {
  const [selecionados, setSelecionados] = useState<string[]>(profile.modulos || []);
  const [saving, setSaving] = useState(false);

  const toggle = (id: string) => {
    setSelecionados(prev => prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]);
  };

  const handleSave = async () => {
    setSaving(true);
    await onSave(profile.user_id, selecionados);
    setSaving(false);
    onClose();
  };

  return (
    <Dialog open={true} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Permissões de {profile.display_name || profile.email}</DialogTitle>
          <DialogDescription>Selecione quais módulos este membro pode acessar.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-4">
          {modulosDisponiveis.map(m => (
            <div 
              key={m.id}
              onClick={() => toggle(m.id)}
              className={cn(
                "flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all",
                selecionados.includes(m.id) ? "border-primary bg-primary/5" : "border-transparent bg-muted/50 hover:bg-muted"
              )}
            >
              <div className={cn("p-2 rounded-md bg-background", m.color)}>
                <m.icon className="w-4 h-4" />
              </div>
              <span className="text-sm font-medium">{m.label}</span>
              {selecionados.includes(m.id) && <Check className="w-4 h-4 ml-auto text-primary" />}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Salvando..." : "Salvar Alterações"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
