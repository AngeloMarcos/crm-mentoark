import { useState } from "react";
import { CRMLayout } from "@/components/CRMLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Users, UserPlus, Trash2, Pencil, Check, X, MessageSquare } from "lucide-react";
import { useEquipe, type Membro } from "@/hooks/useEquipe";
import { useAuth } from "@/hooks/useAuth";

function iniciais(nome?: string, email?: string) {
  const base = (nome || email || "?").trim();
  const parts = base.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

export default function EquipePage() {
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
          <Painel
            equipe={equipe}
            membros={membros}
            onConvidar={convidarMembro}
            onRemover={removerMembro}
          />
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
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            Chat em breve
          </div>
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
