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
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Play, Pause, Square, Settings2, Loader2, Trash2,
  MessageSquare, Table as TableIcon, Send, XCircle, Activity, AlertCircle, CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/integrations/database/client";

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
    <Card className="p-4 space-y-4 border-primary/30">
      <div className="flex items-center justify-between">
        <Label className="font-bold flex items-center gap-2"><Settings2 className="h-4 w-4" /> Editar configuração (campanha pausada)</Label>
        <Badge variant="outline" className="text-[10px]">Aplica no próximo envio, sem reiniciar a fila</Badge>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="space-y-1">
          <span className="text-[10px] uppercase text-muted-foreground">Perfil de velocidade</span>
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
          <span className="text-[10px] uppercase text-muted-foreground">Intervalo mínimo (min)</span>
          <Input type="number" step="0.1" min={DELAY_MIN_ABSOLUTO_MINUTOS} className="h-8"
            value={editForm.delay_min_minutos}
            onChange={e => setEditForm({ ...editForm, delay_min_minutos: parseFloat(e.target.value) })} />
        </div>
        <div className="space-y-1">
          <span className="text-[10px] uppercase text-muted-foreground">Intervalo máximo (min)</span>
          <Input type="number" step="0.1" min={DELAY_MIN_ABSOLUTO_MINUTOS} className="h-8"
            value={editForm.delay_max_minutos}
            onChange={e => setEditForm({ ...editForm, delay_max_minutos: parseFloat(e.target.value) })} />
        </div>
      </div>
      {intervaloInvalido && (
        <p className="text-[10px] text-destructive font-medium">
          O mínimo não pode ser maior que o máximo, e nenhum dos dois pode ser menor que {DELAY_MIN_ABSOLUTO_MINUTOS.toFixed(2)} min (5s).
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="space-y-1">
          <span className="text-[10px] uppercase text-muted-foreground">Início da janela</span>
          <Input type="time" className="h-8" value={editForm.horario_inicio} onChange={e => setEditForm({ ...editForm, horario_inicio: e.target.value })} />
        </div>
        <div className="space-y-1">
          <span className="text-[10px] uppercase text-muted-foreground">Fim da janela</span>
          <Input type="time" className="h-8" value={editForm.horario_fim} onChange={e => setEditForm({ ...editForm, horario_fim: e.target.value })} />
        </div>
        <div className="space-y-1">
          <span className="text-[10px] uppercase text-muted-foreground">Limite diário (mensagens)</span>
          <Input type="number" min={1} className="h-8" value={editForm.limite_diario_mensagens} onChange={e => setEditForm({ ...editForm, limite_diario_mensagens: e.target.value })} />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs">Pausar nos fins de semana</span>
        <Switch checked={editForm.pausa_fins_semana} onCheckedChange={v => setEditForm({ ...editForm, pausa_fins_semana: v })} />
      </div>

      <div className="flex justify-end">
        <Button size="sm" onClick={salvar} disabled={salvando || intervaloInvalido}>
          {salvando && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
          Salvar configuração
        </Button>
      </div>
    </Card>
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

  const stats = [
    { label: "Enviados", val: currentCampaign.enviados || 0, total: currentCampaign.total_leads || 0, icon: Send, color: "text-blue-500", bg: "bg-blue-500/10" },
    { label: "Entregues", val: currentCampaign.entregues || 0, total: null, icon: CheckCircle2, color: "text-emerald-500", bg: "bg-emerald-500/10" },
    { label: "Respondidos", val: currentCampaign.respondidos || 0, total: null, icon: MessageSquare, color: "text-purple-500", bg: "bg-purple-500/10" },
    { label: "Falhas", val: currentCampaign.falhas || 0, total: null, icon: XCircle, color: "text-red-500", bg: "bg-red-500/10" },
  ];

  const failureRate = currentCampaign.enviados > 0 ? (currentCampaign.falhas / (currentCampaign.enviados + currentCampaign.falhas)) * 100 : 0;

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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="h-6 w-6 text-primary animate-pulse" />
            Monitoramento: {currentCampaign.nome}
          </h2>
          <Badge className={`mt-1 ${currentCampaign.status === 'em_andamento' ? 'bg-emerald-500/20 text-emerald-600' : 'bg-yellow-500/20 text-yellow-600'}`}>
            {currentCampaign.status.toUpperCase()}
          </Badge>
        </div>
        <div className="flex gap-2">
          {currentCampaign.status === 'em_andamento' ? (
            <Button variant="outline" onClick={() => handleStatusChange('pausado')}><Pause className="w-4 h-4 mr-2" /> Pausar</Button>
          ) : (
            <Button variant="outline" onClick={() => handleStatusChange('em_andamento')}><Play className="w-4 h-4 mr-2" /> Retomar</Button>
          )}
          <Button variant="destructive" onClick={() => handleStatusChange('cancelado')}><Square className="w-4 h-4 mr-2" /> Cancelar</Button>
        </div>
      </div>

      {currentCampaign.status === 'pausado' && (
        <EditarConfiguracaoPausada
          campaign={currentCampaign}
          onSaved={(fields) => setCurrentCampaign((prev: any) => ({ ...prev, ...fields }))}
        />
      )}

      {failureRate > 10 && (
        <Alert variant={failureRate > 25 ? "destructive" : "default"} className={`animate-bounce ${failureRate <= 25 ? 'border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20' : ''}`}>
          <AlertCircle className={`h-4 w-4 ${failureRate <= 25 ? 'text-yellow-500' : ''}`} />
          <AlertTitle className={failureRate <= 25 ? 'text-yellow-600' : ''}>{failureRate > 25 ? "Pausa Automática Ativada" : "Taxa de Falha Elevada"}</AlertTitle>
          <AlertDescription className={failureRate <= 25 ? 'text-yellow-600/80' : ''}>
            {failureRate > 25
              ? "A campanha foi pausada automaticamente devido a uma taxa de erro superior a 25%."
              : "Detectamos que mais de 10% dos disparos estão falhando. Recomendamos revisar suas instâncias."}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(s => (
          <Card key={s.label} className="p-5 border-none shadow-sm overflow-hidden relative group">
            <div className={`absolute top-0 right-0 p-4 transition-transform group-hover:scale-110`}>
              <s.icon className={`h-12 w-12 opacity-10 ${s.color}`} />
            </div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">{s.label}</p>
            <div className="flex items-baseline gap-1">
              <span className={`text-3xl font-black ${s.color}`}>{s.val}</span>
              {s.total !== null && <span className="text-sm text-muted-foreground font-bold">/ {s.total}</span>}
            </div>
            {s.total !== null && <Progress value={(s.val/s.total)*100} className={`h-1.5 mt-3 ${s.bg}`} />}
            {s.label === "Respondidos" && s.val > 0 && (
              <p className="text-[10px] text-purple-600 font-bold mt-2">
                Conversão: {((s.val / currentCampaign.enviados) * 100).toFixed(1)}%
              </p>
            )}
          </Card>
        ))}
      </div>

      <Card className="border-none shadow-sm overflow-hidden">
        <div className="bg-muted/30 p-4 border-b flex justify-between items-center">
          <h3 className="font-bold text-sm flex items-center gap-2"><TableIcon className="h-4 w-4" /> Log de Envios (Tempo Real)</h3>
          <Badge variant="outline" className="text-[10px]">Atualizando a cada 3s</Badge>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/10">
                <th className="p-3 text-left font-bold">Nome</th>
                <th className="p-3 text-left font-bold">Número</th>
                <th className="p-3 text-left font-bold">Status</th>
                <th className="p-3 text-left font-bold">Erro</th>
                <th className="p-3 text-left font-bold">Horário</th>
                <th className="p-3 text-left font-bold w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-muted/5 transition-colors">
                  <td className="p-3 font-medium">{log.nome || "Contato"}</td>
                  <td className="p-3 text-xs font-mono">{log.telefone}</td>
                  <td className="p-3">
                    <Badge variant={
                      log.status === 'sent' ? 'secondary' :
                      log.status === 'failed' ? 'destructive' :
                      log.status === 'cooldown' ? 'outline' :
                      log.status === 'cancelado' ? 'outline' :
                      log.status === 'sending' ? 'default' : 'outline'
                    } className={`text-[10px] px-2 py-0 ${log.status === 'cooldown' ? 'border-amber-500 text-amber-600' : ''} ${log.status === 'cancelado' ? 'border-muted-foreground/40 text-muted-foreground' : ''}`}>
                      {log.status === 'sent' ? 'Enviado' :
                       log.status === 'failed' ? 'Falha' :
                       log.status === 'cooldown' ? 'Bloqueado (cooldown)' :
                       log.status === 'cancelado' ? 'Removido' :
                       log.status === 'sending' ? 'Enviando...' : 'Pendente'}
                    </Badge>
                  </td>
                  <td className="p-3 text-xs text-red-500 max-w-[200px] truncate" title={log.erro}>
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
                  <td colSpan={6} className="p-8 text-center text-muted-foreground italic">
                    Nenhum envio registrado ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
