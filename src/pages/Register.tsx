import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Eye, EyeOff, UserPlus, Loader2, ArrowLeft, MailCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/integrations/database/client";
import { useAuth } from "@/hooks/useAuth";
import ParticlesBackground from "@/components/ParticlesBackground";
import logo from "@/assets/mentoark-logo.png";

export default function RegisterPage() {
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!authLoading && user) navigate("/dashboard", { replace: true });
  }, [user, authLoading, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!acceptedTerms) {
      toast({
        title: "Atenção",
        description: "Você deve aceitar os Termos de Uso e Política de Privacidade.",
        variant: "destructive",
      });
      return;
    }

    if (password !== confirmPassword) {
      toast({
        title: "Erro na senha",
        description: "As senhas não coincidem.",
        variant: "destructive",
      });
      return;
    }

    if (password.length < 6) {
      toast({
        title: "Senha fraca",
        description: "A senha deve ter pelo menos 6 caracteres.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const { error } = await api.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/login`,
          data: { 
            display_name: displayName,
          },
        },
      });

      if (error) throw error;

      setIsSuccess(true);
      toast({ 
        title: "Conta criada com sucesso!", 
        description: "Verifique seu e-mail para confirmar seu cadastro.",
      });
    } catch (err: any) {
      toast({
        title: "Erro ao cadastrar",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="relative min-h-screen flex items-center justify-center bg-gradient-to-br from-[#1a1c2c] via-[#4a1942] to-[#0f172a] p-4 overflow-hidden text-white">
        <ParticlesBackground />
        <Card className="relative z-10 w-full max-w-md bg-white/5 backdrop-blur-xl border-white/10 shadow-2xl p-8 text-center space-y-6">
          <div className="mx-auto w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mb-4">
            <MailCheck className="h-8 w-8 text-green-400" />
          </div>
          <CardTitle className="text-2xl font-bold">Verifique seu E-mail</CardTitle>
          <p className="text-blue-100/60">
            Enviamos um link de confirmação para <span className="text-white font-medium">{email}</span>. 
            Por favor, verifique sua caixa de entrada e spam.
          </p>
          <Button asChild className="w-full bg-gradient-to-r from-purple-600 to-blue-600">
            <Link to="/login">Voltar para o Login</Link>
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-gradient-to-br from-[#1a1c2c] via-[#4a1942] to-[#0f172a] p-0 overflow-hidden">
      <ParticlesBackground />
      
      {/* Ambient glow effects */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-32 -left-32 w-[40rem] h-[40rem] rounded-full bg-purple-600/20 blur-[120px] animate-pulse" />
        <div className="absolute -bottom-40 -right-32 w-[40rem] h-[40rem] rounded-full bg-blue-600/20 blur-[120px] animate-pulse" style={{ animationDelay: '2s' }} />
      </div>

      <div className="relative z-10 flex w-full h-full min-h-screen">
        {/* Left Side: Register Form */}
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
                <div className="flex justify-start mb-2">
                  <Link to="/login" className="flex items-center text-xs text-purple-300 hover:text-white transition-colors gap-1">
                    <ArrowLeft className="h-3 w-3" /> Voltar
                  </Link>
                </div>
                <CardTitle className="text-2xl font-bold text-white">Criar Conta</CardTitle>
                <CardDescription className="text-blue-100/60">
                  Comece agora sua automação inteligente
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name" className="text-white/80">Nome Completo</Label>
                    <Input 
                      id="name" 
                      value={displayName} 
                      onChange={(e) => setDisplayName(e.target.value)} 
                      placeholder="Seu nome"
                      required
                      className="bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:ring-purple-500"
                    />
                  </div>
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
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="password" className="text-white/80">Senha</Label>
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
                    <div className="space-y-2">
                      <Label htmlFor="confirmPassword" className="text-white/80">Confirmar Senha</Label>
                      <Input 
                        id="confirmPassword" 
                        type="password" 
                        placeholder="••••••••" 
                        value={confirmPassword} 
                        onChange={(e) => setConfirmPassword(e.target.value)} 
                        required 
                        className="bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:ring-purple-500"
                      />
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
                    className="w-full gap-2 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white border-none shadow-lg shadow-purple-500/20 transition-all duration-300 transform hover:scale-[1.02] mt-4" 
                    disabled={loading}
                  >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                    {loading ? "Criando conta..." : "Cadastrar Agora"}
                  </Button>
                </form>

                <div className="text-center pt-4">
                  <Link 
                    to="/login" 
                    className="text-sm text-purple-300 hover:text-white hover:underline transition-colors"
                  >
                    Já possui uma conta? Realizar login
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

        {/* Right Side: Logo & Branding (Consistent with Login) */}
        <div className="hidden lg:flex flex-1 flex-col items-center justify-between bg-gradient-to-br from-purple-900/30 via-[#1e1e2d]/60 to-blue-900/30 backdrop-blur-md relative overflow-hidden border-l border-white/10 py-16 px-12">
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute top-12 left-0 w-32 h-px bg-gradient-to-r from-purple-400/60 to-transparent" />
            <div className="absolute top-16 left-0 w-20 h-px bg-gradient-to-r from-blue-400/40 to-transparent" />
            <div className="absolute bottom-24 right-0 w-40 h-px bg-gradient-to-l from-purple-400/60 to-transparent" />
            <div className="absolute bottom-28 right-0 w-24 h-px bg-gradient-to-l from-blue-400/40 to-transparent" />
          </div>

          <div className="flex-1 flex flex-col items-center justify-center w-full text-center">
            <div className="relative mb-8">
              <div className="absolute inset-0 bg-purple-500/20 blur-3xl rounded-full scale-150" />
              <div className="relative w-36 h-36 rounded-full bg-white shadow-2xl flex items-center justify-center ring-4 ring-white/10">
                <img src={logo} alt="MentoArk" className="w-24 h-24 object-contain" />
              </div>
            </div>

            <h2 className="text-5xl font-black tracking-tight mb-4">
              <span className="text-white">Mento</span>
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-blue-400">Ark</span>
            </h2>

            <p className="text-lg text-blue-100/70 font-light max-w-xs mb-12">
              Sua jornada para o sucesso começa aqui. Crie sua conta e transforme seu atendimento.
            </p>

            <div className="flex items-center gap-4">
               {/* Redes sociais mantidas para consistência */}
               <div className="flex items-center gap-3">
                 <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center backdrop-blur-sm">
                   <div className="w-2 h-2 rounded-full bg-purple-400" />
                 </div>
                 <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center backdrop-blur-sm">
                   <div className="w-2 h-2 rounded-full bg-blue-400" />
                 </div>
               </div>
            </div>
          </div>
          
          <div className="text-white/20 text-xs font-light tracking-widest">
            © 2026 MENTOARK - TODOS OS DIREITOS RESERVADOS
          </div>
        </div>
      </div>
    </div>
  );
}
