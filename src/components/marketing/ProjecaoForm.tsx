import { useState } from "react";
import { Calculator, DollarSign, Target, Users, Calendar, MessageCircle, Facebook, Instagram } from "lucide-react";
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
