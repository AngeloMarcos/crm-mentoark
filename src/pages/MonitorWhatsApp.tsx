/**
 * MonitorWhatsApp.tsx — Página "Monitor WhatsApp ao Vivo" (visão read-only de todas as
 * conversas, pensada para supervisão/operação). Mostra status geral do sistema (WhatsApp/IA/
 * agente/prompt configurados), lista de conversas com filtros/ordenação, e um painel lateral
 * (Sheet) com as últimas mensagens de uma conversa selecionada.
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { CRMLayout } from "@/components/CRMLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  MessageCircle,
  RefreshCw,
  Search,
  Clock,
  Bot,
  Pause,
  User,
  Zap,
  ArrowRight,
  Filter,
  ArrowUpDown,
  CheckCircle2,
  XCircle,
  Wifi,
  Brain,
  FileText,
  ShieldCheck,
  ExternalLink,
} from "lucide-react";
import { authHeader } from "@/lib/api-token";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useNavigate } from "react-router-dom";
import { 
  Sheet, 
  SheetContent, 
  SheetHeader, 
  SheetTitle, 
  SheetDescription 
} from "@/components/ui/sheet";

const API_URL = (import.meta.env.VITE_API_URL as string) || "https://api.mentoark.com.br";

interface Conversa {
  session_id: string;
  push_name: string | null;
  instancia: string;
  ultima_mensagem: string;
  ultima_atividade: string;
  atendimento_ia: string;
  n8n_webhook_url?: string;
  agente_nome?: string;
}

interface Mensagem {
  id: string;
  fromMe: boolean;
  content: string;
  timestamp: string;
}

interface SystemStatus {
  whatsapp: boolean | null;
  ia: boolean | null;
  agente: boolean | null;
  prompt: boolean | null;
}

const MonitorWhatsApp = () => {
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [lastConversas, setLastConversas] = useState<Conversa[]>([]);
  const [sysStatus, setSysStatus] = useState<SystemStatus>({ whatsapp: null, ia: null, agente: null, prompt: null });
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const [secondsSinceUpdate, setSecondsSinceUpdate] = useState(0);
  const [filter, setFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("recent");
  const [selectedConversa, setSelectedConversa] = useState<Conversa | null>(null);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [loadingMensagens, setLoadingMensagens] = useState(false);
  const navigate = useNavigate();

  const fetchSystemStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const [whatsRes, iaRes, agentesRes, promptsRes] = await Promise.allSettled([
        fetch(`${API_URL}/api/whatsapp/status`, { method: 'POST', headers: { ...authHeader(), 'Content-Type': 'application/json' } }),
        fetch(`${API_URL}/api/ai-providers`, { headers: authHeader() }),
        fetch(`${API_URL}/api/agentes`, { headers: authHeader() }),
        fetch(`${API_URL}/api/agent_prompts`, { headers: authHeader() }),
      ]);

      const whatsOk = whatsRes.status === 'fulfilled' && whatsRes.value.ok
        ? await whatsRes.value.json().then((d: any) => d.state === 'open').catch(() => false)
        : false;

      const iaOk = iaRes.status === 'fulfilled' && iaRes.value.ok
        ? await iaRes.value.json().then((d: any[]) => d.length > 0).catch(() => false)
        : false;

      const agenteOk = agentesRes.status === 'fulfilled' && agentesRes.value.ok
        ? await agentesRes.value.json().then((d: any[]) => d.some((a: any) => a.ativo)).catch(() => false)
        : false;

      const promptOk = promptsRes.status === 'fulfilled' && promptsRes.value.ok
        ? await promptsRes.value.json().then((d: any[]) => d.some((p: any) => p.ativo)).catch(() => false)
        : false;

      setSysStatus({ whatsapp: whatsOk, ia: iaOk, agente: agenteOk, prompt: promptOk });
    } catch {
      setSysStatus({ whatsapp: false, ia: false, agente: false, prompt: false });
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  // [AUDITORIA] BUG (severidade alta — polling nunca respeitava os 30s pretendidos):
  // fetchConversas dependia de `[conversas]` no useCallback, mas a própria função chama
  // `setConversas(data)` — toda vez que ela roda, muda `conversas`, o que recria a referência da
  // função (novo useCallback), o que por sua vez recria o useEffect logo abaixo (que depende de
  // `fetchConversas`), disparando fetchSystemStatus()+fetchConversas() de novo IMEDIATAMENTE e
  // recriando o setInterval. Na prática isso vira um loop contínuo de requisições limitado só
  // pela latência de rede, martelando /api/whatsapp/status, /api/ai-providers, /api/agentes,
  // /api/agent_prompts e /api/whatsapp/conversas sem parar — não o polling de 30s que o "há X
  // segundos" no header sugere.
  // [AUDITORIA] FIX APLICADO: `conversas` anterior agora é lida de um ref (conversasRef), não do
  // estado — fetchConversas não depende mais de `conversas`, então a referência da função fica
  // estável entre renders e o useEffect/setInterval não é mais recriado a cada fetch.
  const conversasRef = useRef<Conversa[]>([]);
  const fetchConversas = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/api/whatsapp/conversas`, {
        headers: authHeader(),
      });
      if (response.ok) {
        const data = await response.json();
        setLastConversas(conversasRef.current);
        conversasRef.current = data;
        setConversas(data);
        setLastUpdate(new Date());
        setSecondsSinceUpdate(0);
      }
    } catch (error) {
      console.error("Erro ao buscar conversas:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchMensagens = async (session_id: string) => {
    setLoadingMensagens(true);
    try {
      // Usando o endpoint sugerido /api/whatsapp/conversas/:phone
      const response = await fetch(`${API_URL}/api/whatsapp/conversas/${session_id}`, {
        headers: authHeader(),
      });
      if (response.ok) {
        const data = await response.json();
        setMensagens(data.slice(0, 10)); // Últimas 10 mensagens
      }
    } catch (error) {
      console.error("Erro ao buscar mensagens:", error);
    } finally {
      setLoadingMensagens(false);
    }
  };

  useEffect(() => {
    fetchSystemStatus();
    fetchConversas();
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchConversas();
      }
    }, 30000);

    const secInterval = setInterval(() => {
      setSecondsSinceUpdate(prev => prev + 1);
    }, 1000);

    return () => {
      clearInterval(interval);
      clearInterval(secInterval);
    };
  }, [fetchConversas]);

  const filteredConversas = useMemo(() => {
    let result = [...conversas];

    // Busca
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      result = result.filter(c => 
        (c.push_name?.toLowerCase().includes(lower)) || 
        (c.session_id.includes(lower)) ||
        (c.ultima_mensagem?.toLowerCase().includes(lower))
      );
    }

    // Filtros rápidos
    const agora = new Date();
    const umaHoraAtras = new Date(agora.getTime() - 60 * 60 * 1000);

    if (filter === "ia_active") result = result.filter(c => c.atendimento_ia === "active");
    if (filter === "ia_pause") result = result.filter(c => c.atendimento_ia === "pause");
    if (filter === "no_response") result = result.filter(c => new Date(c.ultima_atividade) < umaHoraAtras);
    if (filter === "today") {
      const hoje = new Date().setHours(0, 0, 0, 0);
      result = result.filter(c => new Date(c.ultima_atividade).setHours(0, 0, 0, 0) === hoje);
    }

    // Ordenação
    if (sortBy === "recent") {
      result.sort((a, b) => new Date(b.ultima_atividade).getTime() - new Date(a.ultima_atividade).getTime());
    } else if (sortBy === "ia_status") {
      result.sort((a, b) => {
        if (a.atendimento_ia === "pause" && b.atendimento_ia !== "pause") return -1;
        if (a.atendimento_ia !== "pause" && b.atendimento_ia === "pause") return 1;
        return new Date(b.ultima_atividade).getTime() - new Date(a.ultima_atividade).getTime();
      });
    }

    return result;
  }, [conversas, searchTerm, filter, sortBy]);

  const stats = useMemo(() => {
    const hoje = new Date().setHours(0, 0, 0, 0);
    return {
      activeToday: conversas.filter(c => new Date(c.ultima_atividade).setHours(0, 0, 0, 0) === hoje).length,
      total: conversas.length
    };
  }, [conversas]);

  const hasNewMessage = (conversa: Conversa) => {
    const last = lastConversas.find(c => c.session_id === conversa.session_id);
    if (!last) return false;
    return new Date(conversa.ultima_atividade).getTime() > new Date(last.ultima_atividade).getTime();
  };

  const openConversa = (conversa: Conversa) => {
    setSelectedConversa(conversa);
    fetchMensagens(conversa.session_id);
  };

  return (
    <CRMLayout>
      <div className="flex flex-col gap-6 animate-in fade-in duration-500">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 glass-strong p-6 rounded-2xl border border-white/10">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold gradient-brand-text">Monitor WhatsApp ao Vivo</h1>
              <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/20 animate-pulse flex gap-1 items-center px-2 py-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                AO VIVO
              </Badge>
            </div>
            <p className="text-muted-foreground text-sm flex items-center gap-2">
              <MessageCircle className="w-4 h-4" />
              {stats.activeToday} conversas ativas hoje | {stats.total} total
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Última atualização</p>
              <p className="text-sm font-medium">há {secondsSinceUpdate} segundos</p>
            </div>
            <Button variant="outline" size="icon" onClick={fetchConversas} className="rounded-full">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </header>

        {/* ── Painel de Status do Sistema ───────────────────────────────── */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Status do Sistema</h3>
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={fetchSystemStatus} disabled={loadingStatus}>
                <RefreshCw className={`w-3 h-3 ${loadingStatus ? 'animate-spin' : ''}`} />
                Verificar
              </Button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {[
                { key: 'whatsapp', label: 'WhatsApp', icon: Wifi, link: '/integracoes', ok: sysStatus.whatsapp },
                { key: 'ia', label: 'IA configurada', icon: Brain, link: '/integracoes', ok: sysStatus.ia },
                { key: 'agente', label: 'Agente ativo', icon: Bot, link: '/agentes', ok: sysStatus.agente },
                { key: 'prompt', label: 'Prompt ativo', icon: FileText, link: '/cerebro', ok: sysStatus.prompt },
                { key: 'pausa', label: 'Pausa automática', icon: ShieldCheck, link: null, ok: true },
              ].map(({ key, label, icon: Icon, link, ok }) => (
                <div key={key} className={`flex items-center gap-2 p-3 rounded-xl border ${ok === null ? 'bg-muted/30' : ok ? 'bg-success/5 border-success/20' : 'bg-destructive/5 border-destructive/20'}`}>
                  <Icon className={`w-4 h-4 shrink-0 ${ok === null ? 'text-muted-foreground animate-pulse' : ok ? 'text-success' : 'text-destructive'}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium text-foreground leading-tight">{label}</p>
                    <p className={`text-[10px] ${ok === null ? 'text-muted-foreground' : ok ? 'text-success' : 'text-destructive'}`}>
                      {ok === null ? 'Verificando...' : ok ? 'OK' : 'Configurar'}
                    </p>
                  </div>
                  {!ok && ok !== null && link && (
                    <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => navigate(link)} title="Configurar">
                      <ExternalLink className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col lg:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder="Buscar por nome, telefone ou mensagem..." 
              className="pl-10 h-11 glass-card border-white/5"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
            <div className="flex bg-muted/50 p-1 rounded-lg border border-white/5">
              {[
                { id: "all", label: "Todos" },
                { id: "ia_active", label: "IA Ativa" },
                { id: "ia_pause", label: "Pausadas" },
                { id: "no_response", label: "+1h Sem Resposta" },
                { id: "today", label: "Hoje" },
              ].map(f => (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                    filter === f.id 
                    ? "bg-primary text-primary-foreground shadow-sm" 
                    : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="flex bg-muted/50 p-1 rounded-lg border border-white/5">
              <button
                onClick={() => setSortBy(prev => prev === "recent" ? "ia_status" : "recent")}
                className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                <ArrowUpDown className="w-3 h-3" />
                {sortBy === "recent" ? "Recentes" : "Status IA"}
              </button>
            </div>
          </div>
        </div>

        {filteredConversas.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center glass-card rounded-2xl border-dashed border-2 border-white/5">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <MessageCircle className="w-8 h-8 text-primary" />
            </div>
            <h3 className="text-lg font-semibold">Nenhuma conversa encontrada</h3>
            <p className="text-muted-foreground max-w-sm mt-2">
              Não encontramos conversas com os filtros atuais ou não há instâncias configuradas.
            </p>
            <Button variant="link" onClick={() => navigate("/agentes")} className="mt-4">
              Configurar Instância WhatsApp
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredConversas.map((conversa) => {
              const isNew = hasNewMessage(conversa);
              const statusIA = conversa.atendimento_ia === "active" ? "active" : (conversa.atendimento_ia === "pause" ? "pause" : "none");

              return (
                <Card 
                  key={conversa.session_id}
                  className={`group relative overflow-hidden transition-all duration-500 hover:shadow-xl hover:-translate-y-1 cursor-pointer glass-card border-white/5 ${
                    isNew ? 'ring-2 ring-blue-500 animate-pulse' : ''
                  }`}
                  onClick={() => openConversa(conversa)}
                >
                  <CardHeader className="pb-3">
                    <div className="flex justify-between items-start mb-1">
                      <div className="flex items-center gap-2">
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20 shrink-0">
                          <User className="w-5 h-5 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <CardTitle className="text-base truncate max-w-[150px]">
                            {conversa.push_name || conversa.session_id}
                          </CardTitle>
                          <Badge variant="secondary" className="text-[10px] h-4 px-1.5 bg-blue-500/10 text-blue-500 border-blue-500/20">
                            {conversa.instancia}
                          </Badge>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        {statusIA === "active" && (
                          <Badge className="bg-green-500/10 text-green-500 border-green-500/20 hover:bg-green-500/20 flex gap-1 items-center px-1.5">
                            <Bot className="w-3 h-3" />
                            Ativa
                          </Badge>
                        )}
                        {statusIA === "pause" && (
                          <Badge className="bg-orange-500/10 text-orange-500 border-orange-500/20 hover:bg-orange-500/20 flex gap-1 items-center px-1.5">
                            <Pause className="w-3 h-3" />
                            Pausada
                          </Badge>
                        )}
                        {statusIA === "none" && (
                          <Badge variant="outline" className="text-muted-foreground border-white/10 px-1.5">
                            —
                          </Badge>
                        )}
                        {conversa.n8n_webhook_url && (
                          <Badge variant="outline" className="text-[10px] text-purple-400 border-purple-500/20 px-1.5">
                            Via n8n
                          </Badge>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground line-clamp-2 min-h-[40px] mb-4 bg-black/20 p-2 rounded-lg italic">
                      "{conversa.ultima_mensagem || "Nenhuma mensagem encontrada"}"
                    </p>
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground border-t border-white/5 pt-3">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" />
                        <span>há {formatDistanceToNow(new Date(conversa.ultima_atividade), { locale: ptBR })}</span>
                      </div>
                      <div className="group-hover:text-primary flex items-center gap-1 transition-colors">
                        Ver histórico
                        <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <Sheet open={!!selectedConversa} onOpenChange={(open) => !open && setSelectedConversa(null)}>
          <SheetContent className="w-full sm:max-w-md glass-strong border-l border-white/10">
            <SheetHeader className="mb-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20">
                  <User className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <SheetTitle className="text-xl">
                    {selectedConversa?.push_name || selectedConversa?.session_id}
                  </SheetTitle>
                  <SheetDescription className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">{selectedConversa?.instancia}</Badge>
                    <span className="text-[10px]">•</span>
                    <span className="text-[10px]">{selectedConversa?.session_id}</span>
                  </SheetDescription>
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <Button 
                  size="sm" 
                  className="flex-1 gradient-brand"
                  onClick={() => navigate(`/contatos/${selectedConversa?.session_id}`)}
                >
                  Abrir Perfil Completo
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="flex-1"
                  onClick={() => navigate(`/whatsapp?chat=${selectedConversa?.session_id}`)}
                >
                  Abrir no Chat
                </Button>
              </div>
            </SheetHeader>

            <div className="space-y-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Zap className="w-3 h-3" />
                Últimas 10 Mensagens
              </h4>
              
              <div className="flex flex-col gap-3 min-h-[300px] overflow-y-auto pr-2 no-scrollbar">
                {loadingMensagens ? (
                  <div className="flex flex-col items-center justify-center py-20 gap-3 opacity-50">
                    <RefreshCw className="w-6 h-6 animate-spin text-primary" />
                    <span className="text-sm">Carregando mensagens...</span>
                  </div>
                ) : mensagens.length === 0 ? (
                  <div className="text-center py-20 text-muted-foreground text-sm">
                    Nenhuma mensagem recente carregada.
                  </div>
                ) : (
                  mensagens.map((msg) => (
                    <div 
                      key={msg.id} 
                      className={`flex flex-col max-w-[85%] ${msg.fromMe ? 'ml-auto items-end' : 'mr-auto items-start'}`}
                    >
                      <div className={`p-3 rounded-2xl text-sm ${
                        msg.fromMe 
                        ? 'bg-primary text-primary-foreground rounded-tr-none' 
                        : 'bg-muted/50 text-foreground border border-white/5 rounded-tl-none'
                      }`}>
                        {msg.content}
                      </div>
                      <span className="text-[9px] text-muted-foreground mt-1 px-1">
                        {formatDistanceToNow(new Date(msg.timestamp), { locale: ptBR, addSuffix: true })}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="mt-8 border-t border-white/5 pt-6 space-y-4">
               <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Detalhes da Sessão</h4>
               <div className="grid grid-cols-2 gap-4">
                  <div className="glass-card p-3 rounded-xl border border-white/5">
                    <p className="text-[10px] text-muted-foreground mb-1 uppercase">Status IA</p>
                    <p className="text-sm font-medium capitalize">{selectedConversa?.atendimento_ia || 'Não definido'}</p>
                  </div>
                  <div className="glass-card p-3 rounded-xl border border-white/5">
                    <p className="text-[10px] text-muted-foreground mb-1 uppercase">Agente</p>
                    <p className="text-sm font-medium truncate">{selectedConversa?.agente_nome || 'Padrão'}</p>
                  </div>
               </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </CRMLayout>
  );
};

export default MonitorWhatsApp;
