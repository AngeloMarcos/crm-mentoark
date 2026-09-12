/**
 * CampanhasList.tsx — lista persistente de campanhas de Disparo (`disparos`), com progresso e
 * status. Usado como tela padrão de `Disparos.tsx` (Sprint Estruturar Disparo, 2026-08-11) — antes
 * dela, a única forma de ver uma campanha era o instante em que era criada (`activeCampaign`,
 * estado React em memória); sair da tela perdia esse controle pra sempre (ver
 * `components/disparos/MonitoringDashboard.tsx` pro relato completo do incidente real que motivou
 * isso, conta `mentoark@gmail.com`, campanha disparando sem controle nenhum na UI).
 */
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Play, Pause, Square, RefreshCw, ChevronRight, Plus, Send } from "lucide-react";
import { api } from "@/integrations/database/client";

interface CampanhasListProps {
  onOpen: (id: string) => void;
  onNova: () => void;
}

export function CampanhasList({ onOpen, onNova }: CampanhasListProps) {
  const [campanhas, setCampanhas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCampanhas = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.from("disparos").select("*").order("created_at", { ascending: false });
      setCampanhas(data || []);
    } finally {
      setLoading(false);
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

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Campanhas de Disparo</h1>
          <p className="text-sm text-muted-foreground">
            {emAndamento.length > 0
              ? `${emAndamento.length} em andamento agora`
              : "Nenhuma campanha em andamento no momento"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={fetchCampanhas} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button onClick={onNova} className="gap-2">
            <Plus className="h-4 w-4" /> Nova Campanha
          </Button>
        </div>
      </div>

      {campanhas.length === 0 && !loading ? (
        <div className="border rounded-xl p-10 text-center text-muted-foreground">
          <Send className="h-8 w-8 mx-auto mb-3 opacity-40" />
          <p className="text-sm">Nenhuma campanha criada ainda.</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={onNova}>
            Criar a primeira
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {emAndamento.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Em andamento</p>
              {emAndamento.map(c => <CampanhaRow key={c.id} c={c} onOpen={onOpen} />)}
            </div>
          )}
          {resto.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Histórico</p>
              {resto.map(c => <CampanhaRow key={c.id} c={c} onOpen={onOpen} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CampanhaRow({ c, onOpen }: { c: any; onOpen: (id: string) => void }) {
  const enviados = c.enviados || 0;
  const total = c.total_leads || 0;
  const pct = total > 0 ? Math.round((enviados / total) * 100) : 0;
  return (
    <button
      onClick={() => onOpen(c.id)}
      className={`w-full flex items-center gap-4 p-3 rounded-xl border text-left transition-colors hover:bg-muted/40 ${
        c.status === 'em_andamento' ? 'border-emerald-500/30 bg-emerald-500/5' : ''
      }`}
    >
      {c.status === 'em_andamento' ? <Play className="h-4 w-4 text-emerald-500 shrink-0" />
        : c.status === 'pausado' ? <Pause className="h-4 w-4 text-amber-500 shrink-0" />
        : <Square className="h-4 w-4 text-muted-foreground shrink-0" />}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium truncate">{c.nome}</p>
          <Badge variant="outline" className="text-[10px] shrink-0">
            {c.status === 'em_andamento' ? 'Em andamento' : c.status === 'pausado' ? 'Pausada' : c.status === 'cancelado' ? 'Cancelada' : c.status}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {enviados}/{total} enviados {total > 0 ? `(${pct}%)` : ''} · {c.falhas || 0} falhas
        </p>
        {total > 0 && <Progress value={pct} className="h-1 mt-1.5" />}
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
    </button>
  );
}
