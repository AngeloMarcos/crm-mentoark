import {
  LayoutDashboard, BarChart3, UserPlus, Tags, BookUser,
  PhoneCall, Filter, MessageCircle, Timer, Zap,
  Send, Megaphone, Rocket, GitBranch, Bot, Plug,
  Brain, Package, Images, BookOpen, ShieldCheck, LogOut,
  ChevronDown,
} from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import logo from "@/assets/mentoark-logo.png";
import { NavLink } from "@/components/NavLink";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarMenu,
  SidebarMenuButton, SidebarMenuItem, SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";

// ── Definição dos grupos e itens ──────────────────────────────────────────────

interface NavItem {
  title: string;
  url: string;
  icon: React.ElementType;
  modulo: string;
  color: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    label: "Visão Geral",
    items: [
      { title: "Dashboard",     url: "/dashboard", icon: LayoutDashboard, modulo: "dashboard", color: "text-blue-500" },
      { title: "Central de BI", url: "/bi",        icon: BarChart3,       modulo: "dashboard", color: "text-cyan-500" },
    ],
  },
  {
    label: "Clientes & Vendas",
    items: [
      { title: "Leads",           url: "/leads",      icon: UserPlus,      modulo: "leads",    color: "text-indigo-500"  },
      { title: "Tags e Funil",    url: "/tags-funil", icon: Tags,          modulo: "leads",    color: "text-violet-500"  },
      { title: "Contatos",        url: "/contatos",   icon: BookUser,      modulo: "contatos", color: "text-purple-500"  },
      { title: "Funil de Vendas", url: "/funil",      icon: Filter,        modulo: "funil",    color: "text-orange-500"  },
    ],
  },
  {
    label: "Atendimento",
    items: [
      { title: "WhatsApp",          url: "/whatsapp",  icon: MessageCircle, modulo: "whatsapp",  color: "text-green-500"   },
      { title: "Discagem",          url: "/discagem",  icon: PhoneCall,     modulo: "discagem",  color: "text-emerald-500" },
      { title: "SLA",               url: "/sla",       icon: Timer,         modulo: "whatsapp",  color: "text-yellow-500"  },
      { title: "Respostas Rápidas", url: "/respostas", icon: Zap,           modulo: "whatsapp",  color: "text-amber-500"   },
    ],
  },
  {
    label: "Comunicação",
    items: [
      { title: "Disparos",          url: "/disparos",          icon: Send,     modulo: "disparos",  color: "text-sky-500"   },
      { title: "Campanhas",         url: "/campanhas",         icon: Megaphone, modulo: "campanhas", color: "text-rose-500"  },
      { title: "Marketing Digital", url: "/marketing-digital", icon: Rocket,   modulo: "campanhas", color: "text-blue-600"  },
    ],
  },
  {
    label: "Automação & IA",
    items: [
      { title: "Workflows",         url: "/workflows",   icon: GitBranch, modulo: "workflows",   color: "text-violet-500" },
      { title: "Agentes",           url: "/agentes",     icon: Bot,       modulo: "agentes",     color: "text-teal-500"   },
      { title: "Cérebro do Agente", url: "/cerebro",     icon: Brain,     modulo: "cerebro",     color: "text-purple-400" },
      { title: "Integrações",       url: "/integracoes", icon: Plug,      modulo: "integracoes", color: "text-amber-500"  },
    ],
  },
  {
    label: "Conteúdo",
    items: [
      { title: "Catálogo",      url: "/catalogo", icon: Package,    modulo: "catalogo", color: "text-fuchsia-500" },
      { title: "Galeria",       url: "/galeria",  icon: Images,     modulo: "galeria",  color: "text-pink-500"    },
      { title: "Documentação",  url: "/docs",     icon: BookOpen,   modulo: "docs",     color: "text-slate-400"   },
      { title: "Usuários",      url: "/usuarios", icon: ShieldCheck, modulo: "usuarios", color: "text-teal-600"   },
    ],
  },
];

// ── Componente de grupo colapsável ────────────────────────────────────────────

function NavGroupSection({
  group,
  collapsed,
  hasModulo,
  location,
}: {
  group: NavGroup;
  collapsed: boolean;
  hasModulo: (m: string) => boolean;
  location: { pathname: string };
}) {
  const visibleItems = group.items.filter((i) => hasModulo(i.modulo));
  if (visibleItems.length === 0) return null;

  // Grupo começa aberto se algum item está ativo
  const hasActive = visibleItems.some((i) =>
    i.url === "/dashboard"
      ? location.pathname === "/dashboard"
      : location.pathname === i.url || location.pathname.startsWith(i.url + "/")
  );

  const [open, setOpen] = useState<boolean>(hasActive || true);

  return (
    <SidebarGroup className="py-0">
      {/* Label da categoria */}
      {!collapsed && (
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center justify-between w-full px-3 pt-4 pb-1.5 group"
        >
          <span className="text-[10px] font-semibold tracking-widest uppercase text-muted-foreground/60 group-hover:text-muted-foreground transition-colors">
            {group.label}
          </span>
          <ChevronDown
            className={`h-3 w-3 text-muted-foreground/40 transition-transform duration-200 ${open ? "rotate-0" : "-rotate-90"}`}
          />
        </button>
      )}

      {/* Divisor quando colapsado (sem label) */}
      {collapsed && (
        <div className="mx-3 my-2 h-px bg-sidebar-border/40" />
      )}

      {/* Itens do grupo */}
      {(open || collapsed) && (
        <SidebarGroupContent>
          <SidebarMenu>
            {visibleItems.map((item) => {
              const isActive =
                item.url === "/dashboard"
                  ? location.pathname === "/dashboard"
                  : location.pathname === item.url || location.pathname.startsWith(item.url + "/");

              return (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === "/dashboard"}
                      title={collapsed ? item.title : undefined}
                      className={`group relative flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ${
                        isActive
                          ? "gradient-brand-subtle font-medium shadow-[inset_0_0_0_1px_hsl(262_83%_58%/0.20)]"
                          : "text-sidebar-foreground hover:bg-sidebar-accent hover:translate-x-1"
                      }`}
                    >
                      {isActive && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 h-7 w-[3px] rounded-r gradient-brand shadow-[0_0_12px_hsl(262_83%_58%/0.6)]" />
                      )}
                      <item.icon
                        className={`h-5 w-5 shrink-0 transition-all duration-300 ${
                          isActive
                            ? item.color + " scale-110 brightness-125"
                            : "text-muted-foreground group-hover:" + item.color + " group-hover:scale-110"
                        }`}
                      />
                      {!collapsed && (
                        <span className={isActive ? "gradient-brand-text" : ""}>{item.title}</span>
                      )}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroupContent>
      )}
    </SidebarGroup>
  );
}

// ── AppSidebar principal ──────────────────────────────────────────────────────

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const navigate = useNavigate();
  const { hasModulo, signOut } = useAuth();

  const handleLogout = async () => {
    await signOut();
    navigate("/login");
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border sidebar-gradient">
      {/* Logo */}
      <div className="relative flex items-center gap-2 px-4 py-4 border-b border-sidebar-border/60">
        <div className="w-9 h-9 rounded-lg gradient-brand flex items-center justify-center shrink-0 animate-breathe overflow-hidden">
          <img src={logo} alt="MentoArk" className="w-full h-full object-cover" />
        </div>
        {!collapsed && (
          <span className="font-bold text-lg tracking-tight">
            <span className="text-sidebar-foreground">Mento</span>
            <span className="gradient-text-animated">Ark</span>
          </span>
        )}
        <div className="absolute bottom-0 left-3 right-3 h-px gradient-brand opacity-40" />
      </div>

      <SidebarContent className="pt-1 overflow-y-auto">
        {navGroups.map((group) => (
          <NavGroupSection
            key={group.label}
            group={group}
            collapsed={collapsed}
            hasModulo={hasModulo}
            location={location}
          />
        ))}
      </SidebarContent>

      <SidebarFooter className="relative border-t border-sidebar-border/60 p-3 before:content-[''] before:absolute before:top-0 before:left-3 before:right-3 before:h-px before:gradient-brand before:opacity-40">
        <SidebarMenuButton
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2 text-muted-foreground hover:text-foreground w-full rounded-lg hover:bg-sidebar-accent transition-colors"
        >
          <LogOut className="h-5 w-5 shrink-0" />
          {!collapsed && <span>Sair</span>}
        </SidebarMenuButton>
      </SidebarFooter>
    </Sidebar>
  );
}
