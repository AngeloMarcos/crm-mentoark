import {
  LayoutDashboard, Users, Kanban, MessageCircle, Megaphone, Plug,
  LogOut, Brain, ShieldCheck, PhoneCall, Bot, Send, GitBranch,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import logo from "@/assets/mentoark-logo.png";
import { NavLink } from "@/components/NavLink";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarMenu,
  SidebarMenuButton, SidebarMenuItem, SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";

const items = [
  { title: "Dashboard",         url: "/dashboard",   icon: LayoutDashboard },
  { title: "Leads",             url: "/leads",       icon: Users           },
  { title: "Discagem",          url: "/discagem",    icon: PhoneCall       },
  { title: "Funil de Vendas",   url: "/funil",       icon: Kanban          },
  { title: "WhatsApp",          url: "/whatsapp",    icon: MessageCircle   },
  { title: "Disparos",          url: "/disparos",    icon: Send            },
  { title: "Workflows",         url: "/workflows",   icon: GitBranch       },
  { title: "Campanhas",         url: "/campanhas",   icon: Megaphone       },
  { title: "Integrações",       url: "/integracoes", icon: Plug            },
  { title: "Agentes",           url: "/agentes",     icon: Bot             },
  { title: "Cérebro do Agente", url: "/cerebro",     icon: Brain           },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const navigate = useNavigate();
  const { isAdmin, signOut } = useAuth();

  const handleLogout = async () => {
    await signOut();
    navigate("/login");
  };

  const menuItems = isAdmin
    ? [...items, { title: "Usuários", url: "/usuarios", icon: ShieldCheck }]
    : items;

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
        {/* Linha degradê fina abaixo do logo */}
        <div className="absolute bottom-0 left-3 right-3 h-px gradient-brand opacity-40" />
      </div>

      <SidebarContent className="pt-2">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => {
                const isActive = item.url === "/dashboard"
                  ? location.pathname === "/dashboard"
                  : location.pathname === item.url || location.pathname.startsWith(item.url + "/");
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to={item.url}
                        end={item.url === "/dashboard"}
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
                          className={`h-5 w-5 shrink-0 transition-colors ${
                            isActive ? "text-primary" : "group-hover:text-primary"
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
        </SidebarGroup>
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
