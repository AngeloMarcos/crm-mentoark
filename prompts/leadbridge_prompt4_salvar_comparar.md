# Prompt Lovable 4 — Marketing Digital: Salvar e Comparar Projeções

## Objetivo
Adicionar a funcionalidade de **salvar** uma projeção calculada com um nome e **comparar** até 3 simulações salvas lado a lado, tudo em memória (sem backend).

---

## Contexto
Complemento final da aba "Projeção de Campanha" em `MarketingDigital.tsx`. O usuário pode salvar o resultado de uma simulação com um nome (ex: "Campanha Junho - Imóveis"), acumular várias e ver uma tabela comparativa.

---

## 1. Criar `src/components/marketing/ProjecaoHistorico.tsx`

```tsx
import { Trash2, BarChart2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { type ProjecaoInputs } from "./ProjecaoForm";

// Reutiliza a mesma função de cálculo do ProjecaoResultados
const BENCHMARKS: Record<string, Record<string, number>> = {
  imoveis:   { leads: 35, mensagens: 18, trafego: 1.2, conversoes: 55 },
  seguros:   { leads: 28, mensagens: 15, trafego: 0.9, conversoes: 42 },
  educacao:  { leads: 12, mensagens: 8,  trafego: 0.5, conversoes: 20 },
  saude:     { leads: 20, mensagens: 12, trafego: 0.8, conversoes: 35 },
  varejo:    { leads: 8,  mensagens: 5,  trafego: 0.4, conversoes: 15 },
  servicos:  { leads: 18, mensagens: 10, trafego: 0.7, conversoes: 30 },
};
const CTR_MEDIO: Record<string, number> = { leads: 1.8, mensagens: 2.4, trafego: 1.2, conversoes: 1.5 };
const CONV_RATE: Record<string, number> = { leads: 22, mensagens: 35, trafego: 8, conversoes: 18 };

function calcular(inputs: ProjecaoInputs) {
  const { orcamentoDiario, duracaoDias, objetivo, publicoEstimado, segmento } = inputs;
  const orcamentoTotal = orcamentoDiario * duracaoDias;
  const ctr = CTR_MEDIO[objetivo] ?? 1.5;
  const convRate = CONV_RATE[objetivo] ?? 15;
  const alcanceDiario = Math.min(publicoEstimado * 0.015, orcamentoDiario / 0.02);
  const alcanceTotal = Math.round(alcanceDiario * duracaoDias);
  const cliquesTotal = Math.round(alcanceTotal * (ctr / 100));
  const leadsTotal = Math.round(cliquesTotal * (convRate / 100));
  const cplReal = leadsTotal > 0 ? orcamentoTotal / leadsTotal : 0;
  const cplBenchmark = BENCHMARKS[segmento]?.[objetivo] ?? 25;
  const viabilidade = cplReal <= cplBenchmark * 1.2 ? "boa" : cplReal <= cplBenchmark * 1.6 ? "moderada" : "baixa";
  return { orcamentoTotal, alcanceTotal, leadsTotal, cplReal, viabilidade };
}

export interface ProjecaoSalva {
  id: string;
  nome: string;
  inputs: ProjecaoInputs;
  criadaEm: string;
}

const SEGMENTO_LABEL: Record<string, string> = {
  imoveis: "Imóveis", seguros: "Seguros", educacao: "Educação",
  saude: "Saúde", varejo: "Varejo", servicos: "Serviços",
};
const OBJETIVO_LABEL: Record<string, string> = {
  leads: "Leads", mensagens: "Mensagens", trafego: "Tráfego", conversoes: "Conversões",
};

interface Props {
  historico: ProjecaoSalva[];
  onRemover: (id: string) => void;
}

export function ProjecaoHistorico({ historico, onRemover }: Props) {
  if (historico.length === 0) return null;

  return (
    <Card className="mt-6">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <BarChart2 className="h-4 w-4 text-blue-600" />
          Comparativo de Simulações
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-muted-foreground text-xs">
                <th className="text-left py-2 pr-4 font-medium">Simulação</th>
                <th className="text-right py-2 px-3 font-medium">Investimento</th>
                <th className="text-right py-2 px-3 font-medium">Alcance</th>
                <th className="text-right py-2 px-3 font-medium">Resultado</th>
                <th className="text-right py-2 px-3 font-medium">CPL</th>
                <th className="text-right py-2 px-3 font-medium">Viabilidade</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {historico.map((item) => {
                const r = calcular(item.inputs);
                const corBadge = r.viabilidade === "boa"
                  ? "bg-green-100 text-green-700"
                  : r.viabilidade === "moderada"
                  ? "bg-yellow-100 text-yellow-700"
                  : "bg-red-100 text-red-700";
                return (
                  <tr key={item.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="py-3 pr-4">
                      <p className="font-medium">{item.nome}</p>
                      <p className="text-xs text-muted-foreground">
                        {SEGMENTO_LABEL[item.inputs.segmento]} · {OBJETIVO_LABEL[item.inputs.objetivo]} · {item.inputs.duracaoDias} dias
                      </p>
                    </td>
                    <td className="text-right px-3 font-medium">
                      R$ {r.orcamentoTotal.toLocaleString("pt-BR")}
                    </td>
                    <td className="text-right px-3 text-muted-foreground">
                      {r.alcanceTotal.toLocaleString("pt-BR")}
                    </td>
                    <td className="text-right px-3 font-bold text-blue-600">
                      {r.leadsTotal.toLocaleString("pt-BR")}
                    </td>
                    <td className="text-right px-3">
                      R$ {r.cplReal.toFixed(2)}
                    </td>
                    <td className="text-right px-3">
                      <Badge className={`text-xs ${corBadge}`}>
                        {r.viabilidade}
                      </Badge>
                    </td>
                    <td className="pl-2">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground hover:text-red-500"
                        onClick={() => onRemover(item.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
```

---

## 2. Atualizar `src/pages/MarketingDigital.tsx`

Adicionar estado de histórico, botão "Salvar simulação" e o componente `ProjecaoHistorico` abaixo do grid:

```tsx
import { useState } from "react";
import { TrendingUp } from "lucide-react";
import { CRMLayout } from "@/components/CRMLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProjecaoForm, type ProjecaoInputs } from "@/components/marketing/ProjecaoForm";
import { ProjecaoResultados } from "@/components/marketing/ProjecaoResultados";
import { ProjecaoHistorico, type ProjecaoSalva } from "@/components/marketing/ProjecaoHistorico";
import { toast } from "sonner";

export default function MarketingDigitalPage() {
  const [loading, setLoading] = useState(false);
  const [resultado, setResultado] = useState<ProjecaoInputs | null>(null);
  const [nomeSalvar, setNomeSalvar] = useState("");
  const [historico, setHistorico] = useState<ProjecaoSalva[]>([]);

  const handleCalcular = async (inputs: ProjecaoInputs) => {
    setLoading(true);
    await new Promise((r) => setTimeout(r, 700));
    setResultado(inputs);
    setLoading(false);
  };

  const handleSalvar = () => {
    if (!resultado) return;
    if (!nomeSalvar.trim()) {
      toast.error("Digite um nome para identificar esta simulação.");
      return;
    }
    if (historico.length >= 5) {
      toast.error("Máximo de 5 simulações salvas. Remova alguma antes de salvar.");
      return;
    }
    const nova: ProjecaoSalva = {
      id: crypto.randomUUID(),
      nome: nomeSalvar.trim(),
      inputs: resultado,
      criadaEm: new Date().toLocaleDateString("pt-BR"),
    };
    setHistorico((prev) => [nova, ...prev]);
    setNomeSalvar("");
    toast.success("Simulação salva com sucesso!");
  };

  const handleRemover = (id: string) => {
    setHistorico((prev) => prev.filter((h) => h.id !== id));
    toast.success("Simulação removida.");
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
            <p className="text-sm text-muted-foreground">Simulação e gestão de campanhas Meta Ads</p>
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

              {resultado ? (
                <div className="space-y-4">
                  <ProjecaoResultados inputs={resultado} />
                  {/* Salvar simulação */}
                  <div className="flex gap-2">
                    <Input
                      placeholder="Nome desta simulação (ex: Junho - Imóveis)"
                      value={nomeSalvar}
                      onChange={(e) => setNomeSalvar(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSalvar()}
                    />
                    <Button variant="outline" onClick={handleSalvar}>
                      Salvar
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground flex flex-col items-center justify-center gap-3">
                  <TrendingUp className="h-10 w-10 opacity-30" />
                  <div>
                    <p className="font-medium">Sua projeção aparecerá aqui</p>
                    <p className="text-sm mt-1">Preencha os parâmetros e clique em Calcular.</p>
                  </div>
                </div>
              )}
            </div>

            {/* Comparativo de simulações salvas */}
            <ProjecaoHistorico historico={historico} onRemover={handleRemover} />
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
Nenhum outro arquivo além de `MarketingDigital.tsx` e o novo `src/components/marketing/ProjecaoHistorico.tsx`.
