import {
  LayoutDashboard, LayoutGrid, BarChart3, UserPlus, Tags, BookUser,
  PhoneCall, Filter, MessageCircle, Timer, Zap,
  Send, Megaphone, Rocket, GitBranch, Bot, Plug,
  Brain, Package, Images, BookOpen, ShieldCheck, LogOut, ShieldOff,
  Lock, MessagesSquare, Car,
  Library, Settings as SettingsIcon, Users as UsersIcon, Link2, Monitor, Users2,
  Activity, LayoutTemplate, Download, CreditCard,
} from "lucide-react";
import { useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useAssinatura } from "@/hooks/useAssinatura";
import logo from "@/assets/mentoark-app-icon-2026.png";
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
  /** Só o master do sistema (MASTER_EMAILS) vê — ver `assinatura.sou_master`. */
  masterOnly?: boolean;
}

interface NavGroup {
  label: string;
  icon: React.ElementType;
  color: string;
  adminOnly?: boolean;
  items: NavItem[];
}

// [AUDITORIA] FIX APLICADO (2026-09-11 — pedido do usuário: "quero que elas fiquem sempre
// abertas mais facil de usar e de um agrupamento melhor com titulo melhor e dinamica melhor"):
// estrutura antes tinha 2 níveis (Categoria → Subgrupo colapsável → Itens), mas 7 das 8
// categorias tinham exatamente 1 subgrupo — o "subgrupo" só repetia um título parecido com o da
// categoria (ex: categoria "VENDAS" > subgrupo "Pipeline Comercial") atrás de um clique extra
// pra abrir, sem agrupar nada de verdade. Achatado pra 1 nível só: cada categoria já mostra sua
// lista de itens direto, sem accordion — nada mais precisa de clique pra aparecer. O único
// subgrupo que era genuinamente 2 seções distintas ("WhatsApp Chat" + "Telefonia", dentro de
// ATENDIMENTO) foi unificado numa lista só (Discagem entrou junto com WhatsApp/Monitor/etc. —
// telefonia É atendimento, não precisa de seção própria pra 1 item). Ícone de cada categoria
// (antes só no cabeçalho do subgrupo colapsável) sobe pro título da categoria — título mais
// informativo, sem depender de emoji no meio da string pra dar identidade visual.
const navGroups: NavGroup[] = [
  {
    label: "Visão Geral",
    icon: LayoutDashboard,
    color: "text-blue-500",
    items: [
      { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard, modulo: "dashboard", color: "text-blue-500" },
      { title: "Central de BI", url: "/bi", icon: BarChart3, modulo: "dashboard", color: "text-cyan-500" },
    ],
  },
  {
    label: "Equipe",
    icon: Users2,
    color: "text-indigo-500",
    items: [
      { title: "Minha Equipe", url: "/equipe", icon: Users2, modulo: "leads", color: "text-indigo-500" },
      { title: "Chat da Equipe", url: "/chat-equipe", icon: UsersIcon, modulo: "whatsapp", color: "text-purple-400" },
      { title: "Smart Links & QR Code", url: "/smart-links", icon: Link2, modulo: "whatsapp", color: "text-fuchsia-400" },
    ],
  },
  {
    label: "Vendas",
    icon: Filter,
    color: "text-orange-500",
    items: [
      { title: "Leads", url: "/leads", icon: UserPlus, modulo: "leads", color: "text-indigo-500" },
      { title: "Exportar Dados", url: "/exportar-dados", icon: Download, modulo: "leads", color: "text-emerald-500" },
      { title: "Contatos", url: "/contatos", icon: BookUser, modulo: "contatos", color: "text-purple-500" },
      { title: "Tags e Funil", url: "/tags-funil", icon: Tags, modulo: "leads", color: "text-violet-500" },
      { title: "Funil de Vendas", url: "/funil", icon: Filter, modulo: "funil", color: "text-orange-500" },
      { title: "Kanban / Tarefas", url: "/kanban", icon: LayoutGrid, modulo: "leads", color: "text-blue-500" },
    ],
  },
  {
    label: "Atendimento",
    icon: MessagesSquare,
    color: "text-green-500",
    items: [
      { title: "WhatsApp", url: "/whatsapp", icon: MessageCircle, modulo: "whatsapp", color: "text-green-500" },
      { title: "Monitor", url: "/monitor-whatsapp", icon: Monitor, modulo: "whatsapp", color: "text-blue-400" },
      { title: "Respostas Rápidas", url: "/respostas-rapidas", icon: Zap, modulo: "whatsapp", color: "text-amber-500" },
      { title: "Corridas Pendentes", url: "/corridas-pendentes", icon: Car, modulo: "whatsapp", color: "text-cyan-500" },
      { title: "SLA / Gestão", url: "/sla", icon: Timer, modulo: "whatsapp", color: "text-yellow-500" },
      { title: "Discagem", url: "/discagem", icon: PhoneCall, modulo: "discagem", color: "text-emerald-500" },
    ],
  },
  {
    label: "Comunicação",
    icon: Megaphone,
    color: "text-rose-500",
    items: [
      { title: "Disparos", url: "/disparos", icon: Send, modulo: "disparos", color: "text-sky-500" },
      { title: "Templates", url: "/disparos/templates", icon: LayoutTemplate, modulo: "disparos", color: "text-indigo-500" },
      { title: "Campanhas", url: "/campanhas", icon: Megaphone, modulo: "campanhas", color: "text-rose-500" },
      { title: "Marketing Digital", url: "/marketing-digital", icon: Rocket, modulo: "campanhas", color: "text-blue-600" },
    ],
  },
  {
    label: "Conteúdo",
    icon: Library,
    color: "text-fuchsia-500",
    items: [
      { title: "Catálogo", url: "/catalogo", icon: Package, modulo: "catalogo", color: "text-fuchsia-500" },
      { title: "Galeria", url: "/galeria", icon: Images, modulo: "galeria", color: "text-pink-500" },
      { title: "Documentação", url: "/docs", icon: BookOpen, modulo: "docs", color: "text-slate-400" },
    ],
  },
  {
    label: "IA & Automação",
    icon: Bot,
    color: "text-teal-500",
    items: [
      { title: "Agentes de IA", url: "/agentes", icon: Bot, modulo: "agentes", color: "text-teal-500" },
      { title: "Configuração da IA", url: "/cerebro", icon: Brain, modulo: "cerebro", color: "text-purple-400" },
      { title: "Workflows", url: "/workflows", icon: GitBranch, modulo: "workflows", color: "text-violet-500" },
      { title: "Uso de IA", url: "/uso-ia", icon: Activity, modulo: "agentes", color: "text-pink-500" },
    ],
  },
  {
    label: "Administração",
    icon: SettingsIcon,
    color: "text-teal-600",
    items: [
      { title: "Usuários", url: "/usuarios", icon: ShieldCheck, modulo: "usuarios", color: "text-teal-600", adminOnly: true },
      { title: "Assinaturas", url: "/admin/assinaturas", icon: CreditCard, modulo: "usuarios", color: "text-emerald-500", adminOnly: true, masterOnly: true },
      { title: "Segurança", url: "/seguranca", icon: Lock, modulo: "usuarios", color: "text-red-400", adminOnly: true },
      { title: "Conectores", url: "/integracoes", icon: Plug, modulo: "integracoes", color: "text-amber-500" },
    ],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function isRouteActive(pathname: string, url: string) {
  const base = url.split("?")[0];
  if (base === "/dashboard") return pathname === "/dashboard";
  return pathname === base || pathname.startsWith(base + "/");
}

// ── Categoria (sempre expandida — sem accordion) ───────────────────────────────

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
  const { assinatura } = useAssinatura();
  const souMaster = !!assinatura?.sou_master;

  const visibleItems = useMemo(() => {
    return group.items.filter((i) => {
      if (!hasModulo(i.modulo)) return false;
      if (i.adminOnly && !isAdmin) return false;
      if (i.masterOnly && !souMaster) return false;
      if (equipeRole === "membro" && !isAdmin) {
        const allowedPaths = ["/dashboard", "/leads", "/contatos", "/whatsapp", "/equipe"];
        if (!allowedPaths.some((path) => i.url.startsWith(path))) return false;
      }
      return true;
    });
  }, [group.items, hasModulo, isAdmin, equipeRole, souMaster]);

  if (visibleItems.length === 0 || (group.adminOnly && !isAdmin)) return null;

  const Icon = group.icon;
  const hasActive = visibleItems.some((i) => isRouteActive(location.pathname, i.url));

  // Modo colapsado (sidebar mini): só os ícones dos itens, sem cabeçalho de categoria.
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
                      ? "gradient-brand-subtle shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.18),0_0_12px_hsl(var(--primary)/0.12)]"
                      : "hover:bg-sidebar-accent hover:shadow-[inset_0_1px_0_hsl(var(--primary)/0.05)]"
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
    <SidebarGroup className="py-0">
      <div className="flex items-center gap-2 px-4 pt-4 pb-1.5">
        <Icon className={`h-3.5 w-3.5 shrink-0 ${hasActive ? group.color : "text-muted-foreground/60"}`} />
        <span className={`text-[11px] font-semibold tracking-wide uppercase ${hasActive ? group.color : "text-muted-foreground/60"}`}>
          {group.label}
        </span>
      </div>

      <SidebarGroupContent className="px-2">
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
                        ? "gradient-brand-subtle font-medium shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.14),0_0_14px_hsl(var(--primary)/0.10)]"
                        : "text-sidebar-foreground/90 hover:bg-sidebar-accent hover:translate-x-0.5 hover:shadow-[inset_0_1px_0_hsl(var(--primary)/0.04)]"
                    }`}
                  >
                    {active && (
                      <span className="absolute -left-1 top-1/2 -translate-y-1/2 h-5 w-[2px] rounded-r gradient-brand shadow-[0_0_10px_hsl(var(--primary)/0.7)]" />
                    )}
                    <item.icon
                      className={`h-4 w-4 shrink-0 transition-all duration-300 ${
                        active ? item.color + " scale-110 drop-shadow-[0_0_5px_hsl(var(--primary)/0.3)]" : "text-muted-foreground group-hover:" + item.color
                      }`}
                    />
                    <span className={`text-[13px] ${active ? "gradient-brand-text" : ""}`}>{item.title}</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
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
  const { hasModulo, signOut } = useAuth();

  const handleLogout = async () => {
    await signOut();
    navigate("/login");
  };

  return (
    // [AUDITORIA] BUG (achado 2026-07-28): `collapsible="icon"` fazia o toggle (botão no
    // AppHeader / Ctrl+B) só encolher a sidebar pra uma régua de ícones de 3rem — nunca some de
    // verdade. Como o breakpoint "mobile" do shadcn (`useIsMobile`, hooks/use-mobile.tsx) só
    // considera <768px, qualquer tablet em paisagem (e a maioria em retrato) cai no modo desktop
    // e fica permanentemente com esses 3rem tomando espaço — some com o chat do WhatsApp (que já
    // tem 3 colunas de largura fixa) sobrando pouquíssimo espaço real de conteúdo. `offcanvas` é
    // o modo que a própria biblioteca já suporta pra sumir de vez (mesmo botão/atalho, sem UI
    // nova) — troca mínima e isolada.
    <Sidebar collapsible="offcanvas" className="border-r border-sidebar-border sidebar-gradient">
      {/* Logo */}
      <div className="relative flex items-center gap-2 px-4 py-4 border-b border-sidebar-border/60">
        <img src={logo} alt="MentoArk" className="w-9 h-9 object-contain shrink-0 animate-breathe" />
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
          className="flex items-center gap-3 px-3 py-2 text-muted-foreground hover:text-foreground w-full rounded-lg hover:bg-sidebar-accent hover:shadow-[inset_0_1px_0_hsl(var(--primary)/0.04)] transition-all duration-200"
        >
          <LogOut className="h-5 w-5 shrink-0" />
          {!collapsed && <span>Sair</span>}
        </SidebarMenuButton>
        {import.meta.env.DEV && (
          <SidebarMenuButton
            onClick={() => {
              localStorage.removeItem('access_token');
              localStorage.removeItem('crm_access_token');
              window.location.reload();
            }}
            className="flex items-center gap-3 px-3 py-2 text-red-400 hover:text-red-500 w-full rounded-lg hover:bg-red-500/10 transition-all duration-200 mt-1"
          >
            <ShieldOff className="h-5 w-5 shrink-0" />
            {!collapsed && <span>Simular Expiração</span>}
          </SidebarMenuButton>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
