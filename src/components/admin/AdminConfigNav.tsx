import { useLocation, useNavigate } from "react-router-dom";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ShieldCheck, LayoutGrid, Lock, CreditCard } from "lucide-react";
import { useAssinatura } from "@/hooks/useAssinatura";

const ITEMS = [
  { value: "/usuarios", label: "Usuários", icon: ShieldCheck },
  { value: "/usuarios/cargos", label: "Cargos", icon: LayoutGrid },
  { value: "/seguranca", label: "Segurança", icon: Lock },
  { value: "/admin/assinaturas", label: "Assinaturas", icon: CreditCard, masterOnly: true },
] as const;

/**
 * Navegação compartilhada entre as páginas de configuração administrativa
 * (Usuários, Cargos, Segurança, Assinaturas) — cada uma é uma rota própria,
 * então a troca de aba aqui navega de verdade em vez de trocar estado local.
 */
export function AdminConfigNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { assinatura } = useAssinatura();
  const souMaster = !!assinatura?.sou_master;

  const items = ITEMS.filter((i) => !i.masterOnly || souMaster);
  const current = items.find((i) => i.value === location.pathname)?.value ?? items[0].value;

  return (
    <Tabs value={current} onValueChange={(v) => navigate(v)}>
      <TabsList className="w-full justify-start overflow-x-auto">
        {items.map((item) => (
          <TabsTrigger key={item.value} value={item.value} className="gap-2">
            <item.icon className="h-4 w-4" /> {item.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
