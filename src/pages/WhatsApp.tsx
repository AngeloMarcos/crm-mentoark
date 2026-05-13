import { CRMLayout } from "@/components/CRMLayout";
import { WhatsAppConversas } from "@/components/whatsapp/WhatsAppConversas";

export default function WhatsAppPage() {
  return (
    <CRMLayout>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">WhatsApp Evolution</h1>
          <p className="text-muted-foreground text-sm">Gerencie suas conversas em tempo real através da Evolution API</p>
        </div>
        
        <WhatsAppConversas />
      </div>
    </CRMLayout>
  );
}
