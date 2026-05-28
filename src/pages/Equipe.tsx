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
  UserPlus2, Users2, BarChart3, Send
} from "lucide-react";
import { useEquipe, type Membro } from "@/hooks/useEquipe";
import { useAuth } from "@/hooks/useAuth";
import { ChatEquipe } from "@/components/equipe/ChatEquipe";
import { useSubPerfis, type SubPerfil } from "@/hooks/useSubPerfis";
import { cn } from "@/lib/utils";

function iniciais(nome?: string, email?: string) {
  const base = (nome || email || "?").trim();
  const parts = base.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

export default function EquipePage() {
  const { user } = useAuth();
  const { equipe, membros, loading, criarEquipe, convidarMembro, removerMembro } = useEquipe();

  if (loading) {
    return (
      <CRMLayout>
        <div className="p-6 text-sm text-muted-foreground">Carregando equipe...</div>
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
                onConvidar={convidarMembro}
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

// ─────────────────────────────────────────────────────────────
// ESTADO 1 — Onboarding
// ─────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────
// ESTADO 2 — Painel da equipe
// ─────────────────────────────────────────────────────────────
function Painel({
  equipe,
  membros,
  onConvidar,
  onRemover,
}: {
  equipe: { id: string; nome: string; owner_id: string };
  membros: Membro[];
  onConvidar: (email: string, role: string) => Promise<void>;
  onRemover: (userId: string) => Promise<void>;
}) {
  const { user, session } = useAuth();
  const isOwner = user?.id === equipe.owner_id;
  const [conviteOpen, setConviteOpen] = useState(false);

  const API_BASE = (import.meta.env.VITE_API_URL as string) || "https://api.mentoark.com.br";

  // Edição do nome da equipe
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

  // Mudar papel de membro
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
      // Refresh implícito vai acontecer no próximo render via hook; força reload da página
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
        {/* ── Seção esquerda: Membros ── */}
        <Card className="p-5 space-y-4">
          {/* Nome editável */}
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

          {/* Header lista */}
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-muted-foreground">
              Membros ({membros.length})
            </h3>
            <Button size="sm" onClick={() => setConviteOpen(true)}>
              <UserPlus className="w-4 h-4 mr-2" />
              Convidar Membro
            </Button>
          </div>

          {/* Lista */}
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

                  {/* Badge / dropdown de papel */}
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

                  {/* Remover */}
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

        {/* ── Seção direita: Chat ── */}
        <Card className="p-5 flex flex-col min-h-[400px]">
          <div className="flex items-center gap-2 pb-3 border-b mb-4">
            <MessageSquare className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Chat da Equipe</h2>
          </div>
          <ChatEquipe equipeId={equipe.id} />
        </Card>
      </div>

      <ConviteDialog
        open={conviteOpen}
        onClose={() => setConviteOpen(false)}
        onInvite={onConvidar}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Dialog de convite
// ─────────────────────────────────────────────────────────────
function ConviteDialog({
  open,
  onClose,
  onInvite,
}: {
  open: boolean;
  onClose: () => void;
  onInvite: (email: string, role: string) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("membro");
  const [saving, setSaving] = useState(false);

  const enviar = async () => {
    if (!email.trim() || !email.includes("@")) {
      toast.error("Digite um email válido");
      return;
    }
    setSaving(true);
    try {
      await onInvite(email.trim(), role);
      toast.success("Convite enviado!");
      setEmail("");
      setRole("membro");
      onClose();
    } catch (e: any) {
      toast.error(e.message || "Erro ao enviar convite");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convidar membro</DialogTitle>
          <DialogDescription>
            Envie um convite por email. O usuário será adicionado à equipe ao aceitar.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="convite-email">Email</Label>
            <Input
              id="convite-email"
              type="email"
              placeholder="colega@exemplo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label>Papel</Label>
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
          <Button onClick={enviar} disabled={saving}>
            {saving ? "Enviando..." : "Enviar Convite"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────
// GESTÃO DE MEMBROS (SUB-PERFIS)
// ─────────────────────────────────────────────────────────────
function GestaoMembros() {
  const { subPerfis, loading, criarSubPerfil, atualizarModulos, atualizarSubPerfil, excluirSubPerfil } = useSubPerfis();
  const [modalAdicionar, setModalAdicionar] = useState(false);
  const [modalPermissoes, setModalPermissoes] = useState<SubPerfil | null>(null);

  const MODULOS_DISPONIVEIS = [
    { id: "kanban", label: "Kanban", icon: LayoutGrid, color: "text-blue-500" },
    { id: "mensagens", label: "Mensagens / WhatsApp", icon: MessageCircle, color: "text-green-500" },
    { id: "leads", label: "Leads", icon: Send, color: "text-indigo-500" },
    { id: "contatos", label: "Contatos", icon: Users, color: "text-purple-500" },
    { id: "relatorios", label: "Relatórios", icon: BarChart3, color: "text-cyan-500" },
    { id: "disparos", label: "Disparos em Massa", icon: Send, color: "text-sky-500" },
  ];

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Membros da Equipe</h2>
          <p className="text-sm text-muted-foreground">Gerencie acessos e permissões dos membros</p>
        </div>
        <Button onClick={() => setModalAdicionar(true)} className="gap-2">
          <UserPlus2 className="w-4 h-4" /> Adicionar Membro
        </Button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          <div className="col-span-full py-20 text-center text-muted-foreground">
            Carregando membros...
          </div>
        ) : subPerfis.length === 0 ? (
          <div className="col-span-full py-20 text-center text-muted-foreground border-2 border-dashed rounded-lg">
            Nenhum membro cadastrado.
          </div>
        ) : (
          subPerfis.map((sp) => (
            <Card key={sp.id} className={cn("p-4 space-y-4", !sp.ativo && "opacity-60 grayscale")}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar className="h-10 w-10 border-2" style={{ borderColor: sp.avatar_cor }}>
                    <AvatarFallback style={{ backgroundColor: sp.avatar_cor + "20", color: sp.avatar_cor }}>
                      {iniciais(sp.nome, sp.email)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold truncate">{sp.nome}</h3>
                    <p className="text-xs text-muted-foreground truncate">{sp.email}</p>
                  </div>
                </div>
                <Switch 
                  checked={sp.ativo} 
                  onCheckedChange={(v) => atualizarSubPerfil(sp.id, { ativo: v })}
                />
              </div>

              <div className="flex flex-wrap gap-1.5">
                {sp.modulos.map((m) => (
                  <Badge key={m} variant="secondary" className="text-[10px] capitalize px-1.5 py-0 h-5">
                    {m}
                  </Badge>
                ))}
                {sp.modulos.length === 0 && (
                  <span className="text-[10px] text-muted-foreground italic">Sem módulos</span>
                )}
              </div>

              <div className="flex items-center justify-between pt-2 border-t">
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="text-xs h-8 gap-1.5"
                  onClick={() => setModalPermissoes(sp)}
                >
                  <Settings2 className="w-3.5 h-3.5" /> Permissões
                </Button>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="text-xs h-8 text-destructive hover:text-destructive gap-1.5"
                  onClick={() => {
                    if (confirm("Desativar acesso deste membro?")) excluirSubPerfil(sp.id);
                  }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </Card>
          ))
        )}
      </div>

      <ModalAdicionarMembro 
        open={modalAdicionar} 
        onClose={() => setModalAdicionar(false)} 
        onConfirm={criarSubPerfil} 
      />

      {modalPermissoes && (
        <ModalPermissoes 
          subPerfil={modalPermissoes} 
          modulosDisponiveis={MODULOS_DISPONIVEIS}
          onClose={() => setModalPermissoes(null)} 
          onSave={atualizarModulos}
        />
      )}
    </div>
  );
}

function ModalAdicionarMembro({ open, onClose, onConfirm }: { open: boolean, onClose: () => void, onConfirm: (d: any) => Promise<void> }) {
  const [form, setForm] = useState({
    nome: "",
    email: "",
    senha: "",
    avatar_cor: "#6366f1",
    modulos: [] as string[]
  });
  const [saving, setSaving] = useState(false);

  const CORES = ["#ef4444", "#f97316", "#f59e0b", "#10b981", "#3b82f6", "#6366f1", "#8b5cf6", "#d946ef"];

  const gerarSenha = () => {
    const s = Math.random().toString(36).slice(-8);
    setForm({ ...form, senha: s });
  };

  const toggleModulo = (id: string) => {
    setForm(prev => ({
      ...prev,
      modulos: prev.modulos.includes(id) ? prev.modulos.filter(m => m !== id) : [...prev.modulos, id]
    }));
  };

  const handleSalvar = async () => {
    if (!form.nome || !form.email || !form.senha) {
      toast.error("Preencha todos os campos");
      return;
    }
    setSaving(true);
    try {
      await onConfirm(form);
      toast.success("Membro criado!");
      setForm({ nome: "", email: "", senha: "", avatar_cor: "#6366f1", modulos: [] });
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Erro ao criar membro");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Adicionar Membro</DialogTitle>
          <DialogDescription>Crie um novo sub-perfil com acesso restrito.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Nome completo</Label>
            <Input value={form.nome} onChange={e => setForm({...form, nome: e.target.value})} />
          </div>
          <div className="space-y-2">
            <Label>Email (login)</Label>
            <Input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} />
          </div>
          <div className="space-y-2">
            <Label>Senha temporária</Label>
            <div className="flex gap-2">
              <Input value={form.senha} onChange={e => setForm({...form, senha: e.target.value})} />
              <Button size="icon" variant="outline" onClick={gerarSenha} title="Gerar senha">
                <RefreshCw className="w-4 h-4" />
              </Button>
              <Button size="icon" variant="outline" onClick={() => {
                navigator.clipboard.writeText(form.senha);
                toast.success("Senha copiada");
              }} disabled={!form.senha}>
                <Copy className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground italic">Envie essas credenciais para o membro. Ele deverá trocar a senha no primeiro acesso.</p>
          </div>

          <div className="space-y-2">
            <Label>Cor do avatar</Label>
            <div className="flex flex-wrap gap-2">
              {CORES.map(c => (
                <button
                  key={c}
                  className={cn("w-6 h-6 rounded-full border-2", form.avatar_cor === c ? "border-slate-900" : "border-transparent")}
                  style={{ backgroundColor: c }}
                  onClick={() => setForm({...form, avatar_cor: c})}
                />
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <Label>Módulos disponíveis</Label>
            <div className="grid grid-cols-2 gap-3">
              {["kanban", "mensagens", "leads", "contatos", "relatorios", "disparos"].map(m => (
                <div key={m} className="flex items-center gap-2">
                  <Checkbox 
                    id={`mod-${m}`} 
                    checked={form.modulos.includes(m)}
                    onCheckedChange={() => toggleModulo(m)}
                  />
                  <Label htmlFor={`mod-${m}`} className="text-xs capitalize cursor-pointer">{m}</Label>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSalvar} disabled={saving}>
            {saving ? "Criando..." : "Criar Membro"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModalPermissoes({ subPerfil, modulosDisponiveis, onClose, onSave }: { subPerfil: SubPerfil, modulosDisponiveis: any[], onClose: () => void, onSave: (id: string, mods: string[]) => Promise<void> }) {
  const [mods, setMods] = useState<string[]>(subPerfil.modulos);
  const [saving, setSaving] = useState(false);

  const toggle = (id: string) => {
    setMods(prev => prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]);
  };

  const handleSalvar = async () => {
    setSaving(true);
    try {
      await onSave(subPerfil.id, mods);
      toast.success("Permissões atualizadas");
      onClose();
    } catch (err) {
      toast.error("Erro ao salvar permissões");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!subPerfil} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Permissões: {subPerfil.nome}</DialogTitle>
          <DialogDescription>Defina quais módulos este membro pode acessar.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {modulosDisponiveis.map(m => (
            <div key={m.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-slate-50 transition-colors">
              <div className="flex items-center gap-3">
                <div className={cn("p-2 rounded-md bg-white border", m.color.replace("text-", "bg-").replace("500", "50"))}>
                  <m.icon className={cn("w-4 h-4", m.color)} />
                </div>
                <div>
                  <p className="text-sm font-semibold">{m.label}</p>
                </div>
              </div>
              <Switch checked={mods.includes(m.id)} onCheckedChange={() => toggle(m.id)} />
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSalvar} disabled={saving}>
            {saving ? "Salvando..." : "Salvar Permissões"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

