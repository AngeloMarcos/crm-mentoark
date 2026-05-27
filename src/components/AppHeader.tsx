import { Moon, Sun, Bell, ChevronDown, User as UserIcon, Home, Shield, LogOut, Clock } from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/useAuth";
import ParticlesBackground from "@/components/ParticlesBackground";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNavigate } from "react-router-dom";
import { usePausaNotificacoes } from "@/hooks/usePausaNotificacoes";
import { Badge } from "@/components/ui/badge";

export function AppHeader() {
  const { theme, toggleTheme } = useTheme();
  const { user, isAdmin, signOut } = useAuth();
  const navigate = useNavigate();
  const { expirando } = usePausaNotificacoes();

  const displayName =
    (user as any)?.user_metadata?.full_name ||
    (user as any)?.user_metadata?.name ||
    user?.email?.split("@")[0] ||
    "Usuário";
  const initials = displayName.slice(0, 2).toUpperCase();
  const roleLabel = isAdmin ? "Administrador" : "Usuário";

  const handleLogout = async () => {
    await signOut();
    navigate("/login");
  };

  return (
    <header className="relative h-14 border-b border-border/40 flex items-center justify-between px-4 glass-strong z-20 overflow-hidden shadow-[0_4px_30px_rgba(0,0,0,0.03)] dark:shadow-[0_4px_30px_rgba(0,0,0,0.3)]">
      {/* Background Particles — sutis e elegantes */}
      <div className="absolute inset-0 pointer-events-none opacity-40 dark:opacity-60 [mask-image:linear-gradient(90deg,transparent,black_20%,black_80%,transparent)]">
        <ParticlesBackground
          className="block w-full h-full"
          count={28}
          connectionDistance={110}
        />
      </div>

      <div className="absolute bottom-0 left-0 right-0 h-[2px] pointer-events-none overflow-hidden">
        <div
          className="h-full w-full opacity-80"
          style={{
            background:
              "linear-gradient(90deg, transparent, hsl(var(--primary)), hsl(var(--accent)), hsl(var(--primary)), transparent)",
            backgroundSize: "200% 100%",
            animation: "gradient-shift 3s linear infinite",
          }}
        />
      </div>

      <div className="flex items-center gap-2">
        <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
      </div>

      <div className="flex items-center gap-2">
        {/* Notificações */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground relative">
              <Bell className="h-5 w-5" />
              {expirando.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 h-4 w-4 flex items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white pulse-gradient">
                  {expirando.length}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel className="flex items-center justify-between">
              Notificações
              {expirando.length > 0 && (
                <Badge variant="destructive" className="ml-2">
                  {expirando.length} expirando
                </Badge>
              )}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {expirando.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                Nenhuma notificação importante
              </div>
            ) : (
              expirando.map((contato) => (
                <DropdownMenuItem 
                  key={contato.id} 
                  onClick={() => navigate(`/contatos/${contato.id}`)}
                  className="flex flex-col items-start gap-1 p-3 cursor-pointer"
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="font-semibold text-sm truncate">
                      {contato.nomewpp || contato.telefone}
                    </span>
                    <Clock className="h-3 w-3 text-orange-500" />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    IA reativa em menos de 5 minutos
                  </p>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Toggle tema */}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          className="text-muted-foreground hover:text-foreground"
        >
          {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </Button>

        {/* Menu do usuário */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 ml-1 pl-1 pr-2 py-1 rounded-full hover:bg-muted/60 transition-colors group">
              <div className="ring-gradient glow-primary">
                <div className="w-8 h-8 rounded-full bg-card flex items-center justify-center text-xs font-semibold gradient-brand-text overflow-hidden">
                  {user?.avatar_url ? (
                    <img src={user.avatar_url} alt={displayName} className="w-full h-full object-cover" />
                  ) : (
                    initials
                  )}
                </div>
              </div>
              <div className="hidden sm:flex flex-col items-start leading-tight">
                <span className="text-sm font-semibold text-foreground capitalize">{displayName}</span>
                <span className="text-[10px] text-muted-foreground">{roleLabel}</span>
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="flex flex-col">
              <span className="capitalize">{displayName}</span>
              <span className="text-xs font-normal text-muted-foreground">{user?.email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate("/perfil")}>
              <UserIcon className="mr-2 h-4 w-4" />
              Perfil
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/dashboard")}>
              <Home className="mr-2 h-4 w-4" />
              Home
            </DropdownMenuItem>
            {isAdmin && (
              <DropdownMenuItem onClick={() => navigate("/usuarios")}>
                <Shield className="mr-2 h-4 w-4" />
                Painel Admin
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive">
              <LogOut className="mr-2 h-4 w-4" />
              Deslogar
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
