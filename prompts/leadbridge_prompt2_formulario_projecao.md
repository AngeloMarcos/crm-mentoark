# Prompt Lovable 2 — Marketing Digital: Formulário de Projeção de Campanha

## Objetivo
Substituir o placeholder da aba "Projeção de Campanha" em `src/pages/MarketingDigital.tsx` por um formulário completo de inputs para simulação de campanha Meta Ads.

---

## Contexto
Este é o simulador da aba "Projeção de Campanha". O usuário preenche os parâmetros da campanha e clica em "Calcular Projeção". Os resultados aparecem no lado direito (Prompt 3).

---

## 1. Criar `src/components/marketing/ProjecaoForm.tsx`

```tsx
import { useState } from "react";
import { Calculator, DollarSign, Target, Users, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";

export interface ProjecaoInputs {
  orcamentoDiario: number;
  duracaoDias: number;
  objetivo: "leads" | "mensagens" | "trafego" | "conversoes";
  publicoEstimado: number;
  segmento: "imoveis" | "seguros" | "educacao" | "saude" | "varejo" | "servicos";
}

interface ProjecaoFormProps {
  onCalcular: (inputs: ProjecaoInputs) => void;
  loading: boolean;
}

const OBJETIVOS = [
  { value: "leads", label: "Geração de Leads (Lead Ads)" },
  { value: "mensagens", label: "Mensagens WhatsApp" },
  { value: "trafego", label: "Tráfego para Site" },
  { value: "conversoes", label: "Conversões" },
];

const SEGMENTOS = [
  { value: "imoveis", label: "Imóveis / Corretora" },
  { value: "seguros", label: "Seguros" },
  { value: "educacao", label: "Educação / Cursos" },
  { value: "saude", label: "Saúde / Estética" },
  { value: "varejo", label: "Varejo / E-commerce" },
  { value: "servicos", label: "Serviços Gerais" },
];

export function ProjecaoForm({ onCalcular, loading }: ProjecaoFormProps) {
  const [orcamentoDiario, setOrcamentoDiario] = useState<number>(50);
  const [duracaoDias, setDuracaoDias] = useState<number>(30);
  const [objetivo, setObjetivo] = useState<ProjecaoInputs["objetivo"]>("leads");
  const [publicoEstimado, setPublicoEstimado] = useState<number>(100000);
  const [segmento, setSegmento] = useState<ProjecaoInputs["segmento"]>("imoveis");

  const orcamentoTotal = orcamentoDiario * duracaoDias;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCalcular({ orcamentoDiario, duracaoDias, objetivo, publicoEstimado, segmento });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Calculator className="h-4 w-4 text-blue-600" />
          Parâmetros da Campanha
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">

          {/* Segmento */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              <Target className="h-3.5 w-3.5 text-muted-foreground" />
              Segmento do negócio
            </Label>
            <Select value={segmento} onValueChange={(v) => setSegmento(v as ProjecaoInputs["segmento"])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEGMENTOS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Objetivo */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              <Target className="h-3.5 w-3.5 text-muted-foreground" />
              Objetivo da campanha
            </Label>
            <Select value={objetivo} onValueChange={(v) => setObjetivo(v as ProjecaoInputs["objetivo"])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OBJETIVOS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Orçamento diário */}
          <div className="space-y-2">
            <Label className="flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                Orçamento diário
              </span>
              <span className="font-semibold text-blue-600">
                R$ {orcamentoDiario.toLocaleString("pt-BR")}
              </span>
            </Label>
            <Slider
              min={10}
              max={1000}
              step={10}
              value={[orcamentoDiario]}
              onValueChange={([v]) => setOrcamentoDiario(v)}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>R$ 10</span>
              <span>R$ 1.000</span>
            </div>
          </div>

          {/* Duração */}
          <div className="space-y-2">
            <Label className="flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                Duração da campanha
              </span>
              <span className="font-semibold text-blue-600">{duracaoDias} dias</span>
            </Label>
            <Slider
              min={7}
              max={90}
              step={1}
              value={[duracaoDias]}
              onValueChange={([v]) => setDuracaoDias(v)}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>7 dias</span>
              <span>90 dias</span>
            </div>
          </div>

          {/* Tamanho do público */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5 text-muted-foreground" />
              Tamanho do público-alvo estimado
            </Label>
            <Select
              value={String(publicoEstimado)}
              onValueChange={(v) => setPublicoEstimado(Number(v))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="50000">Pequeno — até 50 mil pessoas</SelectItem>
                <SelectItem value="100000">Médio — até 100 mil pessoas</SelectItem>
                <SelectItem value="500000">Grande — até 500 mil pessoas</SelectItem>
                <SelectItem value="1000000">Muito grande — até 1 milhão</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Resumo do orçamento */}
          <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-3 text-sm">
            <p className="text-muted-foreground">Investimento total estimado</p>
            <p className="text-2xl font-bold text-blue-600 mt-0.5">
              R$ {orcamentoTotal.toLocaleString("pt-BR")}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              R$ {orcamentoDiario}/dia × {duracaoDias} dias
            </p>
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Calculando..." : "Calcular Projeção"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
```

---

## 2. Atualizar `src/pages/MarketingDigital.tsx`

Substituir todo o conteúdo da aba `projecao` para usar o `ProjecaoForm` e um painel de resultados placeholder:

```tsx
import { useState } from "react";
import { TrendingUp } from "lucide-react";
import { CRMLayout } from "@/components/CRMLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProjecaoForm, type ProjecaoInputs } from "@/components/marketing/ProjecaoForm";

export default function MarketingDigitalPage() {
  const [loading, setLoading] = useState(false);
  const [resultado, setResultado] = useState<ProjecaoInputs | null>(null);

  const handleCalcular = async (inputs: ProjecaoInputs) => {
    setLoading(true);
    // Simula um breve processamento
    await new Promise((r) => setTimeout(r, 800));
    setResultado(inputs);
    setLoading(false);
  };

  return (
    <CRMLayout>
      <div className="space-y-6">
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

        <Tabs defaultValue="projecao">
          <TabsList>
            <TabsTrigger value="projecao">Projeção de Campanha</TabsTrigger>
            <TabsTrigger value="campanhas">Campanhas</TabsTrigger>
            <TabsTrigger value="leads">Leads Captados</TabsTrigger>
          </TabsList>

          <TabsContent value="projecao" className="mt-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <ProjecaoForm onCalcular={handleCalcular} loading={loading} />
              {/* Painel de resultados — adicionado no Prompt 3 */}
              <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground flex items-center justify-center">
                {resultado
                  ? "Resultados serão exibidos aqui (Prompt 3)"
                  : "Preencha o formulário e clique em Calcular."}
              </div>
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
Nenhum outro arquivo além de `MarketingDigital.tsx` e o novo `src/components/marketing/ProjecaoForm.tsx`.
