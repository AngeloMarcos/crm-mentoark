import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, LogIn, UserPlus, Loader2, Instagram, Facebook, Linkedin, Youtube } from "lucide-react";
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

  const handleGoogleLogin = async () => {
    try {
      const { error } = await api.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/dashboard`
        }
      });
      if (error) throw error;
    } catch (err: any) {
      toast({
        title: "Erro Google",
        description: err.message,
        variant: "destructive",
      });
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
      toast({
        title: "E-mail necessário",
        description: "Digite seu e-mail no campo acima para recuperar a senha.",
        variant: "destructive",
      });
      return;
    }
    
    setLoading(true);
    try {
      const { error } = await api.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      toast({
        title: "E-mail enviado",
        description: "Verifique sua caixa de entrada para redefinir a senha.",
      });
    } catch (err: any) {
      toast({
        title: "Erro",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-gradient-to-br from-[#1a1c2c] via-[#4a1942] to-[#0f172a] p-0 overflow-hidden">
      {/* Particles Background */}
      <ParticlesBackground />
      
      {/* Ambient glow effects */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-32 -left-32 w-[40rem] h-[40rem] rounded-full bg-purple-600/20 blur-[120px] animate-pulse" />
        <div className="absolute -bottom-40 -right-32 w-[40rem] h-[40rem] rounded-full bg-blue-600/20 blur-[120px] animate-pulse" style={{ animationDelay: '2s' }} />
      </div>

      <div className="relative z-10 flex w-full h-full min-h-screen">
        {/* Left Side: Login Form */}
        <div className="flex-1 flex flex-col items-center justify-center p-8 bg-[#1e1e2d]/40 backdrop-blur-sm">
          <div className="w-full max-w-md space-y-6 animate-fade-in">
            <div className="text-center space-y-3 mb-8 lg:hidden">
              <div className="relative mx-auto w-fit">
                <div className="relative p-1 bg-gradient-to-tr from-purple-500 to-blue-500 rounded-2xl animate-breathe shadow-2xl">
                  <img src={logo} alt="MentoArk" className="w-16 h-16 rounded-xl object-cover bg-[#1e1e2d]" />
                </div>
              </div>
              <h1 className="text-3xl font-extrabold tracking-tight">
                <span className="text-white drop-shadow-md">Mento</span>
                <span className="bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-blue-400">Ark</span>
              </h1>
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
                    <div className="flex items-center justify-between">
                      <Label htmlFor="password" senior-only className="text-white/80">Senha</Label>
                      {isLogin && (
                        <button 
                          type="button" 
                          onClick={handleForgotPassword}
                          className="text-xs text-purple-300 hover:text-white hover:underline transition-colors"
                        >
                          Esqueci minha senha
                        </button>
                      )}
                    </div>
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

                <div className="relative flex items-center gap-4 my-4">
                  <div className="h-px w-full bg-white/10" />
                  <span className="text-[10px] text-white/30 uppercase tracking-widest whitespace-nowrap">Ou continue com</span>
                  <div className="h-px w-full bg-white/10" />
                </div>

                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={handleGoogleLogin}
                  className="w-full bg-white/5 border-white/10 text-white hover:bg-white/10 hover:text-white transition-all duration-300 gap-2"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24">
                    <path
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      fill="#4285F4"
                    />
                    <path
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      fill="#34A853"
                    />
                    <path
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      fill="#FBBC05"
                    />
                    <path
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      fill="#EA4335"
                    />
                  </svg>
                  Google
                </Button>

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

            {/* Social Media Links */}
            <div className="flex items-center justify-center gap-6 pt-8">
              <a href="#" className="text-white/40 hover:text-white transition-colors p-2 hover:bg-white/10 rounded-full">
                <Instagram className="h-5 w-5" />
              </a>
              <a href="#" className="text-white/40 hover:text-white transition-colors p-2 hover:bg-white/10 rounded-full">
                <Facebook className="h-5 w-5" />
              </a>
              <a href="#" className="text-white/40 hover:text-white transition-colors p-2 hover:bg-white/10 rounded-full">
                <Linkedin className="h-5 w-5" />
              </a>
              <a href="#" className="text-white/40 hover:text-white transition-colors p-2 hover:bg-white/10 rounded-full">
                <Youtube className="h-5 w-5" />
              </a>
            </div>
          </div>
        </div>

        {/* Right Side: Logo & Branding */}
        <div className="hidden lg:flex flex-1 flex-col items-center justify-center bg-gradient-to-bl from-purple-900/40 to-blue-900/40 backdrop-blur-md relative overflow-hidden border-l border-white/10">
          <div className="absolute top-0 right-0 p-12">
            <div className="h-1 w-24 bg-gradient-to-r from-purple-500 to-transparent" />
          </div>
          <div className="absolute bottom-0 left-0 p-12">
            <div className="h-1 w-24 bg-gradient-to-l from-blue-500 to-transparent" />
          </div>

          <div className="relative z-10 text-center space-y-8 animate-float">
            <div className="relative mx-auto w-fit">
              <div className="absolute inset-0 bg-white/20 blur-3xl rounded-full scale-150" />
              <div className="relative p-2 bg-gradient-to-tr from-purple-500 via-white to-blue-500 rounded-3xl shadow-2xl">
                <div className="p-4 bg-[#1e1e2d] rounded-[1.25rem]">
                  <img src={logo} alt="MentoArk" className="w-48 h-48 object-contain" />
                </div>
              </div>
            </div>
            
            <div className="space-y-4">
              <h2 className="text-6xl font-black tracking-tighter">
                <span className="text-white">Mento</span>
                <span className="bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-blue-400">Ark</span>
              </h2>
              <p className="text-2xl text-blue-100/70 font-light tracking-widest uppercase">
                CRM de Automação Comercial
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
