import { useState } from "react";
import {
  ChevronDown, DollarSign, Calendar, Users, Target,
  Image, Video, LayoutList, Smartphone, Clapperboard,
  Facebook, Instagram, Share2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { type ProjecaoInputs, type Plataforma, type Objetivo, type Segmento, type FormatoAnuncio } from "./tipos";

// ── Dados ────────────────────────────────────────────────────────────────────

const SEGMENTOS: { value: Segmento; label: string }[] = [
  { value: "imoveis",    label: "Imóveis / Corretora" },
  { value: "seguros",    label: "Seguros" },
  { value: "educacao",   label: "Educação / Cursos" },
  { value: "saude",      label: "Saúde / Estética" },
  { value: "financeiro", label: "Financeiro / Crédito" },
  { value: "varejo",     label: "Varejo / E-commerce" },
  { value: "automotivo", label: "Automotivo" },
  { value: "servicos",   label: "Serviços Gerais" },
];

const OBJETIVOS: { value: Objetivo; label: string; desc: string }[] = [
  { value: "leads",              label: "Geração de Leads",    desc: "Formulário nativo Meta" },
  { value: "mensagens_whatsapp", label: "Mensagens WhatsApp",  desc: "Click-to-WhatsApp" },
  { value: "trafego",            label: "Tráfego para Site",   desc: "Visitas ao site" },
  { value: "conversoes",         label: "Conversões",          desc: "Ações no site ou app" },
  { value: "alcance",            label: "Alcance",             desc: "Máximo de pessoas" },
  { value: "engajamento",        label: "Engajamento",         desc: "Curtidas e comentários" },
];

const FORMATOS: { value: FormatoAnuncio; icon: React.ElementType; label: string }[] = [
  { value: "imagem",    icon: Image,        label: "Imagem" },
  { value: "video",     icon: Video,        label: "Vídeo" },
  { value: "carrossel", icon: LayoutList,   label: "Carrossel" },
  { value: "stories",   icon: Smartphone,   label: "Stories" },
  { value: "reels",     icon: Clapperboard, label: "Reels" },
];

const PLATAFORMAS: { value: Plataforma; icon: React.ElementType; label: string }[] = [
  { value: "facebook",  icon: Facebook,  label: "Facebook" },
  { value: "instagram", icon: Instagram, label: "Instagram" },
  { value: "ambos",     icon: Share2,    label: "Facebook + Instagram" },
];

// ── Sub-componentes ──────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
      {children}
    </p>
  );
}

function FieldGroup({ children }: { children: React.ReactNode }) {
  return <div className="space-y-2">{children}</div>;
}

// ── Componente principal ─────────────────────────────────────────────────────

interface Props {
  onCalcular: (inputs: ProjecaoInputs) => void;
  loading: boolean;
}

export function ProjecaoForm({ onCalcular, loading }: Props) {
  const [plataforma, setPlataforma]             = useState<Plataforma>("ambos");
  const [segmento, setSegmento]                 = useState<Segmento>("imoveis");
  const [objetivo, setObjetivo]                 = useState<Objetivo>("leads");
  const [formato, setFormato]                   = useState<FormatoAnuncio>("imagem");
  const [orcamentoDiario, setOrcamentoDiario]   = useState(50);
  const [duracaoDias, setDuracaoDias]           = useState(30);
  const [publicoEstimado, setPublicoEstimado]   = useState(100000);
  const [idadeMin, setIdadeMin]                 = useState(25);
  const [idadeMax, setIdadeMax]                 = useState(55);

  const orcamentoTotal = orcamentoDiario * duracaoDias;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCalcular({ plataforma, segmento, objetivo, formato, orcamentoDiario, duracaoDias, publicoEstimado, idadeMin, idadeMax });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">

      {/* ── Plataforma ── */}
      <FieldGroup>
        <SectionLabel>Plataforma</SectionLabel>
        <div className="grid grid-cols-3 gap-2">
          {PLATAFORMAS.map(({ value, icon: Icon, label }) => {
            const ativo = plataforma === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setPlataforma(value)}
                className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-lg border text-xs font-medium transition-all
                  ${ativo
                    ? "border-blue-500 bg-blue-500/10 text-blue-400"
                    : "border-border bg-transparent text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground"
                  }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            );
          })}
        </div>
      </FieldGroup>

      {/* ── Segmento ── */}
      <FieldGroup>
        <SectionLabel>Segmento</SectionLabel>
        <Select value={segmento} onValueChange={(v) => setSegmento(v as Segmento)}>
          <SelectTrigger className="bg-transparent border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SEGMENTOS.map((s) => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldGroup>

      {/* ── Objetivo ── */}
      <FieldGroup>
        <SectionLabel>Objetivo da campanha</SectionLabel>
        <div className="grid grid-cols-2 gap-1.5">
          {OBJETIVOS.map((o) => {
            const ativo = objetivo === o.value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => setObjetivo(o.value)}
                className={`text-left px-3 py-2.5 rounded-lg border transition-all
                  ${ativo
                    ? "border-blue-500 bg-blue-500/10"
                    : "border-border hover:border-muted-foreground/40 bg-transparent"
                  }`}
              >
                <p className={`text-xs font-semibold ${ativo ? "text-blue-400" : "text-foreground"}`}>
                  {o.label}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{o.desc}</p>
              </button>
            );
          })}
        </div>
      </FieldGroup>

      {/* ── Formato ── */}
      <FieldGroup>
        <SectionLabel>Formato do anúncio</SectionLabel>
        <div className="flex gap-1.5 flex-wrap">
          {FORMATOS.map(({ value, icon: Icon, label }) => {
            const ativo = formato === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setFormato(value)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-medium transition-all
                  ${ativo
                    ? "border-blue-500 bg-blue-500/10 text-blue-400"
                    : "border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground bg-transparent"
                  }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            );
          })}
        </div>
        {formato === "reels" && (
          <p className="text-[11px] text-blue-400 mt-1">
            Reels tem o maior alcance orgânico da plataforma.
          </p>
        )}
      </FieldGroup>

      {/* ── Público ── */}
      <FieldGroup>
        <SectionLabel>Público-alvo</SectionLabel>

        {/* Faixa etária */}
        <div className="rounded-lg border border-border px-4 py-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Users className="h-3.5 w-3.5" />
              Faixa etária
            </span>
            <span className="text-xs font-semibold text-foreground">{idadeMin}–{idadeMax} anos</span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground">Mínima</p>
              <Slider min={18} max={50} step={1} value={[idadeMin]}
                onValueChange={([v]) => setIdadeMin(Math.min(v, idadeMax - 1))} />
            </div>
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground">Máxima</p>
              <Slider min={20} max={65} step={1} value={[idadeMax]}
                onValueChange={([v]) => setIdadeMax(Math.max(v, idadeMin + 1))} />
            </div>
          </div>
        </div>

        {/* Tamanho do público */}
        <Select value={String(publicoEstimado)} onValueChange={(v) => setPublicoEstimado(Number(v))}>
          <SelectTrigger className="bg-transparent border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="20000">Hiper-local — até 20 mil pessoas</SelectItem>
            <SelectItem value="50000">Pequeno — até 50 mil pessoas</SelectItem>
            <SelectItem value="100000">Médio — até 100 mil pessoas</SelectItem>
            <SelectItem value="300000">Grande — até 300 mil pessoas</SelectItem>
            <SelectItem value="1000000">Nacional — acima de 1 milhão</SelectItem>
          </SelectContent>
        </Select>
      </FieldGroup>

      {/* ── Orçamento e Duração ── */}
      <FieldGroup>
        <SectionLabel>Investimento</SectionLabel>
        <div className="rounded-lg border border-border px-4 py-3 space-y-4">

          {/* Orçamento diário */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <DollarSign className="h-3.5 w-3.5" />
                Orçamento diário
              </span>
              <span className="text-sm font-semibold text-foreground">
                R$ {orcamentoDiario.toLocaleString("pt-BR")}
              </span>
            </div>
            <Slider min={10} max={2000} step={10} value={[orcamentoDiario]}
              onValueChange={([v]) => setOrcamentoDiario(v)} />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>R$ 10</span><span>R$ 2.000</span>
            </div>
          </div>

          {/* Duração */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Calendar className="h-3.5 w-3.5" />
                Duração
              </span>
              <span className="text-sm font-semibold text-foreground">{duracaoDias} dias</span>
            </div>
            <Slider min={7} max={90} step={1} value={[duracaoDias]}
              onValueChange={([v]) => setDuracaoDias(v)} />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>7 dias</span><span>90 dias</span>
            </div>
          </div>

          {/* Total */}
          <div className="flex items-center justify-between pt-2 border-t border-border">
            <span className="text-xs text-muted-foreground">Total do período</span>
            <span className="text-lg font-bold text-foreground">
              R$ {orcamentoTotal.toLocaleString("pt-BR")}
            </span>
          </div>
        </div>
      </FieldGroup>

      {/* ── Botão ── */}
      <Button
        type="submit"
        className="w-full gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium"
        disabled={loading}
      >
        <Target className="h-4 w-4" />
        {loading ? "Calculando..." : "Calcular Projeção"}
      </Button>

    </form>
  );
}
