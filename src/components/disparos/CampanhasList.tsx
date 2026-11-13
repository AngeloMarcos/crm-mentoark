/**
 * CampanhasList.tsx — lista persistente de campanhas de Disparo (`disparos`), com progresso e
 * status. Usado como tela padrão de `Disparos.tsx` (Sprint Estruturar Disparo, 2026-08-11) — antes
 * dela, a única forma de ver uma campanha era o instante em que era criada (`activeCampaign`,
 * estado React em memória); sair da tela perdia esse controle pra sempre (ver
 * `components/disparos/MonitoringDashboard.tsx` pro relato completo do incidente real que motivou
 * isso, conta `mentoark@gmail.com`, campanha disparando sem controle nenhum na UI).
 *
 * Redesign 2026-11-13 ("liquid glass"): o progresso saiu do filete de 4px embaixo do texto e virou
 * o preenchimento do retângulo inteiro — o card é vidro translúcido e o avanço é o líquido dentro
 * dele, com menisco brilhante na borda de avanço. Utilidades em `index.css` (`.lq-*`).
 */
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Play, Pause, Square, RefreshCw, ChevronRight, Plus, Send, FileEdit, Clock, CheckCircle2, Search, Copy } from "lucide-react";
import { api } from "@/integrations/database/client";

interface CampanhasListProps {
  onOpen: (id: string) => void;
  onNova: () => void;
  onDuplicar?: (c: any) => void;
}

export function CampanhasList({ onOpen, onNova, onDuplicar }: CampanhasListProps) {
  const [campanhas, setCampanhas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [carregouUmaVez, setCarregouUmaVez] = useState(false);

  const fetchCampanhas = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.from("disparos").select("*").order("created_at", { ascending: false });
      setCampanhas(data || []);
    } finally {
      setLoading(false);
      setCarregouUmaVez(true);
    }
  }, []);

  useEffect(() => {
    fetchCampanhas();
    // [AUDITORIA] LÓGICA: poll de 15s — só a lista (nome/status/contagem grosseira). O detalhe
    // real de uma campanha aberta (`MonitoringDashboard`) tem seu próprio poll de 3s.
    const timer = setInterval(fetchCampanhas, 15000);
    return () => clearInterval(timer);
  }, [fetchCampanhas]);

  // Busca e filtro (2026-11-13): a lista crescia sem limite e campanhas recriadas com o mesmo
  // nome ficavam indistinguíveis — três "Mentoark 05*" seguidas, nenhuma forma de saber qual é
  // qual. Resolvido junto com a data na linha (ver `CampanhaRow`).
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<string>("todas");

  const termo = busca.trim().toLowerCase();
  const visiveis = campanhas.filter(c => {
    if (termo && !String(c.nome || "").toLowerCase().includes(termo)) return false;
    if (filtro !== "todas" && c.status !== filtro) return false;
    return true;
  });

  const emAndamento = visiveis.filter(c => c.status === 'em_andamento');
  const resto = visiveis.filter(c => c.status !== 'em_andamento');
  const filtrando = termo !== "" || filtro !== "todas";

  // O resumo do topo é sempre sobre o estado real da operação, nunca sobre o que o filtro mostra:
  // esconder "2 disparando agora" porque o operador buscou outra coisa seria perigoso.
  const ativas = campanhas.filter(c => c.status === 'em_andamento');
  const enviadosAgora = ativas.reduce((acc, c) => acc + (c.enviados || 0), 0);
  const totalAgora = ativas.reduce((acc, c) => acc + (c.total_leads || 0), 0);

  const FILTROS = [
    { v: "todas", r: "Todas" },
    { v: "em_andamento", r: "Em andamento" },
    { v: "pausado", r: "Pausadas" },
    { v: "concluido", r: "Concluídas" },
    { v: "cancelado", r: "Canceladas" },
  ].filter(f => f.v === "todas" || f.v === filtro || campanhas.some(c => c.status === f.v));

  return (
    <div className="max-w-6xl mx-auto space-y-7">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Campanhas de Disparo</h1>
          <p className="text-sm text-muted-foreground">
            {ativas.length > 0 ? (
              <>
                {ativas.length === 1 ? "1 campanha disparando agora" : `${ativas.length} campanhas disparando agora`}
                {totalAgora > 0 && (
                  <span className="tabular-nums"> — {enviadosAgora.toLocaleString("pt-BR")} de {totalAgora.toLocaleString("pt-BR")} mensagens enviadas</span>
                )}
              </>
            ) : (
              "Nenhuma campanha disparando agora"
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={fetchCampanhas} disabled={loading} aria-label="Atualizar lista">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button onClick={onNova} className="gap-2">
            <Plus className="h-4 w-4" /> Nova Campanha
          </Button>
        </div>
      </div>

      {!carregouUmaVez ? (
        <div className="space-y-2.5">
          {[0, 1, 2].map(i => (
            <div key={i} className="lq-surface h-[76px] rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : campanhas.length === 0 ? (
        <div className="lq-surface rounded-2xl p-12 text-center">
          <div className="lq-content">
            <Send className="h-7 w-7 mx-auto mb-4 text-muted-foreground/50" />
            <p className="text-sm font-medium">Nenhuma campanha criada ainda</p>
            <p className="text-sm text-muted-foreground mt-1">
              Escolha os contatos, escreva a mensagem e acompanhe o envio aqui.
            </p>
            <Button variant="outline" size="sm" className="mt-5" onClick={onNova}>
              Criar a primeira campanha
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {campanhas.length > 4 && (
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-[220px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={busca}
                  onChange={e => setBusca(e.target.value)}
                  placeholder="Buscar campanha pelo nome"
                  className="pl-9"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {FILTROS.map(f => (
                  <button
                    key={f.v}
                    type="button"
                    onClick={() => setFiltro(f.v)}
                    className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                      filtro === f.v
                        ? "border-primary/50 bg-primary/10 text-primary"
                        : "border-border/60 text-muted-foreground hover:bg-foreground/[0.04]"
                    }`}
                  >
                    {f.r}
                  </button>
                ))}
              </div>
            </div>
          )}

          {visiveis.length === 0 ? (
            <div className="lq-surface rounded-2xl p-10 text-center">
              <div className="lq-content">
                <p className="text-sm font-medium">Nenhuma campanha encontrada</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Ajuste a busca ou escolha outro status.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-5"
                  onClick={() => { setBusca(""); setFiltro("todas"); }}
                >
                  Limpar filtros
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-8">
              {emAndamento.length > 0 && (
                <section className="space-y-2.5">
                  <SecaoTitulo titulo="Em andamento" quantidade={emAndamento.length} />
                  {emAndamento.map(c => <CampanhaRow key={c.id} c={c} onOpen={onOpen} onDuplicar={onDuplicar} />)}
                </section>
              )}
              {resto.length > 0 && (
                <section className="space-y-2.5">
                  <SecaoTitulo titulo={filtrando ? "Resultados" : "Histórico"} quantidade={resto.length} />
                  {resto.map(c => <CampanhaRow key={c.id} c={c} onOpen={onOpen} onDuplicar={onDuplicar} />)}
                </section>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SecaoTitulo({ titulo, quantidade }: { titulo: string; quantidade: number }) {
  return (
    <div className="flex items-center gap-3 pb-1">
      <p className="text-sm font-medium text-foreground/80">{titulo}</p>
      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
        {quantidade}
      </span>
      <div className="h-px flex-1 bg-border/60" />
    </div>
  );
}

/**
 * Aparência por status: o acento é um trio HSL (mesmo formato dos tokens do tema), injetado como
 * `--lq-accent` e usado tanto pelo líquido quanto pela borda no hover e pelo ponto do status.
 */
const APARENCIA: Record<string, { rotulo: string; accent: string; icone: typeof Play }> = {
  em_andamento: { rotulo: "Em andamento", accent: "var(--primary)", icone: Play },
  pausado:      { rotulo: "Pausada",      accent: "38 92% 50%",     icone: Pause },
  concluido:    { rotulo: "Concluída",    accent: "152 55% 45%",    icone: CheckCircle2 },
  cancelado:    { rotulo: "Cancelada",    accent: "0 0% 45%",       icone: Square },
  agendado:     { rotulo: "Agendada",     accent: "215 60% 55%",    icone: Clock },
  rascunho:     { rotulo: "Rascunho",     accent: "215 10% 50%",    icone: FileEdit },
};

/**
 * Quando a campanha foi criada, em formato curto. Sem isso, campanhas recriadas com o mesmo nome
 * (acontece o tempo todo: três "Mentoark 05*" seguidas na lista real) ficam indistinguíveis — não
 * havia NENHUMA data na tela. Hoje mostra a hora; no ano, dia e mês; antes disso, com ano.
 */
function quando(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return null;
  const agora = new Date();
  const mesmoDia = d.toDateString() === agora.toDateString();
  if (mesmoDia) return `hoje ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;

  const ontem = new Date(agora);
  ontem.setDate(agora.getDate() - 1);
  if (d.toDateString() === ontem.toDateString()) {
    return `ontem ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  }
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    ...(d.getFullYear() === agora.getFullYear() ? {} : { year: "numeric" }),
  }).replace(".", "");
}

function CampanhaRow({ c, onOpen, onDuplicar }: { c: any; onOpen: (id: string) => void; onDuplicar?: (c: any) => void }) {
  const enviados = c.enviados || 0;
  const total = c.total_leads || 0;
  const falhas = c.falhas || 0;
  const pct = total > 0 ? Math.min(100, Math.round((enviados / total) * 100)) : 0;
  const ativa = c.status === 'em_andamento';
  const criada = quando(c.created_at);

  const { rotulo, accent, icone: Icone } = APARENCIA[c.status] ?? {
    rotulo: c.status, accent: "215 10% 50%", icone: Square,
  };

  return (
    // A linha deixou de ser um <button> envolvendo tudo quando ganhou a ação "Duplicar": botão
    // dentro de botão é HTML inválido. Agora o nome é o botão real (rótulo acessível de verdade)
    // e o `after:absolute after:inset-0` estende a área de clique dele para o card inteiro; a
    // ação secundária fica acima pelo z-10. Padrão "stretched link".
    <div
      className="lq-surface w-full rounded-2xl text-left"
      style={{ "--lq-accent": accent } as CSSProperties}
    >
      <div
        className={`lq-fill ${ativa ? "lq-fill-live" : "lq-fill-quiet"}`}
        style={{ "--lq-progress": `${pct}%` } as CSSProperties}
      />

      <div className="lq-content flex items-center gap-4 px-4 py-4">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border/60 bg-background/40 backdrop-blur-sm"
          style={{ color: `hsl(${accent})` }}
        >
          <Icone className="h-4 w-4" fill={ativa ? "currentColor" : "none"} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onOpen(c.id)}
              aria-label={`Abrir campanha ${c.nome}. ${rotulo}, ${pct}% enviado.`}
              className="truncate rounded text-left text-sm font-semibold after:absolute after:inset-0 after:content-['']"
            >
              {c.nome}
            </button>
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border/60 bg-background/40 px-2 py-0.5 text-[11px] text-muted-foreground backdrop-blur-sm">
              <span
                className={`h-1.5 w-1.5 rounded-full ${ativa ? "animate-pulse" : ""}`}
                style={{ background: `hsl(${accent})` }}
              />
              {rotulo}
            </span>
          </div>
          <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="tabular-nums">
              {enviados.toLocaleString("pt-BR")} de {total.toLocaleString("pt-BR")} enviados
            </span>
            {falhas > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-1.5 py-0.5 text-[11px] text-red-500 tabular-nums">
                {falhas.toLocaleString("pt-BR")} {falhas === 1 ? "falha" : "falhas"}
              </span>
            )}
            {criada && (
              <span className="ml-auto hidden shrink-0 pl-3 tabular-nums sm:inline" title={new Date(c.created_at).toLocaleString("pt-BR")}>
                criada {criada}
              </span>
            )}
          </p>
        </div>

        {total > 0 && (
          <p
            className="shrink-0 text-xl font-semibold tabular-nums tracking-tight"
            style={{ color: ativa ? `hsl(${accent})` : undefined }}
          >
            {pct}<span className="text-sm font-medium opacity-60">%</span>
          </p>
        )}

        {onDuplicar && (
          <button
            type="button"
            onClick={() => onDuplicar(c)}
            title="Duplicar esta campanha"
            aria-label={`Duplicar a campanha ${c.nome}`}
            className="relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
          >
            <Copy className="h-4 w-4" />
          </button>
        )}

        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </div>
    </div>
  );
}
