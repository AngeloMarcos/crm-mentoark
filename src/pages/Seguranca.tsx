import { CRMLayout } from "@/components/CRMLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Lock, Users, Database, ShieldCheck, Key, 
  Settings, Bot, Globe 
} from "lucide-react";
import { UsuariosAcessos } from "@/components/seguranca/UsuariosAcessos";
import { MapaBancoDados } from "@/components/seguranca/MapaBancoDados";
import { LoginsSessoes } from "@/components/seguranca/LoginsSessoes";
import { ChavesIntegracoes } from "@/components/seguranca/ChavesIntegracoes";

export default function SegurancaPage() {
  return (
    <CRMLayout>
      <div className="space-y-6">
        {/* Header Profissional */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center shadow-lg shadow-red-500/5">
              <Lock className="h-6 w-6 text-red-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white">Painel de Segurança</h1>
              <p className="text-sm text-muted-foreground">Monitoramento de acessos, integridade de dados e configurações master.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider">Sistema Operacional</span>
            </div>
          </div>
        </div>

        <Tabs defaultValue="usuarios" className="space-y-6">
          <div className="border-b border-white/10">
            <TabsList className="bg-transparent h-auto p-0 gap-8">
              {[
                { value: "usuarios", label: "Usuários & Acessos", icon: Users },
                { value: "banco", label: "Banco & Multi-tenant", icon: Database },
                { value: "auth", label: "Logins & Sessões", icon: ShieldCheck },
                { value: "chaves", label: "Chaves & Integrações", icon: Key },
              ].map((tab) => (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className="bg-transparent border-b-2 border-transparent data-[state=active]:border-red-500 data-[state=active]:bg-transparent rounded-none px-0 py-3 text-sm font-medium text-muted-foreground data-[state=active]:text-white transition-all gap-2"
                >
                  <tab.icon className="h-4 w-4" />
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <TabsContent value="usuarios" className="animate-in fade-in duration-300">
            <UsuariosAcessos />
          </TabsContent>

          <TabsContent value="banco" className="animate-in fade-in duration-300">
            <MapaBancoDados />
          </TabsContent>

          <TabsContent value="auth" className="animate-in fade-in duration-300">
            <LoginsSessoes />
          </TabsContent>

          <TabsContent value="chaves" className="animate-in fade-in duration-300">
            <ChavesIntegracoes />
          </TabsContent>
        </Tabs>
      </div>
    </CRMLayout>
  );
}
