import { useState, useEffect, useMemo } from "react";
import { CRMLayout } from "@/components/CRMLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Car, Loader2, Send, Trash2, Sparkles, User, Clock } from "lucide-react";
import { toast } from "sonner";
import { api, getFreshToken } from "@/integrations/database/client";

const API_URL = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";

interface Corrida {
  id: string;
  telefone: string;
  nome_passageiro: string | null;
  origem: string | null;
  destino: string | null;
  horario_solicitado: string | null;
  observacoes: string | null;
  status: "pendente_confirmacao" | "confirmada" | "enviada" | "falha_envio" | "cancelada";
  origem_extracao: "ia" | "manual";
  confianca_ia: "alta" | "baixa" | null;
  created_at: string;
  enviado_at: string | null;
}

type EditFields = Partial<Pick<Corrida, "origem" | "destino" | "horario_solicitado" | "nome_passageiro" | "observacoes">>;

const STATUS_LABELS: Record<Corrida["status"], { label: string; className: string }> = {
  pendente_confirmacao: { label: "Aguardando confirmação", className: "bg-yellow-100 text-yellow-700" },
  confirmada:            { label: "Confirmada",             className: "bg-blue-100 text-blue-700" },
  enviada:               { label: "Enviada",                className: "bg-green-100 text-green-700" },
  falha_envio:           { label: "Falha no envio",         className: "bg-red-100 text-red-700" },
  cancelada:             { label: "Descartada",             className: "bg-gray-100 text-gray-500" },
};

// [AUDITORIA] LÓGICA: página "Corridas Pendentes" — fila de confirmação humana da
// arquitetura híbrida IA + confirmação (ver sprint "Corridas via WhatsApp"). Corridas com
// confianca_ia='alta' e dados completos já saem enviadas automaticamente pela ferramenta
// `criar_corrida` (mcp/tools.ts) e não aparecem aqui na fila — só na aba Histórico. O que
// cai na fila é: extração incerta/incompleta (confianca_ia='baixa'), ou uma tentativa de
// envio automático que falhou (status='falha_envio', reaproveitável para reenvio manual).
export default function CorridasPendentes() {
  const [corridas, setCorridas] = useState<Corrida[]>([]);
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState<Record<string, EditFields>>({});
  const [enviando, setEnviando] = useState<string | null>(null);

  const carregar = async () => {
    setLoading(true);
    const { data, error } = await (api as any)
      .from("corridas")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setCorridas((data ?? []) as Corrida[]);
    setLoading(false);
  };

  useEffect(() => { carregar(); }, []);

  const fila = useMemo(
    () => corridas.filter(c => ["pendente_confirmacao", "confirmada", "falha_envio"].includes(c.status)),
    [corridas]
  );
  const historico = useMemo(
    () => corridas.filter(c => ["enviada", "cancelada"].includes(c.status)),
    [corridas]
  );

  const setCampo = (id: string, campo: keyof EditFields, valor: string) => {
    setEdits(prev => ({ ...prev, [id]: { ...prev[id], [campo]: valor } }));
  };

  const valorCampo = (c: Corrida, campo: keyof EditFields) =>
    edits[c.id]?.[campo] ?? c[campo] ?? "";

  const confirmarEEnviar = async (c: Corrida) => {
    setEnviando(c.id);
    try {
      const token = await getFreshToken();
      const res = await fetch(`${API_URL}/api/corridas/${c.id}/confirmar`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(edits[c.id] || {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message || "Falha ao enviar corrida ao sistema do cliente");
      } else {
        toast.success("Corrida confirmada e enviada ao sistema do cliente!");
        setEdits(prev => { const next = { ...prev }; delete next[c.id]; return next; });
      }
      carregar();
    } catch (err: any) {
      toast.error("Erro ao confirmar corrida", { description: err?.message });
    } finally {
      setEnviando(null);
    }
  };

  const descartar = async (id: string) => {
    const { error } = await (api as any).from("corridas").update({ status: "cancelada" }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Corrida descartada");
    setCorridas(prev => prev.map(c => c.id === id ? { ...c, status: "cancelada" } : c));
  };

  const CampoEditavel = ({ c, campo, label, placeholder }: { c: Corrida; campo: keyof EditFields; label: string; placeholder: string }) => (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        value={valorCampo(c, campo)}
        onChange={e => setCampo(c.id, campo, e.target.value)}
        placeholder={placeholder}
        disabled={c.status === "cancelada" || c.status === "enviada"}
      />
    </div>
  );

  return (
    <CRMLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Car className="h-6 w-6 text-primary" /> Corridas Pendentes
            </h1>
            <p className="text-muted-foreground text-sm">
              Pedidos de corrida identificados no WhatsApp. A IA envia automaticamente ao sistema do cliente
              quando tem certeza dos dados — o que ficar incompleto ou incerto cai aqui para você confirmar.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Tabs defaultValue="fila">
            <TabsList>
              <TabsTrigger value="fila">Fila ({fila.length})</TabsTrigger>
              <TabsTrigger value="historico">Histórico ({historico.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="fila" className="space-y-4 mt-4">
              {fila.length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="flex flex-col items-center text-center py-12 gap-3">
                    <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                      <Car className="h-6 w-6" />
                    </div>
                    <p className="font-semibold">Nenhuma corrida aguardando confirmação</p>
                    <p className="text-sm text-muted-foreground">
                      Pedidos com dados completos e claros são enviados automaticamente.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                fila.map(c => (
                  <Card key={c.id}>
                    <CardContent className="p-4 space-y-4">
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge className={STATUS_LABELS[c.status].className}>{STATUS_LABELS[c.status].label}</Badge>
                          {c.confianca_ia && (
                            <Badge variant="outline" className="gap-1 text-xs">
                              <Sparkles className="h-3 w-3" /> confiança IA: {c.confianca_ia}
                            </Badge>
                          )}
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <User className="h-3 w-3" /> {c.nome_passageiro || c.telefone}
                          </span>
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3 w-3" /> {new Date(c.created_at).toLocaleString("pt-BR")}
                          </span>
                        </div>
                      </div>

                      <div className="grid sm:grid-cols-2 gap-3">
                        <CampoEditavel c={c} campo="origem" label="Origem" placeholder="Ex: Rua X, 123" />
                        <CampoEditavel c={c} campo="destino" label="Destino" placeholder="Ex: Aeroporto" />
                        <CampoEditavel c={c} campo="horario_solicitado" label="Horário" placeholder="Ex: amanhã 8h" />
                        <CampoEditavel c={c} campo="nome_passageiro" label="Passageiro" placeholder={c.telefone} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Observações</Label>
                        <Textarea
                          value={valorCampo(c, "observacoes")}
                          onChange={e => setCampo(c.id, "observacoes", e.target.value)}
                          placeholder="Detalhes extras (opcional)"
                          className="min-h-[60px] resize-y"
                        />
                      </div>

                      <div className="flex items-center gap-2 justify-end">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="outline" size="sm" className="gap-1 text-destructive hover:text-destructive">
                              <Trash2 className="h-3.5 w-3.5" /> Descartar
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Descartar esta corrida?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Ela não será enviada ao sistema do cliente e fica marcada como descartada no histórico.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction onClick={() => descartar(c.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                Descartar
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                        <Button size="sm" className="gap-1" onClick={() => confirmarEEnviar(c)} disabled={enviando === c.id}>
                          {enviando === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                          Confirmar e enviar
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </TabsContent>

            <TabsContent value="historico" className="space-y-3 mt-4">
              {historico.length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="text-center py-12 text-sm text-muted-foreground">
                    Nenhuma corrida enviada ou descartada ainda.
                  </CardContent>
                </Card>
              ) : (
                historico.map(c => (
                  <Card key={c.id}>
                    <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <Badge className={STATUS_LABELS[c.status].className}>{STATUS_LABELS[c.status].label}</Badge>
                          <span className="text-xs text-muted-foreground">{c.nome_passageiro || c.telefone}</span>
                        </div>
                        <p className="text-sm truncate">
                          {c.origem || "?"} → {c.destino || "?"} {c.horario_solicitado ? `· ${c.horario_solicitado}` : ""}
                        </p>
                      </div>
                      <span className="text-xs text-muted-foreground/70 whitespace-nowrap">
                        {new Date(c.enviado_at || c.created_at).toLocaleString("pt-BR")}
                      </span>
                    </CardContent>
                  </Card>
                ))
              )}
            </TabsContent>
          </Tabs>
        )}
      </div>
    </CRMLayout>
  );
}
