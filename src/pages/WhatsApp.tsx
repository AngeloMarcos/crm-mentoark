import { CRMLayout } from "@/components/CRMLayout";
import { WhatsAppInterface } from "@/components/WhatsAppInterface";
import { InstanceManagementPanel } from "@/components/whatsapp/InstanceManagementPanel";
import { TesteInstancias } from "@/components/whatsapp/TesteInstancias";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Inbox, MessageSquare, Smartphone, FlaskConical } from "lucide-react";
import { useSearchParams } from "react-router-dom";

const VALID_TABS = ["conversas", "instancias", "diagnostico"] as const;
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
      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="conversas" className="gap-2">
            <MessageSquare className="h-4 w-4" /> Conversas
          </TabsTrigger>
          <TabsTrigger value="instancias" className="gap-2">
            <Smartphone className="h-4 w-4" /> Instâncias
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
        <TabsContent value="diagnostico" className="m-0">
          <TesteInstancias />
        </TabsContent>
      </Tabs>
    </CRMLayout>
  );
}
