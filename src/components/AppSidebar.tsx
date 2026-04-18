import {
  LayoutDashboard, Users, Kanban, MessageCircle, Megaphone, Plug, LogOut, ChevronLeft, Brain, ShieldCheck, PhoneCall,
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
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Leads", url: "/leads", icon: Users },
  { title: "Discagem", url: "/discagem", icon: PhoneCall },
  { title: "Funil de Vendas", url: "/funil", icon: Kanban },
  { title: "WhatsApp", url: "/whatsapp", icon: MessageCircle },
  { title: "Campanhas", url: "/campanhas", icon: Megaphone },
  { title: "Integrações", url: "/integracoes", icon: Plug },
  { title: "Cérebro do Agente", url: "/cerebro", icon: Brain },
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
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <div className="flex items-center gap-2 px-4 py-4 border-b border-sidebar-border">
        <img src={logo} alt="MentoArk" className="w-9 h-9 rounded-lg object-cover shrink-0" />
        {!collapsed && (
          <span className="font-bold text-lg text-sidebar-foreground tracking-tight">
            Mento<span className="text-primary">Ark</span>
          </span>
        )}
      </div>

      <SidebarContent className="pt-2">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === "/dashboard"}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
                      activeClassName="bg-primary/10 text-primary font-medium"
                    >
                      <item.icon className="h-5 w-5 shrink-0" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-3">
        <SidebarMenuButton onClick={handleLogout} className="flex items-center gap-3 px-3 py-2 text-muted-foreground hover:text-foreground w-full rounded-lg hover:bg-sidebar-accent transition-colors">
          <LogOut className="h-5 w-5 shrink-0" />
          {!collapsed && <span>Sair</span>}
        </SidebarMenuButton>
      </SidebarFooter>
    </Sidebar>
  );
}
