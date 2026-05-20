import { useState } from "react";
import {
  TrendingUp, Users, MousePointer, DollarSign, BarChart3,
  CheckCircle2, AlertCircle, XCircle, Sparkles,
  Download, BookmarkPlus, Info,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { type ProjecaoResultado, type ProjecaoInputs } from "./tipos";

// Ícones manuais para evitar erros de importação da lucide-react
const Facebook = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
  </svg>
);

const Instagram = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
    <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
  </svg>
);

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
