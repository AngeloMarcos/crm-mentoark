/**
 * MaturadorNumeros.tsx — aba "Maturador" de /whatsapp (Sprint Score Real + Maturador,
 * 2026-08-09; v2 em 2026-10-04). Ferramenta pra "esquentar" números novos/recém-conectados
 * trocando mensagem pré-escrita entre 2 instâncias da própria conta — zero IA/token externo
 * (banco por tema, `backend/src/services/maturadorDialogos.ts`). Motor real roda no backend
 * (`maturadorProcessor.ts`, cron de 1min) — esta tela cria/liga/desliga pares, ajusta a janela de
 * horário e mostra o progresso (fase, envios do dia por ponta, score, últimas trocas).
 *
 * [AUDITORIA] LÓGICA (v2): a IA não precisa mais estar desligada pra usar o maturador — o
 * webhook reconhece o tráfego do maturador e nunca o entrega pra IA (`maturadorFiltro.ts`).
 * "Ligar" ainda pode ser recusado (409) se uma ponta estiver desconectada ou sem número
 * identificado; a mensagem do backend já explica o motivo e é só repassada via toast.
 */
import { useEffect, useState } from "react";
import { getAuthToken } from "@/lib/api-token";
import { api } from "@/integrations/database/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Loader2, Users2, Plus, Trash2, AlertOctagon, Info, Flame, Clock, PauseCircle, ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { MaturadorGlobal } from "./MaturadorGlobal";
import { PainelChips } from "./PainelChips";
import { GruposMaturador } from "./GruposMaturador";
import { ConversasMaturador } from "./ConversasMaturador";

const API_BASE = (import.meta.env.VITE_API_URL as string) || "http://localhost:3000";

interface Agente {
  id: string;
  nome: string;
  evolution_instancia: string | null;
}

interface MensagemMaturador {
  de_agente_id: string;
  tipo: "texto" | "reacao";
  texto: string;
  created_at: string;
}

interface ParMaturador {
  id: string;
  agente_a_id: string;
  agente_b_id: string;
  agente_a_nome: string;
  agente_b_nome: string;
  agente_a_score: number | null;
  agente_b_score: number | null;
  numero_a: string | null;
  numero_b: string | null;
  ativo: boolean;
  data_inicio: string;
  banido_em: string | null;
  banido_agente_id: string | null;
  ultima_mensagem_em: string | null;
  proxima_mensagem_em: string | null;
  hora_inicio: number;
  hora_fim: number;
  pausado_motivo: string | null;
  enviados_hoje_a: number;
  enviados_hoje_b: number;
  total_mensagens: number;
  ultimas_mensagens: MensagemMaturador[];
}

async function apiFetch(path: string, options: RequestInit = {}) {
  const t = getAuthToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}), ...(options.headers || {}) },
  });
  if (res.status === 204) return null;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message || `Falha na requisição (${res.status})`);
  return json;
}

// Mesma progressão de `limiteDiarioPorIdade` em `maturadorProcessor.ts` — só pra exibir, o teto
// real é aplicado no backend (por instância remetente).
function faseMaturacao(dataInicio: string): { dias: number; limite: number; fase: string } {
  const dias = Math.max(0, Math.floor((Date.now() - new Date(dataInicio).getTime()) / 86_400_000));
  if (dias < 7) return { dias, limite: 20, fase: "Semana 1" };
  if (dias < 14) return { dias, limite: 50, fase: "Semana 2" };
  return { dias, limite: 100, fase: "Aquecido" };
}

function corScore(score: number | null): string {
  if (score == null) return "bg-muted text-muted-foreground";
  if (score >= 75) return "bg-emerald-500/15 text-emerald-600 border-emerald-500/30";
  if (score >= 50) return "bg-amber-500/15 text-amber-600 border-amber-500/30";
  return "bg-red-500/15 text-red-600 border-red-500/30";
}

function hora(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function proximaTexto(par: ParMaturador): string {
  if (!par.ativo) return "desligado";
  const agora = new Date();
  const h = Number(agora.toLocaleString("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "America/Sao_Paulo" }));
  const dentro = par.hora_inicio <= par.hora_fim
    ? h >= par.hora_inicio && h < par.hora_fim
    : h >= par.hora_inicio || h < par.hora_fim;
  if (!dentro) return `fora do horário — volta às ${String(par.hora_inicio).padStart(2, "0")}h`;
  if (!par.proxima_mensagem_em || new Date(par.proxima_mensagem_em) <= agora) return "a qualquer momento";
  return `por volta de ${hora(par.proxima_mensagem_em)}`;
}

const HORAS = Array.from({ length: 24 }, (_, i) => i);

export function MaturadorNumeros() {
  const { user } = useAuth();
  const [agentes, setAgentes] = useState<Agente[]>([]);
  const [pares, setPares] = useState<ParMaturador[]>([]);
  const [loading, setLoading] = useState(true);
  const [criando, setCriando] = useState(false);
  const [selA, setSelA] = useState("");
  const [selB, setSelB] = useState("");
  const [processandoId, setProcessandoId] = useState<string | null>(null);

  const carregar = async (silencioso = false) => {
    if (!user) return;
    if (!silencioso) setLoading(true);
    try {
      const [{ data: agData }, paresData] = await Promise.all([
        api.from("agentes").select("id,nome,evolution_instancia").eq("user_id", user.id),
        apiFetch("/api/maturador"),
      ]);
      setAgentes(((agData ?? []) as Agente[]).filter(a => !!a.evolution_instancia));
      setPares(paresData);
    } catch (err: any) {
      if (!silencioso) toast.error(`Erro ao carregar Aquecimento: ${err.message}`);
    } finally {
      if (!silencioso) setLoading(false);
    }
  };

  useEffect(() => { carregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user?.id]);

  // Atualiza o progresso a cada 60s enquanto houver par ligado (o motor roda a cada 1 min).
  const algumAtivo = pares.some(p => p.ativo);
  useEffect(() => {
    if (!algumAtivo) return;
    const t = setInterval(() => carregar(true), 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [algumAtivo, user?.id]);

  const criarPar = async () => {
    if (!selA || !selB) { toast.error("Selecione as 2 instâncias do par"); return; }
    if (selA === selB) { toast.error("Selecione 2 instâncias diferentes"); return; }
    setCriando(true);
    try {
      await apiFetch("/api/maturador", { method: "POST", body: JSON.stringify({ agente_a_id: selA, agente_b_id: selB }) });
      toast.success("Par criado — ainda desligado, ligue quando quiser começar.");
      setSelA(""); setSelB("");
      carregar();
    } catch (err: any) {
      toast.error(`Erro ao criar par: ${err.message}`);
    } finally {
      setCriando(false);
    }
  };

  const alternarAtivo = async (par: ParMaturador, ativo: boolean) => {
    setProcessandoId(par.id);
    try {
      await apiFetch(`/api/maturador/${par.id}/ativo`, { method: "PATCH", body: JSON.stringify({ ativo }) });
      toast.success(ativo ? "Maturação ligada — a 1ª troca sai no próximo minuto" : "Maturação pausada para este par");
      carregar(true);
    } catch (err: any) {
      toast.error(err.message, { duration: 8000 });
    } finally {
      setProcessandoId(null);
    }
  };

  const salvarJanela = async (par: ParMaturador, hora_inicio: number, hora_fim: number) => {
    if (hora_inicio === hora_fim) { toast.error("Início e fim precisam ser diferentes"); return; }
    setProcessandoId(par.id);
    try {
      await apiFetch(`/api/maturador/${par.id}/config`, { method: "PATCH", body: JSON.stringify({ hora_inicio, hora_fim }) });
      setPares(ps => ps.map(p => p.id === par.id ? { ...p, hora_inicio, hora_fim } : p));
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setProcessandoId(null);
    }
  };

  const marcarBanido = async (par: ParMaturador, agenteId: string, nome: string) => {
    if (!confirm(`Marcar "${nome}" como caído/banido? Isso desliga este par e força o Score de Saúde dessa instância pra crítico imediatamente.`)) return;
    setProcessandoId(par.id);
    try {
      await apiFetch(`/api/maturador/${par.id}/banido`, { method: "POST", body: JSON.stringify({ agente_id: agenteId }) });
      toast.success(`"${nome}" marcado como caído/banido — score atualizado.`);
      carregar(true);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setProcessandoId(null);
    }
  };

  // Reativa um par marcado como banido/caído (POST /:id/reativar) — volta desligado, sem perder
  // a progressão de dias.
  const reativarPar = async (par: ParMaturador) => {
    setProcessandoId(par.id);
    try {
      await apiFetch(`/api/maturador/${par.id}/reativar`, { method: "POST" });
      toast.success("Par reativado — ligue o switch quando quiser voltar a mandar mensagem.");
      carregar(true);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setProcessandoId(null);
    }
  };

  const excluirPar = async (par: ParMaturador) => {
    if (!confirm(`Excluir o par "${par.agente_a_nome}" ↔ "${par.agente_b_nome}"? Isso só remove o pareamento, as instâncias continuam existindo.`)) return;
    try {
      await apiFetch(`/api/maturador/${par.id}`, { method: "DELETE" });
      toast.success("Par removido");
      carregar(true);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
    <div className="space-y-4">
      {/* Sprint 7 do maturador v5: controles por chip, velocidade e progresso (modelo ChipFlow). */}
      {/* Sprint 12 do maturador v5: pulso do dia e conversas (só leitura). */}
      <ConversasMaturador />
      {/* Painel de chips (2026-10-27, modelo ChipFlow): um card por número — substitui o card "Controles",
          cujos liga/desliga agora ficam no menu "…" de cada card. */}
      <PainelChips />
      <GruposMaturador />
      {/* Sprint 9: Maturador Global (entre contas) — adesão, situação de cada número e proxy. */}
      <MaturadorGlobal />
      <div>
        <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
          <Flame className="h-5 w-5 text-orange-500" /> Aquecimento de Números
        </h2>
        <p className="text-sm text-muted-foreground">
          Aquece número novo trocando conversas naturais com outra instância da sua conta: em
          sessões curtas com pausas, só no horário escolhido, com "digitando…", leitura e reações.
          Ritmo gradual de 20/dia na 1ª semana, 50 na 2ª e 100 a partir da 3ª. As conversas são escritas por IA
          (com teto de custo por dia) ou, sem IA, saem de um banco de frases prontas.
        </p>
      </div>

      <Card className="p-3 bg-emerald-500/5 border-emerald-500/20 flex gap-2 items-start">
        <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
        <div className="text-xs text-muted-foreground space-y-1">
          <p>
            As mensagens do Aquecimento nunca chegam na IA, não viram contato nem lead. Pode manter
            sua IA ligada normalmente.
          </p>
          <p>
            Para o número ganhar score: use chip com WhatsApp ativo no celular, evite reconectar
            o QR várias vezes seguidas, nunca conecte o mesmo número em duas instâncias e só
            comece campanhas depois da fase "Aquecido".
          </p>
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <p className="text-sm font-bold flex items-center gap-2"><Plus className="h-4 w-4" /> Novo par</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <Select value={selA} onValueChange={setSelA}>
            <SelectTrigger className="sm:flex-1"><SelectValue placeholder="Instância A" /></SelectTrigger>
            <SelectContent>
              {agentes.map(a => <SelectItem key={a.id} value={a.id}>{a.nome}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={selB} onValueChange={setSelB}>
            <SelectTrigger className="sm:flex-1"><SelectValue placeholder="Instância B" /></SelectTrigger>
            <SelectContent>
              {agentes.map(a => <SelectItem key={a.id} value={a.id}>{a.nome}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={criarPar} disabled={criando || !selA || !selB} className="sm:w-auto">
            {criando ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
            Criar par
          </Button>
        </div>
      </Card>

      {loading && (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando...
        </div>
      )}

      {!loading && pares.length === 0 && (
        <Card className="p-10 text-center border-dashed">
          <Users2 className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <h3 className="text-base font-bold mb-1">Nenhum par cadastrado</h3>
          <p className="text-sm text-muted-foreground">Crie um par acima entre 2 instâncias da sua conta pra começar.</p>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {pares.map(par => {
          const { dias, limite, fase } = faseMaturacao(par.data_inicio);
          const pontas = [
            { id: par.agente_a_id, nome: par.agente_a_nome, score: par.agente_a_score, numero: par.numero_a, enviados: par.enviados_hoje_a },
            { id: par.agente_b_id, nome: par.agente_b_nome, score: par.agente_b_score, numero: par.numero_b, enviados: par.enviados_hoje_b },
          ];
          const nomePorId = (id: string) => (id === par.agente_a_id ? par.agente_a_nome : par.agente_b_nome);
          return (
            <Card key={par.id} className={`p-4 space-y-3 ${par.banido_em ? "border-red-500/50 bg-red-50/30" : ""}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-bold truncate">{par.agente_a_nome} ↔ {par.agente_b_nome}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {fase} · dia {dias + 1} · {par.total_mensagens} mensagens trocadas no total
                  </p>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 shrink-0" onClick={() => excluirPar(par)} title="Excluir par">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>

              {par.banido_em ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 p-2 bg-red-500 text-white rounded-md text-[11px] font-bold">
                    <AlertOctagon className="h-3 w-3" />
                    Par desligado — uma das instâncias foi marcada como caída/banida
                  </div>
                  <Button
                    size="sm" variant="outline" className="w-full h-7 text-[11px]"
                    disabled={processandoId === par.id}
                    onClick={() => reativarPar(par)}
                  >
                    {processandoId === par.id ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : null}
                    Já reconectei / foi engano — reativar par
                  </Button>
                </div>
              ) : (
                <>
                  {par.pausado_motivo && !par.ativo && (
                    <div className="flex items-start gap-2 p-2 rounded-md bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-700 dark:text-amber-400">
                      <PauseCircle className="h-3.5 w-3.5 shrink-0 mt-px" />
                      <span><b>Pausado automaticamente:</b> {par.pausado_motivo}. Resolva e ligue de novo.</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" /> Próxima: {proximaTexto(par)}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs">{par.ativo ? "Ligado" : "Desligado"}</span>
                      <Switch
                        checked={par.ativo}
                        disabled={processandoId === par.id}
                        onCheckedChange={(v) => alternarAtivo(par, v)}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {pontas.map(p => (
                      <div key={p.id} className="rounded-md border p-2 space-y-1.5">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs font-semibold truncate">{p.nome}</span>
                          <Badge variant="outline" className={`text-[10px] px-1.5 ${corScore(p.score)}`} title="Score de Saúde">
                            {p.score ?? "—"}
                          </Badge>
                        </div>
                        {p.numero && <p className="text-[10px] text-muted-foreground">+{p.numero}</p>}
                        <Progress value={Math.min(100, (p.enviados / limite) * 100)} className="h-1.5" />
                        <p className="text-[10px] text-muted-foreground">{p.enviados}/{limite} enviadas hoje</p>
                        <Button
                          size="sm" variant="ghost" className="w-full h-6 text-[10px] text-red-600"
                          disabled={processandoId === par.id}
                          onClick={() => marcarBanido(par, p.id, p.nome)}
                        >
                          Caiu/baniu
                        </Button>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">Conversar das</span>
                    <Select value={String(par.hora_inicio)} onValueChange={(v) => salvarJanela(par, Number(v), par.hora_fim)}>
                      <SelectTrigger className="h-7 w-[72px] text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>{HORAS.map(h => <SelectItem key={h} value={String(h)}>{String(h).padStart(2, "0")}h</SelectItem>)}</SelectContent>
                    </Select>
                    <span className="text-muted-foreground">às</span>
                    <Select value={String(par.hora_fim)} onValueChange={(v) => salvarJanela(par, par.hora_inicio, Number(v))}>
                      <SelectTrigger className="h-7 w-[72px] text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>{HORAS.map(h => <SelectItem key={h} value={String(h)}>{String(h).padStart(2, "0")}h</SelectItem>)}</SelectContent>
                    </Select>
                  </div>

                  {par.ultimas_mensagens.length > 0 && (
                    <div className="rounded-md bg-muted/40 p-2 space-y-1">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Últimas trocas</p>
                      {par.ultimas_mensagens.map((m, i) => (
                        <p key={i} className="text-[11px] truncate">
                          <span className="text-muted-foreground">{hora(m.created_at)} · {nomePorId(m.de_agente_id)}:</span>{" "}
                          {m.tipo === "reacao" ? <span title="Reação">reagiu {m.texto}</span> : m.texto}
                        </p>
                      ))}
                    </div>
                  )}
                </>
              )}
            </Card>
          );
        })}
      </div>

      {pares.length > 0 && (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1">
          <Info className="h-3 w-3" /> O Score de Saúde é recalculado a cada 15 minutos.
        </p>
      )}
    </div>
  );
}
