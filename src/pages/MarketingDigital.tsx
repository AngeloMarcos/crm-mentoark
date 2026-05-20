import { useState } from "react";
import { Megaphone, Facebook, Instagram, MessageCircle, BarChart3, Settings2, Zap } from "lucide-react";
import { CRMLayout } from "@/components/CRMLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useMetaStatus } from "@/hooks/useMetaStatus";

// Placeholders substituídos nos prompts seguintes
function PlaceholderTab({ texto }: { texto: string }) {
  return (
    <div className="rounded-xl border border-dashed p-16 text-center text-muted-foreground flex flex-col items-center gap-3 mt-6">
      <Zap className="h-10 w-10 opacity-20" />
      <p className="font-medium">{texto}</p>
    </div>
  );
}

export default function MarketingDigitalPage() {
  const meta = useMetaStatus();

  return (
    <CRMLayout>
      <div className="space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/15 text-blue-600 flex items-center justify-center">
              <Megaphone className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Marketing Digital</h1>
              <p className="text-sm text-muted-foreground">
                Campanhas Facebook · Instagram · WhatsApp
              </p>
            </div>
          </div>

          {/* Status da conta Meta */}
          {!meta.loading && (
            <div className="flex items-center gap-2">
              {meta.conectado ? (
                <Badge className="bg-green-100 text-green-700 border-green-300 gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                  Meta Ads conectado · {meta.nome_conta}
                </Badge>
              ) : (
                <Badge className="bg-yellow-100 text-yellow-700 border-yellow-300 gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 inline-block" />
                  Meta não conectado — configure na aba Conta
                </Badge>
              )}
            </div>
          )}
        </div>

        {/* Plataformas suportadas */}
        <div className="flex gap-3 flex-wrap">
          {[
            { icon: Facebook,       label: "Facebook Ads",   cor: "text-blue-600 bg-blue-50 border-blue-200" },
            { icon: Instagram,      label: "Instagram Ads",  cor: "text-pink-600 bg-pink-50 border-pink-200" },
            { icon: MessageCircle,  label: "WhatsApp Leads", cor: "text-green-600 bg-green-50 border-green-200" },
          ].map(({ icon: Icon, label, cor }) => (
            <div key={label} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-medium ${cor}`}>
              <Icon className="h-3.5 w-3.5" />
              {label}
            </div>
          ))}
        </div>

        {/* Abas */}
        <Tabs defaultValue="projecao">
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="projecao" className="gap-1.5">
              <BarChart3 className="h-3.5 w-3.5" /> Projeção
            </TabsTrigger>
            <TabsTrigger value="campanhas" className="gap-1.5">
              <Megaphone className="h-3.5 w-3.5" /> Campanhas
            </TabsTrigger>
            <TabsTrigger value="leads" className="gap-1.5">
              <Zap className="h-3.5 w-3.5" /> Leads Captados
            </TabsTrigger>
            <TabsTrigger value="criativo" className="gap-1.5">
              <Instagram className="h-3.5 w-3.5" /> Criativos
            </TabsTrigger>
            <TabsTrigger value="conta" className="gap-1.5">
              <Settings2 className="h-3.5 w-3.5" /> Conta Meta
            </TabsTrigger>
          </TabsList>

          <TabsContent value="projecao">
            <PlaceholderTab texto="Simulador de campanha — Prompt 2" />
          </TabsContent>
          <TabsContent value="campanhas">
            <PlaceholderTab texto="Dashboard de campanhas reais — Prompt 4" />
          </TabsContent>
          <TabsContent value="leads">
            <PlaceholderTab texto="Leads Ads + ativar Cris — Prompt 5" />
          </TabsContent>
          <TabsContent value="criativo">
            <PlaceholderTab texto="Galeria de criativos e análise — Prompt futuro" />
          </TabsContent>
          <TabsContent value="conta">
            <PlaceholderTab texto="Conexão OAuth Meta Ads — Prompt 5" />
          </TabsContent>
        </Tabs>

      </div>
    </CRMLayout>
  );
}
