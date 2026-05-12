import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, LogIn, UserPlus, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/integrations/database/client";
import { useAuth } from "@/hooks/useAuth";
import logo from "@/assets/mentoark-logo.png";

export default function LoginPage() {
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!authLoading && user) navigate("/dashboard", { replace: true });
  }, [user, authLoading, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isLogin) {
        const { error } = await api.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate("/dashboard");
      } else {
        const { error } = await api.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/dashboard`,
            data: { display_name: displayName || email.split("@")[0] },
          },
        });
        if (error) throw error;
        toast({ title: "Conta criada", description: "Você já pode entrar." });
        setIsLogin(true);
      }
    } catch (err: any) {
      toast({
        title: "Erro",
        description: err.message?.includes("Invalid login") ? "E-mail ou senha incorretos." : err.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-background p-4 overflow-hidden">
      {/* Aurora orbs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-32 -left-32 w-[28rem] h-[28rem] rounded-full bg-primary/25 blur-3xl opacity-40" />
        <div className="absolute -bottom-40 -right-32 w-[32rem] h-[32rem] rounded-full bg-accent/25 blur-3xl opacity-35" />
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[24rem] h-[24rem] rounded-full bg-primary/15 blur-3xl opacity-25" />
      </div>

      <div className="relative z-10 w-full max-w-md space-y-6 animate-fade-in">
        <div className="text-center space-y-2">
          <div className="ring-gradient mx-auto w-fit animate-breathe">
            <img src={logo} alt="MentoArk" className="w-20 h-20 rounded-2xl object-cover bg-card" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            <span className="text-foreground">Mento</span>
            <span className="gradient-text-animated">Ark</span>
          </h1>
          <p className="text-sm text-muted-foreground">CRM de automação comercial</p>
        </div>

        <Card className="card-gradient-border glow-soft">
          <CardHeader className="text-center pb-4">
            <CardTitle className="text-lg">{isLogin ? "Entrar" : "Criar Conta"}</CardTitle>
            <CardDescription>{isLogin ? "Acesse sua conta para continuar" : "Preencha os dados para se cadastrar"}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">

            <form onSubmit={handleSubmit} className="space-y-4">
              {!isLogin && (
                <div className="space-y-2">
                  <Label htmlFor="name">Nome</Label>
                  <Input id="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Seu nome" />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <Input id="email" type="email" placeholder="seu@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Senha</Label>
                <div className="relative">
                  <Input id="password" type={showPw ? "text" : "password"} placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
                  <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0 h-full" onClick={() => setShowPw(!showPw)}>
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <Button type="submit" className="w-full gap-2 btn-gradient" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : isLogin ? <LogIn className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
                {loading ? "Aguarde..." : isLogin ? "Entrar" : "Cadastrar"}
              </Button>
            </form>

            <div className="text-center">
              <button type="button" onClick={() => setIsLogin(!isLogin)} className="text-sm text-primary hover:underline">
                {isLogin ? "Não tem conta? Cadastre-se" : "Já tem conta? Entre"}
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
