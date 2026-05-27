import { useEffect, useRef, useState } from "react";
import { CRMLayout } from "@/components/CRMLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Camera, Loader2, KeyRound, User as UserIcon, Trash2 } from "lucide-react";

const API_BASE = (import.meta.env.VITE_API_URL as string) || "https://api.mentoark.com.br";

// Redimensiona imagem para no máx 512x512 e devolve data URL JPEG (~q 0.85)
function fileToResizedDataUrl(file: File, max = 512, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Falha ao ler arquivo"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Imagem inválida"));
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > max) { height = (height * max) / width; width = max; }
        else if (height > max) { width = (width * max) / height; height = max; }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas indisponível"));
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export default function Perfil() {
  const { user, session } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPwd, setSavingPwd] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");

  useEffect(() => {
    if (!session?.access_token) return;
    setLoading(true);
    fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        setDisplayName(data.display_name || "");
        setAvatarUrl(data.avatar_url || null);
      })
      .catch(() => toast.error("Não foi possível carregar seu perfil"))
      .finally(() => setLoading(false));
  }, [session?.access_token]);

  const initials = (displayName || user?.email || "?")
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/^image\//.test(file.type)) { toast.error("Selecione uma imagem"); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("Imagem maior que 5MB"); return; }
    try {
      const dataUrl = await fileToResizedDataUrl(file, 512, 0.85);
      setAvatarUrl(dataUrl);
      toast.success("Pré-visualização carregada — clique em Salvar perfil");
    } catch (err: any) {
      toast.error(err.message || "Falha ao processar imagem");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const saveProfile = async () => {
    if (!session?.access_token) return;
    if (!displayName.trim()) { toast.error("Informe um nome"); return; }
    setSavingProfile(true);
    try {
      const r = await fetch(`${API_BASE}/auth/me`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          display_name: displayName.trim(),
          avatar_url: avatarUrl,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || "Erro ao salvar");
      toast.success("Perfil atualizado");
      // Atualiza o user no localStorage para refletir no header sem relogar
      try {
        const stored = JSON.parse(localStorage.getItem("crm_user") || "null");
        if (stored) {
          stored.display_name = data.display_name;
          stored.avatar_url = data.avatar_url;
          localStorage.setItem("crm_user", JSON.stringify(stored));
        }
      } catch {}
      setTimeout(() => window.location.reload(), 600);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSavingProfile(false);
    }
  };

  const changePassword = async () => {
    if (!session?.access_token) return;
    if (newPwd.length < 8) { toast.error("Nova senha deve ter ao menos 8 caracteres"); return; }
    if (newPwd !== confirmPwd) { toast.error("A confirmação não confere"); return; }
    setSavingPwd(true);
    try {
      const r = await fetch(`${API_BASE}/auth/me`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ current_password: currentPwd, new_password: newPwd }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || "Erro ao trocar senha");
      toast.success("Senha alterada");
      setCurrentPwd(""); setNewPwd(""); setConfirmPwd("");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSavingPwd(false);
    }
  };

  return (
    <CRMLayout>
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <UserIcon className="h-6 w-6 text-primary" /> Meu Perfil
          </h1>
          <p className="text-sm text-muted-foreground">Personalize seu nome de exibição, foto e senha.</p>
        </div>

        {/* Card: foto + nome */}
        <Card>
          <CardHeader>
            <CardTitle>Informações pessoais</CardTitle>
            <CardDescription>Como você aparece no CRM para a equipe.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center gap-6">
              <div className="relative group">
                <div className="w-28 h-28 rounded-full overflow-hidden bg-gradient-to-br from-primary/20 to-accent/20 ring-4 ring-primary/30 flex items-center justify-center">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-3xl font-bold text-primary">{initials}</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="absolute bottom-0 right-0 bg-primary text-primary-foreground rounded-full p-2 shadow-lg hover:scale-110 transition-transform"
                  aria-label="Trocar foto"
                >
                  <Camera className="h-4 w-4" />
                </button>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
              </div>
              <div className="flex-1 space-y-2">
                <p className="text-sm font-medium">Foto de perfil</p>
                <p className="text-xs text-muted-foreground">
                  JPG, PNG ou WEBP até 5MB. Será redimensionada para 512×512.
                </p>
                {avatarUrl && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-destructive hover:text-destructive"
                    onClick={() => setAvatarUrl(null)}
                  >
                    <Trash2 className="h-3 w-3 mr-1" /> Remover foto
                  </Button>
                )}
              </div>
            </div>

            <Separator />

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="display_name">Nome de exibição</Label>
                <Input
                  id="display_name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Seu nome"
                  disabled={loading}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">E-mail</Label>
                <Input id="email" value={user?.email || ""} disabled className="bg-muted/40" />
              </div>
            </div>

            <div className="flex justify-end">
              <Button onClick={saveProfile} disabled={savingProfile || loading}>
                {savingProfile && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Salvar perfil
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Card: senha */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" /> Alterar senha
            </CardTitle>
            <CardDescription>Use uma senha forte com pelo menos 8 caracteres.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="cur">Senha atual</Label>
                <Input id="cur" type="password" value={currentPwd} onChange={(e) => setCurrentPwd(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new">Nova senha</Label>
                <Input id="new" type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="conf">Confirmar</Label>
                <Input id="conf" type="password" value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} />
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                variant="secondary"
                onClick={changePassword}
                disabled={savingPwd || !currentPwd || !newPwd || !confirmPwd}
              >
                {savingPwd && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Trocar senha
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </CRMLayout>
  );
}
