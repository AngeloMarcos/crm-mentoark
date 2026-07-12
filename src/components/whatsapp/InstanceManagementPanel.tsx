/**
 * InstanceManagementPanel.tsx — Aba "Instâncias" de /whatsapp. Lista os `agentes` com
 * evolution_instancia preenchida, mostra status de conexão/score de saúde (ScoreInstancia),
 * permite conectar (QR/pairing code), desconectar, excluir e importar histórico, além de
 * configurar comportamento/automação por instância (modal "Configurar Instância").
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { getAuthToken } from "@/lib/api-token";
import { api } from "@/integrations/database/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Smartphone,
  Settings2,
  Loader2,
  Activity,
  Wifi,
  WifiOff,
  RefreshCw,
  AlertOctagon,
  Plus,
  QrCode,
  Power,
  Download,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { ScoreInstancia } from "./ScoreInstancia";
import {
  createInstance,
  fetchConnectionStatus,
  disconnectInstance,
  pollQr,
  type CreateInstanceResult,
} from "@/services/evolutionService";

interface ScoreFatores {
  volume_diario: number;
  taxa_resposta: number;
  reclamacoes: number;
  tempo_conta: number;
}

interface Agente {
  id: string;
  nome: string;
  evolution_instancia: string | null;
  whatsapp_score: number | null;
  score_fatores: ScoreFatores | null;
  fallback_owner: string | null;
  filial: string | null;
  reject_calls: boolean | null;
  ignore_groups: boolean | null;
  auto_read: boolean | null;
  show_signature: boolean | null;
  operation_mode: string | null;
  auto_distribute: boolean | null;
  linked_agent_id: string | null;
}

interface Profile {
  user_id: string;
  email: string;
  display_name: string | null;
}

type ConnState = "open" | "close" | "connecting" | "unauthorized";

function StatusChip({ state }: { state: ConnState }) {
  const cfg = {
    open: { label: "Conectado", className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30", Icon: Wifi },
    connecting: { label: "Reconectando", className: "bg-yellow-500/15 text-yellow-600 border-yellow-500/30", Icon: RefreshCw },
    unauthorized: { label: "Reconecte seu WhatsApp", className: "bg-orange-500/15 text-orange-600 border-orange-500/30 font-bold animate-pulse", Icon: AlertOctagon },
    close: { label: "Desconectado", className: "bg-red-500/15 text-red-600 border-red-500/30", Icon: WifiOff },
  }[state];
  const I = cfg.Icon;
  return (
    <Badge variant="outline" className={`gap-1 ${cfg.className}`}>
      <I className="h-3 w-3" /> {cfg.label}
    </Badge>
  );
}

export function InstanceManagementPanel() {
  const { user } = useAuth();
  const [agentes, setAgentes] = useState<Agente[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [statuses, setStatuses] = useState<Record<string, ConnState>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Agente | null>(null);
  const [saving, setSaving] = useState(false);
  const [calculating, setCalculating] = useState<string | null>(null);

  // ─── Conectar nova instância ───
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [newInstanceName, setNewInstanceName] = useState("");
  const [newInstancePhone, setNewInstancePhone] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [qrData, setQrData] = useState<CreateInstanceResult | null>(null);
  const [pollingConnect, setPollingConnect] = useState(false);
  const [waitingQr, setWaitingQr] = useState(false); // Baileys ainda gerando QR
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [showForceBtn, setShowForceBtn] = useState(false);
  // [AUDITORIA] BUG: pollQrLoop() e pollUntilConnected() (abaixo) usavam a variável de estado
  // (waitingQr / pollingConnect / showQrModal) diretamente na condição do `while`. Como essas
  // funções chamam `setWaitingQr(true)`/`setPollingConnect(true)` na própria primeira linha, a
  // variável capturada no closure continua com o valor ANTIGO (de antes da chamada) durante toda
  // a execução do loop — setState não muda o valor já capturado na clausura em execução, só
  // agenda um novo render. Na prática, como esse valor antigo normalmente é `false`, a condição
  // do while já nasce falsa e o loop inteiro é pulado: a função pula direto para o "Tempo
  // esgotado", sem nunca de fato chamar pollQr()/fetchConnectionStatus() uma única vez.
  // [AUDITORIA] FIX APLICADO: refs espelhando o estado, atualizadas de forma síncrona (refs não
  // sofrem o batching/atraso do setState), usadas como condição real do loop. O estado
  // (waitingQr/pollingConnect) continua existindo só para controlar a UI (spinners/textos).
  const waitingQrRef = useRef(false);
  const pollingConnectRef = useRef(false);
  const showQrModalRef = useRef(false);
  useEffect(() => { showQrModalRef.current = showQrModal; }, [showQrModal]);

  const startConnect = async () => {
    // Backend garante 1 instância por usuário usando nome estável.
    const name = newInstanceName.trim() || `WhatsApp ${user?.display_name || 'Agente'}`;
    
    try {
      setConnecting(true);
      setErrorDetail(null);
      setShowForceBtn(false);
      const phoneDigits = newInstancePhone.replace(/\D/g, "");

      // Backend agora lida com a idempotência e limpeza de duplicatas
      const res = await createInstance(name, phoneDigits || undefined);
      
      setQrData(res);
      setShowConnectModal(false);
      setShowQrModal(true);
      
      if (res.state === "open") {
        toast.success("✅ WhatsApp conectado com sucesso!");
        setShowQrModal(false);
        setQrData(null);
        carregar();
      } else if (res.qrCode || res.pairingCode) {
        toast.info("Escaneie o QR Code ou use o código de pareamento");
        pollUntilConnected(res.instanceName || res.instancia);
      } else if (res.qrPending) {
        toast.info("Aguardando inicialização do Baileys. O QR aparecerá em instantes...");
        pollQrLoop();
      } else {
        toast.error("Evolution não retornou QR Code. Verifique o servidor.");
      }
    } catch (err: any) {
      const msg = err.message || "";
      if (msg.includes("401") || msg.includes("unauthorized")) {
        toast.error("Erro na Evolution API: API Key inválida ou expirada.");
      } else {
        toast.error(`Falha ao conectar: ${msg}`);
      }
      setErrorDetail(msg || "Falha ao conectar.");
      setShowForceBtn(true);
    } finally {
      setConnecting(false);
    }
  };

  // Polling do QR enquanto Baileys inicializa (Evolution v2.2.3)
  // [AUDITORIA] FIX APLICADO: o `catch {}` engolia qualquer erro de pollQr() silenciosamente —
  // agora que o backend propaga erros reais (502/500/offline da Evolution, ver whatsapp.ts
  // /poll-qr), 2 falhas consecutivas encerram o loop e expõem o erro + botão de reconexão
  // forçada, em vez de deixar o spinner girando até o timeout de 90s sem explicação.
  const pollQrLoop = async () => {
    setWaitingQr(true);
    waitingQrRef.current = true;
    setErrorDetail(null);
    setShowForceBtn(false);
    const start = Date.now();
    const TIMEOUT = 90 * 1000; // 90 segundos
    let consecutiveErrors = 0;
    while (Date.now() - start < TIMEOUT && waitingQrRef.current) {
      await new Promise(r => setTimeout(r, 3000));
      try {
        const data = await pollQr();
        consecutiveErrors = 0;
        if (data.state === "open") {
          setWaitingQr(false);
          waitingQrRef.current = false;
          setPollingConnect(false);
          pollingConnectRef.current = false;
          setShowQrModal(false);
          setQrData(null);
          setNewInstanceName("");
          setNewInstancePhone("");
          toast.success("✅ WhatsApp conectado com sucesso!");
          carregar();
          return;
        }
        if (data.state === "unauthorized") {
          setWaitingQr(false);
          waitingQrRef.current = false;
          setShowQrModal(false);
          toast.error("Erro na Evolution: API Key ou Sessão inválida.");
          return;
        }
        if (data.qrCode) {
          setQrData(prev => ({ ...prev, ...data }));
          setWaitingQr(false);
          waitingQrRef.current = false;
          toast.success("QR Code gerado! Escaneie agora.");
          pollUntilConnected(data.instanceName || data.instancia);
          return;
        }
      } catch (err: any) {
        consecutiveErrors++;
        if (consecutiveErrors >= 2) {
          setWaitingQr(false);
          waitingQrRef.current = false;
          setErrorDetail(err?.message || "Erro de conectividade com a Evolution API.");
          setShowForceBtn(true);
          toast.error(err?.message || "Erro ao gerar QR Code.");
          return;
        }
      }
    }
    setWaitingQr(false);
    waitingQrRef.current = false;
    setErrorDetail("A geração do QR Code está demorando mais do que o esperado. A instância pode estar travada internamente na API.");
    setShowForceBtn(true);
    toast.error("Tempo esgotado para gerar QR. Clique em 'Forçar Reinicialização' para tentar novamente.");
  };

  // Deleta fisicamente a instância na Evolution e recria do zero — destrava casos em que o
  // Baileys mantém a instância presa em memória com o socket quebrado (loop de QR sem fim).
  const handleForceReconnect = async () => {
    setConnecting(true);
    setErrorDetail(null);
    setShowForceBtn(false);
    waitingQrRef.current = false;
    pollingConnectRef.current = false;
    setWaitingQr(false);
    setPollingConnect(false);
    try {
      const name = qrData?.instanceName || newInstanceName.trim() || `WhatsApp ${user?.display_name || 'Agente'}`;
      const res = await createInstance(name, undefined, true);
      setQrData(res);
      if (res.state === "open") {
        toast.success("✅ WhatsApp conectado com sucesso!");
        setShowQrModal(false);
        setQrData(null);
        carregar();
      } else if (res.qrCode || res.pairingCode) {
        toast.info("Nova instância criada. Escaneie o QR Code.");
        pollUntilConnected(res.instanceName || res.instancia);
      } else if (res.qrPending) {
        toast.info("Aguardando inicialização do Baileys...");
        pollQrLoop();
      }
    } catch (err: any) {
      setErrorDetail(`Falha na reinicialização forçada: ${err.message}`);
      setShowForceBtn(true);
      toast.error(`Falha na reinicialização forçada: ${err.message}`);
    } finally {
      setConnecting(false);
    }
  };

  const pollUntilConnected = async (instanciaNome?: string) => {
    setPollingConnect(true);
    pollingConnectRef.current = true;
    const start = Date.now();
    const TIMEOUT = 2 * 60 * 1000; // 2 min
    // [AUDITORIA] BUG: targetInstancia era calculado mas nunca usado — fetchConnectionStatus()
    // era chamado sem argumento, checando a instância padrão do usuário em vez da instância que
    // acabou de ser criada/conectada (relevante sobretudo se o usuário tiver mais de uma).
    // [AUDITORIA] FIX APLICADO: passa targetInstancia adiante, agora que evolutionService.ts
    // realmente encaminha esse parâmetro pro backend (fix aplicado no mesmo arquivo desta sessão).
    const targetInstancia = instanciaNome || newInstanceName;
    while (Date.now() - start < TIMEOUT && pollingConnectRef.current && showQrModalRef.current) {
      await new Promise(r => setTimeout(r, 3000));
      try {
        const st = await fetchConnectionStatus(targetInstancia || undefined);
        if (st.state === "open") {
          setPollingConnect(false);
          pollingConnectRef.current = false;
          setShowQrModal(false);
          setQrData(null);
          setNewInstanceName("");
          setNewInstancePhone("");
          toast.success("✅ WhatsApp conectado com sucesso!");
          carregar();
          return;
        }
        if (st.state === "unauthorized") {
          setPollingConnect(false);
          pollingConnectRef.current = false;
          setShowQrModal(false);
          toast.error("Erro na conexão: API Key ou Sessão inválida.");
          return;
        }
        // [AUDITORIA] FIX APLICADO: antes, um erro de conectividade aqui (Evolution offline/502)
        // era engolido pelo catch {} e o usuário ficava vendo "Aguardando você escanear..." até
        // o timeout de 2min estourar em silêncio, sem nunca saber que a Evolution caiu no meio
        // da espera pós-scan do QR.
        if (st.error) {
          setPollingConnect(false);
          pollingConnectRef.current = false;
          setErrorDetail(st.message || "Erro de conectividade com a Evolution API.");
          setShowForceBtn(true);
          toast.error(st.message || "Erro ao confirmar conexão.");
          return;
        }
      } catch {}
    }
    setPollingConnect(false);
  };

  // Gera um QR novo para uma instância já existente (ex: card em "unauthorized"/"close"/
  // "connecting" travado), sem passar pelo formulário "Conectar nova instância" — o backend
  // resolve a instância do usuário sozinho (cfg.stableInstancia), então basta chamar createInstance().
  const handleReconnectExisting = async (a: Agente) => {
    setQrData(null);
    setErrorDetail(null);
    setShowForceBtn(false);
    setNewInstanceName(a.nome);
    setNewInstancePhone("");
    setShowQrModal(true);
    try {
      setConnecting(true);
      const res = await createInstance(a.nome);
      setQrData(res);
      if (res.state === "open") {
        toast.success("✅ WhatsApp conectado com sucesso!");
        setShowQrModal(false);
        setQrData(null);
        carregar();
      } else if (res.qrCode || res.pairingCode) {
        toast.info("Escaneie o QR Code ou use o código de pareamento");
        pollUntilConnected(res.instanceName || res.instancia);
      } else if (res.qrPending) {
        toast.info("Aguardando inicialização do Baileys. O QR aparecerá em instantes...");
        pollQrLoop();
      } else {
        toast.error("Evolution não retornou QR Code. Verifique o servidor.");
      }
    } catch (err: any) {
      const msg = err.message || "";
      toast.error(`Falha ao reconectar: ${msg}`);
      setErrorDetail(msg || "Falha ao reconectar.");
      setShowForceBtn(true);
    } finally {
      setConnecting(false);
    }
  };

  const refreshQr = async () => {
    try {
      setConnecting(true);
      setErrorDetail(null);
      setShowForceBtn(false);
      const data = await pollQr();
      if (data.qrCode) {
        setQrData(prev => ({ ...prev, ...data }));
        toast.success("QR Code atualizado!");
      } else if (data.state === "open") {
        setShowQrModal(false);
        toast.success("✅ WhatsApp já conectado!");
        carregar();
      } else if (data.state === "unauthorized") {
        setShowQrModal(false);
        toast.error("Erro na Evolution: API Key ou Sessão inválida.");
      } else {
        toast.info("QR ainda não disponível, aguarde...");
        pollQrLoop();
      }
    } catch (e: any) {
      setErrorDetail(e.message);
      setShowForceBtn(true);
      toast.error(`Erro: ${e.message}`);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async (a: Agente) => {
    if (!confirm(`Desconectar a instância "${a.nome}"? Você precisará escanear o QR Code novamente para reconectar.`)) return;
    try {
      await disconnectInstance();
      toast.success("Instância desconectada");
      carregar();
    } catch (e: any) {
      toast.error(`Erro ao desconectar: ${e.message}`);
    }
  };

  const [syncing, setSyncing] = useState<string | null>(null);
  const handleSyncHistory = async (a: Agente) => {
    if (!a.evolution_instancia) return;
    if (!confirm(`Importar histórico de mensagens da instância "${a.nome}"? Pode levar alguns segundos.`)) return;
    try {
      setSyncing(a.id);
      const API_BASE = (import.meta.env.VITE_API_URL as string) || "http://localhost:3000";
      const t = getAuthToken();
      const res = await fetch(`${API_BASE}/api/whatsapp/sync-history`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) },
        body: JSON.stringify({ instancia: a.evolution_instancia }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || "Falha ao importar");
      toast.success(`✅ ${json.inseridos} mensagens importadas (${json.chats} chats, ${json.messages} totais)`);
    } catch (e: any) {
      toast.error(`Erro ao importar: ${e.message}`);
    } finally {
      setSyncing(null);
    }
  };

  const handleDeleteInstance = async (a: Agente) => {
    if (!a.evolution_instancia) return;
    if (!confirm(`Excluir definitivamente a instância "${a.evolution_instancia}" da Evolution? Esta ação é irreversível.`)) return;
    try {
      const API_BASE = (import.meta.env.VITE_API_URL as string) || "http://localhost:3000";
      const t = getAuthToken();
      const res = await fetch(`${API_BASE}/api/whatsapp/instances/${encodeURIComponent(a.evolution_instancia)}`, {
        method: "DELETE",
        headers: { ...(t ? { Authorization: `Bearer ${t}` } : {}) },
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.message || "Falha ao excluir");
      }
      toast.success("Instância removida");
      carregar();
    } catch (e: any) {
      toast.error(`Erro ao excluir: ${e.message}`);
    }
  };



  const carregar = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await api
      .from("agentes")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) toast.error(`Erro ao carregar instâncias: ${error.message}`);
    else setAgentes((data ?? []) as Agente[]);
    setLoading(false);

    // profiles (pode falhar se não-admin) — silencioso
    try {
      const { data: pdata } = await api.from("profiles").select("user_id,email,display_name");
      if (pdata) setProfiles(pdata as Profile[]);
    } catch {}
  };

  // [AUDITORIA] BUG: esta função busca o status UMA VEZ (sem instancia — sempre a instância
  // "oficial" do usuário, ver getEvolutionConfig em backend/src/routes/whatsapp.ts) e aplica o
  // MESMO resultado para TODAS as instâncias da lista (`lista.forEach` só copia `state` pra cada
  // `a.id`). Se um usuário tiver mais de um `agente` com `evolution_instancia` preenchida (o
  // painel se chama "InstanceManagementPanel" e renderiza um card com Desconectar/Excluir por
  // instância, sugerindo suporte a múltiplas), qualquer instância que não seja a "oficial" exibe
  // um status que não é o dela de verdade — pode mostrar "Conectado" para uma instância desativada
  // ou vice-versa.
  // [AUDITORIA] FIX PENDENTE (motivo: mudança de comportamento com custo — trocar por N chamadas
  // fetchConnectionStatus(a.evolution_instancia), uma por instância, aumenta chamadas à Evolution
  // API e só faz diferença real se múltiplas instâncias por usuário for um cenário que ainda
  // acontece de verdade hoje, dado que o backend inteiro converge pra "1 conta = 1 instância
  // estável". Próxima sessão: confirmar com o usuário se multi-instância por conta ainda é
  // suportado/esperado; se não for, o comportamento atual é aceitável e vale só um comentário
  // explicando a limitação (já feito aqui); se for, trocar para status por instância.
  const carregarStatus = async (lista: Agente[]) => {
    const map: Record<string, ConnState> = {};

    // Agora o backend resolve a instância oficial automaticamente.
    // Fazemos uma única chamada para pegar o status da conta
    try {
      const st = await fetchConnectionStatus();
      const state = (st.state ?? "close") as ConnState;

      lista.forEach(a => {
        // Mostramos o status real para instâncias que coincidem com a oficial
        // ou um status genérico para outras registradas (legado)
        if (a.evolution_instancia) {
          map[a.id] = state;
        }
      });
    } catch (error) {
      console.error(`[WhatsApp] Erro ao buscar status global:`, error);
    }

    setStatuses(map);
  };

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    if (agentes.length > 0) carregarStatus(agentes);
  }, [agentes]);

  // Auto-refresh de status a cada 30s sem recarregar a página
  useEffect(() => {
    if (agentes.length === 0) return;
    const id = setInterval(() => carregarStatus(agentes), 30_000);
    return () => clearInterval(id);
  }, [agentes]);

  const instancias = useMemo(
    () => agentes.filter(a => !!a.evolution_instancia),
    [agentes]
  );

  const updateScore = async (id: string, mockData?: any) => {
    setCalculating(id);
    try {
      // Em um cenário real, isso seria uma chamada para /api/agentes/:id/score
      // que consultaria o histórico real de disparos, taxas e logs de ban.
      // Aqui simulamos o cálculo baseado nas regras fornecidas.
      
      const data = mockData || {
        volume_diario: Math.floor(Math.random() * 200),
        taxa_resposta: Math.floor(Math.random() * 50),
        reclamacoes: Math.floor(Math.random() * 5),
        tempo_dias: Math.floor(Math.random() * 120),
      };

      let v_score = data.volume_diario < 50 ? 25 : data.volume_diario <= 150 ? 15 : 5;
      let r_score = data.taxa_resposta > 30 ? 25 : data.taxa_resposta >= 10 ? 15 : 5;
      let b_score = data.reclamacoes === 0 ? 25 : data.reclamacoes <= 3 ? 10 : 0;
      let m_score = data.tempo_dias > 90 ? 25 : data.tempo_dias >= 30 ? 15 : 5;

      const total = v_score + r_score + b_score + m_score;
      const fatores: ScoreFatores = {
        volume_diario: v_score,
        taxa_resposta: r_score,
        reclamacoes: b_score,
        tempo_conta: m_score
      };

      const { error } = await api.from("agentes").update({
        whatsapp_score: total,
        score_fatores: fatores,
        score_updated_at: new Date().toISOString()
      }).eq("id", id);

      if (error) throw error;
      toast.success("Score atualizado com sucesso");
      carregar();
    } catch (err: any) {
      toast.error(`Falha ao calcular score: ${err.message}`);
    } finally {
      setCalculating(null);
    }
  };

  const handleSave = async () => {

    if (!editing) return;
    setSaving(true);
    const payload = {
      nome: editing.nome,
      fallback_owner: editing.fallback_owner,
      filial: editing.filial,
      reject_calls: editing.reject_calls,
      ignore_groups: editing.ignore_groups,
      auto_read: editing.auto_read,
      show_signature: editing.show_signature,
      operation_mode: editing.operation_mode,
      auto_distribute: editing.auto_distribute,
      linked_agent_id: editing.linked_agent_id,
    };
    const { error } = await api.from("agentes").update(payload).eq("id", editing.id);
    setSaving(false);
    if (error) {
      toast.error(`Erro ao salvar: ${error.message}`);
      return;
    }
    toast.success("Configurações salvas");
    setEditing(null);
    carregar();
  };

  return (
    <TooltipProvider>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold tracking-tight">Instâncias WhatsApp</h2>
            <p className="text-sm text-muted-foreground">
              Gerencie o comportamento, automação e saúde de cada número conectado.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={carregar}>
              <RefreshCw className="h-4 w-4 mr-2" /> Atualizar
            </Button>
            <Button size="sm" onClick={() => setShowConnectModal(true)} className="bg-green-600 hover:bg-green-700 text-white">
              <Plus className="h-4 w-4 mr-2" /> Conectar nova
            </Button>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando instâncias...
          </div>
        )}

        {!loading && instancias.length === 0 && (
          <Card className="p-10 text-center border-dashed">
            <Smartphone className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <h3 className="text-base font-bold mb-1">Nenhuma instância conectada</h3>
            <p className="text-sm text-muted-foreground mb-5">
              Conecte um número de WhatsApp para começar a receber e enviar mensagens.
            </p>
            <Button onClick={() => setShowConnectModal(true)} className="bg-green-600 hover:bg-green-700 text-white">
              <Plus className="h-4 w-4 mr-2" /> Conectar primeiro WhatsApp
            </Button>
          </Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {instancias.map(a => {
            const score = a.whatsapp_score ?? 100;
            const fatores = a.score_fatores || { volume_diario: 25, taxa_resposta: 25, reclamacoes: 25, tempo_conta: 25 };
            const state: ConnState = statuses[a.id] ?? "close";
            const isCritical = score < 40;

            return (
              <Card key={a.id} className={`p-5 space-y-4 hover:shadow-lg transition-all border-2 ${isCritical ? 'border-red-500/50 bg-red-50/30' : 'border-transparent'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                        <Smartphone className="h-4 w-4 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-bold truncate">{a.nome}</h3>
                        <p className="text-[10px] font-mono text-muted-foreground truncate">
                          {a.evolution_instancia}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => updateScore(a.id)}
                      disabled={calculating === a.id}
                      title="Recalcular score"
                    >
                      <RefreshCw className={`h-3 w-3 ${calculating === a.id ? 'animate-spin' : ''}`} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => setEditing(a)}
                      title="Configurar instância"
                    >
                      <Settings2 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => handleSyncHistory(a)}
                      disabled={syncing === a.id}
                      title="Importar histórico de mensagens"
                    >
                      {syncing === a.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-red-500 hover:text-red-600 hover:bg-red-500/10"
                      onClick={() => handleDisconnect(a)}
                      title="Desconectar instância"
                    >
                      <Power className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-red-500 hover:text-red-600 hover:bg-red-500/10"
                      onClick={() => handleDeleteInstance(a)}
                      title="Excluir instância da Evolution"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <StatusChip state={state} />

                  {state === "unauthorized" && (
                    <Button
                      size="sm"
                      onClick={() => handleReconnectExisting(a)}
                      className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold gap-2 animate-bounce"
                    >
                      <QrCode className="h-4 w-4" />
                      Reconectar Agora
                    </Button>
                  )}

                  {(state === "close" || state === "connecting") && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleReconnectExisting(a)}
                      className="w-full gap-2"
                    >
                      <QrCode className="h-4 w-4" />
                      Gerar novo QR Code
                    </Button>
                  )}
                </div>

                {isCritical && (
                  <div className="flex items-center gap-2 p-2 bg-red-500 text-white rounded-md text-[11px] font-bold animate-pulse">
                    <AlertOctagon className="h-3 w-3" />
                    Score crítico — disparos pausados automaticamente
                  </div>
                )}

                <ScoreInstancia 
                  score={score} 
                  fatores={fatores} 
                />

                <div className="flex flex-wrap gap-1.5 pt-1">
                  {a.operation_mode && (
                    <Badge variant="secondary" className="text-[10px]">
                      {a.operation_mode === "manual" && "Manual"}
                      {a.operation_mode === "chatbot" && "Chatbot"}
                      {a.operation_mode === "agente_ia" && "Agente IA"}
                    </Badge>
                  )}
                  {a.auto_distribute && (
                    <Badge variant="outline" className="text-[10px]">Roleta</Badge>
                  )}
                  {a.filial && (
                    <Badge variant="outline" className="text-[10px]">{a.filial}</Badge>
                  )}
                </div>
                
                <Button 
                  className="w-full h-8 text-xs" 
                  variant={isCritical ? "secondary" : "default"}
                  disabled={isCritical}
                >
                  {isCritical ? "Disparos Desabilitados" : "Novo Disparo"}
                </Button>
              </Card>
            );
          })}
        </div>


        {/* Modal de configuração */}
        <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent className="sm:max-w-[560px]">
            <DialogHeader>
              <DialogTitle>Configurar Instância</DialogTitle>
              <DialogDescription>
                Ajuste comportamento e automação do número conectado.
              </DialogDescription>
            </DialogHeader>

            {editing && (
              <Tabs defaultValue="geral" className="w-full">
                <TabsList className="grid grid-cols-3 w-full">
                  <TabsTrigger value="geral">Geral</TabsTrigger>
                  <TabsTrigger value="comportamento">Comportamento</TabsTrigger>
                  <TabsTrigger value="automacao">Automação</TabsTrigger>
                </TabsList>

                {/* GERAL */}
                <TabsContent value="geral" className="space-y-4 pt-4">
                  <div className="space-y-1.5">
                    <Label>Nome de identificação</Label>
                    <Input
                      value={editing.nome ?? ""}
                      onChange={(e) => setEditing({ ...editing, nome: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Proprietário fallback</Label>
                    <p className="text-[11px] text-muted-foreground">
                      Recebe chats caso a distribuição automática falhe.
                    </p>
                    {profiles.length > 0 ? (
                      <Select
                        value={editing.fallback_owner ?? ""}
                        onValueChange={(v) => setEditing({ ...editing, fallback_owner: v })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione um usuário" />
                        </SelectTrigger>
                        <SelectContent>
                          {profiles.map(p => (
                            <SelectItem key={p.user_id} value={p.user_id}>
                              {p.display_name || p.email}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        placeholder="user_id ou email"
                        value={editing.fallback_owner ?? ""}
                        onChange={(e) => setEditing({ ...editing, fallback_owner: e.target.value })}
                      />
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label>Filial</Label>
                    <Input
                      placeholder="Ex: Matriz SP"
                      value={editing.filial ?? ""}
                      onChange={(e) => setEditing({ ...editing, filial: e.target.value })}
                    />
                  </div>
                </TabsContent>

                {/* COMPORTAMENTO */}
                <TabsContent value="comportamento" className="space-y-3 pt-4">
                  {[
                    { key: "reject_calls", label: "Rejeitar Chamadas", desc: "Recusa automaticamente ligações recebidas." },
                    { key: "ignore_groups", label: "Ignorar Grupos", desc: "Não processa mensagens vindas de grupos." },
                    { key: "auto_read", label: "Marcar como Lida Automaticamente", desc: "Confirmação azul ao receber." },
                    { key: "show_signature", label: "Exibir Nome do Agente (Assinatura)", desc: "Prefixa cada mensagem com o nome do atendente." },
                  ].map(({ key, label, desc }) => (
                    <div key={key} className="flex items-center justify-between gap-4 p-3 rounded-lg border bg-card/40">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{label}</p>
                        <p className="text-[11px] text-muted-foreground">{desc}</p>
                      </div>
                      <Switch
                        checked={!!(editing as any)[key]}
                        onCheckedChange={(v) => setEditing({ ...editing, [key]: v } as Agente)}
                      />
                    </div>
                  ))}
                </TabsContent>

                {/* AUTOMAÇÃO */}
                <TabsContent value="automacao" className="space-y-4 pt-4">
                  <div className="space-y-1.5">
                    <Label>Modo de Operação</Label>
                    <Select
                      value={editing.operation_mode ?? "manual"}
                      onValueChange={(v) => setEditing({ ...editing, operation_mode: v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="manual">Manual — atendimento humano puro</SelectItem>
                        <SelectItem value="chatbot">Chatbot (Fluxo) — bot configurável</SelectItem>
                        <SelectItem value="agente_ia">Agente IA — agente de IA do CRM</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {editing.operation_mode === "agente_ia" && (
                    <div className="space-y-1.5">
                      <Label>Agente IA vinculado</Label>
                      <Select
                        value={editing.linked_agent_id ?? ""}
                        onValueChange={(v) => setEditing({ ...editing, linked_agent_id: v })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione um agente" />
                        </SelectTrigger>
                        <SelectContent>
                          {agentes.map(a => (
                            <SelectItem key={a.id} value={a.id}>{a.nome}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-4 p-3 rounded-lg border bg-card/40">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">Distribuição Automática (Roleta)</p>
                      <p className="text-[11px] text-muted-foreground">
                        Distribui novos chats entre a equipe em round-robin.
                      </p>
                    </div>
                    <Switch
                      checked={!!editing.auto_distribute}
                      onCheckedChange={(v) => setEditing({ ...editing, auto_distribute: v })}
                    />
                  </div>
                </TabsContent>
              </Tabs>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>
                Cancelar
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Salvar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ─── Modal: Conectar nova instância ─── */}
        <Dialog open={showConnectModal} onOpenChange={setShowConnectModal}>
          <DialogContent className="sm:max-w-[480px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Smartphone className="h-5 w-5 text-green-600" />
                Conectar nova instância WhatsApp
              </DialogTitle>
              <DialogDescription>
                Dê um nome para identificar este número. Opcionalmente informe o telefone para receber código de pareamento.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>Nome da instância <span className="text-red-500">*</span></Label>
                <Input
                  placeholder="Ex: Vendas Matriz, Suporte SP..."
                  value={newInstanceName}
                  onChange={(e) => setNewInstanceName(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label>Telefone (opcional)</Label>
                <Input
                  placeholder="Ex: 5511999999999 (com DDI+DDD)"
                  value={newInstancePhone}
                  onChange={(e) => setNewInstancePhone(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Se informar, você pode conectar por código de pareamento em vez do QR Code.
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowConnectModal(false)} disabled={connecting}>
                Cancelar
              </Button>
              <Button
                onClick={startConnect}
                disabled={connecting || !newInstanceName.trim()}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                {connecting ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Gerando...</>
                ) : (
                  <><QrCode className="h-4 w-4 mr-2" /> Gerar QR Code</>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ─── Modal: QR Code + Pareamento ─── */}
        <Dialog
          open={showQrModal}
          onOpenChange={(o) => {
            setShowQrModal(o);
            if (!o) {
              setQrData(null);
              setPollingConnect(false);
              pollingConnectRef.current = false;
              setWaitingQr(false);
              waitingQrRef.current = false;
              setErrorDetail(null);
              setShowForceBtn(false);
              carregar();
            }
          }}
        >
          <DialogContent className="sm:max-w-[460px]">
            <DialogHeader>
              <DialogTitle>
                Conectar: <span className="text-foreground">{qrData?.instanceName || newInstanceName}</span>
              </DialogTitle>
              <DialogDescription>
                Escaneie o QR Code abaixo no seu WhatsApp para conectar este número.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {qrData?.pairingCode && (
                <div className="rounded-xl border bg-card p-4 space-y-2">
                  <p className="text-sm font-bold flex items-center gap-2">
                    <Smartphone className="h-4 w-4 text-orange-500" />
                    Código de Pareamento
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    WhatsApp → Aparelhos Conectados → Conectar com número de telefone
                  </p>
                  <div className="border border-dashed rounded-lg py-3 px-4 text-center bg-muted/20">
                    <p
                      className="text-lg font-mono font-bold tracking-[0.35em] cursor-pointer hover:text-primary"
                      onClick={() => {
                        navigator.clipboard.writeText(qrData.pairingCode!.replace(/\s/g, ""));
                        toast.success("Código copiado!");
                      }}
                    >
                      {qrData.pairingCode}
                    </p>
                  </div>
                </div>
              )}

              <div className="rounded-xl border bg-card p-4 space-y-3">
                <p className="text-sm font-bold text-center flex items-center justify-center gap-2">
                  <QrCode className="h-4 w-4 text-green-600" /> QR Code
                </p>
                <div className="flex justify-center">
                  {qrData?.qrCode?.startsWith("data:image") ? (
                    <img src={qrData.qrCode} alt="QR Code" className="w-56 h-56" />
                  ) : (
                    <div className="w-56 h-56 flex flex-col items-center justify-center gap-3 bg-muted/20 rounded-lg">
                      <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
                      <span className="text-xs text-muted-foreground text-center px-4">
                        {waitingQr ? "Inicializando WhatsApp...\nAguarde alguns segundos" : "Carregando QR Code..."}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {pollingConnect && !waitingQr && (
                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground bg-muted/30 rounded-lg p-3">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Aguardando você escanear o código...
                </div>
              )}

              {waitingQr && (
                <div className="flex items-center justify-center gap-2 text-sm text-orange-600 bg-orange-500/10 rounded-lg p-3">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Aguardando WhatsApp inicializar... (pode levar até 30s)
                </div>
              )}

              {errorDetail && (
                <div
                  role="alert"
                  className="p-3 text-sm rounded-lg bg-red-50 border border-red-200 text-red-700 dark:bg-red-950/30 dark:border-red-900 dark:text-red-400"
                >
                  <p className="font-semibold flex items-center gap-1.5">
                    <AlertOctagon className="h-3.5 w-3.5" /> Erro de conectividade
                  </p>
                  <p className="mt-1 text-xs opacity-90">{errorDetail}</p>
                </div>
              )}

              {showForceBtn && (
                <Button
                  onClick={handleForceReconnect}
                  disabled={connecting}
                  className="w-full bg-amber-600 hover:bg-amber-700 text-white gap-2"
                >
                  {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Forçar Reinicialização do QR Code
                </Button>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowQrModal(false)}>
                Fechar
              </Button>
              <Button onClick={refreshQr} disabled={connecting} className="bg-orange-500 hover:bg-orange-600 text-white">
                {connecting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                Atualizar QR
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/*
          [AUDITORIA] FIX APLICADO: removido o segundo Dialog "Conectar Novo WhatsApp" que existia
          aqui (mesmo estado showConnectModal do "Conectar nova instância WhatsApp" ~linha 824 —
          os dois abriam juntos). Era um subconjunto funcional do que ficou (mesmos dois campos,
          mesmo startConnect), confirmado sem uso próprio antes da remoção.
        */}
      </div>
    </TooltipProvider>
  );
}
