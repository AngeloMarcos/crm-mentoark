# Prompt Lovable 3 — Marketing Digital: Painel de Resultados da Projeção

## Objetivo
Criar o componente `ProjecaoResultados.tsx` que exibe os resultados calculados da simulação de campanha: cards de métricas, gráfico de leads por semana e análise de viabilidade.

---

## Contexto
Este componente substitui o placeholder no lado direito do layout de duas colunas em `MarketingDigital.tsx`. Ele recebe os inputs do formulário e exibe as projeções calculadas com base em benchmarks do setor.

---

## Benchmarks usados no cálculo (embutidos no componente)

```ts
// CPL médio por segmento + objetivo (em R$)
const BENCHMARKS = {
  imoveis:   { leads: 35, mensagens: 18, trafego: 1.2, conversoes: 55 },
  seguros:   { leads: 28, mensagens: 15, trafego: 0.9, conversoes: 42 },
  educacao:  { leads: 12, mensagens: 8,  trafego: 0.5, conversoes: 20 },
  saude:     { leads: 20, mensagens: 12, trafego: 0.8, conversoes: 35 },
  varejo:    { leads: 8,  mensagens: 5,  trafego: 0.4, conversoes: 15 },
  servicos:  { leads: 18, mensagens: 10, trafego: 0.7, conversoes: 30 },
};

// CTR médio por objetivo (%)
const CTR_MEDIO = {
  leads: 1.8, mensagens: 2.4, trafego: 1.2, conversoes: 1.5
};

// Taxa de conversão do clique para lead (%)
const CONV_RATE = {
  leads: 22, mensagens: 35, trafego: 8, conversoes: 18
};
```

---

## 1. Criar `src/components/marketing/ProjecaoResultados.tsx`

```tsx
import { TrendingUp, Users, DollarSign, MousePointer, BarChart3, CheckCircle2, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { type ProjecaoInputs } from "./ProjecaoForm";

// Benchmarks por segmento e objetivo
const BENCHMARKS: Record<string, Record<string, number>> = {
  imoveis:   { leads: 35, mensagens: 18, trafego: 1.2, conversoes: 55 },
  seguros:   { leads: 28, mensagens: 15, trafego: 0.9, conversoes: 42 },
  educacao:  { leads: 12, mensagens: 8,  trafego: 0.5, conversoes: 20 },
  saude:     { leads: 20, mensagens: 12, trafego: 0.8, conversoes: 35 },
  varejo:    { leads: 8,  mensagens: 5,  trafego: 0.4, conversoes: 15 },
  servicos:  { leads: 18, mensagens: 10, trafego: 0.7, conversoes: 30 },
};

const CTR_MEDIO: Record<string, number> = {
  leads: 1.8, mensagens: 2.4, trafego: 1.2, conversoes: 1.5,
};

const CONV_RATE: Record<string, number> = {
  leads: 22, mensagens: 35, trafego: 8, conversoes: 18,
};

interface Props {
  inputs: ProjecaoInputs;
}

function calcular(inputs: ProjecaoInputs) {
  const { orcamentoDiario, duracaoDias, objetivo, publicoEstimado, segmento } = inputs;
  const orcamentoTotal = orcamentoDiario * duracaoDias;
  const cpl = BENCHMARKS[segmento]?.[objetivo] ?? 25;
  const ctr = CTR_MEDIO[objetivo] ?? 1.5;
  const convRate = CONV_RATE[objetivo] ?? 15;

  // Alcance estimado: até 15% do público por semana com orçamento adequado
  const alcanceDiario = Math.min(publicoEstimado * 0.015, (orcamentoDiario / 0.02));
  const alcanceTotal = Math.round(alcanceDiario * duracaoDias);

  // Cliques
  const cliquesTotal = Math.round(alcanceTotal * (ctr / 100));

  // Leads
  const leadsTotal = Math.round(cliquesTotal * (convRate / 100));

  // CPC real
  const cpcReal = cliquesTotal > 0 ? orcamentoTotal / cliquesTotal : 0;

  // CPL real
  const cplReal = leadsTotal > 0 ? orcamentoTotal / leadsTotal : 0;

  // Distribuição semanal
  const semanas = Math.ceil(duracaoDias / 7);
  const leadsPorSemana = Array.from({ length: semanas }, (_, i) => {
    const fator = i === 0 ? 0.7 : i === 1 ? 0.9 : 1.0; // curva de aprendizado
    return Math.round((leadsTotal / semanas) * fator);
  });

  // Viabilidade
  const cplBenchmark = cpl;
  const viabilidade = cplReal <= cplBenchmark * 1.2
    ? "boa"
    : cplReal <= cplBenchmark * 1.6
    ? "moderada"
    : "baixa";

  return { orcamentoTotal, alcanceTotal, cliquesTotal, leadsTotal, cpcReal, cplReal, leadsPorSemana, viabilidade, cplBenchmark };
}

const OBJETIVO_LABEL: Record<string, string> = {
  leads: "Leads", mensagens: "Mensagens", trafego: "Cliques no site", conversoes: "Conversões",
};

export function ProjecaoResultados({ inputs }: Props) {
  const r = calcular(inputs);

  const viabilidadeCor = {
    boa: "bg-green-500/10 text-green-700 border-green-300",
    moderada: "bg-yellow-500/10 text-yellow-700 border-yellow-300",
    baixa: "bg-red-500/10 text-red-700 border-red-300",
  }[r.viabilidade];

  const viabilidadeIcon = r.viabilidade === "boa"
    ? <CheckCircle2 className="h-4 w-4" />
    : <AlertCircle className="h-4 w-4" />;

  return (
    <div className="space-y-4">
      {/* Header do resultado */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-base">
            <span className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-blue-600" />
              Projeção de Resultados
            </span>
            <Badge className={`text-xs border ${viabilidadeCor} flex items-center gap-1`}>
              {viabilidadeIcon}
              Viabilidade {r.viabilidade}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            Baseado em benchmarks do setor · CPL de referência: R$ {r.cplBenchmark.toFixed(2)}
          </p>
        </CardContent>
      </Card>

      {/* Cards de métricas */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Users className="h-4 w-4" />
              <span className="text-xs">Alcance estimado</span>
            </div>
            <p className="text-2xl font-bold">{r.alcanceTotal.toLocaleString("pt-BR")}</p>
            <p className="text-xs text-muted-foreground">pessoas únicas</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <MousePointer className="h-4 w-4" />
              <span className="text-xs">Cliques totais</span>
            </div>
            <p className="text-2xl font-bold">{r.cliquesTotal.toLocaleString("pt-BR")}</p>
            <p className="text-xs text-muted-foreground">CPC: R$ {r.cpcReal.toFixed(2)}</p>
          </CardContent>
        </Card>

        <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-blue-600 mb-1">
              <TrendingUp className="h-4 w-4" />
              <span className="text-xs font-medium">{OBJETIVO_LABEL[inputs.objetivo] ?? "Leads"}</span>
            </div>
            <p className="text-3xl font-bold text-blue-600">{r.leadsTotal.toLocaleString("pt-BR")}</p>
            <p className="text-xs text-muted-foreground">resultado esperado</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <DollarSign className="h-4 w-4" />
              <span className="text-xs">Custo por resultado</span>
            </div>
            <p className="text-2xl font-bold">R$ {r.cplReal.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground">
              {r.cplReal <= r.cplBenchmark
                ? "✅ Abaixo do benchmark"
                : `⚠️ Ref: R$ ${r.cplBenchmark.toFixed(2)}`}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Distribuição semanal (barras simples em CSS) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Distribuição por semana</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-2 h-24">
            {r.leadsPorSemana.map((v, i) => {
              const max = Math.max(...r.leadsPorSemana);
              const pct = max > 0 ? (v / max) * 100 : 0;
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs font-medium text-blue-600">{v}</span>
                  <div
                    className="w-full rounded-t bg-blue-500 transition-all"
                    style={{ height: `${pct}%`, minHeight: "4px" }}
                  />
                  <span className="text-[10px] text-muted-foreground">S{i + 1}</span>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            * Semana 1 menor por período de aprendizado do algoritmo Meta.
          </p>
        </CardContent>
      </Card>

      {/* Dica de viabilidade */}
      {r.viabilidade === "baixa" && (
        <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 p-3 text-sm text-red-700 dark:text-red-400">
          <strong>Atenção:</strong> Com este orçamento e público, o CPL projetado está acima do benchmark do setor.
          Tente aumentar o orçamento diário ou reduzir o tamanho do público para melhorar a eficiência.
        </div>
      )}
      {r.viabilidade === "boa" && (
        <div className="rounded-lg border border-green-200 bg-green-50 dark:bg-green-950/20 p-3 text-sm text-green-700 dark:text-green-400">
          <strong>Ótima projeção!</strong> O CPL estimado está dentro do benchmark para o seu segmento.
        </div>
      )}
    </div>
  );
}
```

---

## 2. Atualizar `src/pages/MarketingDigital.tsx`

Substituir o placeholder de resultados pelo componente real:

```tsx
import { useState } from "react";
import { TrendingUp } from "lucide-react";
import { CRMLayout } from "@/components/CRMLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProjecaoForm, type ProjecaoInputs } from "@/components/marketing/ProjecaoForm";
import { ProjecaoResultados } from "@/components/marketing/ProjecaoResultados";

export default function MarketingDigitalPage() {
  const [loading, setLoading] = useState(false);
  const [resultado, setResultado] = useState<ProjecaoInputs | null>(null);

  const handleCalcular = async (inputs: ProjecaoInputs) => {
    setLoading(true);
    await new Promise((r) => setTimeout(r, 700));
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
                <ProjecaoResultados inputs={resultado} />
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
Nenhum outro arquivo além de `MarketingDigital.tsx` e o novo `src/components/marketing/ProjecaoResultados.tsx`.
