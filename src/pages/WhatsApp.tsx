/**
 * WhatsApp.tsx — Página principal do módulo WhatsApp (/whatsapp), com 4 abas: Conversas
 * (WhatsAppInterface, o chat em si), Instâncias (InstanceManagementPanel, conectar/desconectar
 * Evolution + Score de Saúde real), Maturador (MaturadorNumeros, aquecimento de número novo
 * trocando mensagem pré-escrita entre 2 instâncias próprias, zero IA — Sprint Score Real +
 * Maturador, 2026-08-09) e Diagnóstico (TesteInstancias, ferramenta de teste de conectividade).
 *
 * [AUDITORIA] LÓGICA: a aba "Diagnóstico" aqui renderiza TesteInstancias, um componente
 * diferente de src/pages/admin/DiagnosticoWhatsApp.tsx (outra página, rota separada, também
 * auditada neste módulo). Nomes muito parecidos para propósitos parecidos mas distintos — vale
 * ter isso em mente para não confundir os dois ao dar manutenção.
 */
import { CRMLayout } from "@/components/CRMLayout";
import { WhatsAppInterface } from "@/components/WhatsAppInterface";
import { InstanceManagementPanel } from "@/components/whatsapp/InstanceManagementPanel";
import { TesteInstancias } from "@/components/whatsapp/TesteInstancias";
import { MaturadorNumeros } from "@/components/whatsapp/MaturadorNumeros";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Inbox, MessageSquare, Smartphone, FlaskConical, MessageCircleHeart } from "lucide-react";
import { useSearchParams } from "react-router-dom";

const VALID_TABS = ["conversas", "instancias", "maturador", "diagnostico"] as const;
type TabValue = (typeof VALID_TABS)[number];

export default function WhatsAppPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab") as TabValue | null;
  const activeTab: TabValue = tabParam && VALID_TABS.includes(tabParam) ? tabParam : "conversas";

  const handleTabChange = (value: string) => {
    if (value === "conversas") {
      searchParams.delete("tab");
    } else {
      searchParams.set("tab", value);
    }
    setSearchParams(searchParams, { replace: true });
  };

  return (
    <CRMLayout>
      <div className="surface-whatsapp">
      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="conversas" className="gap-2">
            <MessageSquare className="h-4 w-4" /> Conversas
          </TabsTrigger>
          <TabsTrigger value="instancias" className="gap-2">
            <Smartphone className="h-4 w-4" /> Instâncias
          </TabsTrigger>
          <TabsTrigger value="maturador" className="gap-2">
            <MessageCircleHeart className="h-4 w-4" /> Maturador
          </TabsTrigger>
          <TabsTrigger value="diagnostico" className="gap-2">
            <FlaskConical className="h-4 w-4" /> 🔬 Diagnóstico
          </TabsTrigger>
        </TabsList>
        <TabsContent value="conversas" className="m-0">
          <WhatsAppInterface />
        </TabsContent>
        <TabsContent value="instancias" className="m-0">
          <InstanceManagementPanel />
        </TabsContent>
        <TabsContent value="maturador" className="m-0">
          <MaturadorNumeros />
        </TabsContent>
        <TabsContent value="diagnostico" className="m-0">
          <TesteInstancias />
        </TabsContent>
      </Tabs>
      </div>
    </CRMLayout>
  );
}
