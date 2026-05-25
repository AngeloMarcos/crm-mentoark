import { CRMLayout } from "@/components/CRMLayout";
import { WhatsAppInterface } from "@/components/WhatsAppInterface";
import { InstanceManagementPanel } from "@/components/whatsapp/InstanceManagementPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Inbox, MessageSquare, Smartphone } from "lucide-react";

export default function WhatsAppPage() {
  return (
    <CRMLayout>
      <Tabs defaultValue="conversas" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="conversas" className="gap-2">
            <MessageSquare className="h-4 w-4" /> Conversas
          </TabsTrigger>
          <TabsTrigger value="caixa" className="gap-2">
            <Inbox className="h-4 w-4" /> Caixa de Entrada
          </TabsTrigger>
          <TabsTrigger value="instancias" className="gap-2">
            <Smartphone className="h-4 w-4" /> Instâncias
          </TabsTrigger>
        </TabsList>
        <TabsContent value="conversas" className="m-0">
          <WhatsAppInterface />
        </TabsContent>
        <TabsContent value="caixa" className="m-0">
          <WhatsAppInterface />
        </TabsContent>
        <TabsContent value="instancias" className="m-0">
          <InstanceManagementPanel />
        </TabsContent>
      </Tabs>
    </CRMLayout>
  );
}
