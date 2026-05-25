import { useEffect, useState } from "react";
import { CRMLayout } from "@/components/CRMLayout";
import { api } from "@/integrations/database/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Timer, Settings2, Zap, Loader2, Save,
} from "lucide-react";
import { toast } from "sonner";

interface SlaConfig {
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

const CRONOMETROS = [
  {
    key: "sla_tme" as const,
    title: "Primeira Resposta (TME)",
    desc: 'O cliente falou com a empresa pela primeira vez. Tempo limite para um vendedor puxar o chat e dar o "Oi".',
  },
  {
    key: "sla_ociosidade" as const,
    title: "Resposta Contínua (Ociosidade)",
    desc: "O chat já tem dono. O cliente mandou uma nova dúvida. Tempo limite para o vendedor devolver a resposta.",
  },
  {
    key: "sla_tma" as const,
    title: "Tempo Máx de Resolução (TMA)",
    desc: "Tempo máximo ideal desde a chegada até o encerramento do chamado (Resolver).",
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
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-foreground text-background flex items-center justify-center shadow-sm">
            <Timer className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Gestor de Acordos de Nível de Serviço (SLA)
            </h1>
            <p className="text-sm text-muted-foreground">
              Defina o motor de penalização e os tempos ideais de atendimento.
            </p>
          </div>
        </div>

        {/* GRID 2 colunas */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
          {/* Cronômetros */}
          <Card className="p-6">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <Settings2 className="h-5 w-5 text-foreground" />
                <h2 className="text-base font-semibold">Cronômetros da Operação</h2>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={cfg.sla_ativo}
                  onCheckedChange={(v) => setCfg({ ...cfg, sla_ativo: v })}
                  className="data-[state=checked]:bg-emerald-500"
                />
                <span className="text-sm font-medium">SLA Ativado</span>
              </div>
            </div>

            <div className="space-y-3">
              {CRONOMETROS.map((c) => (
                <div
                  key={c.key}
                  className="flex items-center gap-4 p-4 rounded-xl border border-border hover:border-primary/30 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm">{c.title}</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      {c.desc}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Input
                      type="number"
                      min={1}
                      value={cfg[c.key]}
                      onChange={(e) =>
                        setCfg({ ...cfg, [c.key]: parseInt(e.target.value || "0", 10) })
                      }
                      className="w-20 h-11 text-center text-lg font-bold"
                    />
                    <span className="text-sm text-muted-foreground">min</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Lateral: Regras + Salvar */}
          <div className="space-y-4">
            <Card className="p-5 space-y-4">
              <div className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-foreground" />
                <h2 className="text-base font-semibold">Regras de Estouro (Punição)</h2>
              </div>
              <p className="text-xs text-muted-foreground">
                O que o sistema deve fazer silenciosamente quando o vendedor demorar?
              </p>

              <Select
                value={cfg.sla_acao_estouro}
                onValueChange={(v) =>
                  setCfg({ ...cfg, sla_acao_estouro: v as SlaConfig["sla_acao_estouro"] })
                }
              >
                <SelectTrigger className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Apenas enviar para o BI (Não punir)</SelectItem>
                  <SelectItem value="unassign">Retirar cliente do atendente</SelectItem>
                  <SelectItem value="transfer_ai">Transferir para Agente IA</SelectItem>
                </SelectContent>
              </Select>

              <div className="flex items-center justify-between pt-2">
                <span className="text-sm">Notificar Gerente no "Odin"</span>
                <Switch
                  checked={cfg.sla_notificar_supervisor}
                  onCheckedChange={(v) =>
                    setCfg({ ...cfg, sla_notificar_supervisor: v })
                  }
                  className="data-[state=checked]:bg-emerald-500"
                />
              </div>

              {cfg.sla_notificar_supervisor && (
                <Input
                  type="email"
                  placeholder="gerente@empresa.com.br"
                  value={cfg.sla_email_supervisor}
                  onChange={(e) =>
                    setCfg({ ...cfg, sla_email_supervisor: e.target.value })
                  }
                />
              )}
            </Card>

            <Button
              onClick={handleSave}
              disabled={saving}
              className="w-full h-12 bg-foreground text-background hover:bg-foreground/90 font-semibold"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Gravar e Aplicar Imediatamente
            </Button>
          </div>
        </div>
      </div>
    </CRMLayout>
  );
}
