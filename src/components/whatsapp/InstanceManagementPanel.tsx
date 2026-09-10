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
import { formatPhoneDisplay } from "@/lib/utils";
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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
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
  Pencil,
  Check,
  X,
  Phone,
} from "lucide-react";
import { toast } from "sonner";
import { ScoreInstancia } from "./ScoreInstancia";
import {
  createInstance,
  fetchConnectionStatus,
  disconnectInstance,
  pollQr,
  LogoutLoopError,
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
  user_id: string;
  nome: string;
  evolution_instancia: string | null;
  whatsapp_score: number | null;
  score_fatores: ScoreFatores | null;
  // [AUDITORIA] LÓGICA (Sprint Score Real + Maturador, 2026-08-09): `null` = nunca calculado de
  // verdade (cron de 15min ainda não passou por esta instância) — usado pra distinguir "sem dado
  // real ainda" de "score baixo calculado de verdade", em vez do fallback antigo (`?? 100`) que
  // mascarava os dois casos como "Saudável".
  score_updated_at: string | null;
  created_at: string;
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
  const [phoneNumbers, setPhoneNumbers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Agente | null>(null);
  const [saving, setSaving] = useState(false);
  const [calculating, setCalculating] = useState<string | null>(null);

  // ─── Renomear instância (inline, sem abrir a modal de configuração inteira) ───
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);

  const startRename = (a: Agente) => {
    setRenamingId(a.id);
    setRenameValue(a.nome);
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameValue("");
  };

  const confirmRename = async (a: Agente) => {
    const novoNome = renameValue.trim();
    if (!novoNome || novoNome === a.nome) {
      cancelRename();
      return;
    }
    setRenameSaving(true);
    try {
      const { error } = await api.from("agentes").update({ nome: novoNome }).eq("id", a.id);
      if (error) throw error;
      toast.success("Instância renomeada");
      cancelRename();
      carregar();
    } catch (e: any) {
      toast.error(`Erro ao renomear: ${e.message}`);
    } finally {
      setRenameSaving(false);
    }
  };

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
  // [AUDITORIA] LÓGICA (Sprint Circuit-Breaker LOGOUT, 2026-08-10): estado do cooldown quando o
  // backend recusa reconectar (`LogoutLoopError`) — `until` é o epoch ms em que o backend
  // considera a janela liberada; `cooldownSecondsLeft` só existe pra render (contagem regressiva
  // visível), recalculado a cada segundo a partir de `until`, nunca decidido localmente. Se a
  // aba ficar aberta além do cooldown, o próximo clique bate o backend de novo — que é quem
  // continua sendo a fonte real da regra (o timer local é só UX, não segurança).
  const [forceReconnectCooldown, setForceReconnectCooldown] = useState<{ until: number; total: number } | null>(null);
  const [cooldownSecondsLeft, setCooldownSecondsLeft] = useState(0);
  const [showForceConfirm, setShowForceConfirm] = useState(false);

  useEffect(() => {
    if (!forceReconnectCooldown) { setCooldownSecondsLeft(0); return; }
    const tick = () => {
      const left = Math.max(0, Math.ceil((forceReconnectCooldown.until - Date.now()) / 1000));
      setCooldownSecondsLeft(left);
      if (left <= 0) setForceReconnectCooldown(null);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [forceReconnectCooldown]);

  // [AUDITORIA] LÓGICA: handler comum pros 3 pontos que chamam createInstance() (Conectar nova
  // instância, Reconectar existente, Forçar Reinicialização) — trata especificamente o bloqueio
  // do circuit-breaker (mensagem + cooldown visível), devolve `true` quando tratou, pra quem
  // chamou decidir se ainda precisa do fallback de erro genérico.
  const tratarErroDeConexao = (err: any): boolean => {
    if (err instanceof LogoutLoopError) {
      setForceReconnectCooldown({ until: Date.now() + err.minutosRestantes * 60_000, total: err.totalRecente });
      setErrorDetail(err.message);
      toast.error(err.message, { duration: 8000 });
      return true;
    }
    return false;
  };
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

      // [AUDITORIA] LÓGICA (Sprint 2 — multi-instância): novaConexao:true sempre — se for a
      // primeira instância do tenant, o backend resolve pro nome padrão do mesmo jeito de
      // antes; se já existir uma, calcula a próxima livre (_2, _3...) em vez de reaproveitar a
      // existente (era isso que causava "WhatsApp já conectado" ao tentar somar um segundo
      // número — ver diagnosticos/AUDITORIA_LOG.md).
      const res = await createInstance({ instanceName: name, phoneNumber: phoneDigits || undefined, novaConexao: true });

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
        pollQrLoop(res.instancia || res.instanceName);
      } else {
        toast.error("Evolution não retornou QR Code. Verifique o servidor.");
      }
    } catch (err: any) {
      if (tratarErroDeConexao(err)) return;
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
  const pollQrLoop = async (instancia?: string) => {
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
        const data = await pollQr(instancia);
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

  // [AUDITORIA] FIX APLICADO (Sprint Circuit-Breaker LOGOUT, 2026-08-10): o botão não chama mais
  // a reinicialização direto — abre um diálogo de confirmação explicando o risco real primeiro
  // (achado do incidente: o botão aparecia sozinho depois de um erro/timeout, convidando a
  // clicar de novo sem fricção nenhuma, e cada clique é literalmente um pareamento de aparelho
  // novo pro WhatsApp). A ação de fato fica em `executeForceReconnect`, só chamada após confirmar.
  const handleForceReconnect = () => setShowForceConfirm(true);

  // Deleta fisicamente a instância na Evolution e recria do zero — destrava casos em que o
  // Baileys mantém a instância presa em memória com o socket quebrado (loop de QR sem fim).
  const executeForceReconnect = async () => {
    setShowForceConfirm(false);
    setConnecting(true);
    setErrorDetail(null);
    setShowForceBtn(false);
    waitingQrRef.current = false;
    pollingConnectRef.current = false;
    setWaitingQr(false);
    setPollingConnect(false);
    try {
      const name = qrData?.instanceName || newInstanceName.trim() || `WhatsApp ${user?.display_name || 'Agente'}`;
      // [AUDITORIA] FIX APLICADO (Sprint 2 — multi-instância): sem `instancia` explícito, forçar
      // reconexão sempre mexia na instância PADRÃO do tenant — se o card travado fosse uma
      // instância adicional (_2, _3...), o force-reconnect recriava a instância errada.
      const res = await createInstance({ instanceName: name, forceReconnect: true, instancia: qrData?.instancia || qrData?.instanceName });
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
        pollQrLoop(res.instancia || res.instanceName);
      }
    } catch (err: any) {
      if (tratarErroDeConexao(err)) { setShowForceBtn(true); return; }
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
  // "connecting" travado), sem passar pelo formulário "Conectar nova instância".
  // [AUDITORIA] FIX APLICADO (Sprint 2 — multi-instância): antes chamava createInstance(a.nome)
  // sem instancia — com mais de um card na tela, "Reconectar" em qualquer um sempre mexia na
  // instância PADRÃO do tenant, nunca na instância daquele card específico. Agora manda
  // `a.evolution_instancia` explicitamente.
  const handleReconnectExisting = async (a: Agente) => {
    setQrData(null);
    setErrorDetail(null);
    setShowForceBtn(false);
    setNewInstanceName(a.nome);
    setNewInstancePhone("");
    setShowQrModal(true);
    try {
      setConnecting(true);
      const res = await createInstance({ instanceName: a.nome, instancia: a.evolution_instancia || undefined });
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
        pollQrLoop(res.instancia || res.instanceName);
      } else {
        toast.error("Evolution não retornou QR Code. Verifique o servidor.");
      }
    } catch (err: any) {
      if (tratarErroDeConexao(err)) return;
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
      // [AUDITORIA] FIX APLICADO (Sprint 2 — multi-instância): sem instancia, atualizava o QR
      // da instância padrão em vez da que está de fato aberta no modal.
      const data = await pollQr(qrData?.instancia || qrData?.instanceName);
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
        pollQrLoop(qrData?.instancia || qrData?.instanceName);
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
      // [AUDITORIA] FIX APLICADO (Sprint 2 — multi-instância): sem instancia, desconectava
      // sempre a instância padrão do tenant, nunca o card em que o botão foi clicado.
      await disconnectInstance(a.evolution_instancia || undefined);
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
      toast.success("Instância removida (histórico de mensagens preservado)");
      carregar();
    } catch (e: any) {
      toast.error(`Erro ao excluir: ${e.message}`);
    }
  };

  // Apagar mensagens é a ÚNICA forma de remover histórico — ação deliberada do usuário.
  // Deletar/desconectar instância nunca mais apaga mensagens (fix backend 2026-09-09).
  const [apagandoMsgs, setApagandoMsgs] = useState(false);
  const handleDeleteMessages = async (inst: string) => {
    const txt = window.prompt(
      `Isso vai apagar TODO o histórico de mensagens da instância "${inst}".\n` +
      `Ação irreversível (as mensagens somem da tela e são expurgadas em 90 dias).\n\n` +
      `Digite APAGAR para confirmar:`,
    );
    if (txt?.trim().toUpperCase() !== "APAGAR") return;
    setApagandoMsgs(true);
    try {
      const API_BASE = (import.meta.env.VITE_API_URL as string) || "http://localhost:3000";
      const t = getAuthToken();
      const res = await fetch(`${API_BASE}/api/whatsapp/instances/${encodeURIComponent(inst)}/mensagens`, {
        method: "DELETE",
        headers: { ...(t ? { Authorization: `Bearer ${t}` } : {}) },
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.message || "Falha ao apagar mensagens");
      toast.success(`${j.apagadas ?? 0} mensagem(ns) apagada(s)`);
    } catch (e: any) {
      toast.error(`Erro ao apagar mensagens: ${e.message}`);
    } finally {
      setApagandoMsgs(false);
    }
  };



  const carregar = async () => {
    if (!user) return;
    setLoading(true);
    // [AUDITORIA] FIX APLICADO (2026-07-22): o .eq("user_id", user.id) abaixo é um no-op --
    // src/integrations/database/client.ts:316 descarta silenciosamente qualquer filtro de
    // user_id antes de montar a requisição (o escopo normal vem do backend, por JWT). Isso é
    // correto pra usuário comum, mas backend/src/crud.ts (makeCrud) tem um bypass explícito
    // pra admin ("admin vê/edita tudo"), então uma conta admin via este painel recebia os
    // `agentes` de TODOS os usuários misturados, sem indicação de dono -- painel de "minha
    // conexão" virava um Frankenstein de instâncias de outros tenants. É plausível que essa
    // mistura tenha sido a causa raiz do incidente real desta sessão (admin excluiu a
    // instância de outro cliente sem perceber, ver diagnosticos/AUDITORIA_LOG.md). Filtro
    // aplicado aqui no cliente, isolado a este painel -- não mexe no client.ts nem no crud.ts
    // compartilhados, que outras telas administrativas legitimamente dependem do bypass.
    const { data, error } = await api
      .from("agentes")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) toast.error(`Erro ao carregar instâncias: ${error.message}`);
    else setAgentes(((data ?? []) as Agente[]).filter(a => a.user_id === user.id));
    setLoading(false);

    // profiles (pode falhar se não-admin) — silencioso
    try {
      const { data: pdata } = await api.from("profiles").select("user_id,email,display_name");
      if (pdata) setProfiles(pdata as Profile[]);
    } catch {}
  };

  // [AUDITORIA] FIX APLICADO (Sprint 2 — multi-instância, 2026-07-23): antes buscava o status
  // UMA VEZ (sem instancia — sempre a instância "padrão" do tenant) e aplicava o MESMO
  // resultado pra todos os cards, então qualquer instância adicional (_2, _3...) exibia um
  // status que não era o dela de verdade. Agora com multi-instância implementada (ver
  // diagnosticos/AUDITORIA_LOG.md, Sprint 1/2), cada card busca o próprio status, em paralelo.
  const carregarStatus = async (lista: Agente[]) => {
    const map: Record<string, ConnState> = {};
    const phones: Record<string, string> = {};
    await Promise.all(lista.map(async (a) => {
      if (!a.evolution_instancia) return;
      try {
        const st = await fetchConnectionStatus(a.evolution_instancia);
        map[a.id] = (st.state ?? "close") as ConnState;
        if (st.phoneNumber) phones[a.id] = st.phoneNumber;
      } catch (error) {
        console.error(`[WhatsApp] Erro ao buscar status de ${a.evolution_instancia}:`, error);
      }
    }));
    setStatuses(map);
    setPhoneNumbers(phones);
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

  // [AUDITORIA] BUG GRAVE CORRIGIDO (Sprint Score Real + Maturador, 2026-08-09): achado real do
  // usuário — 2 números banidos na mesma semana, "Score de Saúde" mostrando 100/100 "Saudável"
  // nos dois. Causa raiz confirmada por leitura do código: esta função nunca calculou nada real —
  // `Math.random()` pra volume/taxa/reclamações/tempo, só rodava com clique manual, e o fallback
  // de exibição sem cálculo nenhum era `whatsapp_score ?? 100`. [AUDITORIA] FIX APLICADO: chama o
  // backend de verdade (`POST /api/instancias/:id/score`, `backend/src/services/instanceScore.ts`)
  // que consulta `whatsapp_messages`/`disparo_logs`/`disparo_optouts` reais — mesma função usada
  // pelo cron de 15min que agora recalcula automaticamente todas as instâncias conectadas (este
  // botão só força um recálculo imediato, pra quem acabou de mudar algo e não quer esperar).
  const updateScore = async (id: string) => {
    setCalculating(id);
    try {
      const API_BASE = (import.meta.env.VITE_API_URL as string) || "http://localhost:3000";
      const t = getAuthToken();
      const res = await fetch(`${API_BASE}/api/instancias/${id}/score`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || "Falha ao calcular score");
      toast.success(`Score recalculado: ${json.total}/100`);
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
            // [AUDITORIA] FIX APLICADO (Sprint Score Real + Maturador, 2026-08-09): `?? 100` era a
            // causa raiz do achado do usuário — sem NENHUM cálculo real, o fallback mostrava
            // "Saudável" pra qualquer instância nunca avaliada (inclusive uma já banida). Agora
            // `naoCalculado` é tratado como estado PRÓPRIO (nem "saudável" nem "crítico" — ver
            // `ScoreInstancia.tsx`), e `score`/`fatores` só são realmente exibidos quando existe
            // dado de verdade (`score_updated_at` preenchido pelo cálculo real, cron ou botão).
            const naoCalculado = !a.score_updated_at;
            const score = a.whatsapp_score ?? 0;
            const fatores = a.score_fatores || { volume_diario: 0, taxa_resposta: 0, reclamacoes: 0, tempo_conta: 0 };
            const state: ConnState = statuses[a.id] ?? "close";
            // Override crítico do achado original: desconectada/banida nunca é "saudável",
            // independente do score calculado (pode estar desatualizado em até 15min) — mesmo
            // raciocínio se aplica ao badge "Score crítico"/botão "Novo Disparo" abaixo, não só
            // ao componente ScoreInstancia.
            const desconectada = state !== "open";
            const isCritical = desconectada || (!naoCalculado && score < 40);

            return (
              <Card key={a.id} className={`p-5 space-y-4 hover:shadow-lg transition-all border-2 ${isCritical ? 'border-red-500/50 bg-red-50/30' : 'border-transparent'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                        <Smartphone className="h-4 w-4 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        {renamingId === a.id ? (
                          <div className="flex items-center gap-1">
                            <Input
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") confirmRename(a);
                                if (e.key === "Escape") cancelRename();
                              }}
                              disabled={renameSaving}
                              autoFocus
                              className="h-7 text-sm"
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 shrink-0 text-emerald-600"
                              onClick={() => confirmRename(a)}
                              disabled={renameSaving}
                              title="Salvar nome"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 shrink-0"
                              onClick={cancelRename}
                              disabled={renameSaving}
                              title="Cancelar"
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 group/name">
                            <h3 className="font-bold truncate">{a.nome}</h3>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 shrink-0 opacity-0 group-hover/name:opacity-100"
                              onClick={() => startRename(a)}
                              title="Renomear instância"
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                          </div>
                        )}
                        <p className="text-[10px] font-mono text-muted-foreground truncate">
                          {a.evolution_instancia}
                        </p>
                        {phoneNumbers[a.id] && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                            <Phone className="h-3 w-3" /> {formatPhoneDisplay(phoneNumbers[a.id]) || phoneNumbers[a.id]}
                          </p>
                        )}
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

                {/* [AUDITORIA] LÓGICA (Sprint Score Real + Maturador, 2026-08-09): texto
                    diferenciado — "desconectada" e "score crítico" são achados diferentes, não
                    faz sentido usar a mesma frase pros dois. Nenhum dos dois casos realmente
                    PAUSA disparos automaticamente no backend hoje (achado lateral, fora do escopo
                    desta sprint — só o botão "Novo Disparo" fica desabilitado NESTA tela; ver
                    diagnosticos/AUDITORIA_LOG.md pro registro completo). */}
                {isCritical && (
                  <div className="flex items-center gap-2 p-2 bg-red-500 text-white rounded-md text-[11px] font-bold animate-pulse">
                    <AlertOctagon className="h-3 w-3" />
                    {desconectada ? "Desconectada — não deve receber disparos" : "Score crítico — evite disparar por este número"}
                  </div>
                )}

                <ScoreInstancia
                  score={score}
                  fatores={fatores}
                  desconectado={desconectada}
                  naoCalculado={naoCalculado}
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


        {/* Painel lateral de configuração */}
        <Sheet open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
          <SheetContent
            side="right"
            onInteractOutside={(e) => e.preventDefault()}
            className="w-full sm:max-w-xl flex flex-col gap-0 p-0"
          >
            <SheetHeader className="border-b p-6 pb-4 text-left">
              <SheetTitle>Configurar Instância</SheetTitle>
              <SheetDescription>
                Ajuste comportamento e automação do número conectado.
              </SheetDescription>
            </SheetHeader>

            {editing && (
              <div className="flex-1 overflow-y-auto p-6">
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

                  {/* Zona de perigo — apagar mensagens é ação deliberada e separada */}
                  <div className="mt-2 rounded-lg border border-destructive/30 bg-destructive/[0.04] p-3">
                    <p className="text-sm font-medium text-destructive">Apagar histórico de mensagens</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Remove todas as mensagens desta instância da tela (expurgo definitivo em 90 dias).
                      Excluir ou desconectar a instância <strong>não</strong> apaga o histórico — só este botão.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      disabled={apagandoMsgs || !editing.evolution_instancia}
                      onClick={() => editing.evolution_instancia && handleDeleteMessages(editing.evolution_instancia)}
                    >
                      {apagandoMsgs && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                      Apagar mensagens desta instância
                    </Button>
                  </div>
                </TabsContent>
              </Tabs>
              </div>
            )}

            <SheetFooter className="border-t bg-muted/30 p-6 pt-4 !flex-row !justify-end !space-x-2">
              <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>
                Cancelar
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Salvar
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>

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
                <div className="space-y-1.5">
                  <Button
                    onClick={handleForceReconnect}
                    disabled={connecting || cooldownSecondsLeft > 0}
                    className="w-full bg-amber-600 hover:bg-amber-700 text-white gap-2"
                  >
                    {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    {cooldownSecondsLeft > 0
                      ? `Aguarde ${Math.floor(cooldownSecondsLeft / 60)}:${String(cooldownSecondsLeft % 60).padStart(2, "0")}`
                      : "Forçar Reinicialização do QR Code"}
                  </Button>
                  {cooldownSecondsLeft > 0 && (
                    <p className="text-[11px] text-amber-600 text-center">
                      {forceReconnectCooldown?.total} desconexões seguidas detectadas — bloqueado temporariamente pra não arriscar banir o número.
                    </p>
                  )}
                </div>
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

        {/* [AUDITORIA] LÓGICA (Sprint Circuit-Breaker LOGOUT, 2026-08-10): fricção real antes de
            "Forçar Reinicialização" — achado do incidente Serenovlogs067 (e um segundo usuário
            banido no mesmo dia) é que o botão convidava a clicar de novo sem nenhum aviso do
            risco real. Diálogo explícito, sem atalho — confirmar tem que ser uma ação de
            propósito, não um segundo clique reflexo. */}
        <Dialog open={showForceConfirm} onOpenChange={setShowForceConfirm}>
          <DialogContent className="sm:max-w-[440px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-amber-600">
                <AlertOctagon className="h-5 w-5" />
                Forçar reinicialização?
              </DialogTitle>
              <DialogDescription className="pt-2 text-sm text-foreground/90 leading-relaxed">
                Cada reinicialização forçada apaga a sessão atual e cria um <strong>pareamento de aparelho novo</strong> pro WhatsApp — como se você tivesse escaneado o QR Code do zero num celular diferente.
                <br /><br />
                Repetir isso várias vezes seguidas é exatamente o padrão que já derrubou e chegou a banir números reais desta conta. Só use se o QR realmente estiver travado — não como primeira tentativa.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowForceConfirm(false)}>
                Cancelar
              </Button>
              <Button onClick={executeForceReconnect} className="bg-amber-600 hover:bg-amber-700 text-white">
                Sim, forçar reinicialização
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
