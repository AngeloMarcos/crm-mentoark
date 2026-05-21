# Prompt Lovable 3 — Marketing Digital: Resultados, Gráficos e Otimizador de Budget

## Objetivo
Criar o painel de resultados completo da projeção com: cards de métricas, comparativo FB vs IG, gráfico semanal, badge de viabilidade, sugestões de otimização, comparativo de até 3 simulações salvas e botão de exportar.

---

## 1. Criar `src/components/marketing/ProjecaoResultados.tsx`

```tsx
import { useState } from "react";
import {
  TrendingUp, Users, MousePointer, DollarSign, BarChart3,
  CheckCircle2, AlertCircle, XCircle, Sparkles, Facebook, Instagram,
  Download, BookmarkPlus, Info,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { type ProjecaoResultado, type ProjecaoInputs } from "./tipos";

// ---- Sub-componentes ----

function MetricCard({
  icon: Icon, label, valor, sub, destaque = false, cor = "default"
}: {
  icon: React.ElementType; label: string; valor: string; sub?: string;
  destaque?: boolean; cor?: "default" | "blue" | "green" | "red" | "yellow";
}) {
  const corMap = {
    default: "",
    blue:    "border-blue-200 bg-blue-50/60 dark:bg-blue-950/20",
    green:   "border-green-200 bg-green-50/60 dark:bg-green-950/20",
    red:     "border-red-200 bg-red-50/60 dark:bg-red-950/20",
    yellow:  "border-yellow-200 bg-yellow-50/60 dark:bg-yellow-950/20",
  };
  const iconCor = { default: "text-muted-foreground", blue: "text-blue-600", green: "text-green-600", red: "text-red-600", yellow: "text-yellow-600" };

  return (
    <Card className={corMap[cor]}>
      <CardContent className="pt-4 pb-3">
        <div className={`flex items-center gap-1.5 mb-1 ${iconCor[cor]}`}>
          <Icon className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">{label}</span>
        </div>
        <p className={`font-bold ${destaque ? "text-3xl text-blue-600" : "text-2xl"}`}>{valor}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function GraficoSemanal({ dados }: { dados: number[] }) {
  const max = Math.max(...dados, 1);
  return (
    <div className="flex items-end gap-1.5 h-28">
      {dados.map((v, i) => {
        const pct = (v / max) * 100;
        const isFirst = i === 0;
        return (
          <TooltipProvider key={i}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex-1 flex flex-col items-center gap-1 cursor-default">
                  <span className="text-[11px] font-semibold text-blue-600">{v}</span>
                  <div
                    className={`w-full rounded-t transition-all ${isFirst ? "bg-blue-300" : "bg-blue-500"}`}
                    style={{ height: `${Math.max(pct, 4)}%`, minHeight: "4px" }}
                  />
                  <span className="text-[10px] text-muted-foreground">S{i + 1}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>Semana {i + 1}: {v} resultados</p>
                {isFirst && <p className="text-xs text-muted-foreground">⏳ Período de aprendizado</p>}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      })}
    </div>
  );
}

// ---- Componente principal ----

interface Props {
  inputs: ProjecaoInputs;
  resultado: ProjecaoResultado;
  onSalvar?: (nome: string) => void;
}

const OBJETIVO_LABEL: Record<string, string> = {
  leads: "Leads", mensagens_whatsapp: "Mensagens WhatsApp",
  trafego: "Cliques no site", conversoes: "Conversões",
  alcance: "Pessoas alcançadas", engajamento: "Engajamentos",
};

const VIABILIDADE_CONFIG = {
  excelente: { cor: "bg-green-100 text-green-700 border-green-300", icon: CheckCircle2,  texto: "Excelente — CPL muito abaixo do benchmark!" },
  boa:       { cor: "bg-green-100 text-green-700 border-green-300", icon: CheckCircle2,  texto: "Boa viabilidade — dentro do benchmark do setor." },
  moderada:  { cor: "bg-yellow-100 text-yellow-700 border-yellow-300", icon: AlertCircle, texto: "Moderada — CPL acima do esperado. Veja as sugestões." },
  baixa:     { cor: "bg-red-100 text-red-700 border-red-300",    icon: XCircle,      texto: "Baixa — revise orçamento ou segmentação." },
};

export function ProjecaoResultados({ inputs, resultado: r, onSalvar }: Props) {
  const [nomeSalvar, setNomeSalvar] = useState("");
  const cfg = VIABILIDADE_CONFIG[r.viabilidade];
  const ViabilIcon = cfg.icon;

  const handleSalvar = () => {
    if (!nomeSalvar.trim()) { toast.error("Digite um nome para esta simulação."); return; }
    onSalvar?.(nomeSalvar.trim());
    setNomeSalvar("");
    toast.success("Simulação salva!");
  };

  const handleExportar = () => {
    const linhas = [
      "=== PROJEÇÃO DE CAMPANHA — MARKETING DIGITAL ===",
      `Plataforma: ${inputs.plataforma.toUpperCase()}`,
      `Objetivo: ${OBJETIVO_LABEL[inputs.objetivo]}`,
      `Formato: ${inputs.formato}`,
      `Orçamento total: R$ ${r.orcamentoTotal.toLocaleString("pt-BR")}`,
      "",
      `Alcance: ${r.alcanceTotal.toLocaleString("pt-BR")} pessoas`,
      `Impressões: ${r.impressoesTotal.toLocaleString("pt-BR")}`,
      `Cliques: ${r.cliquesTotal.toLocaleString("pt-BR")} | CTR: ${r.ctr.toFixed(2)}% | CPC: R$ ${r.cpc.toFixed(2)}`,
      `${OBJETIVO_LABEL[inputs.objetivo]}: ${r.leadsTotal.toLocaleString("pt-BR")}`,
      `CPL: R$ ${r.cpl.toFixed(2)} (benchmark: R$ ${r.cplBenchmark.toFixed(2)})`,
      `Viabilidade: ${r.viabilidade.toUpperCase()}`,
      "",
      r.sugestoes.length > 0 ? "SUGESTÕES:\n" + r.sugestoes.map((s) => `• ${s}`).join("\n") : "",
      `\nGerado em: ${new Date().toLocaleString("pt-BR")}`,
    ].join("\n");

    const blob = new Blob([linhas], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "projecao-campanha.txt"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">

      {/* Header viabilidade */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Badge className={`text-xs border flex items-center gap-1 ${cfg.cor}`}>
                  <ViabilIcon className="h-3 w-3" /> Viabilidade {r.viabilidade}
                </Badge>
                {r.fonte === "local" && (
                  <Badge variant="outline" className="text-xs text-muted-foreground">
                    📊 Benchmarks locais
                  </Badge>
                )}
                {r.fonte === "api" && (
                  <Badge className="text-xs bg-blue-100 text-blue-700 border-blue-300">
                    🔗 Dados da sua conta
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{cfg.texto}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                CPL projetado: <strong>R$ {r.cpl.toFixed(2)}</strong> · Referência setor: R$ {r.cplBenchmark.toFixed(2)}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={handleExportar} className="gap-1.5 shrink-0">
              <Download className="h-3.5 w-3.5" /> Exportar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Grid de métricas */}
      <div className="grid grid-cols-2 gap-3">
        <MetricCard icon={Users}        label="Alcance estimado"     valor={r.alcanceTotal.toLocaleString("pt-BR")}   sub="pessoas únicas" />
        <MetricCard icon={BarChart3}    label="Impressões"           valor={r.impressoesTotal.toLocaleString("pt-BR")} sub={`CTR ${r.ctr.toFixed(2)}%`} />
        <MetricCard icon={TrendingUp}   label={OBJETIVO_LABEL[inputs.objetivo]}
          valor={r.leadsTotal.toLocaleString("pt-BR")} destaque cor="blue"
          sub={`R$ ${r.cpl.toFixed(2)} por resultado`}
        />
        <MetricCard icon={DollarSign}   label="Custo por clique (CPC)"
          valor={`R$ ${r.cpc.toFixed(2)}`}
          sub={`${r.cliquesTotal.toLocaleString("pt-BR")} cliques totais`}
          cor={r.cpl > r.cplBenchmark * 1.3 ? "red" : "default"}
        />
      </div>

      {/* Distribuição FB vs IG (só quando "ambos") */}
      {r.distribuicaoPlataforma && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              Distribuição por plataforma
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger><Info className="h-3.5 w-3.5 text-muted-foreground" /></TooltipTrigger>
                  <TooltipContent><p>60% Facebook · 40% Instagram (média do setor)</p></TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { icon: Facebook, label: "Facebook", valor: r.distribuicaoPlataforma.facebook, cor: "bg-blue-500" },
              { icon: Instagram, label: "Instagram", valor: r.distribuicaoPlataforma.instagram, cor: "bg-gradient-to-r from-pink-500 to-orange-400" },
            ].map(({ icon: Icon, label, valor, cor }) => {
              const pct = Math.round((valor / r.leadsTotal) * 100);
              return (
                <div key={label} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-1.5"><Icon className="h-3.5 w-3.5" />{label}</span>
                    <span className="font-semibold">{valor} ({pct}%)</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className={`h-full rounded-full ${cor}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Gráfico semanal */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <BarChart3 className="h-3.5 w-3.5 text-blue-600" />
            {OBJETIVO_LABEL[inputs.objetivo]} por semana
          </CardTitle>
        </CardHeader>
        <CardContent>
          <GraficoSemanal dados={r.leadsPorSemana} />
          <p className="text-[11px] text-muted-foreground mt-2">
            * S1 menor devido ao período de aprendizado do algoritmo Meta (3–7 dias).
          </p>
        </CardContent>
      </Card>

      {/* Sugestões */}
      {r.sugestoes.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/50 dark:bg-amber-950/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <Sparkles className="h-3.5 w-3.5" /> Sugestões de otimização
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {r.sugestoes.map((s, i) => (
                <li key={i} className="text-sm flex items-start gap-2">
                  <span className="text-amber-600 mt-0.5">→</span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Salvar simulação */}
      <div className="flex gap-2">
        <Input
          placeholder="Nome desta simulação (ex: Junho - Imóveis)"
          value={nomeSalvar}
          onChange={(e) => setNomeSalvar(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSalvar()}
        />
        <Button variant="outline" onClick={handleSalvar} className="gap-1.5 shrink-0">
          <BookmarkPlus className="h-4 w-4" /> Salvar
        </Button>
      </div>

    </div>
  );
}
```

---

## 2. Criar `src/components/marketing/ProjecaoComparativo.tsx`

Tabela de comparativo das simulações salvas:

```tsx
import { Trash2, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { type ProjecaoResultado, type ProjecaoInputs } from "./tipos";

export interface SimulacaoSalva {
  id: string;
  nome: string;
  inputs: ProjecaoInputs;
  resultado: ProjecaoResultado;
  criadaEm: string;
}

const OBJETIVO_LABEL: Record<string, string> = {
  leads: "Leads", mensagens_whatsapp: "Msg WA", trafego: "Tráfego",
  conversoes: "Conversões", alcance: "Alcance", engajamento: "Engajamento",
};
const PLATAFORMA_EMOJI: Record<string, string> = { facebook: "🔵", instagram: "🟣", ambos: "🟡" };
const VIA_COR: Record<string, string> = {
  excelente: "bg-green-100 text-green-700", boa: "bg-green-100 text-green-700",
  moderada: "bg-yellow-100 text-yellow-700", baixa: "bg-red-100 text-red-700",
};

interface Props { historico: SimulacaoSalva[]; onRemover: (id: string) => void; }

export function ProjecaoComparativo({ historico, onRemover }: Props) {
  if (historico.length === 0) return null;
  return (
    <Card className="mt-6">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <TrendingUp className="h-4 w-4 text-blue-600" />
          Comparativo de Simulações ({historico.length}/5)
        </CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th className="text-left py-2 pr-4 font-medium">Simulação</th>
              <th className="text-right py-2 px-2 font-medium">Investimento</th>
              <th className="text-right py-2 px-2 font-medium">Resultado</th>
              <th className="text-right py-2 px-2 font-medium">CPL</th>
              <th className="text-right py-2 px-2 font-medium">Alcance</th>
              <th className="text-right py-2 px-2 font-medium">Viabilidade</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {historico.map((item) => {
              const r = item.resultado;
              return (
                <tr key={item.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="py-3 pr-4">
                    <p className="font-medium">{item.nome}</p>
                    <p className="text-xs text-muted-foreground">
                      {PLATAFORMA_EMOJI[item.inputs.plataforma]} {OBJETIVO_LABEL[item.inputs.objetivo]} · {item.inputs.duracaoDias}d · {item.criadaEm}
                    </p>
                  </td>
                  <td className="text-right px-2 font-medium">R$ {r.orcamentoTotal.toLocaleString("pt-BR")}</td>
                  <td className="text-right px-2 font-bold text-blue-600">{r.leadsTotal.toLocaleString("pt-BR")}</td>
                  <td className="text-right px-2">R$ {r.cpl.toFixed(2)}</td>
                  <td className="text-right px-2 text-muted-foreground">{r.alcanceTotal.toLocaleString("pt-BR")}</td>
                  <td className="text-right px-2">
                    <Badge className={`text-xs ${VIA_COR[r.viabilidade]}`}>{r.viabilidade}</Badge>
                  </td>
                  <td className="pl-2">
                    <Button size="icon" variant="ghost" className="h-7 w-7 hover:text-red-500"
                      onClick={() => onRemover(item.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
```

---

## 3. Atualizar `src/pages/MarketingDigital.tsx`

Substituir o placeholder de resultados e adicionar o comparativo:

```tsx
// Adicionar imports:
import { ProjecaoResultados } from "@/components/marketing/ProjecaoResultados";
import { ProjecaoComparativo, type SimulacaoSalva } from "@/components/marketing/ProjecaoComparativo";

// Adicionar estado:
const [historico, setHistorico] = useState<SimulacaoSalva[]>([]);
const [inputsAtual, setInputsAtual] = useState<ProjecaoInputs | null>(null);

const handleCalcular = async (inputs: ProjecaoInputs) => {
  setLoadingCalc(true);
  setInputsAtual(inputs);
  const r = await calcularProjecao(inputs, token);
  setResultado(r);
  setLoadingCalc(false);
};

const handleSalvar = (nome: string) => {
  if (!resultado || !inputsAtual) return;
  if (historico.length >= 5) { toast.error("Máximo 5 simulações. Remova uma antes."); return; }
  setHistorico((prev) => [{
    id: crypto.randomUUID(), nome, inputs: inputsAtual, resultado,
    criadaEm: new Date().toLocaleDateString("pt-BR"),
  }, ...prev]);
};

// Na aba projecao:
<TabsContent value="projecao" className="mt-6">
  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
    <ProjecaoForm onCalcular={handleCalcular} loading={loadingCalc} />
    {resultado && inputsAtual ? (
      <ProjecaoResultados inputs={inputsAtual} resultado={resultado} onSalvar={handleSalvar} />
    ) : (
      <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground flex flex-col items-center justify-center gap-3">
        <TrendingUp className="h-10 w-10 opacity-20" />
        <div>
          <p className="font-medium">Sua projeção aparecerá aqui</p>
          <p className="text-sm mt-1">Preencha os parâmetros e clique em Calcular.</p>
        </div>
      </div>
    )}
  </div>
  <ProjecaoComparativo historico={historico} onRemover={(id) => setHistorico((p) => p.filter((h) => h.id !== id))} />
</TabsContent>
```

---

## Não alterar
Nenhum arquivo além dos listados.
