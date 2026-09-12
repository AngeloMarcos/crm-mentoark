import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion, animate } from "framer-motion";
import {
  Eye, Pause, Play, Trash2, Plus, Sun, Moon, Check, TrendingUp,
  Users, Send, Bot, Sparkles, ArrowUpRight, ArrowDownRight,
  Info, CheckCircle2, AlertTriangle, XCircle, Zap, Loader2,
  Search, X, ChevronsUpDown, Download, MoreHorizontal,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { useTheme } from "@/components/ThemeProvider";

/* ------------------------------------------------------------------ */
/*  Controles / opções                                                 */
/* ------------------------------------------------------------------ */
type Palette = "a" | "b" | "c";
type Font = "sora" | "grotesk" | "manrope" | "system";
type BtnStyle = "b1" | "b2";
type LabTheme = "dark" | "light";

const PALETTES: { id: Palette; name: string; hint: string }[] = [
  { id: "a", name: "Ember", hint: "punchy · alto contraste" },
  { id: "b", name: "Copper Dusk", hint: "premium · mais quente" },
  { id: "c", name: "Carbon Command", hint: "industrial · preto puro · 2ª cor aço" },
];
const FONTS: { id: Font; name: string }[] = [
  { id: "sora", name: "Sora" },
  { id: "grotesk", name: "Space Grotesk" },
  { id: "manrope", name: "Manrope" },
  { id: "system", name: "Sistema" },
];
const BTNS: { id: BtnStyle; name: string; hint: string }[] = [
  { id: "b1", name: "B1 · Sólido chapado", hint: "laranja plano + sombra neutra" },
  { id: "b2", name: "B2 · Sólido + brilho topo", hint: "linha de luz no topo, sem gradiente" },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
function Segmented<T extends string>({
  label, value, onChange, options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { id: T; name: string; hint?: string }[];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-card/60 p-1">
        {options.map((o) => {
          const on = o.id === value;
          return (
            <button
              key={o.id}
              onClick={() => onChange(o.id)}
              title={o.hint}
              className={`relative rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                on ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {on && (
                <motion.span
                  layoutId={`seg-${label}`}
                  className="absolute inset-0 rounded-md bg-primary"
                  transition={{ type: "spring", stiffness: 400, damping: 32 }}
                />
              )}
              <span className="relative z-10">{o.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CountUp({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!ref.current) return;
    if (reduce) {
      ref.current.textContent = value.toLocaleString("pt-BR");
      return;
    }
    const controls = animate(0, value, {
      duration: 1.1,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        if (ref.current) ref.current.textContent = Math.round(v).toLocaleString("pt-BR");
      },
    });
    return () => controls.stop();
  }, [value, reduce]);
  return <span ref={ref} className={className}>0</span>;
}

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight" style={{ textWrap: "balance" } as any}>
          <span className="h-5 w-1 shrink-0 rounded-full bg-primary" />
          {title}
        </h2>
        {desc && <p className="mt-1 text-sm text-muted-foreground">{desc}</p>}
      </div>
      {children}
    </section>
  );
}

function StatusChip({ kind }: { kind: "processando" | "pausado" | "finalizado" }) {
  const map = {
    processando: { label: "Processando", cls: "bg-info/15 text-info ring-info/30" },
    pausado: { label: "Pausado", cls: "bg-warning/15 text-warning ring-warning/30" },
    finalizado: { label: "Finalizado", cls: "bg-success/15 text-success ring-success/30" },
  } as const;
  const s = map[kind];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${s.cls}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {s.label}
    </span>
  );
}

function ProgressSegmented({ enviados, falhas, pendentes }: { enviados: number; falhas: number; pendentes: number }) {
  const total = Math.max(1, enviados + falhas + pendentes);
  const pct = (n: number) => `${(n / total) * 100}%`;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="bg-success" style={{ width: pct(enviados) }} />
        <div className="bg-destructive" style={{ width: pct(falhas) }} />
      </div>
      <div className="flex gap-3 text-[11px] tabular-nums text-muted-foreground" style={{ fontVariantNumeric: "tabular-nums" }}>
        <span className="text-success">{enviados.toLocaleString("pt-BR")} enviados</span>
        <span className="text-destructive">{falhas.toLocaleString("pt-BR")} falhas</span>
        <span>{pendentes.toLocaleString("pt-BR")} pendentes</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Dados de exemplo                                                   */
/* ------------------------------------------------------------------ */
const CHART = [
  { dia: "Seg", total: 120 }, { dia: "Ter", total: 210 }, { dia: "Qua", total: 180 },
  { dia: "Qui", total: 320 }, { dia: "Sex", total: 290 }, { dia: "Sáb", total: 410 },
  { dia: "Dom", total: 380 },
];
const CHART_MULTI = [
  { dia: "Seg", entregues: 96, falhas: 24, leads: 40 },
  { dia: "Ter", entregues: 180, falhas: 30, leads: 62 },
  { dia: "Qua", entregues: 150, falhas: 30, leads: 55 },
  { dia: "Qui", entregues: 270, falhas: 50, leads: 88 },
  { dia: "Sex", entregues: 250, falhas: 40, leads: 70 },
  { dia: "Sáb", entregues: 360, falhas: 50, leads: 120 },
  { dia: "Dom", entregues: 330, falhas: 50, leads: 104 },
];
const FILAS = [
  { nome: "Fila 04/09 10:43", tpl: "CRM 2", por: "Angelo", status: "processando" as const, e: 23, f: 279, p: 4141 },
  { nome: "Fila 03/09 14:48", tpl: "CRM 2", por: "Angelo", status: "processando" as const, e: 25, f: 549, p: 3689 },
  { nome: "Fila 02/09 14:48", tpl: "Mentoark", por: "Angelo", status: "pausado" as const, e: 0, f: 1775, p: 2488 },
  { nome: "Fila 27/08 15:29", tpl: "Mentoark", por: "Angelo", status: "finalizado" as const, e: 5, f: 701, p: 0 },
  { nome: "Fila 25/08 13:24", tpl: "Mentoark", por: "Angelo", status: "finalizado" as const, e: 72, f: 36, p: 0 },
];

/* ------------------------------------------------------------------ */
/*  Página                                                             */
/* ------------------------------------------------------------------ */
export default function StyleLab() {
  const { theme } = useTheme();
  const [palette, setPalette] = useState<Palette>("a");
  const [font, setFont] = useState<Font>("sora");
  const [btn, setBtn] = useState<BtnStyle>("b1");
  const [labTheme, setLabTheme] = useState<LabTheme>((theme as LabTheme) || "dark");
  const [reduce, setReduce] = useState(false);
  const [listKey, setListKey] = useState(0);
  const reduceMotion = useReducedMotion();

  const container = {
    hidden: {},
    show: { transition: { staggerChildren: reduceMotion ? 0 : 0.06 } },
  };
  const item = {
    hidden: { opacity: 0, y: reduceMotion ? 0 : 10 },
    show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] as any } },
  };

  return (
    <div
      data-lab
      data-lab-palette={palette}
      data-lab-theme={labTheme}
      data-lab-font={font}
      data-lab-btn={btn}
      data-lab-reduce={reduce ? "1" : "0"}
      className="min-h-screen"
    >
      {/* ---------- Toolbar ---------- */}
      <div className="sticky top-0 z-30 border-b border-border bg-[hsl(var(--background))] shadow-[0_1px_0_0_hsl(0_0%_0%/0.4)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-end gap-x-6 gap-y-3 px-5 py-3">
          <div className="mr-auto flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Sparkles className="h-4 w-4" />
            </span>
            <div className="leading-tight">
              <div className="text-sm font-semibold">Style Lab</div>
              <div className="text-[11px] text-muted-foreground">compare e escolha — nada disto está no app ainda</div>
            </div>
          </div>
          <Segmented label="Paleta" value={palette} onChange={setPalette} options={PALETTES} />
          <Segmented label="Fonte" value={font} onChange={setFont} options={FONTS} />
          <Segmented label="Botão" value={btn} onChange={setBtn} options={BTNS} />
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Tema</span>
            <div className="flex gap-1 rounded-lg border border-border bg-card/60 p-1">
              <button
                onClick={() => setLabTheme("light")}
                className={`rounded-md px-2.5 py-1.5 text-xs ${labTheme === "light" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Sun className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setLabTheme("dark")}
                className={`rounded-md px-2.5 py-1.5 text-xs ${labTheme === "dark" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Moon className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <label className="flex cursor-pointer flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Movimento</span>
            <span className="flex items-center gap-2 rounded-lg border border-border bg-card/60 px-3 py-1.5 text-xs">
              <input type="checkbox" checked={reduce} onChange={(e) => setReduce(e.target.checked)} className="accent-[hsl(var(--primary))]" />
              reduzir
            </span>
          </label>
        </div>
      </div>

      {/* ---------- Conteúdo ---------- */}
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="mx-auto flex max-w-6xl flex-col gap-14 px-5 py-10"
      >
        {/* Hero / amostra de tipografia */}
        <motion.div variants={item} className="flex flex-col gap-3">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">MentoArk · Design</span>
          <h1 className="text-4xl font-bold leading-[1.05] tracking-tight md:text-5xl" style={{ textWrap: "balance" } as any}>
            Laranja em destaque, preto de base,<br />o resto em silêncio.
          </h1>
          <p className="max-w-xl text-[15px] text-muted-foreground">
            Amostra viva das duas paletas, três tratamentos de botão e quatro fontes.
            Alterne pelos controles no topo — em light e dark.
          </p>
          <div className="mt-2 flex flex-wrap gap-3">
            <button className="lab-btn lg">Começar agora <ArrowUpRight className="h-4 w-4" /></button>
            <button className="lab-btn lg outline">Ver documentação</button>
          </div>
        </motion.div>

        {/* Botões */}
        <motion.div variants={item}>
          <Section
            title="Botões"
            desc="Hierarquia clara: 1 ação primária laranja por tela, secundária neutra, destrutiva vermelha. Clique para ver o “press” (encolhe 3%)."
          >
            <div className="flex flex-col gap-6 rounded-xl border border-border bg-card p-6">
              {/* hierarquia */}
              <div>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Hierarquia</div>
                <div className="flex flex-wrap items-center gap-3">
                  <button className="lab-btn">Salvar campanha</button>
                  <button className="lab-btn secondary">Cancelar</button>
                  <button className="lab-btn danger">Excluir <Trash2 className="h-4 w-4" /></button>
                  <button className="lab-btn outline">Duplicar</button>
                  <button className="lab-btn ghost">Ver histórico</button>
                  <span className="cursor-pointer text-sm font-medium text-primary underline-offset-4 hover:underline">Saiba mais</span>
                </div>
              </div>
              {/* tamanhos */}
              <div>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Tamanhos</div>
                <div className="flex flex-wrap items-center gap-3">
                  <button className="lab-btn sm">Pequeno</button>
                  <button className="lab-btn">Padrão</button>
                  <button className="lab-btn lg">Grande</button>
                  <button className="lab-btn icon" aria-label="ações"><MoreHorizontal className="h-4 w-4" /></button>
                  <button className="lab-btn icon sm outline" aria-label="baixar"><Download className="h-3.5 w-3.5" /></button>
                </div>
              </div>
              {/* com ícone / estados */}
              <div>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Ícone &amp; estados</div>
                <div className="flex flex-wrap items-center gap-3">
                  <button className="lab-btn"><Plus className="h-4 w-4" /> Novo disparo</button>
                  <button className="lab-btn">Avançar <ArrowUpRight className="h-4 w-4" /></button>
                  <button className="lab-btn" disabled><Loader2 className="h-4 w-4 animate-spin" /> Enviando…</button>
                  <button className="lab-btn" disabled>Desabilitado</button>
                </div>
              </div>
              {/* largura total */}
              <div>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Bloco (mobile / modais)</div>
                <button className="lab-btn block">Confirmar e enviar 4.263 mensagens</button>
              </div>
            </div>
          </Section>
        </motion.div>

        {/* Métricas / dashboard */}
        <motion.div variants={item}>
          <Section title="Métricas & gráfico" desc="Números em fonte display com contagem animada; área do gráfico em laranja translúcido.">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { icon: Users, label: "Leads totais", value: 4820, delta: "+12%" },
                { icon: Send, label: "Mensagens hoje", value: 1394, delta: "+8%" },
                { icon: TrendingUp, label: "Conversão", value: 27, delta: "+3pp", suffix: "%" },
                { icon: Bot, label: "Respostas IA", value: 932, delta: "+21%" },
              ].map((s) => (
                <div key={s.label} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 shadow-[inset_0_2px_0_0_hsl(var(--primary))]">
                  <div className="flex items-center justify-between">
                    <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary/15 text-primary ring-1 ring-inset ring-primary/25">
                      <s.icon style={{ width: 18, height: 18 }} />
                    </span>
                    <span className="rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-success">{s.delta}</span>
                  </div>
                  <div>
                    <div className="text-2xl font-bold tracking-tight" style={{ fontVariantNumeric: "tabular-nums" }}>
                      <CountUp value={s.value} />{s.suffix}
                    </div>
                    <div className="text-xs text-muted-foreground">{s.label}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-xl border border-border bg-card p-5 shadow-[inset_0_2px_0_0_hsl(var(--primary))]">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                <span className="h-2 w-2 rounded-full bg-primary" />
                Mensagens · últimos 7 dias
              </div>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={CHART} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="dia" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--popover))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 10,
                        color: "hsl(var(--popover-foreground))",
                        fontSize: 12,
                      }}
                      cursor={{ stroke: "hsl(var(--primary))", strokeOpacity: 0.3 }}
                    />
                    <Area
                      type="monotone" dataKey="total"
                      stroke="hsl(var(--primary))" strokeWidth={2.5}
                      fill="hsl(var(--primary))" fillOpacity={0.1}
                      dot={{ r: 0 }} activeDot={{ r: 4, fill: "hsl(var(--primary))", stroke: "hsl(var(--card))", strokeWidth: 2 }}
                      isAnimationActive={!reduceMotion}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </Section>
        </motion.div>

        {/* Tabela de filas */}
        <motion.div variants={item}>
          <Section title="Tabela — Fila de Mensagens" desc="O padrão que a tela de Disparos vai usar: progresso segmentado + chip de status + ações.">
            <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-[inset_0_2px_0_0_hsl(var(--primary))]">
              <table className="w-full min-w-[760px] text-sm" style={{ fontVariantNumeric: "tabular-nums" }}>
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 font-semibold">Canal</th>
                    <th className="px-4 py-3 font-semibold">Nome</th>
                    <th className="px-4 py-3 font-semibold">Template</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Progresso</th>
                    <th className="px-4 py-3 font-semibold text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {FILAS.map((f) => (
                    <tr key={f.nome} className="border-b border-border/60 last:border-0 transition-colors hover:bg-muted/40">
                      <td className="px-4 py-3">
                        <span className="rounded-md bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">API</span>
                      </td>
                      <td className="px-4 py-3 font-medium">{f.nome}</td>
                      <td className="px-4 py-3 text-muted-foreground">{f.tpl}</td>
                      <td className="px-4 py-3"><StatusChip kind={f.status} /></td>
                      <td className="px-4 py-3 w-[280px]">
                        <ProgressSegmented enviados={f.e} falhas={f.f} pendentes={f.p} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <button className="lab-btn icon sm" style={{ width: 32, height: 32 }} aria-label="ver"><Eye className="h-3.5 w-3.5" /></button>
                          <button className="lab-btn icon sm outline" style={{ width: 32, height: 32 }} aria-label="pausar"><Pause className="h-3.5 w-3.5" /></button>
                          <button className="lab-btn icon sm ghost" style={{ width: 32, height: 32 }} aria-label="excluir"><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </motion.div>

        {/* Detalhes coloridos — azul / verde / vermelho */}
        <motion.div variants={item}>
          <Section
            title="Detalhes coloridos"
            desc="Azul, verde e vermelho como cor de detalhe — ícones, bordas de severidade, séries de gráfico e deltas. O laranja continua sendo a marca; estes são sinais."
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { icon: Zap, tint: "primary", label: "Disparos ativos", value: "3", delta: "+1", up: true },
                { icon: Info, tint: "info", label: "Aguardando revisão", value: "12", delta: "novo", up: true },
                { icon: CheckCircle2, tint: "success", label: "Entregues hoje", value: "1.394", delta: "+8%", up: true },
                { icon: XCircle, tint: "destructive", label: "Falhas 24h", value: "279", delta: "-14%", up: false },
              ].map((s) => (
                <div
                  key={s.label}
                  className="flex items-start gap-3 rounded-xl border border-border bg-card p-4"
                  style={{ boxShadow: `inset 0 2px 0 0 hsl(var(--${s.tint}))` }}
                >
                  <span
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-lg"
                    style={{ background: `hsl(var(--${s.tint}) / 0.16)`, color: `hsl(var(--${s.tint}))`, boxShadow: `inset 0 0 0 1px hsl(var(--${s.tint}) / 0.3)` }}
                  >
                    <s.icon style={{ width: 18, height: 18 }} />
                  </span>
                  <div className="min-w-0">
                    <div className="text-xl font-bold tracking-tight" style={{ fontVariantNumeric: "tabular-nums" }}>{s.value}</div>
                    <div className="truncate text-xs text-muted-foreground">{s.label}</div>
                    <div
                      className="mt-1 inline-flex items-center gap-0.5 text-[11px] font-semibold"
                      style={{ color: `hsl(var(--${s.up ? "success" : "destructive"}))` }}
                    >
                      {s.up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                      {s.delta}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {/* Lista de severidade com borda-acento */}
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="mb-3 text-sm font-medium">Eventos recentes</div>
                <ul className="flex flex-col gap-2">
                  {[
                    { tint: "info", icon: Info, txt: "Nova integração conectada", time: "há 2 min" },
                    { tint: "success", icon: CheckCircle2, txt: "Fila 04/09 concluída — 4.140 entregues", time: "há 18 min" },
                    { tint: "warning", icon: AlertTriangle, txt: "Instância “Stella” com bateria baixa", time: "há 1 h" },
                    { tint: "destructive", icon: XCircle, txt: "312 mensagens falharam (número inválido)", time: "há 3 h" },
                  ].map((e) => (
                    <li
                      key={e.txt}
                      className="flex items-center gap-3 rounded-lg bg-background/60 py-2 pl-3 pr-2 text-sm"
                      style={{ borderLeft: `2px solid hsl(var(--${e.tint}))` }}
                    >
                      <e.icon style={{ width: 15, height: 15, color: `hsl(var(--${e.tint}))` }} />
                      <span className="flex-1 truncate">{e.txt}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{e.time}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Gráfico multi-série */}
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium">Entrega · 7 dias</span>
                  <div className="flex gap-3 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-success" />entregues</span>
                    <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-destructive" />falhas</span>
                    <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-info" />leads</span>
                  </div>
                </div>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={CHART_MULTI} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="dia" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tickLine={false} axisLine={false} />
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))",
                          borderRadius: 10, color: "hsl(var(--popover-foreground))", fontSize: 12,
                        }}
                      />
                      <Area type="monotone" dataKey="entregues" stroke="hsl(var(--success))" strokeWidth={2} fill="hsl(var(--success))" fillOpacity={0.1} isAnimationActive={!reduceMotion} />
                      <Area type="monotone" dataKey="leads" stroke="hsl(var(--info))" strokeWidth={2} fill="hsl(var(--info))" fillOpacity={0.08} isAnimationActive={!reduceMotion} />
                      <Area type="monotone" dataKey="falhas" stroke="hsl(var(--destructive))" strokeWidth={2} fill="none" isAnimationActive={!reduceMotion} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </Section>
        </motion.div>

        {/* Cards */}
        <motion.div variants={item}>
          <Section
            title="Cards"
            desc="Borda + fundo por papel. Card estático não reage; card clicável levanta e acende a borda laranja; selecionado ganha anel + faixa. Nada de sombra pesada."
          >
            <div className="grid gap-4 lg:grid-cols-3">
              {/* estático com header/body/footer */}
              <div className="lab-card flex flex-col">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <span className="text-sm font-semibold">Template · CRM 2</span>
                  <StatusChip kind="finalizado" />
                </div>
                <div className="flex-1 px-4 py-4 text-sm text-muted-foreground">
                  Cabeçalho, corpo e rodapé com ritmo de espaçamento fixo. Card de conteúdo padrão.
                </div>
                <div className="flex items-center gap-2 border-t border-border px-4 py-3">
                  <button className="lab-btn sm">Abrir</button>
                  <button className="lab-btn sm ghost">Duplicar</button>
                </div>
              </div>

              {/* interativo */}
              <button className="lab-card interactive strip pad flex flex-col items-start gap-2 text-left">
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-primary/15 text-primary"><Zap style={{ width: 18, height: 18 }} /></span>
                <span className="text-sm font-semibold">Nova automação</span>
                <span className="text-xs text-muted-foreground">Card clicável — passe o mouse: levanta 2px e a borda fica laranja.</span>
              </button>

              {/* selecionado */}
              <div className="lab-card selected pad flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">Plano Pro</span>
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-primary text-primary-foreground"><Check className="h-3 w-3" /></span>
                </div>
                <span className="text-xs text-muted-foreground">Estado selecionado: anel laranja + faixa no topo. Sem depender só de cor de texto.</span>
              </div>
            </div>

            {/* três elevações */}
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <div className="rounded-xl border border-border/60 bg-background p-4 text-sm">
                <div className="font-medium">Flat</div>
                <p className="mt-1 text-xs text-muted-foreground">Sem sombra — seções.</p>
              </div>
              <div className="rounded-xl border border-border bg-card p-4 text-sm shadow-[0_1px_2px_rgb(0_0_0/0.5)]">
                <div className="font-medium">Card</div>
                <p className="mt-1 text-xs text-muted-foreground">Sombra curta — conteúdo.</p>
              </div>
              <div className="rounded-xl border border-border bg-[hsl(var(--surface-raised))] p-4 text-sm shadow-[0_6px_20px_-10px_rgb(0_0_0/0.7)]">
                <div className="font-medium">Raised</div>
                <p className="mt-1 text-xs text-muted-foreground">Popover / modal.</p>
              </div>
            </div>

            {/* badges */}
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full bg-primary px-2.5 py-0.5 text-xs font-semibold text-primary-foreground">Marca</span>
              <span className="rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-semibold text-success ring-1 ring-success/30">Sucesso</span>
              <span className="rounded-full bg-warning/15 px-2.5 py-0.5 text-xs font-semibold text-warning ring-1 ring-warning/30">Alerta</span>
              <span className="rounded-full bg-destructive/15 px-2.5 py-0.5 text-xs font-semibold text-destructive ring-1 ring-destructive/30">Erro</span>
              <span className="rounded-full bg-info/15 px-2.5 py-0.5 text-xs font-semibold text-info ring-1 ring-info/30">Info</span>
              <span className="rounded-full border border-border px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">Neutro</span>
            </div>
          </Section>
        </motion.div>

        {/* Form controls */}
        <motion.div variants={item}>
          <Section title="Campos de formulário" desc="Foco com anel laranja consistente.">
            <div className="grid max-w-lg gap-4 rounded-xl border border-border bg-card p-6">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">Nome da campanha</span>
                <input
                  placeholder="Ex.: Reengajamento setembro"
                  className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">Mensagem</span>
                <textarea
                  rows={3}
                  placeholder="Olá {{nome}}, ..."
                  className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                />
              </label>
              <div className="flex items-center gap-3">
                <button className="lab-btn">Salvar <Check className="h-4 w-4" /></button>
                <button className="lab-btn ghost">Cancelar</button>
              </div>
            </div>
          </Section>
        </motion.div>

        {/* Funções / componentes interativos */}
        <motion.div variants={item}>
          <Section
            title="Funções"
            desc="Componentes que o usuário opera: abas, chave liga/desliga, busca, e a tabela com seleção, ordenação e ações que aparecem no hover."
          >
            <FuncoesDemo reduceMotion={!!reduceMotion} />
          </Section>
        </motion.div>

        {/* Motion */}
        <motion.div variants={item}>
          <Section title="Movimento" desc="Stagger de lista, indicador de navegação deslizante, contagem. Tudo respeita “reduzir movimento”.">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-border bg-card p-6">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-medium">Lista com stagger</span>
                  <button className="lab-btn sm outline" onClick={() => setListKey((k) => k + 1)}>Repetir</button>
                </div>
                <motion.ul
                  key={listKey}
                  variants={container}
                  initial="hidden"
                  animate="show"
                  className="flex flex-col gap-2"
                >
                  {["Novo lead capturado", "Mensagem entregue", "IA respondeu", "Lead movido para Ganho"].map((t) => (
                    <motion.li
                      key={t}
                      variants={item}
                      className="flex items-center gap-2 rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                      {t}
                    </motion.li>
                  ))}
                </motion.ul>
              </div>
              <div className="rounded-xl border border-border bg-card p-6">
                <span className="text-sm font-medium">Indicador de navegação</span>
                <NavDemo />
              </div>
            </div>
          </Section>
        </motion.div>

        <motion.div variants={item} className="pb-8 pt-4 text-center text-xs text-muted-foreground">
          Escolha <strong>paleta + fonte + botão</strong> e me diga — aí eu consolido nos tokens e nos componentes.
        </motion.div>
      </motion.div>
    </div>
  );
}

function FuncoesDemo({ reduceMotion }: { reduceMotion: boolean }) {
  const TABS = ["Perfil", "Configurações", "Execuções"];
  const [tab, setTab] = useState(0);
  const [sw, setSw] = useState<{ ia: boolean; horario: boolean; humaniza: boolean }>({ ia: true, horario: false, humaniza: true });
  const [q, setQ] = useState("");
  const [sortDesc, setSortDesc] = useState(true);
  const [sel, setSel] = useState<Record<number, boolean>>({});
  const spring = reduceMotion
    ? { duration: 0 }
    : { type: "spring" as const, stiffness: 400, damping: 32 };

  const rows = [...FILAS].sort((a, b) =>
    sortDesc ? b.nome.localeCompare(a.nome) : a.nome.localeCompare(b.nome),
  );
  const visible = rows.filter((f) => !q || f.nome.toLowerCase().includes(q.toLowerCase()));
  const allSel = rows.length > 0 && rows.every((_, i) => sel[i]);
  const selCount = Object.values(sel).filter(Boolean).length;

  return (
    <div className="flex flex-col gap-4">
      {/* Abas com indicador deslizante */}
      <div className="lab-card">
        <div className="flex border-b border-border px-2">
          {TABS.map((t, i) => (
            <button
              key={t}
              onClick={() => setTab(i)}
              className={`relative px-4 py-3 text-sm font-medium transition-colors ${
                i === tab ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t}
              {i === tab && (
                <motion.span layoutId="lab-tab" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" transition={spring} />
              )}
            </button>
          ))}
        </div>
        <div className="p-4 text-sm text-muted-foreground">
          {tab === 0 && "Nome, avatar e descrição do agente."}
          {tab === 1 && "Modelo, temperatura e ferramentas habilitadas."}
          {tab === 2 && "Histórico de execuções com custo por chamada."}
        </div>
      </div>

      {/* Chaves liga/desliga */}
      <div className="lab-card pad">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Chaves liga/desliga</div>
        <div className="flex flex-col divide-y divide-border">
          {([
            { k: "ia", label: "IA responde automaticamente", sub: "Motor de conversa ligado neste funil" },
            { k: "horario", label: "Respeitar horário comercial", sub: "Fora do horário, só registra" },
            { k: "humaniza", label: "Humanizar mensagens", sub: "Reescreve antes de enviar" },
          ] as const).map((r) => (
            <div key={r.k} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
              <div>
                <div className="text-sm font-medium">{r.label}</div>
                <div className="text-xs text-muted-foreground">{r.sub}</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={sw[r.k]}
                aria-label={r.label}
                className="lab-switch"
                data-on={sw[r.k]}
                onClick={() => setSw((s) => ({ ...s, [r.k]: !s[r.k] }))}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Busca + tabela com seleção / ordenação / ações no hover */}
      <div className="lab-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar fila…"
              className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-9 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            />
            {q && (
              <button
                onClick={() => setQ("")}
                aria-label="limpar busca"
                className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {selCount > 0 ? (
            <button className="lab-btn sm danger"><Trash2 className="h-3.5 w-3.5" /> Excluir ({selCount})</button>
          ) : (
            <button className="lab-btn sm"><Plus className="h-3.5 w-3.5" /> Nova fila</button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm" style={{ fontVariantNumeric: "tabular-nums" }}>
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="w-10 px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={allSel}
                    onChange={(e) => {
                      const v = e.target.checked;
                      const next: Record<number, boolean> = {};
                      rows.forEach((_, i) => (next[i] = v));
                      setSel(next);
                    }}
                    className="accent-[hsl(var(--primary))]"
                    aria-label="selecionar todos"
                  />
                </th>
                <th className="px-3 py-2.5 font-semibold">
                  <button onClick={() => setSortDesc((d) => !d)} className="inline-flex items-center gap-1 hover:text-foreground">
                    Nome <ChevronsUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="px-3 py-2.5 font-semibold">Status</th>
                <th className="px-3 py-2.5 font-semibold">Progresso</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {visible.map((f) => {
                const i = rows.indexOf(f);
                return (
                  <tr
                    key={f.nome}
                    className={`group border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40 ${sel[i] ? "bg-primary/5" : ""}`}
                  >
                    <td className="px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={!!sel[i]}
                        onChange={(e) => setSel((s) => ({ ...s, [i]: e.target.checked }))}
                        className="accent-[hsl(var(--primary))]"
                        aria-label={`selecionar ${f.nome}`}
                      />
                    </td>
                    <td className="px-3 py-2.5 font-medium">{f.nome}</td>
                    <td className="px-3 py-2.5"><StatusChip kind={f.status} /></td>
                    <td className="w-[240px] px-3 py-2.5"><ProgressSegmented enviados={f.e} falhas={f.f} pendentes={f.p} /></td>
                    <td className="px-3 py-2.5">
                      <div className="flex justify-end gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                        <button className="lab-btn icon sm outline" aria-label="ver"><Eye className="h-3.5 w-3.5" /></button>
                        <button className="lab-btn icon sm outline" aria-label="pausar"><Pause className="h-3.5 w-3.5" /></button>
                        <button className="lab-btn icon sm ghost" aria-label="excluir"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-sm text-muted-foreground">Nenhuma fila para “{q}”.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-border px-3 py-2.5 text-xs text-muted-foreground">
          <span>Mostrando <span className="tabular-nums">1–{visible.length}</span> de <span className="tabular-nums">42</span></span>
          <div className="flex gap-1">
            <button className="lab-btn sm outline" disabled>Anterior</button>
            <button className="lab-btn sm outline">Próxima</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function NavDemo() {
  const items = ["Visão geral", "Disparos", "Agentes", "Relatórios"];
  const [active, setActive] = useState(1);
  return (
    <div className="mt-3 flex flex-col gap-1">
      {items.map((it, i) => (
        <button
          key={it}
          onClick={() => setActive(i)}
          className={`relative flex items-center rounded-lg px-3 py-2 text-sm transition-colors ${
            i === active ? "text-primary" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {i === active && (
            <motion.span
              layoutId="lab-nav-indicator"
              className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-primary"
              transition={{ type: "spring", stiffness: 400, damping: 32 }}
            />
          )}
          {i === active && (
            <motion.span
              layoutId="lab-nav-bg"
              className="absolute inset-0 rounded-lg bg-primary/10"
              transition={{ type: "spring", stiffness: 400, damping: 32 }}
            />
          )}
          <span className="relative z-10">{it}</span>
        </button>
      ))}
    </div>
  );
}
