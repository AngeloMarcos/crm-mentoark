/**
 * MaturadorNumeros.tsx — aba "Maturador" de /whatsapp (Sprint Score Real + Maturador,
 * 2026-08-09, item 2). Ferramenta pra "esquentar" números novos/recém-conectados trocando
 * mensagem pré-escrita entre 2+ instâncias da própria conta — zero IA/token externo (banco de
 * diálogo determinístico, `backend/src/services/maturadorDialogos.ts`). Motor real roda no
 * backend (`maturadorProcessor.ts`, cron de 1min) — esta tela só cria/ativa/desativa pares e
 * mostra a contagem do dia.
 *
 * [AUDITORIA] LÓGICA: "ativar" pode ser recusado pelo backend (409) se a conta tiver qualquer
 * instância com IA ativa (`agentes.ativo=true`) — guard-rail contra a mensagem do maturador cair
 * no fallback de IA da conta (`agentEngine.ts`, ver comentário completo em
 * `backend/src/routes/maturador.ts`) e gerar custo real de token. A mensagem de erro do backend
 * já explica o motivo — só repassada aqui via toast, sem reescrever a lógica no frontend.
 */
import { useEffect, useState } from "react";
import { getAuthToken } from "@/lib/api-token";
import { api } from "@/integrations/database/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Users2, Plus, Trash2, AlertOctagon, Info, MessageCircleHeart } from "lucide-react";
import { toast } from "sonner";

const API_BASE = (import.meta.env.VITE_API_URL as string) || "http://localhost:3000";

interface Agente {
  id: string;
  nome: string;
  evolution_instancia: string | null;
}

interface ParMaturador {
  id: string;
  agente_a_id: string;
  agente_b_id: string;
  agente_a_nome: string;
  agente_b_nome: string;
  ativo: boolean;
  data_inicio: string;
  contador_dia: number;
  banido_em: string | null;
  banido_agente_id: string | null;
}

async function apiFetch(path: string, options: RequestInit = {}) {
  const t = getAuthToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}), ...(options.headers || {}) },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message || `Falha na requisição (${res.status})`);
  return json;
}

// Mesma progressão documentada em `maturadorProcessor.ts`/`ScoreInstancia.tsx` — só pra exibir
// "X/limite" na tela, o teto real de verdade é aplicado no backend.
function limiteHojeExibicao(dataInicio: string): number {
  const dias = Math.max(0, Math.floor((Date.now() - new Date(dataInicio).getTime()) / (1000 * 60 * 60 * 24)));
  if (dias < 7) return 20;
  if (dias < 14) return 50;
  return 100;
}

export function MaturadorNumeros() {
  const { user } = useAuth();
  const [agentes, setAgentes] = useState<Agente[]>([]);
  const [pares, setPares] = useState<ParMaturador[]>([]);
  const [loading, setLoading] = useState(true);
  const [criando, setCriando] = useState(false);
  const [selA, setSelA] = useState("");
  const [selB, setSelB] = useState("");
  const [processandoId, setProcessandoId] = useState<string | null>(null);

  const carregar = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [{ data: agData }, paresData] = await Promise.all([
        api.from("agentes").select("id,nome,evolution_instancia").eq("user_id", user.id),
        apiFetch("/api/maturador"),
      ]);
      setAgentes(((agData ?? []) as Agente[]).filter(a => !!a.evolution_instancia));
      setPares(paresData);
    } catch (err: any) {
      toast.error(`Erro ao carregar Maturador: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { carregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user?.id]);

  const criarPar = async () => {
    if (!selA || !selB) { toast.error("Selecione as 2 instâncias do par"); return; }
    if (selA === selB) { toast.error("Selecione 2 instâncias diferentes"); return; }
    setCriando(true);
    try {
      await apiFetch("/api/maturador", { method: "POST", body: JSON.stringify({ agente_a_id: selA, agente_b_id: selB }) });
      toast.success("Par criado — ainda desligado, ative quando quiser começar.");
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
      toast.success(ativo ? "Maturação ativada para este par" : "Maturação pausada para este par");
      carregar();
    } catch (err: any) {
      toast.error(err.message, { duration: 8000 });
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
      carregar();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setProcessandoId(null);
    }
  };

  // [AUDITORIA] BUG CORRIGIDO (achado real do usuário, 2026-09-13: "não consigo usar o
  // maturador" — par marcado como banido/caído ficava preso pra sempre, sem nenhuma ação além de
  // excluir e recriar o par do zero, perdendo a progressão de dias 20→50→100/dia). Reativa via
  // POST /:id/reativar (routes/maturador.ts) — só limpa a marca, o par volta desligado (mesma
  // regra de "nasce sempre desligado"), usuário liga de novo quando quiser.
  const reativarPar = async (par: ParMaturador) => {
    setProcessandoId(par.id);
    try {
      await apiFetch(`/api/maturador/${par.id}/reativar`, { method: "POST" });
      toast.success("Par reativado — ligue o switch quando quiser voltar a mandar mensagem.");
      carregar();
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
      carregar();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
          <MessageCircleHeart className="h-5 w-5 text-primary" /> Maturador de Números
        </h2>
        <p className="text-sm text-muted-foreground">
          Aquece número novo/recém-conectado trocando mensagem pré-escrita com outra instância da
          sua conta — zero IA, zero custo de token, ritmo gradual (20/dia na 1ª semana, 50 na 2ª, 100 da 3ª em diante).
        </p>
      </div>

      <Card className="p-3 bg-blue-500/5 border-blue-500/20 flex gap-2 items-start">
        <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground">
          Estimativa baseada em dado real do CRM, não é uma métrica oficial da Meta/WhatsApp (que
          não existe pra API não-oficial). Ativar um par exige que NENHUMA instância da conta
          tenha IA ativa — evita que a mensagem do maturador seja respondida pela IA de verdade e
          gere custo de token.
        </p>
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {pares.map(par => {
          const limite = limiteHojeExibicao(par.data_inicio);
          return (
            <Card key={par.id} className={`p-4 space-y-3 ${par.banido_em ? 'border-red-500/50 bg-red-50/30' : ''}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-bold truncate">{par.agente_a_nome} ↔ {par.agente_b_nome}</p>
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
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {par.contador_dia}/{limite} mensagens hoje
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs">{par.ativo ? "Ativo" : "Desligado"}</span>
                    <Switch
                      checked={par.ativo}
                      disabled={processandoId === par.id}
                      onCheckedChange={(v) => alternarAtivo(par, v)}
                    />
                  </div>
                </div>
              )}

              {!par.banido_em && (
                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm" variant="outline" className="flex-1 h-7 text-[10px]"
                    disabled={processandoId === par.id}
                    onClick={() => marcarBanido(par, par.agente_a_id, par.agente_a_nome)}
                  >
                    "{par.agente_a_nome}" caiu/baniu
                  </Button>
                  <Button
                    size="sm" variant="outline" className="flex-1 h-7 text-[10px]"
                    disabled={processandoId === par.id}
                    onClick={() => marcarBanido(par, par.agente_b_id, par.agente_b_nome)}
                  >
                    "{par.agente_b_nome}" caiu/baniu
                  </Button>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
