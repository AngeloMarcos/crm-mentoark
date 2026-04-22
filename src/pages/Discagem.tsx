import { useEffect, useMemo, useState } from "react";
import { CRMLayout } from "@/components/CRMLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import {
  Phone, PhoneCall, PhoneOff, PhoneMissed, ChevronLeft, ChevronRight,
  Building2, Mail, CheckCircle2, XCircle, Clock, CalendarCheck, Loader2,
  SkipForward, Tag, FileText,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { toast as sonnerToast } from "sonner";

interface Contato {
  id: string;
  nome: string;
  telefone: string | null;
  email: string | null;
  empresa: string | null;
  cargo: string | null;
  origem: string | null;
  status: string;
  tags: string[] | null;
  notas: string | null;
  lista_id: string | null;
}

interface Lista {
  id: string;
  nome: string;
}

const resultados = [
  { value: "atendeu", label: "Atendeu", icon: CheckCircle2, color: "text-success", novoStatus: "contatado" },
  { value: "nao_atendeu", label: "Não atendeu", icon: PhoneMissed, color: "text-warning", novoStatus: "novo" },
  { value: "ocupado", label: "Ocupado / Caixa postal", icon: Clock, color: "text-warning", novoStatus: "novo" },
  { value: "agendou", label: "Agendou reunião", icon: CalendarCheck, color: "text-info", novoStatus: "agendado" },
  { value: "fechou", label: "Fechou negócio", icon: CheckCircle2, color: "text-success", novoStatus: "fechado" },
  { value: "recusou", label: "Recusou / Sem interesse", icon: XCircle, color: "text-destructive", novoStatus: "perdido" },
  { value: "numero_invalido", label: "Número inválido", icon: PhoneOff, color: "text-destructive", novoStatus: "perdido" },
];

export default function DiscagemPage() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [listas, setListas] = useState<Lista[]>([]);
  const [contatos, setContatos] = useState<Contato[]>([]);
  const [listaSelecionada, setListaSelecionada] = useState<string>("todas");
  const [filtroStatus, setFiltroStatus] = useState<string>("nao_contatados");
  const [indice, setIndice] = useState(0);

  const [resultado, setResultado] = useState("");
  const [notas, setNotas] = useState("");
  const [ultimaChamada, setUltimaChamada] = useState<{
    contatoId: string;
    statusAnterior: string;
    notasAnteriores: string | null;
  } | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      const [{ data: l }, { data: c }] = await Promise.all([
        supabase
          .from("listas")
          .select("id, nome")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("contatos")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false }),
      ]);
      setListas(l ?? []);
      setContatos(c ?? []);
      setLoading(false);
    })();
  }, [user?.id]);

  // Fila filtrada
  const fila = useMemo(() => {
    return contatos.filter((c) => {
      if (!c.telefone) return false;
      if (listaSelecionada !== "todas" && c.lista_id !== listaSelecionada) return false;
      if (filtroStatus === "nao_contatados" && c.status !== "novo") return false;
      if (filtroStatus === "todos") return true;
      return true;
    });
  }, [contatos, listaSelecionada, filtroStatus]);

  // Reset índice quando fila muda
  useEffect(() => { setIndice(0); }, [listaSelecionada, filtroStatus]);

  const atual = fila[indice];

  const irPara = (delta: number) => {
    const novo = indice + delta;
    if (novo < 0 || novo >= fila.length) return;
    setIndice(novo);
    setResultado("");
    setNotas("");
  };

  const ligarAgora = () => {
    if (!atual?.telefone) return;
    // Limpa telefone para tel: (mantém + para internacional)
    const tel = atual.telefone.replace(/[^\d+]/g, "");
    window.location.href = `tel:${tel}`;
  };

  const desfazerUltimaChamada = async () => {
    if (!ultimaChamada) return;
    await supabase
      .from("contatos")
      .update({
        status: ultimaChamada.statusAnterior,
        notas: ultimaChamada.notasAnteriores,
      })
      .eq("id", ultimaChamada.contatoId);

    const { data: chamadas } = await supabase
      .from("chamadas")
      .select("id")
      .eq("contato_id", ultimaChamada.contatoId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (chamadas?.[0]) {
      await supabase.from("chamadas").delete().eq("id", chamadas[0].id);
    }

    setContatos((prev) =>
      prev.map((c) =>
        c.id === ultimaChamada.contatoId
          ? { ...c, status: ultimaChamada.statusAnterior, notas: ultimaChamada.notasAnteriores }
          : c,
      ),
    );
    setUltimaChamada(null);
    sonnerToast.success("Chamada desfeita");
  };

  const registrarChamada = async () => {
    if (!atual || !user || !resultado) return;
    setSaving(true);
    const meta = resultados.find((r) => r.value === resultado)!;

    // Salva estado anterior para permitir desfazer
    const snapshot = {
      contatoId: atual.id,
      statusAnterior: atual.status,
      notasAnteriores: atual.notas,
    };

    // 1) registrar chamada
    const { error: e1 } = await supabase.from("chamadas").insert({
      user_id: user.id,
      contato_id: atual.id,
      resultado,
      notas: notas.trim() || null,
    });

    // 2) atualizar status do contato + concatenar nota no contato
    const novasNotas = [atual.notas, notas.trim() ? `[${new Date().toLocaleString("pt-BR")}] ${meta.label}: ${notas.trim()}` : null]
      .filter(Boolean).join("\n");

    const { error: e2 } = await supabase.from("contatos").update({
      status: meta.novoStatus,
      notas: novasNotas || atual.notas,
    }).eq("id", atual.id);

    setSaving(false);

    if (e1 || e2) {
      toast({ title: "Erro ao registrar", description: (e1 ?? e2)?.message, variant: "destructive" });
      return;
    }

    setUltimaChamada(snapshot);
    sonnerToast.success(`✅ ${meta.label}`, {
      description: "Clique em desfazer para corrigir",
      duration: 8000,
      action: {
        label: "Desfazer",
        onClick: () => desfazerUltimaChamada(),
      },
    });

    // Atualiza local + avança
    setContatos((prev) => prev.map((c) => c.id === atual.id ? { ...c, status: meta.novoStatus, notas: novasNotas || atual.notas } : c));
    setResultado("");
    setNotas("");
    // se filtro era "não contatados", o atual sai da fila → mantém índice (próximo "ocupa o lugar")
    if (filtroStatus === "nao_contatados") {
      // não mexe no índice, mas se passou do fim, volta
      setTimeout(() => setIndice((i) => Math.min(i, Math.max(0, fila.length - 2))), 0);
    } else {
      setIndice((i) => Math.min(i + 1, fila.length - 1));
    }
  };

  // Estatísticas da sessão
  const totalFila = fila.length;
  const contatados = contatos.filter((c) => c.status !== "novo" && (listaSelecionada === "todas" || c.lista_id === listaSelecionada)).length;
  const totalLista = contatos.filter((c) => listaSelecionada === "todas" || c.lista_id === listaSelecionada).length;

  if (loading) {
    return (
      <CRMLayout>
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mr-2" /> Carregando contatos...
        </div>
      </CRMLayout>
    );
  }

  return (
    <CRMLayout>
      <div className="space-y-5 max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <PhoneCall className="h-6 w-6 text-primary" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold tracking-tight">Modo Discagem</h1>
            <p className="text-muted-foreground text-sm">Ligue para sua lista um por um e registre o resultado de cada chamada.</p>
          </div>
        </div>

        {/* Filtros */}
        <div className="flex gap-3 flex-wrap">
          <Select value={listaSelecionada} onValueChange={setListaSelecionada}>
            <SelectTrigger className="flex-1 min-w-[200px]">
              <SelectValue placeholder="Lista" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as listas</SelectItem>
              {listas.map((l) => (
                <SelectItem key={l.id} value={l.id}>{l.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filtroStatus} onValueChange={setFiltroStatus}>
            <SelectTrigger className="w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="nao_contatados">Apenas não contatados</SelectItem>
              <SelectItem value="todos">Todos os contatos</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Progresso */}
        {totalLista > 0 && (
          <div className="space-y-2 bg-muted/40 rounded-lg p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {contatados} de {totalLista} contatados
              </span>
              <span className="font-medium">{(totalLista > 0 ? Math.round((contatados / totalLista) * 100) : 0)}%</span>
            </div>
            <Progress value={totalLista > 0 ? Math.round((contatados / totalLista) * 100) : 0} className="h-2" />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{totalFila} na fila</span>
              {atual && <span>Contato {indice + 1} de {totalFila}</span>}
            </div>
          </div>
        )}

        {/* Card principal — contato atual */}
        {!atual ? (
          <Card>
            <CardContent className="text-center py-16">
              <PhoneOff className="h-12 w-12 mx-auto mb-4 text-muted-foreground/40" />
              <p className="font-semibold text-lg">Fila vazia 🎉</p>
              <p className="text-sm text-muted-foreground mt-1">
                {totalLista === 0
                  ? "Nenhum contato com telefone nessa seleção. Importe leads na página de Leads."
                  : "Você já contatou todo mundo dessa lista! Mude o filtro para 'Todos' para revisar."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-primary/30">
            <CardContent className="p-6 space-y-5">
              {/* Posição na fila */}
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="font-mono">Contato {indice + 1} de {totalFila}</span>
                <Badge variant="outline" className="text-xs">{atual.origem ?? "Manual"}</Badge>
              </div>

              {/* Identidade */}
              <div className="space-y-1.5">
                <h2 className="text-2xl font-bold">{atual.nome}</h2>
                {atual.empresa && (
                  <p className="text-muted-foreground flex items-center gap-1.5">
                    <Building2 className="h-4 w-4" />
                    {atual.empresa}{atual.cargo && ` • ${atual.cargo}`}
                  </p>
                )}
              </div>

              {/* Telefone gigante + botão ligar */}
              <div className="bg-primary/5 border border-primary/20 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <Phone className="h-7 w-7 text-primary shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Telefone</p>
                    <p className="text-2xl font-mono font-bold break-all">{atual.telefone}</p>
                  </div>
                </div>
                <Button size="lg" onClick={ligarAgora} className="gap-2 shrink-0 w-full sm:w-auto">
                  <PhoneCall className="h-5 w-5" /> Ligar agora
                </Button>
              </div>

              {/* Outros dados */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                {atual.email && (
                  <div className="flex items-start gap-2">
                    <Mail className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                    <span className="break-all">{atual.email}</span>
                  </div>
                )}
                {(atual.tags?.length ?? 0) > 0 && (
                  <div className="flex items-start gap-2">
                    <Tag className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="flex gap-1 flex-wrap">
                      {atual.tags!.map((t) => (
                        <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {atual.notas && (
                <div className="bg-muted/50 rounded-lg p-3 text-sm">
                  <p className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider flex items-center gap-1">
                    <FileText className="h-3 w-3" /> Notas
                  </p>
                  <p className="whitespace-pre-line text-muted-foreground">{atual.notas}</p>
                </div>
              )}

              {/* Resultado */}
              <div className="space-y-2 pt-2 border-t">
                <Label className="text-sm font-semibold">Resultado da ligação</Label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {resultados.map((r) => {
                    const ativo = resultado === r.value;
                    return (
                      <Button
                        key={r.value}
                        variant={ativo ? "default" : "outline"}
                        size="sm"
                        onClick={() => setResultado(r.value)}
                        className="justify-start gap-2 h-auto py-2"
                      >
                        <r.icon className={`h-4 w-4 ${ativo ? "" : r.color}`} />
                        <span className="text-xs text-left">{r.label}</span>
                      </Button>
                    );
                  })}
                </div>
              </div>

              {/* Notas */}
              <div className="space-y-1.5">
                <Label className="text-sm">Notas da ligação (opcional)</Label>
                <Textarea
                  value={notas}
                  onChange={(e) => setNotas(e.target.value)}
                  rows={2}
                  placeholder="O que conversaram, próximos passos, melhor horário para retornar..."
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Navegação */}
        {atual && (
          <div className="flex items-center justify-between gap-3">
            <Button variant="outline" onClick={() => irPara(-1)} disabled={indice === 0}>
              <ChevronLeft className="h-4 w-4 mr-1" /> Anterior
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => irPara(1)} disabled={indice >= fila.length - 1}>
                <SkipForward className="h-4 w-4 mr-1" /> Pular
              </Button>
              <Button onClick={registrarChamada} disabled={!resultado || saving}>
                {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
                Registrar e avançar
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </CRMLayout>
  );
}
