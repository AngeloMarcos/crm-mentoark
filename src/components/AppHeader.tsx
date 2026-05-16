import { Moon, Sun, Bell } from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/useAuth";
import ParticlesBackground from "@/components/ParticlesBackground";

export function AppHeader() {
  const { theme, toggleTheme } = useTheme();
  const { user } = useAuth();

  const initials = user?.email ? user.email.slice(0, 2).toUpperCase() : "U";

  return (
    <header className="relative h-14 border-b border-border/40 flex items-center justify-between px-4 glass-strong z-20 overflow-hidden">
      {/* Background Particles */}
      <div className="absolute inset-0 pointer-events-none opacity-80">
        <ParticlesBackground 
          className="block w-full h-full" 
          count={75} 
          connectionDistance={170} 
        />
      </div>

      <div className="absolute bottom-0 left-0 right-0 h-[2px] pointer-events-none overflow-hidden">
        <div
          className="h-full w-full"
          style={{
            background:
              "linear-gradient(90deg, transparent, hsl(226 85% 52%), hsl(262 83% 58%), hsl(226 85% 52%), transparent)",
            backgroundSize: "200% 100%",
            animation: "gradient-shift 6s linear infinite",
          }}
        />
      </div>

      <div className="flex items-center gap-2">
        <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
      </div>

      <div className="flex items-center gap-2">
        {/* Notificações */}
        <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground relative">
          <Bell className="h-5 w-5" />
          <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full gradient-brand pulse-gradient" />
        </Button>

        {/* Toggle tema */}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          className="text-muted-foreground hover:text-foreground"
        >
          {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </Button>

        {/* Avatar com anel degradê */}
        <div className="ring-gradient glow-primary ml-1">
          <div className="w-8 h-8 rounded-full bg-card flex items-center justify-center text-xs font-semibold gradient-brand-text">
            {initials}
          </div>
        </div>
      </div>
    </header>
  );
}
