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
import ParticlesBackground from "@/components/ParticlesBackground";
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
    <div className="relative min-h-screen flex items-center justify-center bg-gradient-to-br from-[#1a1c2c] via-[#4a1942] to-[#0f172a] p-4 overflow-hidden">
      {/* Particles Background */}
      <ParticlesBackground />
      
      {/* Ambient glow effects */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-32 -left-32 w-[40rem] h-[40rem] rounded-full bg-purple-600/20 blur-[120px] animate-pulse" />
        <div className="absolute -bottom-40 -right-32 w-[40rem] h-[40rem] rounded-full bg-blue-600/20 blur-[120px] animate-pulse" style={{ animationDelay: '2s' }} />
      </div>

      <div className="relative z-10 w-full max-w-md space-y-6 animate-fade-in">
        <div className="text-center space-y-3">
          <div className="relative mx-auto w-fit">
            <div className="absolute inset-0 bg-white/20 blur-xl rounded-full" />
            <div className="relative p-1 bg-gradient-to-tr from-purple-500 to-blue-500 rounded-2xl animate-breathe shadow-2xl">
              <img src={logo} alt="MentoArk" className="w-20 h-20 rounded-xl object-cover bg-[#1e1e2d]" />
            </div>
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight">
            <span className="text-white drop-shadow-md">Mento</span>
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-blue-400 drop-shadow-sm">Ark</span>
          </h1>
          <p className="text-blue-100/70 font-medium tracking-wide">CRM de automação comercial</p>
        </div>

        <Card className="bg-white/5 backdrop-blur-xl border-white/10 shadow-2xl ring-1 ring-white/20">
          <CardHeader className="text-center pb-4">
            <CardTitle className="text-2xl font-bold text-white">
              {isLogin ? "Bem-vindo" : "Criar Conta"}
            </CardTitle>
            <CardDescription className="text-blue-100/60">
              {isLogin ? "Acesse sua conta para continuar" : "Preencha os dados para se cadastrar"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handleSubmit} className="space-y-4">
              {!isLogin && (
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-white/80">Nome</Label>
                  <Input 
                    id="name" 
                    value={displayName} 
                    onChange={(e) => setDisplayName(e.target.value)} 
                    placeholder="Seu nome"
                    className="bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:ring-purple-500"
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="email" className="text-white/80">E-mail</Label>
                <Input 
                  id="email" 
                  type="email" 
                  placeholder="seu@email.com" 
                  value={email} 
                  onChange={(e) => setEmail(e.target.value)} 
                  required 
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:ring-purple-500"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" senior-only className="text-white/80">Senha</Label>
                <div className="relative">
                  <Input 
                    id="password" 
                    type={showPw ? "text" : "password"} 
                    placeholder="••••••••" 
                    value={password} 
                    onChange={(e) => setPassword(e.target.value)} 
                    required 
                    minLength={6}
                    className="bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:ring-purple-500"
                  />
                  <Button 
                    type="button" 
                    variant="ghost" 
                    size="icon" 
                    className="absolute right-0 top-0 h-full text-white/40 hover:text-white hover:bg-transparent" 
                    onClick={() => setShowPw(!showPw)}
                  >
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <Button 
                type="submit" 
                className="w-full gap-2 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white border-none shadow-lg shadow-purple-500/20 transition-all duration-300 transform hover:scale-[1.02]" 
                disabled={loading}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : isLogin ? <LogIn className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
                {loading ? "Processando..." : isLogin ? "Entrar na Plataforma" : "Criar Minha Conta"}
              </Button>
            </form>

            <div className="text-center pt-2">
              <button 
                type="button" 
                onClick={() => setIsLogin(!isLogin)} 
                className="text-sm text-purple-300 hover:text-white hover:underline transition-colors"
              >
                {isLogin ? "Não tem uma conta? Cadastre-se gratuitamente" : "Já possui uma conta? Realizar login"}
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
