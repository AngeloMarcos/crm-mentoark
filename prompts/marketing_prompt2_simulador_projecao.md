# Prompt Lovable 2 — Marketing Digital: Simulador de Projeção Multi-plataforma

## Objetivo
Construir o simulador completo na aba "Projeção" com seleção de plataforma (Facebook/Instagram/ambos), formato de anúncio, objetivos e cálculo de resultados com benchmarks reais do mercado brasileiro.

---

## Contexto
- A função `calcularProjecao` tenta chamar `POST /api/marketing/projecao` no backend.
- Se o backend retornar erro ou a conta Meta não estiver conectada, usa cálculo local com benchmarks embutidos.
- Os benchmarks são baseados em médias do mercado brasileiro 2024–2025.

---

## 1. Criar `src/components/marketing/tipos.ts`

Tipos compartilhados entre todos os componentes do módulo:

```ts
export type Plataforma = "facebook" | "instagram" | "ambos";
export type Objetivo = "leads" | "mensagens_whatsapp" | "trafego" | "conversoes" | "alcance" | "engajamento";
export type Segmento = "imoveis" | "seguros" | "educacao" | "saude" | "varejo" | "servicos" | "financeiro" | "automotivo";
export type FormatoAnuncio = "imagem" | "video" | "carrossel" | "stories" | "reels";

export interface ProjecaoInputs {
  plataforma: Plataforma;
  segmento: Segmento;
  objetivo: Objetivo;
  formato: FormatoAnuncio;
  orcamentoDiario: number;
  duracaoDias: number;
  publicoEstimado: number;
  cidade?: string;
  idadeMin: number;
  idadeMax: number;
}

export interface ProjecaoResultado {
  orcamentoTotal: number;
  alcanceTotal: number;
  impressoesTotal: number;
  cliquesTotal: number;
  ctr: number;
  cpc: number;
  leadsTotal: number;
  cpl: number;
  cplBenchmark: number;
  viabilidade: "excelente" | "boa" | "moderada" | "baixa";
  leadsPorSemana: number[];
  distribuicaoPlataforma: { facebook: number; instagram: number } | null;
  sugestoes: string[];
  fonte: "api" | "local";
}
```

---

## 2. Criar `src/components/marketing/benchmarks.ts`

```ts
import { Segmento, Objetivo, Plataforma, FormatoAnuncio } from "./tipos";

// CPL médio Brasil 2024 por segmento + objetivo (R$)
export const CPL_BENCHMARK: Record<Segmento, Record<Objetivo, number>> = {
  imoveis:    { leads: 38, mensagens_whatsapp: 20, trafego: 1.4, conversoes: 60, alcance: 0.05, engajamento: 0.12 },
  seguros:    { leads: 30, mensagens_whatsapp: 16, trafego: 1.0, conversoes: 45, alcance: 0.04, engajamento: 0.10 },
  educacao:   { leads: 14, mensagens_whatsapp: 9,  trafego: 0.6, conversoes: 22, alcance: 0.03, engajamento: 0.08 },
  saude:      { leads: 22, mensagens_whatsapp: 13, trafego: 0.9, conversoes: 38, alcance: 0.04, engajamento: 0.09 },
  varejo:     { leads: 9,  mensagens_whatsapp: 6,  trafego: 0.5, conversoes: 18, alcance: 0.02, engajamento: 0.06 },
  servicos:   { leads: 20, mensagens_whatsapp: 11, trafego: 0.8, conversoes: 32, alcance: 0.04, engajamento: 0.09 },
  financeiro: { leads: 45, mensagens_whatsapp: 25, trafego: 1.8, conversoes: 70, alcance: 0.06, engajamento: 0.15 },
  automotivo: { leads: 50, mensagens_whatsapp: 28, trafego: 2.0, conversoes: 80, alcance: 0.07, engajamento: 0.18 },
};

// CTR médio por objetivo (%)
export const CTR_OBJETIVO: Record<Objetivo, number> = {
  leads: 1.8, mensagens_whatsapp: 2.5, trafego: 1.4, conversoes: 1.6, alcance: 0.5, engajamento: 2.2,
};

// Taxa de conversão clique → lead (%)
export const CONV_RATE: Record<Objetivo, number> = {
  leads: 24, mensagens_whatsapp: 38, trafego: 9, conversoes: 20, alcance: 3, engajamento: 5,
};

// Multiplicadores de formato
export const FATOR_FORMATO: Record<FormatoAnuncio, number> = {
  imagem: 1.0, video: 1.25, carrossel: 1.15, stories: 0.90, reels: 1.35,
};

// Distribuição Facebook vs Instagram quando "ambos"
export const DIST_PLATAFORMA: Record<Plataforma, { facebook: number; instagram: number } | null> = {
  facebook:  null,
  instagram: null,
  ambos:     { facebook: 0.60, instagram: 0.40 },
};

// Frequência de exibição (vezes que o mesmo usuário vê o anúncio por semana)
export const FREQ_MEDIA: Record<Plataforma, number> = {
  facebook: 2.4, instagram: 3.1, ambos: 2.7,
};
```

---

## 3. Criar `src/components/marketing/calcularProjecao.ts`

```ts
import { ProjecaoInputs, ProjecaoResultado } from "./tipos";
import { CPL_BENCHMARK, CTR_OBJETIVO, CONV_RATE, FATOR_FORMATO, DIST_PLATAFORMA, FREQ_MEDIA } from "./benchmarks";

const BASE = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";

export async function calcularProjecao(inputs: ProjecaoInputs, token: string): Promise<ProjecaoResultado> {
  // Tenta API do backend (que pode enriquecer com dados reais da conta Meta)
  try {
    const r = await fetch(`${BASE}/api/marketing/projecao`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(inputs),
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) {
      const data = await r.json();
      return { ...data, fonte: "api" };
    }
  } catch { /* fallback para cálculo local */ }

  // Cálculo local com benchmarks
  return calcularLocal(inputs);
}

function calcularLocal(inputs: ProjecaoInputs): ProjecaoResultado {
  const { plataforma, segmento, objetivo, formato, orcamentoDiario, duracaoDias, publicoEstimado } = inputs;
  const orcamentoTotal = orcamentoDiario * duracaoDias;

  const cplBenchmark = CPL_BENCHMARK[segmento][objetivo];
  const ctr = CTR_OBJETIVO[objetivo];
  const convRate = CONV_RATE[objetivo];
  const fatorFormato = FATOR_FORMATO[formato];
  const freq = FREQ_MEDIA[plataforma];

  // Alcance diário: limitado pelo tamanho do público e pelo orçamento disponível
  const alcancePorOrçamento = orcamentoDiario / (cplBenchmark * (convRate / 100) * (ctr / 100) || 0.01);
  const alcancePorPublico = publicoEstimado * 0.018;
  const alcanceDiario = Math.min(alcancePorOrçamento, alcancePorPublico);
  const alcanceTotal = Math.round(alcanceDiario * duracaoDias);

  // Impressões (frequência média)
  const impressoesTotal = Math.round(alcanceTotal * freq);

  // Cliques
  const cliquesTotal = Math.round(impressoesTotal * (ctr / 100) * fatorFormato);

  // Resultado (leads, mensagens, etc.)
  const leadsTotal = Math.round(cliquesTotal * (convRate / 100));

  // Custos reais
  const cpc = cliquesTotal > 0 ? orcamentoTotal / cliquesTotal : 0;
  const cpl = leadsTotal > 0 ? orcamentoTotal / leadsTotal : 0;

  // Viabilidade
  const ratio = cpl / cplBenchmark;
  const viabilidade = ratio <= 0.8 ? "excelente" : ratio <= 1.2 ? "boa" : ratio <= 1.6 ? "moderada" : "baixa";

  // Distribuição semanal com curva de aprendizado Meta
  const semanas = Math.ceil(duracaoDias / 7);
  const fatoresSemana = [0.65, 0.85, 1.0, 1.05, 1.08, 1.10, 1.10, 1.10, 1.10, 1.10, 1.10, 1.10, 1.10];
  const leadsPorSemana = Array.from({ length: semanas }, (_, i) => {
    const f = fatoresSemana[Math.min(i, fatoresSemana.length - 1)];
    return Math.round((leadsTotal / semanas) * f);
  });

  // Distribuição por plataforma
  const distribuicaoPlataforma = DIST_PLATAFORMA[plataforma]
    ? {
        facebook: Math.round(leadsTotal * DIST_PLATAFORMA[plataforma]!.facebook),
        instagram: Math.round(leadsTotal * DIST_PLATAFORMA[plataforma]!.instagram),
      }
    : null;

  // Sugestões automáticas
  const sugestoes: string[] = [];
  if (viabilidade === "baixa" || viabilidade === "moderada") {
    sugestoes.push("Aumente o orçamento diário para reduzir o CPL.");
    if (formato !== "video" && formato !== "reels") sugestoes.push("Experimente vídeo ou Reels — geram até 35% mais engajamento.");
  }
  if (plataforma === "facebook" && (segmento === "educacao" || segmento === "varejo")) {
    sugestoes.push("Instagram tende a performar melhor para este segmento — teste 'Ambas as plataformas'.");
  }
  if (inputs.idadeMin < 25 && segmento === "imoveis") {
    sugestoes.push("Para imóveis, público 30-55 anos tende a converter melhor.");
  }
  if (leadsTotal < 10) {
    sugestoes.push("Projeção de leads muito baixa. Considere aumentar o orçamento ou o período da campanha.");
  }

  return {
    orcamentoTotal, alcanceTotal, impressoesTotal, cliquesTotal,
    ctr, cpc, leadsTotal, cpl, cplBenchmark,
    viabilidade, leadsPorSemana, distribuicaoPlataforma, sugestoes,
    fonte: "local",
  };
}
```

---

## 4. Criar `src/components/marketing/ProjecaoForm.tsx`

```tsx
import { useState } from "react";
import { Calculator, DollarSign, Target, Users, Calendar, Facebook, Instagram, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { type ProjecaoInputs, type Plataforma, type Objetivo, type Segmento, type FormatoAnuncio } from "./tipos";

const SEGMENTOS: { value: Segmento; label: string }[] = [
  { value: "imoveis",    label: "🏠 Imóveis / Corretora" },
  { value: "seguros",    label: "🛡️ Seguros" },
  { value: "educacao",   label: "🎓 Educação / Cursos" },
  { value: "saude",      label: "❤️ Saúde / Estética" },
  { value: "financeiro", label: "💰 Financeiro / Crédito" },
  { value: "varejo",     label: "🛍️ Varejo / E-commerce" },
  { value: "automotivo", label: "🚗 Automotivo" },
  { value: "servicos",   label: "⚙️ Serviços Gerais" },
];

const OBJETIVOS: { value: Objetivo; label: string; desc: string }[] = [
  { value: "leads",              label: "Geração de Leads",       desc: "Formulário nativo Meta" },
  { value: "mensagens_whatsapp", label: "Mensagens WhatsApp",     desc: "Click-to-WhatsApp" },
  { value: "trafego",            label: "Tráfego para Site",      desc: "Visitas ao seu site" },
  { value: "conversoes",         label: "Conversões",             desc: "Ações no site/app" },
  { value: "alcance",            label: "Alcance / Branding",     desc: "Máximo de pessoas" },
  { value: "engajamento",        label: "Engajamento",            desc: "Curtidas, comentários" },
];

const FORMATOS: { value: FormatoAnuncio; label: string; emoji: string }[] = [
  { value: "imagem",    label: "Imagem",    emoji: "🖼️" },
  { value: "video",     label: "Vídeo",     emoji: "🎬" },
  { value: "carrossel", label: "Carrossel", emoji: "🎠" },
  { value: "stories",   label: "Stories",   emoji: "📱" },
  { value: "reels",     label: "Reels",     emoji: "🎞️" },
];

interface Props {
  onCalcular: (inputs: ProjecaoInputs) => void;
  loading: boolean;
}

export function ProjecaoForm({ onCalcular, loading }: Props) {
  const [plataforma, setPlataforma] = useState<Plataforma>("ambos");
  const [segmento, setSegmento] = useState<Segmento>("imoveis");
  const [objetivo, setObjetivo] = useState<Objetivo>("leads");
  const [formato, setFormato] = useState<FormatoAnuncio>("imagem");
  const [orcamentoDiario, setOrcamentoDiario] = useState(50);
  const [duracaoDias, setDuracaoDias] = useState(30);
  const [publicoEstimado, setPublicoEstimado] = useState(100000);
  const [idadeMin, setIdadeMin] = useState(25);
  const [idadeMax, setIdadeMax] = useState(55);

  const orcamentoTotal = orcamentoDiario * duracaoDias;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCalcular({ plataforma, segmento, objetivo, formato, orcamentoDiario, duracaoDias, publicoEstimado, idadeMin, idadeMax });
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

          {/* Plataforma */}
          <div className="space-y-2">
            <Label>Plataforma</Label>
            <ToggleGroup type="single" value={plataforma} onValueChange={(v) => v && setPlataforma(v as Plataforma)}
              className="justify-start gap-2">
              <ToggleGroupItem value="facebook" className="gap-1.5 data-[state=on]:bg-blue-100 data-[state=on]:text-blue-700 data-[state=on]:border-blue-300">
                <Facebook className="h-3.5 w-3.5" /> Facebook
              </ToggleGroupItem>
              <ToggleGroupItem value="instagram" className="gap-1.5 data-[state=on]:bg-pink-100 data-[state=on]:text-pink-700 data-[state=on]:border-pink-300">
                <Instagram className="h-3.5 w-3.5" /> Instagram
              </ToggleGroupItem>
              <ToggleGroupItem value="ambos" className="gap-1.5 data-[state=on]:bg-purple-100 data-[state=on]:text-purple-700 data-[state=on]:border-purple-300">
                <MessageCircle className="h-3.5 w-3.5" /> Ambos
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          {/* Segmento */}
          <div className="space-y-1.5">
            <Label>Segmento do negócio</Label>
            <Select value={segmento} onValueChange={(v) => setSegmento(v as Segmento)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SEGMENTOS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Objetivo */}
          <div className="space-y-1.5">
            <Label>Objetivo da campanha</Label>
            <div className="grid grid-cols-2 gap-2">
              {OBJETIVOS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setObjetivo(o.value)}
                  className={`text-left p-2.5 rounded-lg border text-xs transition-all ${
                    objetivo === o.value
                      ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30"
                      : "border-border hover:border-muted-foreground/40"
                  }`}
                >
                  <p className="font-medium">{o.label}</p>
                  <p className="text-muted-foreground mt-0.5">{o.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Formato */}
          <div className="space-y-1.5">
            <Label>Formato do anúncio</Label>
            <div className="flex gap-1.5 flex-wrap">
              {FORMATOS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setFormato(f.value)}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                    formato === f.value
                      ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300"
                      : "border-border hover:border-muted-foreground/40"
                  }`}
                >
                  {f.emoji} {f.label}
                </button>
              ))}
            </div>
            {formato === "reels" && (
              <p className="text-xs text-green-600">✨ Reels tem o maior alcance orgânico — ótima escolha!</p>
            )}
            {formato === "video" && (
              <p className="text-xs text-blue-600">🎬 Vídeo gera 25% mais engajamento que imagem estática.</p>
            )}
          </div>

          {/* Faixa etária */}
          <div className="space-y-2">
            <Label className="flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                Faixa etária do público
              </span>
              <span className="text-blue-600 font-semibold text-sm">{idadeMin}–{idadeMax} anos</span>
            </Label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Idade mínima</p>
                <Slider min={18} max={50} step={1} value={[idadeMin]}
                  onValueChange={([v]) => setIdadeMin(Math.min(v, idadeMax - 1))} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Idade máxima</p>
                <Slider min={20} max={65} step={1} value={[idadeMax]}
                  onValueChange={([v]) => setIdadeMax(Math.max(v, idadeMin + 1))} />
              </div>
            </div>
          </div>

          {/* Público estimado */}
          <div className="space-y-1.5">
            <Label>Tamanho do público-alvo</Label>
            <Select value={String(publicoEstimado)} onValueChange={(v) => setPublicoEstimado(Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="20000">Micro — até 20 mil (hiper-local)</SelectItem>
                <SelectItem value="50000">Pequeno — até 50 mil</SelectItem>
                <SelectItem value="100000">Médio — até 100 mil</SelectItem>
                <SelectItem value="300000">Grande — até 300 mil</SelectItem>
                <SelectItem value="1000000">Muito grande — 1 milhão+</SelectItem>
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
              <span className="font-bold text-blue-600">R$ {orcamentoDiario.toLocaleString("pt-BR")}</span>
            </Label>
            <Slider min={10} max={2000} step={10} value={[orcamentoDiario]}
              onValueChange={([v]) => setOrcamentoDiario(v)} />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>R$ 10</span><span>R$ 2.000</span>
            </div>
          </div>

          {/* Duração */}
          <div className="space-y-2">
            <Label className="flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                Duração
              </span>
              <span className="font-bold text-blue-600">{duracaoDias} dias</span>
            </Label>
            <Slider min={7} max={90} step={1} value={[duracaoDias]}
              onValueChange={([v]) => setDuracaoDias(v)} />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>7 dias</span><span>90 dias</span>
            </div>
          </div>

          {/* Resumo investimento */}
          <div className="rounded-lg bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-950/30 dark:to-purple-950/30 border border-blue-200 dark:border-blue-800 p-3">
            <p className="text-xs text-muted-foreground">Investimento total</p>
            <p className="text-2xl font-bold text-blue-600">
              R$ {orcamentoTotal.toLocaleString("pt-BR")}
            </p>
            <p className="text-xs text-muted-foreground">
              R$ {orcamentoDiario}/dia × {duracaoDias} dias
            </p>
          </div>

          <Button type="submit" className="w-full gap-2" disabled={loading}>
            <Target className="h-4 w-4" />
            {loading ? "Calculando..." : "Calcular Projeção"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
```

---

## 5. Atualizar `src/pages/MarketingDigital.tsx`

Substituir o `PlaceholderTab` da aba `projecao` por:

```tsx
import { useState } from "react";
import { ProjecaoForm } from "@/components/marketing/ProjecaoForm";
import { calcularProjecao } from "@/components/marketing/calcularProjecao";
import { type ProjecaoInputs, type ProjecaoResultado } from "@/components/marketing/tipos";

// Dentro do componente MarketingDigitalPage, adicionar estado:
const [loadingCalc, setLoadingCalc] = useState(false);
const [resultado, setResultado] = useState<ProjecaoResultado | null>(null);
const token = localStorage.getItem("crm_access_token") || "";

const handleCalcular = async (inputs: ProjecaoInputs) => {
  setLoadingCalc(true);
  const r = await calcularProjecao(inputs, token);
  setResultado(r);
  setLoadingCalc(false);
};

// Na aba projecao:
<TabsContent value="projecao" className="mt-6">
  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
    <ProjecaoForm onCalcular={handleCalcular} loading={loadingCalc} />
    <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground flex flex-col items-center justify-center gap-3">
      {resultado
        ? <p>Resultados virão no Prompt 3</p>
        : <>
            <Target className="h-10 w-10 opacity-20" />
            <p className="font-medium">Sua projeção aparecerá aqui</p>
          </>
      }
    </div>
  </div>
</TabsContent>
```

---

## Não alterar
Além dos arquivos acima, não modificar mais nada.
