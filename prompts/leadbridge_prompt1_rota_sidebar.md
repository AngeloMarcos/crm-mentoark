# Prompt Lovable 1 — Marketing Digital: Rota, Sidebar e Página Base

## Objetivo
Criar a entrada do módulo **Marketing Digital** no CRM: rota, item na sidebar e página base com a estrutura de abas.

---

## 1. Sidebar — `src/components/AppSidebar.tsx`

Adicionar item após "Campanhas" na lista de navegação:

```tsx
{ title: "Marketing Digital", url: "/marketing-digital", icon: TrendingUp }
```

Importar `TrendingUp` do lucide-react.

---

## 2. Rota — `src/App.tsx`

Adicionar import e rota:

```tsx
import MarketingDigitalPage from "@/pages/MarketingDigital";
// Na lista de rotas protegidas:
<Route path="/marketing-digital" element={<MarketingDigitalPage />} />
```

---

## 3. Criar `src/pages/MarketingDigital.tsx`

Página base com 3 abas: **Projeção de Campanha**, **Campanhas** e **Leads Captados**.
Por ora, apenas a aba Projeção terá conteúdo — as outras mostram "Em breve".

```tsx
import { TrendingUp } from "lucide-react";
import { CRMLayout } from "@/components/CRMLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function MarketingDigitalPage() {
  return (
    <CRMLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/15 text-blue-600 flex items-center justify-center">
            <TrendingUp className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Marketing Digital</h1>
            <p className="text-sm text-muted-foreground">
              Simulação e gestão de campanhas Meta Ads
            </p>
          </div>
        </div>

        {/* Abas */}
        <Tabs defaultValue="projecao">
          <TabsList>
            <TabsTrigger value="projecao">Projeção de Campanha</TabsTrigger>
            <TabsTrigger value="campanhas">Campanhas</TabsTrigger>
            <TabsTrigger value="leads">Leads Captados</TabsTrigger>
          </TabsList>

          <TabsContent value="projecao" className="mt-6">
            {/* Conteúdo adicionado no Prompt 2 */}
            <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground">
              Simulador de campanha será adicionado aqui.
            </div>
          </TabsContent>

          <TabsContent value="campanhas" className="mt-6">
            <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground">
              Integração com Meta Ads API — Em breve.
            </div>
          </TabsContent>

          <TabsContent value="leads" className="mt-6">
            <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground">
              Leads capturados via Facebook Lead Ads — Em breve.
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </CRMLayout>
  );
}
```

---

## Não alterar
Nenhum outro arquivo além de `App.tsx`, `AppSidebar.tsx` e o novo `MarketingDigital.tsx`.
