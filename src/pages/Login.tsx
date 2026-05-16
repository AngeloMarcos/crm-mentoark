import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!authLoading && user) navigate("/dashboard", { replace: true });
  }, [user, authLoading, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    if (!acceptedTerms) {
      toast({
        title: "Atenção",
        description: "Você deve aceitar os Termos de Uso e Política de Privacidade.",
        variant: "destructive",
      });
      setLoading(false);
      return;
    }
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
                  <div className="flex items-start space-x-2 py-2">
                    <Checkbox 
                      id="terms" 
                      checked={acceptedTerms} 
                      onCheckedChange={(checked) => setAcceptedTerms(checked as boolean)}
                      className="border-white/20 data-[state=checked]:bg-purple-600 data-[state=checked]:border-purple-600 mt-1"
                    />
                    <Label 
                      htmlFor="terms" 
                      className="text-xs text-white/60 leading-tight cursor-pointer select-none"
                    >
                      Eu li e concordo com os{" "}
                      <Link to="/termos" className="text-purple-400 hover:underline">Termos de Uso</Link>
                      {" "}e a{" "}
                      <Link to="/privacidade" className="text-purple-400 hover:underline">Política de Privacidade</Link>.
                    </Label>
                  </div>

                  <Button 
                    type="submit" 
...
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
                  <Link 
                    to="/register" 
                    className="text-sm text-purple-300 hover:text-white hover:underline transition-colors"
                  >
                    Não tem uma conta? Cadastre-se gratuitamente
                  </Link>
                </div>

                <div className="flex items-center justify-center gap-4 text-[11px] text-white/30 pt-2">
                  <Link to="/termos" className="hover:text-white/60 transition-colors">Termos de Uso</Link>
                  <span>|</span>
                  <Link to="/privacidade" className="hover:text-white/60 transition-colors">Privacidade</Link>
                </div>
              </CardContent>
            </Card>

          </div>
        </div>

        {/* Right Side: Logo & Branding */}
        <div className="hidden lg:flex flex-1 flex-col items-center justify-between bg-gradient-to-br from-purple-900/30 via-[#1e1e2d]/60 to-blue-900/30 backdrop-blur-md relative overflow-hidden border-l border-white/10 py-16 px-12">
          {/* Decorative lines */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute top-12 left-0 w-32 h-px bg-gradient-to-r from-purple-400/60 to-transparent" />
            <div className="absolute top-16 left-0 w-20 h-px bg-gradient-to-r from-blue-400/40 to-transparent" />
            <div className="absolute bottom-24 right-0 w-40 h-px bg-gradient-to-l from-purple-400/60 to-transparent" />
            <div className="absolute bottom-28 right-0 w-24 h-px bg-gradient-to-l from-blue-400/40 to-transparent" />
            <div className="absolute top-8 left-8 w-2 h-2 rounded-full bg-purple-400/60" />
            <div className="absolute bottom-32 right-12 w-1.5 h-1.5 rounded-full bg-blue-400/60" />
          </div>

          <div className="flex-1 flex flex-col items-center justify-center w-full">
            {/* Circular Logo */}
            <div className="relative mb-8">
              <div className="absolute inset-0 bg-purple-500/20 blur-3xl rounded-full scale-150" />
              <div className="relative w-36 h-36 rounded-full bg-white shadow-2xl flex items-center justify-center ring-4 ring-white/10">
                <img src={logo} alt="MentoArk" className="w-24 h-24 object-contain" />
              </div>
            </div>

            {/* Brand name */}
            <h2 className="text-5xl font-black tracking-tight mb-4">
              <span className="text-white">Mento</span>
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-blue-400">Ark</span>
            </h2>

            {/* Tagline */}
            <p className="text-lg text-blue-100/70 font-light text-center max-w-xs mb-12">
              CRM inteligente para automação comercial via WhatsApp
            </p>

            {/* Social media circles */}
            <div className="flex items-center gap-4">
              <a href="https://instagram.com/mentoark" target="_blank" rel="noreferrer" aria-label="Instagram"
                className="w-12 h-12 rounded-full bg-white shadow-lg flex items-center justify-center hover:scale-110 hover:shadow-purple-500/40 transition-all duration-300">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="url(#ig-grad)">
                  <defs>
                    <linearGradient id="ig-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#F58529"/>
                      <stop offset="50%" stopColor="#DD2A7B"/>
                      <stop offset="100%" stopColor="#8134AF"/>
                    </linearGradient>
                  </defs>
                  <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zm0 10.162a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/>
                </svg>
              </a>
              <a href="https://linkedin.com/company/mentoark" target="_blank" rel="noreferrer" aria-label="LinkedIn"
                className="w-12 h-12 rounded-full bg-white shadow-lg flex items-center justify-center hover:scale-110 hover:shadow-blue-500/40 transition-all duration-300">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="#0A66C2">
                  <path d="M4.98 3.5c0 1.381-1.11 2.5-2.48 2.5S0 4.881 0 3.5C0 2.12 1.11 1 2.5 1s2.48 1.12 2.48 2.5zM.02 8h4.96v16H.02V8zm7.98 0h4.756v2.19h.067c.662-1.25 2.28-2.566 4.692-2.566 5.018 0 5.945 3.302 5.945 7.596V24h-4.96v-7.61c0-1.815-.033-4.15-2.53-4.15-2.53 0-2.92 1.977-2.92 4.02V24H8V8z"/>
                </svg>
              </a>
              <a href="https://wa.me/5511999999999" target="_blank" rel="noreferrer" aria-label="WhatsApp"
                className="w-12 h-12 rounded-full bg-white shadow-lg flex items-center justify-center hover:scale-110 hover:shadow-green-500/40 transition-all duration-300">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="#25D366">
                  <path d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 0 1 8.413 3.488 11.824 11.824 0 0 1 3.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 0 1-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 0 0 1.523 5.27l-.999 3.648 3.965-1.027zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413z"/>
                </svg>
              </a>
              <a href="https://facebook.com/mentoark" target="_blank" rel="noreferrer" aria-label="Facebook"
                className="w-12 h-12 rounded-full bg-white shadow-lg flex items-center justify-center hover:scale-110 hover:shadow-blue-600/40 transition-all duration-300">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="#1877F2">
                  <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                </svg>
              </a>
            </div>
          </div>

          {/* Footer */}
          <p className="text-xs text-white/40 text-center">
            © {new Date().getFullYear()} MentoArk. Todos os direitos reservados.
          </p>
        </div>
      </div>
    </div>
  );
}
