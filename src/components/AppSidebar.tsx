import {
  LayoutDashboard, LayoutGrid, BarChart3, UserPlus, Tags, BookUser,
  PhoneCall, Filter, MessageCircle, Timer, Zap,
  Send, Megaphone, Rocket, GitBranch, Bot, Plug,
  Brain, Package, Images, BookOpen, ShieldCheck, LogOut,
  ChevronDown, Lock, MessagesSquare, Phone, Inbox, Smartphone,
  Library, Settings as SettingsIcon, Wrench, Users as UsersIcon, Link2, Monitor, Users2,
  Activity, Webhook, Database, Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import logo from "@/assets/mentoark-logo.png";
import { NavLink } from "@/components/NavLink";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarMenu,
  SidebarMenuButton, SidebarMenuItem, SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface NavItem {
  title: string;
  url: string;
  icon: React.ElementType;
  modulo: string;
  color: string;
  adminOnly?: boolean;
}

interface NavSubgroup {
  label: string;
  icon: React.ElementType;
  color: string;
  adminOnly?: boolean;
  items: NavItem[];
}

interface NavGroup {
  label: string;
  adminOnly?: boolean;
  subgroups: NavSubgroup[];
}

// ── Estrutura ─────────────────────────────────────────────────────────────────

import {
  LayoutDashboard, LayoutGrid, BarChart3, UserPlus, Tags, BookUser,
  PhoneCall, Filter, MessageCircle, Timer, Zap,
  Send, Megaphone, Rocket, GitBranch, Bot, Plug,
  Brain, Package, Images, BookOpen, ShieldCheck, LogOut,
  ChevronDown, Lock, MessagesSquare, Phone, Inbox, Smartphone,
  Library, Settings as SettingsIcon, Wrench, Users as UsersIcon, Link2, Monitor, Users2,
  Activity, Webhook, Database, Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import logo from "@/assets/mentoark-logo.png";
import { NavLink } from "@/components/NavLink";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarMenu,
  SidebarMenuButton, SidebarMenuItem, SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface NavItem {
  title: string;
  url: string;
  icon: React.ElementType;
  modulo: string;
  color: string;
  adminOnly?: boolean;
}

interface NavSubgroup {
  label: string;
  icon?: React.ElementType;
  color?: string;
  adminOnly?: boolean;
  items: NavItem[];
}

interface NavGroup {
  label: string;
  adminOnly?: boolean;
  subgroups: NavSubgroup[];
}

// ── Estrutura ─────────────────────────────────────────────────────────────────

const navGroups: NavGroup[] = [
  {
    label: "📊 VISÃO GERAL",
    subgroups: [
      {
        label: "Dashboard",
        items: [
          { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard, modulo: "dashboard", color: "text-blue-500" },
          { title: "Central de BI", url: "/bi", icon: BarChart3, modulo: "dashboard", color: "text-cyan-500" },
        ],
      },
    ],
  },
  {
    label: "🎯 VENDAS",
    subgroups: [
      {
        label: "Pipeline Comercial",
        icon: Filter,
        color: "text-orange-500",
        items: [
          { title: "Leads", url: "/leads", icon: UserPlus, modulo: "leads", color: "text-indigo-500" },
          { title: "Contatos", url: "/contatos", icon: BookUser, modulo: "contatos", color: "text-purple-500" },
          { title: "Tags e Funil", url: "/tags-funil", icon: Tags, modulo: "leads", color: "text-violet-500" },
          { title: "Funil de Vendas", url: "/funil", icon: Filter, modulo: "funil", color: "text-orange-500" },
          { title: "Kanban / Tarefas", url: "/kanban", icon: LayoutGrid, modulo: "leads", color: "text-blue-500" },
        ],
      },
    ],
  },
  {
    label: "💬 ATENDIMENTO",
    subgroups: [
      {
        label: "WhatsApp Chat",
        icon: MessagesSquare,
        color: "text-green-500",
        items: [
          { title: "WhatsApp", url: "/whatsapp", icon: MessageCircle, modulo: "whatsapp", color: "text-green-500" },
          { title: "Caixa de Entrada", url: "/whatsapp?tab=caixa", icon: Inbox, modulo: "whatsapp", color: "text-emerald-500" },
          { title: "Instâncias", url: "/whatsapp?tab=instancias", icon: Smartphone, modulo: "whatsapp", color: "text-cyan-500" },
          { title: "Monitor", url: "/monitor-whatsapp", icon: Monitor, modulo: "whatsapp", color: "text-blue-400" },
          { title: "Respostas Rápidas", url: "/respostas-rapidas", icon: Zap, modulo: "whatsapp", color: "text-amber-500" },
          { title: "SLA / Gestão", url: "/sla", icon: Timer, modulo: "whatsapp", color: "text-yellow-500" },
        ],
      },
      {
        label: "Telefonia",
        icon: Phone,
        color: "text-emerald-500",
        items: [
          { title: "Discagem", url: "/discagem", icon: PhoneCall, modulo: "discagem", color: "text-emerald-500" },
        ],
      },
    ],
  },
  {
    label: "📣 COMUNICAÇÃO",
    subgroups: [
      {
        label: "Campanhas & Disparos",
        icon: Megaphone,
        color: "text-rose-500",
        items: [
          { title: "Disparos", url: "/disparos", icon: Send, modulo: "disparos", color: "text-sky-500" },
          { title: "Campanhas", url: "/campanhas", icon: Megaphone, modulo: "campanhas", color: "text-rose-500" },
          { title: "Marketing Digital", url: "/marketing-digital", icon: Rocket, modulo: "campanhas", color: "text-blue-600" },
        ],
      },
    ],
  },
  {
    label: "📁 CONTEÚDO",
    subgroups: [
      {
        label: "Biblioteca",
        icon: Library,
        color: "text-fuchsia-500",
        items: [
          { title: "Catálogo", url: "/catalogo", icon: Package, modulo: "catalogo", color: "text-fuchsia-500" },
          { title: "Galeria", url: "/galeria", icon: Images, modulo: "galeria", color: "text-pink-500" },
          { title: "Documentação", url: "/docs", icon: BookOpen, modulo: "docs", color: "text-slate-400" },
        ],
      },
    ],
  },
  {
    label: "🤖 IA & AUTOMAÇÃO",
    adminOnly: true,
    subgroups: [
      {
        label: "Agentes & Prompts",
        icon: Bot,
        color: "text-teal-500",
        items: [
          { title: "Agentes de IA", url: "/agentes", icon: Bot, modulo: "agentes", color: "text-teal-500" },
          { title: "Configuração da IA", url: "/cerebro", icon: Brain, modulo: "cerebro", color: "text-purple-400" },
          { title: "Workflows", url: "/workflows", icon: GitBranch, modulo: "workflows", color: "text-violet-500" },
          { title: "Uso de IA", url: "/uso-ia", icon: Activity, modulo: "agentes", color: "text-pink-500" },
        ],
      },
    ],
  },
  {
    label: "👥 EQUIPE",
    subgroups: [
      {
        label: "Colaboração",
        items: [
          { title: "Minha Equipe", url: "/equipe", icon: Users2, modulo: "leads", color: "text-indigo-500" },
          { title: "Chat da Equipe", url: "/chat-equipe", icon: UsersIcon, modulo: "whatsapp", color: "text-purple-400" },
          { title: "Smart Links & QR Code", url: "/smart-links", icon: Link2, modulo: "whatsapp", color: "text-fuchsia-400" },
        ],
      },
    ],
  },
  {
    label: "⚙️ ADMINISTRAÇÃO",
    adminOnly: true,
    subgroups: [
      {
        label: "Acessos",
        icon: SettingsIcon,
        color: "text-teal-600",
        items: [
          { title: "Usuários", url: "/usuarios", icon: ShieldCheck, modulo: "usuarios", color: "text-teal-600" },
          { title: "Segurança", url: "/seguranca", icon: Lock, modulo: "usuarios", color: "text-red-400" },
        ],
      },
      {
        label: "Conectores",
        icon: Plug,
        color: "text-amber-500",
        items: [
          { title: "Gerenciar Todos", url: "/integracoes", icon: Plug, modulo: "integracoes", color: "text-amber-500" },
          { title: "WhatsApp", url: "/integracoes?tipo=evolution", icon: MessageCircle, modulo: "integracoes", color: "text-green-500" },
          { title: "Webhook", url: "/integracoes?tipo=webhook_in", icon: Webhook, modulo: "integracoes", color: "text-blue-500" },
          { title: "Supabase", url: "/integracoes?tipo=database_vector", icon: Database, modulo: "integracoes", color: "text-emerald-500" },
          { title: "OpenAI", url: "/integracoes?tipo=openai", icon: Bot, modulo: "integracoes", color: "text-purple-500" },
          { title: "Gemini", url: "/integracoes?tipo=gemini", icon: Sparkles, modulo: "integracoes", color: "text-orange-400" },
          { title: "Claude", url: "/integracoes?tipo=claude", icon: Brain, modulo: "integracoes", color: "text-violet-500" },
          { title: "ElevenLabs", url: "/integracoes?tipo=elevenlabs", icon: Activity, modulo: "integracoes", color: "text-pink-500" },
        ],
      },
    ],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function isRouteActive(pathname: string, url: string) {
  const base = url.split("?")[0];
  if (base === "/dashboard") return pathname === "/dashboard";
  return pathname === base || pathname.startsWith(base + "/");
}

// ── Subgrupo colapsável ───────────────────────────────────────────────────────

function NavSubgroupSection({
  subgroup,
  collapsed,
  hasModulo,
  location,
}: {
  subgroup: NavSubgroup;
  collapsed: boolean;
  hasModulo: (m: string) => boolean;
  location: { pathname: string };
}) {
  const { isAdmin, equipeRole } = useAuth();
  const visibleItems = useMemo(() => {
    return subgroup.items.filter((i) => {
      // 1. Permissão por módulo
      if (!hasModulo(i.modulo)) return false;

      // 2. Admin logic
      if (i.adminOnly && !isAdmin) return false;

      // 3. Equipe logic para 'membro' (admin bypassa essa restrição)
      if (equipeRole === 'membro' && !isAdmin) {
        const allowedPaths = ["/dashboard", "/leads", "/contatos", "/whatsapp", "/equipe"];
        const isAllowed = allowedPaths.some(path => i.url.startsWith(path));
        if (!isAllowed) return false;
      }

      return true;
    });
  }, [subgroup.items, hasModulo, isAdmin, equipeRole]);

  const hasActive = visibleItems.some((i) => isRouteActive(location.pathname, i.url));
  // Subgrupos admin começam expandidos; demais, abrem só se a rota ativa estiver dentro
  const [open, setOpen] = useState<boolean>(hasActive || !!subgroup.adminOnly);

  if (visibleItems.length === 0 || (subgroup.adminOnly && !isAdmin)) return null;

  const Icon = subgroup.icon;

  // Modo colapsado (sidebar mini): mostra só os ícones dos itens, sem cabeçalho expansível
  if (collapsed) {
    return (
      <SidebarMenu className="px-1">
        {visibleItems.map((item) => {
          const active = isRouteActive(location.pathname, item.url);
          return (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton asChild>
                  <NavLink
                    to={item.url}
                    end={item.url === "/dashboard"}
                    title={item.title}
                    className={`group relative flex items-center justify-center px-2 py-2 rounded-lg transition-all ${
                      active
                        ? "gradient-brand-subtle shadow-[inset_0_0_0_1px_hsl(217_91%_45%/0.18),0_0_12px_hsl(217_91%_45%/0.12)]"
                        : "hover:bg-sidebar-accent hover:shadow-[inset_0_1px_0_hsl(217_91%_45%/0.05)]"
                    }`}
                  >
                  <item.icon className={`h-5 w-5 ${active ? item.color : "text-muted-foreground"}`} />
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    );
  }

  return (
    <div className="px-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center w-full gap-2.5 px-2.5 py-2 rounded-lg transition-all duration-200 ${
          hasActive
            ? "gradient-brand-subtle shadow-[inset_0_1px_0_hsl(217_91%_45%/0.08),0_0_12px_hsl(217_91%_45%/0.10),inset_0_0_0_1px_hsl(217_91%_45%/0.14)]"
            : "hover:bg-sidebar-accent hover:shadow-[inset_0_1px_1px_hsl(217_91%_45%/0.03)]"
        }`}
      >
        <Icon className={`h-[18px] w-[18px] shrink-0 transition-all duration-300 ${hasActive ? subgroup.color + " drop-shadow-[0_0_4px_hsl(217_91%_45%/0.25)] scale-105" : "text-muted-foreground"}`} />
        <span className={`flex-1 text-left text-sm font-medium ${hasActive ? "gradient-brand-text" : "text-sidebar-foreground"}`}>
          {subgroup.label}
        </span>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground/60 transition-transform duration-200 ${open ? "rotate-0" : "-rotate-90"}`}
        />
      </button>

      {open && (
        <div className="relative mt-1 ml-[18px] pl-3 border-l border-sidebar-border/60">
          <SidebarMenu className="gap-0.5">
            {visibleItems.map((item) => {
              const active = isRouteActive(location.pathname, item.url);
              return (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === "/dashboard"}
                      className={`group relative flex items-center gap-2.5 px-2.5 py-2 rounded-md transition-all duration-200 ${
                        active
                          ? "gradient-brand-subtle font-medium shadow-[inset_0_0_0_1px_hsl(217_91%_45%/0.14),0_0_14px_hsl(217_91%_45%/0.10)]"
                          : "text-sidebar-foreground/90 hover:bg-sidebar-accent hover:translate-x-0.5 hover:shadow-[inset_0_1px_0_hsl(217_91%_45%/0.04)]"
                      }`}
                    >
                      {active && (
                        <span className="absolute -left-3 top-1/2 -translate-y-1/2 h-5 w-[2px] rounded-r gradient-brand shadow-[0_0_10px_hsl(217_91%_45%/0.7)]" />
                      )}
                      <item.icon
                        className={`h-4 w-4 shrink-0 transition-all duration-300 ${
                          active ? item.color + " scale-110 drop-shadow-[0_0_5px_hsl(217_91%_45%/0.3)]" : "text-muted-foreground group-hover:" + item.color
                        }`}
                      />
                      <span className={`text-[13px] ${active ? "gradient-brand-text" : ""}`}>{item.title}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </div>
      )}
    </div>
  );
}

// ── Categoria ─────────────────────────────────────────────────────────────────

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
  const { isAdmin, equipeRole } = useAuth();
  if (group.adminOnly && !isAdmin && equipeRole !== 'gerente') return null;

  // Filtra subgrupos visíveis (com pelo menos 1 item permitido)
  const visibleSubgroups = group.subgroups.filter((sg) => {
    if (sg.adminOnly && !isAdmin && equipeRole !== 'gerente') return false;
    
    return sg.items.some((i) => {
      if (!hasModulo(i.modulo)) return false;
      if (i.adminOnly && !isAdmin) return false;
      
      if (equipeRole === 'membro' && !isAdmin) {
        const allowedPaths = ["/dashboard", "/leads", "/contatos", "/whatsapp", "/equipe"];
        return allowedPaths.some(path => i.url.startsWith(path));
      }
      
      return true;
    });
  });
  if (visibleSubgroups.length === 0) return null;

  return (
    <SidebarGroup className="py-0">
      {!collapsed && (
        <div className="px-4 pt-4 pb-1.5">
          <span className="text-[10px] font-semibold tracking-widest uppercase text-muted-foreground/60">
            {group.label}
          </span>
        </div>
      )}
      {collapsed && <div className="mx-3 my-2 h-px bg-sidebar-border/40" />}

      <SidebarGroupContent>
        <div className="flex flex-col gap-0.5">
          {visibleSubgroups.map((sg) => (
            <NavSubgroupSection
              key={sg.label}
              subgroup={sg}
              collapsed={collapsed}
              hasModulo={hasModulo}
              location={location}
            />
          ))}
        </div>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

// ── AppSidebar principal ──────────────────────────────────────────────────────

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const navigate = useNavigate();
  const { hasModulo, signOut, isAdmin, equipeRole } = useAuth();

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

      <SidebarFooter className="relative border-t border-sidebar-border/50 p-3 before:content-[''] before:absolute before:top-0 before:left-3 before:right-3 before:h-px before:gradient-brand before:opacity-40">
        <SidebarMenuButton
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2 text-muted-foreground hover:text-foreground w-full rounded-lg hover:bg-sidebar-accent hover:shadow-[inset_0_1px_0_hsl(217_91%_45%/0.04)] transition-all duration-200"
        >
          <LogOut className="h-5 w-5 shrink-0" />
          {!collapsed && <span>Sair</span>}
        </SidebarMenuButton>
      </SidebarFooter>
    </Sidebar>
  );
}
