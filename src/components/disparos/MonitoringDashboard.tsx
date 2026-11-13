/**
 * MonitoringDashboard.tsx — painel de acompanhamento/controle de UMA campanha de disparo
 * (progresso, log de envios em tempo real, pausar/retomar/cancelar, editar config pausada).
 *
 * [AUDITORIA] LÓGICA (Sprint Monitor Persistente de Campanhas, 2026-08-11): extraído de
 * `pages/Disparos.tsx` (onde vivia desde a Sprint Monitor de Disparo — Layout/Controle,
 * 2026-08-08) — fecha a pendência registrada em `diagnosticos/SPRINT_MONITOR_CAMPANHAS_DISPARO.md`
 * ("extrair pra componente compartilhado se fizer sentido, em vez de duplicar"). Motivo real da
 * extração, achado do usuário em produção (conta `mentoark@gmail.com`): esse painel só era
 * alcançável a partir do estado `activeCampaign` (React, em memória) de `Disparos.tsx`, setado
 * uma única vez logo depois de criar a campanha — sair da tela (navegar, fechar aba, voltar
 * depois) perdia esse estado e NENHUMA tela do CRM sabia mostrar de novo uma campanha que
 * continuava rodando de verdade no backend (`disparoProcessor.ts`). Resultado real: campanha
 * "pessoal" (131 leads) ficou dias `em_andamento` sem ninguém conseguir vê-la ou pará-la, e uma
 * campanha "teste" continuou disparando mensagem real por horas sem controle nenhum na UI.
 * Agora usado tanto por `Disparos.tsx` (fluxo de criação, mesmo comportamento de sempre) quanto
 * por `MonitorWhatsApp.tsx` (lista persistente "Campanhas de Disparo", nova) — mesma lógica,
 * sem duplicar `handleStatusChange`/poll/etc.
 */
import { useState, useEffect, type CSSProperties, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Play, Pause, Square, Settings2, Loader2, Trash2,
  MessageSquare, Table as TableIcon, Send, XCircle, AlertCircle, CheckCircle2, Eye, UserX,
} from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { getAuthToken } from "@/lib/api-token";
import { toast } from "sonner";
import { api } from "@/integrations/database/client";

const ROTULO_OPTIN: Record<string, string> = {
  sem_optin: "sem opt-in", smart_link: "Smart Link", anuncio_ctwa: "anúncio", conversa_iniciada_pelo_contato: "iniciou a conversa",
  importado_com_consentimento: "importação com consentimento", formulario: "formulário",
};

// [AUDITORIA] LÓGICA: mesmo piso de segurança de `StepAntiBan` (Disparos.tsx) — duplicado de
// propósito (constante primitiva, um único número) em vez de exportar de `Disparos.tsx` (que só
// tem export default da página) — mesmo espírito pragmático já documentado em
// `maturadorDialogos.ts`. Manter os dois valores em sincronia se algum dia mudar.
const DELAY_MIN_ABSOLUTO_MINUTOS = 5 / 60;

function EditarConfiguracaoPausada({ campaign, onSaved }: { campaign: any; onSaved: (fields: any) => void }) {
  const [editForm, setEditForm] = useState(() => ({
    perfil_velocidade: campaign.perfil_velocidade || "safe",
    delay_min_minutos: campaign.delay_min_segundos != null ? Number(campaign.delay_min_segundos) / 60 : 0.5,
    delay_max_minutos: campaign.delay_max_segundos != null ? Number(campaign.delay_max_segundos) / 60 : 1,
    horario_inicio: campaign.horario_inicio || "08:00",
    horario_fim: campaign.horario_fim || "21:00",
    limite_diario_mensagens: campaign.limite_diario_mensagens ?? 200,
    pausa_fins_semana: campaign.pausa_fins_semana ?? true,
  }));
  const [salvando, setSalvando] = useState(false);

  const intervaloInvalido = editForm.delay_min_minutos < DELAY_MIN_ABSOLUTO_MINUTOS
    || editForm.delay_max_minutos < DELAY_MIN_ABSOLUTO_MINUTOS
    || editForm.delay_min_minutos > editForm.delay_max_minutos;

  const salvar = async () => {
    if (intervaloInvalido) {
      toast.error("Corrija o intervalo de delay antes de salvar (mínimo não pode ser maior que o máximo, nem menor que o piso de segurança).");
      return;
    }
    setSalvando(true);
    const payload = {
      perfil_velocidade: editForm.perfil_velocidade,
      delay_min_segundos: Math.round(Number(editForm.delay_min_minutos) * 60),
      delay_max_segundos: Math.round(Number(editForm.delay_max_minutos) * 60),
      horario_inicio: editForm.horario_inicio,
      horario_fim: editForm.horario_fim,
      limite_diario_mensagens: Number(editForm.limite_diario_mensagens) || 200,
      pausa_fins_semana: editForm.pausa_fins_semana,
    };
    const { error } = await api.from("disparos").update(payload).eq("id", campaign.id);
    setSalvando(false);
    if (error) {
      toast.error("Erro ao salvar configuração: " + error.message);
      return;
    }
    toast.success("Configuração atualizada — vale a partir do próximo envio.");
    onSaved(payload);
  };

  return (
    <div className="lq-surface rounded-2xl p-5" style={{ "--lq-accent": "38 92% 50%" } as CSSProperties}>
      <div className="lq-content space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label className="flex items-center gap-2 text-sm font-medium">
          <Settings2 className="h-4 w-4 text-muted-foreground" /> Ajustar o ritmo da campanha
        </Label>
        <span className="text-xs text-muted-foreground">Vale a partir do próximo envio, sem reiniciar a fila</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">Perfil de velocidade</span>
          <Select value={editForm.perfil_velocidade} onValueChange={v => setEditForm({ ...editForm, perfil_velocidade: v })}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="safe">Seguro (30-60s)</SelectItem>
              <SelectItem value="moderate">Moderado (15-30s)</SelectItem>
              <SelectItem value="fast">Rápido (5-15s)</SelectItem>
              <SelectItem value="ultra_safe">Ultra Seguro (8-12min)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">Intervalo mínimo (min)</span>
          <Input type="number" step="0.1" min={DELAY_MIN_ABSOLUTO_MINUTOS} className="h-8"
            value={editForm.delay_min_minutos}
            onChange={e => setEditForm({ ...editForm, delay_min_minutos: parseFloat(e.target.value) })} />
        </div>
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">Intervalo máximo (min)</span>
          <Input type="number" step="0.1" min={DELAY_MIN_ABSOLUTO_MINUTOS} className="h-8"
            value={editForm.delay_max_minutos}
            onChange={e => setEditForm({ ...editForm, delay_max_minutos: parseFloat(e.target.value) })} />
        </div>
      </div>
      {intervaloInvalido && (
        <p className="text-xs text-destructive">
          O mínimo não pode ser maior que o máximo, e nenhum dos dois pode ser menor que {DELAY_MIN_ABSOLUTO_MINUTOS.toFixed(2)} min (5s).
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">Início da janela</span>
          <Input type="time" className="h-8" value={editForm.horario_inicio} onChange={e => setEditForm({ ...editForm, horario_inicio: e.target.value })} />
        </div>
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">Fim da janela</span>
          <Input type="time" className="h-8" value={editForm.horario_fim} onChange={e => setEditForm({ ...editForm, horario_fim: e.target.value })} />
        </div>
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">Limite diário (mensagens)</span>
          <Input type="number" min={1} className="h-8" value={editForm.limite_diario_mensagens} onChange={e => setEditForm({ ...editForm, limite_diario_mensagens: e.target.value })} />
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-border/60 pt-4">
        <span className="text-sm">Pausar nos fins de semana</span>
        <Switch checked={editForm.pausa_fins_semana} onCheckedChange={v => setEditForm({ ...editForm, pausa_fins_semana: v })} />
      </div>

      <div className="flex justify-end">
        <Button size="sm" onClick={salvar} disabled={salvando || intervaloInvalido}>
          {salvando && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
          Salvar ajustes
        </Button>
      </div>
      </div>
    </div>
  );
}

/**
 * Status de um envio no log. Mesmo vocabulário de cor da tela inteira: âmbar = atenção,
 * vermelho = falha, verde = chegou, laranja da marca = acontecendo agora, cinza = inerte.
 * Antes era um `Badge` com cinco `variant`s diferentes mais classes soltas de amber por cima.
 */
const STATUS_ENVIO: Record<string, { rotulo: string; accent: string | null }> = {
  sent:      { rotulo: "Enviado",             accent: "152 55% 45%" },
  failed:    { rotulo: "Falha",               accent: "0 72% 51%" },
  cooldown:  { rotulo: "Bloqueado (cooldown)", accent: "38 92% 50%" },
  sending:   { rotulo: "Enviando",            accent: "var(--primary)" },
  cancelado: { rotulo: "Removido",            accent: null },
  pending:   { rotulo: "Pendente",            accent: null },
};

function StatusEnvio({ status }: { status: string }) {
  const { rotulo, accent } = STATUS_ENVIO[status] ?? { rotulo: "Pendente", accent: null };
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs"
      style={accent
        ? { borderColor: `hsl(${accent} / 0.35)`, background: `hsl(${accent} / 0.1)`, color: `hsl(${accent})` }
        : { borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}
    >
      {status === 'sending' && <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />}
      {rotulo}
    </span>
  );
}

/**
 * Aviso da campanha — um só formato para todos os alertas da tela. Antes havia três paletas de
 * aviso concorrendo (yellow-50/yellow-950 cru, amber-500 e `destructive`), cada uma com peso
 * visual diferente para o mesmo tipo de informação. Agora são dois tons: atenção (âmbar) e
 * crítico (vermelho), ambos desenhados como painel tingido, sem o `animate-bounce` que fazia o
 * bloco pular na tela.
 */
function Aviso({ tom, titulo, children }: { tom: "atencao" | "critico"; titulo: string; children: ReactNode }) {
  const accent = tom === "critico" ? "0 72% 51%" : "38 92% 50%";
  return (
    <div
      className="flex gap-3 rounded-2xl border p-4"
      style={{ borderColor: `hsl(${accent} / 0.35)`, background: `hsl(${accent} / 0.08)` }}
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: `hsl(${accent})` }} />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-medium" style={{ color: `hsl(${accent})` }}>{titulo}</p>
        <div className="text-sm text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}

export function MonitoringDashboard({ campaign, onCancel }: { campaign: any, onCancel: () => void }) {
  const [currentCampaign, setCurrentCampaign] = useState(campaign);
  const [logs, setLogs] = useState<any[]>([]);

  useEffect(() => {
    const fetchProgress = async () => {
      // 1. Atualizar dados da campanha
      const { data: campaignData } = await api
        .from("disparos")
        .select("*")
        .eq("id", campaign.id)
        .single();

      if (campaignData) {
        setCurrentCampaign(campaignData);
      }

      // 2. Buscar logs recentes
      const { data: logsData } = await api
        .from("disparo_logs")
        .select("*")
        .eq("disparo_id", campaign.id)
        .order("created_at", { ascending: false })
        .limit(20);

      if (logsData) {
        setLogs(logsData);
      }
    };

    fetchProgress();
    const timer = setInterval(fetchProgress, 3000);
    return () => clearInterval(timer);
  }, [campaign.id]);

  // Sprint 4 / H3 (2026-10-05): métricas reais (entregue/lido por ACK, respondido/opt-out pela
  // resposta até 72h) vindas de GET /api/disparos/:id/metricas — antes "Entregues"/"Respondidos"
  // liam contadores que nenhum código incrementava (ficavam sempre 0).
  const [metricas, setMetricas] = useState<any>(null);
  const [reenviando, setReenviando] = useState(false);
  useEffect(() => {
    const API_BASE = (import.meta.env.VITE_API_URL as string) || "http://localhost:3000";
    const buscar = async () => {
      try {
        const t = getAuthToken();
        const r = await fetch(`${API_BASE}/api/disparos/${campaign.id}/metricas`, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
        if (r.ok) setMetricas(await r.json());
      } catch { /* informativo */ }
    };
    buscar();
    const timer = setInterval(buscar, 10000);
    return () => clearInterval(timer);
  }, [campaign.id]);

  const reenviarFalhasInstancia = async () => {
    setReenviando(true);
    try {
      const API_BASE = (import.meta.env.VITE_API_URL as string) || "http://localhost:3000";
      const t = getAuthToken();
      const r = await fetch(`${API_BASE}/api/disparos/${campaign.id}/reenviar-falhas-instancia`, {
        method: "POST", headers: t ? { Authorization: `Bearer ${t}` } : {},
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.message || "Falha ao reenviar");
      toast.success(`${j.reenfileirados} contato(s) voltaram para a fila.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setReenviando(false);
    }
  };

  const enviadosReais = metricas?.enviados ?? (currentCampaign.enviados || 0);

  // Redesign 2026-11-13: as métricas de entrega são um FUNIL (enviado → entregue → lido →
  // respondido), não seis categorias independentes — antes eram seis cards em seis matizes sem
  // relação (azul/esmeralda/céu/roxo/laranja/vermelho), e o laranja de "Opt-outs" ainda brigava
  // com o laranja da marca. Agora: um hue só no funil (o comprimento da barra é que compara) e
  // cor reservada para os dois vazamentos — falha (vermelho) e opt-out (âmbar).
  const taxa = (v: number) => (enviadosReais > 0 ? Math.min(100, (v / enviadosReais) * 100) : 0);
  const funil = [
    { label: "Enviados", val: enviadosReais, icon: Send },
    { label: "Entregues", val: metricas?.entregues ?? 0, icon: CheckCircle2 },
    { label: "Lidos", val: metricas?.lidos ?? 0, icon: Eye },
    { label: "Respondidos", val: metricas?.respondidos ?? 0, icon: MessageSquare },
  ];
  const vazamentos = [
    { label: "Falhas", val: currentCampaign.falhas || 0, icon: XCircle, accent: "0 72% 51%",
      nota: "não chegaram ao destinatário" },
    { label: "Opt-outs", val: metricas?.optouts ?? 0, icon: UserX, accent: "38 92% 50%",
      nota: "pediram para não receber mais" },
  ];
  const porHora = (metricas?.por_hora ?? []).map((h: any) => ({
    ...h, rotulo: new Date(h.hora).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit" }) + "h",
  }));

  const failureRate = currentCampaign.enviados > 0 ? (currentCampaign.falhas / (currentCampaign.enviados + currentCampaign.falhas)) * 100 : 0;

  // Redesign 2026-11-13 ("liquid glass", ver `.lq-*` no index.css): o progresso da campanha é o
  // preenchimento do painel inteiro, não um filete. Mesma linguagem da lista (`CampanhasList`).
  const totalLeads = currentCampaign.total_leads || 0;
  const pctGeral = totalLeads > 0 ? Math.min(100, Math.round((enviadosReais / totalLeads) * 100)) : 0;
  const ativa = currentCampaign.status === 'em_andamento';
  const accentCampanha = ativa ? "var(--primary)"
    : currentCampaign.status === 'pausado' ? "38 92% 50%"
    : currentCampaign.status === 'concluido' ? "152 55% 45%"
    : "0 0% 45%";
  const rotuloStatus = ativa ? "Disparando agora"
    : currentCampaign.status === 'pausado' ? "Pausada"
    : currentCampaign.status === 'concluido' ? "Concluída"
    : currentCampaign.status === 'cancelado' ? "Cancelada"
    : currentCampaign.status;

  const handleStatusChange = async (newStatus: string) => {
    const { error } = await api
      .from("disparos")
      .update({ status: newStatus })
      .eq("id", campaign.id);

    if (error) {
      toast.error("Erro ao alterar status: " + error.message);
    } else {
      toast.success(`Campanha ${newStatus === 'pausado' ? 'pausada' : newStatus === 'em_andamento' ? 'retomada' : 'cancelada'}!`);
      setCurrentCampaign((prev: any) => ({ ...prev, status: newStatus }));
      if (newStatus === 'cancelado') onCancel();
    }
  };

  const [removendoId, setRemovendoId] = useState<string | null>(null);
  const removerContatoPendente = async (log: any) => {
    if (!confirm(`Remover ${log.nome || log.telefone} desta campanha? Esse contato não vai receber a mensagem.`)) return;
    setRemovendoId(log.id);
    try {
      const novoTotal = Math.max(0, (Number(currentCampaign.total_leads) || 0) - 1);
      const [{ error: errLog }, { error: errTotal }] = await Promise.all([
        api.from("disparo_logs").update({ status: 'cancelado', erro: 'Removido manualmente pelo operador' }).eq("id", log.id),
        api.from("disparos").update({ total_leads: novoTotal }).eq("id", campaign.id),
      ]);
      if (errLog || errTotal) throw new Error(errLog?.message || errTotal?.message);
      setLogs(prev => prev.filter(l => l.id !== log.id));
      setCurrentCampaign((prev: any) => ({ ...prev, total_leads: novoTotal }));
      toast.success(`${log.nome || log.telefone} removido da campanha.`);
    } catch (err: any) {
      toast.error("Erro ao remover contato: " + err.message);
    } finally {
      setRemovendoId(null);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-in fade-in zoom-in duration-300">
      <div className="lq-surface rounded-2xl" style={{ "--lq-accent": accentCampanha } as CSSProperties}>
        <div
          className={`lq-fill ${ativa ? "lq-fill-live" : "lq-fill-quiet"}`}
          style={{ "--lq-progress": `${pctGeral}%` } as CSSProperties}
        />
        <div className="lq-content flex flex-wrap items-center justify-between gap-5 p-5">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <span
                className={`h-1.5 w-1.5 rounded-full ${ativa ? "animate-pulse" : ""}`}
                style={{ background: `hsl(${accentCampanha})` }}
              />
              {rotuloStatus}
            </p>
            <h2 className="mt-1.5 truncate text-2xl font-bold tracking-tight">{currentCampaign.nome}</h2>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="tabular-nums">
                {enviadosReais.toLocaleString("pt-BR")} de {totalLeads.toLocaleString("pt-BR")} enviados
              </span>
              {(currentCampaign.falhas || 0) > 0 && (
                <span className="inline-flex items-center rounded-full bg-red-500/10 px-2 py-0.5 text-xs text-red-500 tabular-nums">
                  {Number(currentCampaign.falhas).toLocaleString("pt-BR")} falhas
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-5">
            {totalLeads > 0 && (
              <p
                className="text-3xl font-semibold tabular-nums tracking-tight"
                style={{ color: ativa ? `hsl(${accentCampanha})` : undefined }}
              >
                {pctGeral}<span className="text-base font-medium opacity-60">%</span>
              </p>
            )}
            <div className="flex gap-2">
              {ativa ? (
                <Button variant="outline" onClick={() => handleStatusChange('pausado')}><Pause className="w-4 h-4 mr-2" /> Pausar</Button>
              ) : (
                <Button variant="outline" onClick={() => handleStatusChange('em_andamento')}><Play className="w-4 h-4 mr-2" /> Retomar</Button>
              )}
              <Button variant="destructive" onClick={() => handleStatusChange('cancelado')}><Square className="w-4 h-4 mr-2" /> Cancelar</Button>
            </div>
          </div>
        </div>
      </div>

      {currentCampaign.status === 'pausado' && (
        <EditarConfiguracaoPausada
          campaign={currentCampaign}
          onSaved={(fields) => setCurrentCampaign((prev: any) => ({ ...prev, ...fields }))}
        />
      )}

      {failureRate > 10 && (
        <Aviso
          tom={failureRate > 25 ? "critico" : "atencao"}
          titulo={failureRate > 25 ? "Campanha pausada automaticamente" : "Taxa de falha elevada"}
        >
          {failureRate > 25
            ? "Mais de 25% dos envios falharam, então a campanha parou sozinha. Revise suas instâncias antes de retomar."
            : "Mais de 10% dos envios estão falhando. Vale revisar suas instâncias antes de continuar."}
        </Aviso>
      )}

      {/* Sprint 7 (API oficial / H4-H7): opt-in da audiência por origem; cliques, custo real e
          falhas por código da Meta só aparecem com dado (campanha do canal oficial). */}
      {metricas?.optin && (
        <div className="lq-surface rounded-2xl p-5">
          <div className="lq-content space-y-4">
            <div>
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-medium">Consentimento da audiência</p>
                <p className="text-sm font-semibold tabular-nums">{metricas.optin.pct}% com opt-in</p>
              </div>
              <div className="mt-2.5 lq-track">
                <span className="lq-track-fill" style={{ width: `${metricas.optin.pct}%` }} />
              </div>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
                {(metricas.optin.por_origem ?? []).map((o: any) => (
                  <span key={o.origem} className="text-xs text-muted-foreground">
                    {ROTULO_OPTIN[o.origem] ?? o.origem}
                    <b className="ml-1.5 font-semibold text-foreground tabular-nums">{o.total}</b>
                  </span>
                ))}
              </div>
            </div>

            {((metricas.cliques ?? 0) > 0 || (metricas.cobradas ?? 0) > 0) && (
              <div className="grid grid-cols-3 gap-4 border-t border-border/60 pt-4">
                {[
                  { r: "Cliques em botões", v: Number(metricas.cliques ?? 0).toLocaleString("pt-BR") },
                  { r: "Mensagens cobradas", v: Number(metricas.cobradas ?? 0).toLocaleString("pt-BR") },
                  { r: "Custo real", v: `US$ ${Number(metricas.custo_real_usd ?? 0).toFixed(2)}` },
                ].map(m => (
                  <div key={m.r}>
                    <p className="text-xs text-muted-foreground">{m.r}</p>
                    <p className="mt-0.5 text-lg font-semibold tabular-nums tracking-tight">{m.v}</p>
                  </div>
                ))}
              </div>
            )}

            {(metricas.erros_meta ?? []).length > 0 && (
              <div className="border-t border-border/60 pt-4">
                <p className="text-xs text-muted-foreground">Falhas reportadas pela Meta</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {metricas.erros_meta.map((e: any) => (
                    <span key={e.codigo} className="rounded-full border border-border/60 px-2.5 py-1 text-xs text-muted-foreground">
                      {e.codigo} {e.titulo ?? ""}
                      <b className="ml-1.5 font-semibold text-foreground tabular-nums">{e.total}</b>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {(metricas?.falhas_instancia_caida ?? 0) > 0 && (
        <Aviso
          tom="atencao"
          titulo={`${metricas.falhas_instancia_caida} ${metricas.falhas_instancia_caida === 1 ? 'falha' : 'falhas'} por instância caída`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>Esses contatos não tiveram problema — a instância estava desconectada na hora do envio.</span>
            <Button size="sm" variant="outline" disabled={reenviando} onClick={reenviarFalhasInstancia}>
              {reenviando ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
              Reenviar esses contatos
            </Button>
          </div>
        </Aviso>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.7fr_1fr]">
        <div className="lq-surface rounded-2xl p-5">
          <div className="lq-content">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-medium">Funil de entrega</p>
              <p className="text-xs text-muted-foreground">Percentual sobre os enviados</p>
            </div>
            <div className="mt-4 space-y-3.5">
              {funil.map(f => (
                <div key={f.label}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-3">
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <f.icon className="h-3.5 w-3.5" />
                      {f.label}
                    </span>
                    <span className="flex items-baseline gap-2">
                      <span className="text-sm font-semibold tabular-nums">{Number(f.val).toLocaleString("pt-BR")}</span>
                      <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">
                        {taxa(f.val).toFixed(0)}%
                      </span>
                    </span>
                  </div>
                  <div className="lq-track">
                    <span className="lq-track-fill" style={{ width: `${taxa(f.val)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid content-start gap-4 sm:grid-cols-2 lg:grid-cols-1">
          {vazamentos.map(v => (
            <div
              key={v.label}
              className="lq-surface rounded-2xl p-5"
              style={{ "--lq-accent": v.accent } as CSSProperties}
            >
              {v.val > 0 && (
                <div
                  className="lq-fill lq-fill-quiet"
                  style={{ "--lq-progress": `${taxa(v.val)}%` } as CSSProperties}
                />
              )}
              <div className="lq-content">
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <v.icon className="h-3.5 w-3.5" style={{ color: v.val > 0 ? `hsl(${v.accent})` : undefined }} />
                  {v.label}
                </p>
                <p className="mt-1.5 flex items-baseline gap-2">
                  <span
                    className="text-3xl font-semibold tabular-nums tracking-tight"
                    style={{ color: v.val > 0 ? `hsl(${v.accent})` : undefined }}
                  >
                    {Number(v.val).toLocaleString("pt-BR")}
                  </span>
                  {v.val > 0 && enviadosReais > 0 && (
                    <span className="text-xs text-muted-foreground tabular-nums">{taxa(v.val).toFixed(1)}%</span>
                  )}
                </p>
                <p className="mt-1.5 text-[11px] text-muted-foreground">{v.nota}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {porHora.length > 0 && (
        <div className="lq-surface rounded-2xl p-5">
          <div className="lq-content">
          <p className="text-sm font-medium mb-4">Envios por hora</p>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={porHora} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.5} />
                <XAxis dataKey="rotulo" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                <Tooltip
                  cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const h = payload[0].payload;
                    return (
                      <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
                        <p className="font-medium">{h.rotulo}</p>
                        <div className="mt-1.5 space-y-0.5">
                          {[
                            { r: "Enviados", v: h.enviados },
                            { r: "Entregues", v: h.entregues },
                            { r: "Lidos", v: h.lidos },
                            { r: "Respondidos", v: h.respondidos },
                          ].map(l => (
                            <p key={l.r} className="flex justify-between gap-6">
                              <span className="text-muted-foreground">{l.r}</span>
                              <b className="font-semibold tabular-nums">{l.v}</b>
                            </p>
                          ))}
                        </div>
                      </div>
                    );
                  }}
                />
                {/* Laranja a 60% de propósito: cheio, o gráfico virava o elemento mais pesado da
                    tela sendo a informação menos importante dela. */}
                <Bar dataKey="enviados" fill="hsl(var(--primary) / 0.6)" radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          </div>
        </div>
      )}

      <div className="lq-surface rounded-2xl">
        <div className="lq-content">
        <div className="flex items-center justify-between gap-3 border-b border-border/60 p-4">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <TableIcon className="h-4 w-4 text-muted-foreground" /> Envios em tempo real
          </h3>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            Atualizando a cada 3s
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60">
                <th className="p-3 text-left text-xs font-medium text-muted-foreground">Nome</th>
                <th className="p-3 text-left text-xs font-medium text-muted-foreground">Número</th>
                <th className="p-3 text-left text-xs font-medium text-muted-foreground">Status</th>
                <th className="p-3 text-left text-xs font-medium text-muted-foreground">Erro</th>
                <th className="p-3 text-left text-xs font-medium text-muted-foreground">Horário</th>
                <th className="w-10 p-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {logs.map((log) => (
                <tr key={log.id} className="transition-colors hover:bg-foreground/[0.03]">
                  <td className="p-3 font-medium">{log.nome || "Contato"}</td>
                  <td className="p-3 text-xs font-mono">{log.telefone}</td>
                  <td className="p-3">
                    <StatusEnvio status={log.status} />
                    {log.status === 'sent' && (log.respondido_em || log.lido_em || log.entregue_em) && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {log.respondido_em ? 'respondeu' : log.lido_em ? 'leu' : 'entregue'}
                      </span>
                    )}
                  </td>
                  <td className="max-w-[200px] truncate p-3 text-xs" style={{ color: log.erro ? "hsl(0 72% 51%)" : undefined }} title={log.erro}>
                    {log.tipo_falha && (
                      <span className="mr-1 font-semibold">
                        [{({ numero_invalido: 'número inválido', instancia_caida: 'instância caída', restricao: 'restrição', erro_desconhecido: 'erro' } as Record<string, string>)[log.tipo_falha] ?? log.tipo_falha}]
                      </span>
                    )}
                    {log.erro || "-"}
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">
                    {new Date(log.enviado_at || log.created_at).toLocaleTimeString()}
                  </td>
                  <td className="p-3">
                    {log.status === 'pending' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        disabled={removendoId === log.id}
                        onClick={() => removerContatoPendente(log)}
                        title="Remover contato desta campanha"
                      >
                        {removendoId === log.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-10 text-center text-sm text-muted-foreground">
                    Os envios aparecem aqui assim que a campanha começar.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        </div>
      </div>
    </div>
  );
}
