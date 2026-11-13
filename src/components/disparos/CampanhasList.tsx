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
import { Play, Pause, Square, RefreshCw, ChevronRight, Plus, Send, FileEdit, Clock, CheckCircle2 } from "lucide-react";
import { api } from "@/integrations/database/client";

interface CampanhasListProps {
  onOpen: (id: string) => void;
  onNova: () => void;
}

export function CampanhasList({ onOpen, onNova }: CampanhasListProps) {
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

  const emAndamento = campanhas.filter(c => c.status === 'em_andamento');
  const resto = campanhas.filter(c => c.status !== 'em_andamento');

  const enviadosAgora = emAndamento.reduce((acc, c) => acc + (c.enviados || 0), 0);
  const totalAgora = emAndamento.reduce((acc, c) => acc + (c.total_leads || 0), 0);

  return (
    <div className="max-w-6xl mx-auto space-y-7">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Campanhas de Disparo</h1>
          <p className="text-sm text-muted-foreground">
            {emAndamento.length > 0 ? (
              <>
                {emAndamento.length === 1 ? "1 campanha disparando agora" : `${emAndamento.length} campanhas disparando agora`}
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
        <div className="space-y-8">
          {emAndamento.length > 0 && (
            <section className="space-y-2.5">
              <SecaoTitulo titulo="Em andamento" quantidade={emAndamento.length} />
              {emAndamento.map(c => <CampanhaRow key={c.id} c={c} onOpen={onOpen} />)}
            </section>
          )}
          {resto.length > 0 && (
            <section className="space-y-2.5">
              <SecaoTitulo titulo="Histórico" quantidade={resto.length} />
              {resto.map(c => <CampanhaRow key={c.id} c={c} onOpen={onOpen} />)}
            </section>
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

function CampanhaRow({ c, onOpen }: { c: any; onOpen: (id: string) => void }) {
  const enviados = c.enviados || 0;
  const total = c.total_leads || 0;
  const falhas = c.falhas || 0;
  const pct = total > 0 ? Math.min(100, Math.round((enviados / total) * 100)) : 0;
  const ativa = c.status === 'em_andamento';

  const { rotulo, accent, icone: Icone } = APARENCIA[c.status] ?? {
    rotulo: c.status, accent: "215 10% 50%", icone: Square,
  };

  return (
    <button
      type="button"
      onClick={() => onOpen(c.id)}
      aria-label={`Abrir campanha ${c.nome}. ${rotulo}, ${pct}% enviado.`}
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
            <p className="truncate text-sm font-semibold">{c.nome}</p>
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

        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </div>
    </button>
  );
}
