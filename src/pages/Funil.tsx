import { useEffect, useState } from "react";
import { CRMLayout } from "@/components/CRMLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Clock, User, Flame, Snowflake, ThermometerSun, Loader2, ArrowRight } from "lucide-react";
import { toast } from "sonner";

type FunilStatus = "novo" | "contatado" | "qualificado" | "agendado" | "fechado" | "perdido";

interface Contato {
  id: string;
  nome: string;
  telefone: string | null;
  email: string | null;
  status: string;
  origem: string | null;
  notas: string | null;
  temperatura: string;
  valor_potencial: number;
  responsavel: string;
  updated_at: string;
}

const etapas: FunilStatus[] = ["novo", "contatado", "qualificado", "agendado", "fechado", "perdido"];

const etapaLabel: Record<FunilStatus, string> = {
  novo: "Novo",
  contatado: "Contatado",
  qualificado: "Qualificado",
  agendado: "Agendado",
  fechado: "Fechado",
  perdido: "Perdido",
};

const etapaCor: Record<FunilStatus, string> = {
  novo: "border-t-info",
  contatado: "border-t-primary",
  qualificado: "border-t-success",
  agendado: "border-t-accent",
  fechado: "border-t-success",
  perdido: "border-t-destructive",
};

const tempIcon: Record<string, any> = { quente: Flame, morno: ThermometerSun, frio: Snowflake };
const tempColor: Record<string, string> = {
  quente: "text-destructive",
  morno: "text-warning",
  frio: "text-info",
};

function daysSince(date: string) {
  return Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
}

function proximaEtapa(status: string): FunilStatus | null {
  if (status === "fechado" || status === "perdido") return null;
  const idx = etapas.indexOf(status as FunilStatus);
  return idx === -1 || idx >= etapas.length - 1 ? null : etapas[idx + 1];
}

export default function FunilPage() {
  const { user } = useAuth();
  const [contatos, setContatos] = useState<Contato[]>([]);
  const [loading, setLoading] = useState(true);
  const [selecionado, setSelecionado] = useState<Contato | null>(null);
  const [movendo, setMovendo] = useState(false);

  const carregar = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("contatos")
      .select("*")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });

    if (error) {
      toast.error("Erro ao carregar contatos");
      setLoading(false);
      return;
    }
    setContatos((data ?? []) as Contato[]);
    setLoading(false);
  };

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const moverProximaEtapa = async () => {
    if (!selecionado) return;
    const prox = proximaEtapa(selecionado.status);
    if (!prox) {
      toast.info("Este contato já está na etapa final.");
      return;
    }
    setMovendo(true);
    const { error } = await supabase
      .from("contatos")
      .update({ status: prox })
      .eq("id", selecionado.id);
    setMovendo(false);
    if (error) {
      toast.error("Erro ao mover contato");
      return;
    }
    toast.success(`Movido para ${etapaLabel[prox]}`);
    setSelecionado(null);
    carregar();
  };

  return (
    <CRMLayout>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Funil de Vendas</h1>
          <p className="text-muted-foreground text-sm">Pipeline visual da operação comercial</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-4">
            {etapas.map((etapa) => {
              const etapaContatos = contatos.filter((c) => c.status === etapa);
              const valorTotal = etapaContatos.reduce(
                (s, c) => s + (Number(c.valor_potencial) || 0),
                0,
              );
              return (
                <div key={etapa} className="min-w-[260px] flex-shrink-0 flex flex-col">
                  <div className="flex items-center justify-between mb-3 px-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-sm">{etapaLabel[etapa]}</h3>
                      <Badge variant="secondary" className="text-xs">
                        {etapaContatos.length}
                      </Badge>
                    </div>
                    {valorTotal > 0 && (
                      <span className="text-xs text-muted-foreground">
                        R$ {(valorTotal / 1000).toFixed(1)}k
                      </span>
                    )}
                  </div>

                  <div className="space-y-2 flex-1">
                    {etapaContatos.map((contato) => {
                      const TempIcon = tempIcon[contato.temperatura] || Snowflake;
                      const dias = daysSince(contato.updated_at);
                      return (
                        <Card
                          key={contato.id}
                          onClick={() => setSelecionado(contato)}
                          className={`p-3 cursor-pointer hover:border-primary/40 transition-colors border-t-2 ${etapaCor[etapa]}`}
                        >
                          <div className="space-y-2">
                            <div className="flex items-start justify-between">
                              <p className="font-medium text-sm">{contato.nome}</p>
                              <TempIcon
                                className={`h-4 w-4 ${tempColor[contato.temperatura] || "text-info"}`}
                              />
                            </div>
                            {contato.origem && (
                              <div className="flex flex-wrap gap-1">
                                <Badge variant="outline" className="text-xs">
                                  {contato.origem}
                                </Badge>
                              </div>
                            )}
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <User className="h-3 w-3" />
                                {contato.responsavel}
                              </span>
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {dias}d
                              </span>
                            </div>
                            {Number(contato.valor_potencial) > 0 && (
                              <p className="text-xs font-medium text-primary">
                                R$ {Number(contato.valor_potencial).toLocaleString("pt-BR")}
                              </p>
                            )}
                          </div>
                        </Card>
                      );
                    })}
                    {etapaContatos.length === 0 && (
                      <div className="border border-dashed border-border rounded-lg p-6 text-center text-xs text-muted-foreground">
                        Nenhum lead
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={!!selecionado} onOpenChange={(o) => !o && setSelecionado(null)}>
        <DialogContent>
          {selecionado && (
            <>
              <DialogHeader>
                <DialogTitle>{selecionado.nome}</DialogTitle>
                <DialogDescription>
                  Etapa atual:{" "}
                  <Badge variant="secondary" className="ml-1">
                    {etapaLabel[selecionado.status as FunilStatus] ?? selecionado.status}
                  </Badge>
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3 text-sm">
                {selecionado.telefone && (
                  <div>
                    <p className="text-muted-foreground text-xs">Telefone</p>
                    <p>{selecionado.telefone}</p>
                  </div>
                )}
                {selecionado.email && (
                  <div>
                    <p className="text-muted-foreground text-xs">E-mail</p>
                    <p>{selecionado.email}</p>
                  </div>
                )}
                <div>
                  <p className="text-muted-foreground text-xs">Notas</p>
                  <p className="whitespace-pre-wrap">
                    {selecionado.notas || (
                      <span className="text-muted-foreground italic">Sem notas</span>
                    )}
                  </p>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setSelecionado(null)}>
                  Fechar
                </Button>
                {proximaEtapa(selecionado.status) && (
                  <Button onClick={moverProximaEtapa} disabled={movendo}>
                    {movendo ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ArrowRight className="h-4 w-4" />
                    )}
                    Mover para {etapaLabel[proximaEtapa(selecionado.status)!]}
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </CRMLayout>
  );
}
