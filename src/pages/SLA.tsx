import { useEffect, useState } from "react";
import { CRMLayout } from "@/components/CRMLayout";
import { api } from "@/integrations/database/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Timer, Clock, Hourglass, CheckCircle2, BarChart3,
  UserMinus, Bot, Bell, Loader2, Save,
} from "lucide-react";
import { toast } from "sonner";

interface SlaConfig {
  id?: string;
  sla_ativo: boolean;
  sla_tme: number;
  sla_ociosidade: number;
  sla_tma: number;
  sla_acao_estouro: "none" | "unassign" | "transfer_ai";
  sla_notificar_supervisor: boolean;
  sla_email_supervisor: string;
}

const DEFAULTS: SlaConfig = {
  sla_ativo: false,
  sla_tme: 15,
  sla_ociosidade: 30,
  sla_tma: 120,
  sla_acao_estouro: "none",
  sla_notificar_supervisor: false,
  sla_email_supervisor: "",
};

const ACOES = [
  {
    value: "none" as const,
    title: "Apenas registrar no BI",
    desc: "Sem punição, apenas métrica para análise.",
    Icon: BarChart3,
    color: "text-blue-500",
  },
  {
    value: "unassign" as const,
    title: "Retirar cliente do atendente",
    desc: "Desatribui o chat para que outro agente assuma.",
    Icon: UserMinus,
    color: "text-amber-500",
  },
  {
    value: "transfer_ai" as const,
    title: "Transferir para Agente IA",
    desc: "Passa para o agente de IA configurado na instância.",
    Icon: Bot,
    color: "text-violet-500",
  },
];

export default function SLAPage() {
  const { user } = useAuth();
  const [cfg, setCfg] = useState<SlaConfig>(DEFAULTS);
  const [agenteId, setAgenteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      const { data } = await api
        .from("agentes")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true })
        .limit(1);
      const a: any = data?.[0];
      if (a) {
        setAgenteId(a.id);
        setCfg({
          sla_ativo: !!a.sla_ativo,
          sla_tme: a.sla_tme ?? DEFAULTS.sla_tme,
          sla_ociosidade: a.sla_ociosidade ?? DEFAULTS.sla_ociosidade,
          sla_tma: a.sla_tma ?? DEFAULTS.sla_tma,
          sla_acao_estouro: (a.sla_acao_estouro ?? "none") as SlaConfig["sla_acao_estouro"],
          sla_notificar_supervisor: !!a.sla_notificar_supervisor,
          sla_email_supervisor: a.sla_email_supervisor ?? "",
        });
      }
      setLoading(false);
    })();
  }, [user?.id]);

  const handleSave = async () => {
    if (!agenteId) {
      toast.error("Nenhum agente encontrado para salvar as configurações.");
      return;
    }
    setSaving(true);
    const { error } = await api.from("agentes").update(cfg).eq("id", agenteId);
    setSaving(false);
    if (error) {
      toast.error(`Erro ao salvar: ${error.message}`);
      return;
    }
    toast.success("Configurações de SLA salvas com sucesso!");
  };

  if (loading) {
    return (
      <CRMLayout>
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando...
        </div>
      </CRMLayout>
    );
  }

  return (
    <CRMLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        {/* HEADER */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-orange-500/10 flex items-center justify-center">
              <Timer className="h-6 w-6 text-orange-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Gestão de SLA</h1>
              <p className="text-sm text-muted-foreground">
                Defina prazos de atendimento e ações automáticas em caso de estouro.
              </p>
            </div>
          </div>

          <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors ${
            cfg.sla_ativo
              ? "bg-emerald-500/10 border-emerald-500/30"
              : "bg-muted/30 border-border"
          }`}>
            <div>
              <p className="text-sm font-bold">
                SLA {cfg.sla_ativo ? "Ativado" : "Desativado"}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {cfg.sla_ativo ? "Monitoramento ativo" : "Sem monitoramento"}
              </p>
            </div>
            <Switch
              checked={cfg.sla_ativo}
              onCheckedChange={(v) => setCfg({ ...cfg, sla_ativo: v })}
              className="scale-125 data-[state=checked]:bg-emerald-500"
            />
          </div>
        </div>

        {/* CARDS DE TEMPO */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              key: "sla_tme" as const,
              title: "Primeira Resposta (TME)",
              desc: "Tempo máximo para o primeiro atendimento após o cliente entrar em contato.",
              Icon: Clock,
              color: "text-blue-500",
              bg: "bg-blue-500/10",
            },
            {
              key: "sla_ociosidade" as const,
              title: "Ociosidade (Resposta Contínua)",
              desc: "Tempo máximo entre respostas do agente durante um atendimento ativo.",
              Icon: Hourglass,
              color: "text-amber-500",
              bg: "bg-amber-500/10",
            },
            {
              key: "sla_tma" as const,
              title: "Resolução Total (TMA)",
              desc: "Tempo máximo para encerrar o atendimento completo.",
              Icon: CheckCircle2,
              color: "text-emerald-500",
              bg: "bg-emerald-500/10",
            },
          ].map((card) => (
            <Card key={card.key} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg ${card.bg} flex items-center justify-center`}>
                    <card.Icon className={`h-5 w-5 ${card.color}`} />
                  </div>
                  <CardTitle className="text-base">{card.title}</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-end gap-2">
                  <Input
                    type="number"
                    min={1}
                    value={cfg[card.key]}
                    onChange={(e) =>
                      setCfg({ ...cfg, [card.key]: parseInt(e.target.value || "0", 10) })
                    }
                    className="text-2xl font-bold h-14"
                  />
                  <span className="text-sm font-medium text-muted-foreground pb-4">min</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{card.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* AÇÃO AO ESTOURAR */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Ação ao Estourar o Prazo</CardTitle>
            <CardDescription>
              Defina o que acontece automaticamente quando um SLA é violado.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {ACOES.map((acao) => {
                const selected = cfg.sla_acao_estouro === acao.value;
                return (
                  <button
                    key={acao.value}
                    type="button"
                    onClick={() => setCfg({ ...cfg, sla_acao_estouro: acao.value })}
                    className={`text-left p-4 rounded-xl border-2 transition-all ${
                      selected
                        ? "border-primary bg-primary/5 shadow-md"
                        : "border-border hover:border-primary/40 hover:bg-muted/30"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className={`w-9 h-9 rounded-lg bg-muted/50 flex items-center justify-center ${acao.color}`}>
                        <acao.Icon className="h-4.5 w-4.5" />
                      </div>
                      {selected && (
                        <Badge className="bg-primary text-primary-foreground text-[10px]">
                          Selecionado
                        </Badge>
                      )}
                    </div>
                    <p className="font-bold text-sm mb-1">{acao.title}</p>
                    <p className="text-xs text-muted-foreground">{acao.desc}</p>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* NOTIFICAÇÕES */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-orange-500" />
              <CardTitle className="text-lg">Notificações</CardTitle>
            </div>
            <CardDescription>
              Alerte um supervisor sempre que um SLA for violado.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4 p-3 rounded-lg border bg-card/40">
              <div className="min-w-0">
                <p className="text-sm font-medium">Notificar supervisor quando SLA estoura</p>
                <p className="text-[11px] text-muted-foreground">
                  Envia e-mail imediato ao supervisor configurado.
                </p>
              </div>
              <Switch
                checked={cfg.sla_notificar_supervisor}
                onCheckedChange={(v) => setCfg({ ...cfg, sla_notificar_supervisor: v })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>E-mail do supervisor</Label>
              <Input
                type="email"
                placeholder="supervisor@empresa.com.br"
                value={cfg.sla_email_supervisor}
                onChange={(e) => setCfg({ ...cfg, sla_email_supervisor: e.target.value })}
                disabled={!cfg.sla_notificar_supervisor}
              />
            </div>
          </CardContent>
        </Card>

        {/* SAVE */}
        <div className="flex justify-end sticky bottom-4 z-10">
          <Button
            size="lg"
            onClick={handleSave}
            disabled={saving}
            className="shadow-lg shadow-primary/20"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Salvar Configurações
          </Button>
        </div>
      </div>
    </CRMLayout>
  );
}
