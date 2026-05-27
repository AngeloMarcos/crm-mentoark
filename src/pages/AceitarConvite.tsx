import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, CheckCircle2 } from "lucide-react";

const API_BASE = (import.meta.env.VITE_API_URL as string) || "https://api.mentoark.com.br";

interface InviteInfo {
  email: string;
  nome: string;
  cargo?: string;
  owner_nome?: string;
  owner_email?: string;
}

export default function AceitarConvitePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [senha, setSenha] = useState("");
  const [senha2, setSenha2] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/invite/${token}`);
        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          throw new Error(e.message || "Convite inválido");
        }
        const data = await res.json();
        setInfo(data);
        setNome(data.nome || "");
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const aceitar = async () => {
    if (senha.length < 8) { toast.error("Senha precisa ter ao menos 8 caracteres"); return; }
    if (senha !== senha2) { toast.error("Senhas não conferem"); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/auth/accept-invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, senha, nome }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.message || "Erro ao aceitar convite");
      }
      toast.success("Convite aceito! Faça login para continuar.");
      navigate("/login");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="p-8 max-w-md text-center">
          <h1 className="text-xl font-bold mb-2">Convite indisponível</h1>
          <p className="text-sm text-muted-foreground mb-4">{error}</p>
          <Button onClick={() => navigate("/login")}>Ir para login</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="p-8 max-w-md w-full">
        <div className="flex items-center gap-2 mb-2 text-primary">
          <CheckCircle2 className="w-5 h-5" />
          <span className="text-xs font-medium uppercase tracking-wider">Convite para a equipe</span>
        </div>
        <h1 className="text-2xl font-bold mb-1">Bem-vindo(a)!</h1>
        <p className="text-sm text-muted-foreground mb-6">
          {info?.owner_nome || info?.owner_email} convidou você para fazer parte da equipe.
          Defina sua senha para entrar.
        </p>

        <div className="space-y-3">
          <div>
            <Label>Email</Label>
            <Input value={info?.email || ""} disabled />
          </div>
          <div>
            <Label>Seu nome</Label>
            <Input value={nome} onChange={e => setNome(e.target.value)} />
          </div>
          <div>
            <Label>Senha (mín. 8 caracteres)</Label>
            <Input type="password" value={senha} onChange={e => setSenha(e.target.value)} />
          </div>
          <div>
            <Label>Confirme a senha</Label>
            <Input type="password" value={senha2} onChange={e => setSenha2(e.target.value)} />
          </div>
        </div>

        <Button className="w-full mt-6" onClick={aceitar} disabled={submitting}>
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Aceitar convite e criar conta"}
        </Button>
      </Card>
    </div>
  );
}
