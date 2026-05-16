import { CRMLayout } from "@/components/CRMLayout";
import { WhatsAppInterface } from "@/components/WhatsAppInterface";

export default function WhatsAppPage() {
  return (
    <CRMLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">WhatsApp Business</h1>
          <p className="text-muted-foreground text-sm">Acompanhe e gerencie as conversas do Agente IA em tempo real</p>
        </div>

        {/* Interface de Chat baseada no Aesir ERP */}
        <WhatsAppInterface />
      </div>
    </CRMLayout>
  );
}
