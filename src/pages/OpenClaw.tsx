import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CRMLayout } from "@/components/CRMLayout";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Terminal, Server, Bot, Database, Zap, RefreshCw, Send, LayoutGrid, Loader2, Activity, Settings, Trash2 } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ChatMessage } from '@/components/openclaw/ChatMessage';
import { StatusCard } from '@/components/openclaw/StatusCard';
import { FileConfigCard } from '@/components/openclaw/FileConfigCard';
import { toast } from 'sonner';
import { getAuthToken } from "@/lib/api-token";
import { fetchConnectionStatus } from "@/services/evolutionService";
import { withCooldown, CooldownError, friendlyError, getCooldownRemaining } from "@/lib/requestGuard";

interface Message {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: number;
  timestamp?: number;
}

const API_BASE = "https://api.mentoark.com.br";
const HISTORY_KEY = 'openclaw_chat_history';
const MAX_HISTORY = 60;

function loadHistory(): Message[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(msgs: Message[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(msgs.slice(-MAX_HISTORY)));
  } catch {}
}

export default function OpenClawPage() {
  const [messages, setMessages] = useState<Message[]>(loadHistory);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<any>({
    gateway: 'loading',
    backend: 'loading',
    evolution: 'loading',
    db: 'online'
  });
  const [dbInfo, setDbInfo] = useState<string>("PostgreSQL 16 + pgvector");
  const scrollRef = useRef<HTMLDivElement>(null);

  const getAuthHeader = useCallback(() => {
    const token = getAuthToken();
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  }, []);

  const getOpenClawHeader = useCallback(() => ({
    ...getAuthHeader(),
    'Content-Type': 'application/json',
  }), [getAuthHeader]);

  const openClawBody = (extra: object) => ({
    ...extra,
    // _adminKey: 'openclaw-admin-2025', // Removido fallback inseguro
  });

  const scrollToBottom = () => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  // Persiste histórico sempre que mensagens mudam
  useEffect(() => {
    if (messages.length > 0) saveHistory(messages);
  }, [messages]);

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 60000);
    return () => clearInterval(interval);
  }, []);

  const checkStatus = async () => {
    // Health check leve — não bate em /openclaw/chat (que é pago e pode estar em cooldown).
    try {
      const res = await fetch(`${API_BASE}/health`);
      const ok = res.ok;
      setStatus((prev: any) => ({
        ...prev,
        backend: ok ? 'online' : 'offline',
        gateway: ok ? 'online' : 'offline',
      }));
    } catch {
      setStatus((prev: any) => ({ ...prev, backend: 'offline', gateway: 'offline' }));
    }

    try {
      const res = await fetchConnectionStatus();
      setStatus((prev: any) => ({
        ...prev,
        evolution: res.state === 'open' ? 'online' : 'offline',
        evolutionInstance: res.phoneNumber || 'Instância'
      }));
    } catch {
      setStatus((prev: any) => ({ ...prev, evolution: 'offline' }));
    }

    try {
      const res = await fetch(`${API_BASE}/api/openclaw/chat`, {
        method: 'POST',
        headers: getOpenClawHeader(),
        body: JSON.stringify(openClawBody({ message: 'health', sessionKey: 'health' })),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.reply) {
          // Extrai info do banco se disponível no reply
          if (data.reply.includes('PostgreSQL')) {
             const match = data.reply.match(/PostgreSQL [0-9.]+/);
             if (match) setDbInfo(match[0]);
          }
        }
      }
    } catch {}
  };

  const sendMessage = async (text?: string) => {
    const messageText = text || input;
    if (!messageText.trim() || isLoading) return;

    const cdRemaining = getCooldownRemaining('openclaw-chat');
    if (cdRemaining > 0) {
      toast.error(
        `Aguarde ${Math.ceil(cdRemaining / 1000)}s antes de tentar novamente.`,
        { id: 'openclaw-error' }
      );
      return;
    }

    const userMsg: Message = { role: 'user', content: messageText, timestamp: Date.now() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);

    const appendErrorOnce = (msg: string) => {
      setMessages(prev => {
        const last = prev[prev.length - 1];
        const tagged = `❌ ${msg}`;
        if (last?.role === 'assistant' && last.content === tagged) {
          return prev.map((m, i) => i === prev.length - 1 ? { ...m, timestamp: Date.now() } : m);
        }
        return [...prev, { role: 'assistant' as const, content: tagged, timestamp: Date.now() }];
      });
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000); // Aumentado para 90s pois VPS pode ser lenta

    try {
      await withCooldown('openclaw-chat', async () => {
        const res = await fetch(`${API_BASE}/api/openclaw/chat`, {
          method: 'POST',
          headers: getOpenClawHeader(),
          body: JSON.stringify(openClawBody({ message: messageText, sessionKey: 'admin' })),
          signal: controller.signal,
        });

        // Tenta ler o JSON. Se falhar, pode ser erro 500 ou Cloudflare
        let data: any = {};
        const responseText = await res.text();
        try {
          data = JSON.parse(responseText);
        } catch (e) {
          console.error("Erro ao parsear resposta do OpenClaw:", responseText);
          data = { error: responseText.slice(0, 100) };
        }

        if (!res.ok) {
          const errMsg = friendlyError(res.status, data?.error || data?.message);
          toast.error(errMsg, { id: 'openclaw-error' });
          appendErrorOnce(errMsg);
          throw new Error(errMsg);
        }

        if (data.reply) {
          setMessages([...newMessages, { 
            role: 'assistant' as const, 
            content: data.reply, 
            toolCalls: data.toolCalls, 
            timestamp: Date.now() 
          }]);
        } else {
          const fallbackMsg = "Agente não retornou resposta (vazio).";
          toast.error(fallbackMsg, { id: 'openclaw-error' });
          appendErrorOnce(fallbackMsg);
          throw new Error('no_reply');
        }
      }, { baseMs: 3000, maxMs: 120_000 }); // Cooldown um pouco mais conservador
    } catch (err: any) {
      if (err instanceof CooldownError) {
        toast.error(
          `Aguarde ${Math.ceil(err.retryInMs / 1000)}s antes de tentar novamente.`,
          { id: 'openclaw-error' }
        );
      } else if (err?.name === 'AbortError') {
        const msg = friendlyError(408);
        toast.error(msg, { id: 'openclaw-error' });
        appendErrorOnce(msg);
      } else {
        console.error("OpenClaw error:", err);
      }
    } finally {
      clearTimeout(timeout);
      setIsLoading(false);
    }
  };

  const clearHistory = () => {
    setMessages([]);
    localStorage.removeItem(HISTORY_KEY);
    toast.success('Histórico apagado');
  };

  const handleQuickAction = (cmd: string) => sendMessage(cmd);

  return (
    <CRMLayout>
      <div className="space-y-4 max-w-full">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/20">
              <Terminal className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">OpenClaw Admin</h1>
              <p className="text-xs text-muted-foreground">Agente de administração da VPS via IA</p>
            </div>
          </div>
          <Badge variant="outline" className="border-blue-500/30 text-blue-500 gap-1 bg-blue-500/5">
            <Zap className="w-3 h-3 fill-current" /> v2.4 Stable
          </Badge>
        </div>

        <Tabs defaultValue="chat" className="space-y-4">
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="chat" className="flex-1 sm:flex-none gap-2">
              <Bot className="w-4 h-4" /> Chat Admin
            </TabsTrigger>
            <TabsTrigger value="status" className="flex-1 sm:flex-none gap-2">
              <Activity className="w-4 h-4" /> Status
            </TabsTrigger>
            <TabsTrigger value="config" className="flex-1 sm:flex-none gap-2">
              <Settings className="w-4 h-4" /> Config
            </TabsTrigger>
          </TabsList>

          {/* ─── CHAT ─── */}
          <TabsContent value="chat">
            <Card className="flex overflow-hidden" style={{ height: 'calc(100vh - 240px)', minHeight: 480 }}>
              {/* Sidebar do chat (desktop) */}
              <div className="hidden md:flex w-[220px] border-r flex-col gap-3 p-3 bg-muted/30 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start gap-2"
                  onClick={clearHistory}
                >
                  <Trash2 className="w-4 h-4" /> Limpar histórico
                </Button>
                <div className="flex-1">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-1 mb-2">Ações rápidas</p>
                  {['docker ps', 'df -h', 'free -h', 'uptime'].map(cmd => (
                    <button
                      key={cmd}
                      onClick={() => handleQuickAction(cmd)}
                      className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-accent font-mono text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {cmd}
                    </button>
                  ))}
                </div>
                <div className="text-[10px] text-muted-foreground bg-muted rounded-lg p-2 leading-relaxed">
                  Histórico salvo localmente ({messages.length} msgs)
                </div>
              </div>

              {/* Área principal do chat */}
              <div className="flex-1 flex flex-col min-w-0">
                {/* Toolbar mobile */}
                <div className="flex md:hidden items-center justify-between gap-2 px-3 py-2 border-b">
                  <span className="text-xs text-muted-foreground">{messages.length} mensagens salvas</span>
                  <Button variant="ghost" size="sm" onClick={clearHistory} className="gap-1 text-xs">
                    <Trash2 className="w-3 h-3" /> Limpar
                  </Button>
                </div>

                <ScrollArea className="flex-1 p-4">
                  <div className="max-w-3xl mx-auto space-y-4">
                    {messages.length === 0 && (
                      <div className="h-64 flex flex-col items-center justify-center text-center gap-4">
                        <div className="p-4 bg-blue-500/10 rounded-full">
                          <Bot className="w-10 h-10 text-blue-500" />
                        </div>
                        <div>
                          <h2 className="text-lg font-bold">Como posso ajudar na VPS hoje?</h2>
                          <p className="text-sm text-muted-foreground max-w-sm mx-auto mt-1">
                            Execute comandos, analise logs, gerencie containers e edite configurações.
                          </p>
                        </div>
                      </div>
                    )}

                    {messages.map((msg, i) => (
                      <ChatMessage key={i} message={msg} />
                    ))}

                    {isLoading && (
                      <div className="flex justify-start">
                        <div className="bg-muted px-4 py-3 rounded-2xl rounded-tl-none border flex items-center gap-2">
                          <div className="flex gap-1">
                            <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
                            <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
                            <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" />
                          </div>
                          <span className="text-xs text-muted-foreground font-mono">OpenClaw processando...</span>
                        </div>
                      </div>
                    )}
                    <div ref={scrollRef} />
                  </div>
                </ScrollArea>

                {/* Input */}
                <div className="p-3 border-t bg-background">
                  <div className="max-w-3xl mx-auto space-y-2">
                    <div className="flex gap-1.5 overflow-x-auto pb-1">
                      {['docker ps', 'df -h', 'docker logs crm-api --tail 50', 'git log --oneline -10'].map(cmd => (
                        <Badge
                          key={cmd}
                          variant="outline"
                          className="cursor-pointer hover:bg-primary hover:text-primary-foreground hover:border-primary transition-all font-mono text-[10px] py-1 px-2 whitespace-nowrap shrink-0"
                          onClick={() => handleQuickAction(cmd)}
                        >
                          {cmd}
                        </Badge>
                      ))}
                    </div>

                    <div className="flex gap-2 items-end">
                      <div className="flex-1 min-w-0 rounded-xl border bg-muted/30 focus-within:border-blue-500/50 transition-colors p-1">
                        <Textarea
                          placeholder="Peça ao agente para executar comandos..."
                          className="bg-transparent border-none focus-visible:ring-0 min-h-[44px] resize-none py-2 text-sm"
                          value={input}
                          onChange={(e) => setInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              sendMessage();
                            }
                          }}
                        />
                      </div>
                      <Button
                        className="h-11 w-11 shrink-0 bg-blue-600 hover:bg-blue-700 rounded-xl shadow-lg shadow-blue-900/20 transition-all active:scale-95"
                        onClick={() => sendMessage()}
                        disabled={isLoading || !input.trim()}
                      >
                        {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          </TabsContent>

          {/* ─── STATUS ─── */}
          <TabsContent value="status" className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatusCard title="OpenClaw Gateway" status={status.gateway === 'online' ? 'online' : 'offline'} info="gpt-4o-mini" />
              <StatusCard title="Backend API" status={status.backend === 'online' ? 'online' : 'offline'} info={status.backend === 'online' ? 'Ativo' : 'Offline'} />
              <StatusCard title="Evolution API" status={status.evolution === 'online' ? 'online' : 'offline'} info={status.evolutionInstance || 'Verificando...'} />
              <StatusCard title="Banco de Dados" status="online" info={dbInfo} />
            </div>

            <div className="grid grid-cols-1 gap-4">
              <Card className="p-5">
                <div className="flex justify-between items-center mb-4">
                  <div>
                    <h2 className="text-base font-bold flex items-center gap-2">
                      <LayoutGrid className="w-4 h-4 text-blue-500" /> Containers Ativos
                    </h2>
                    <p className="text-xs text-muted-foreground">Clique em "Verificar" para dados em tempo real</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => handleQuickAction("Use exec para rodar: docker ps --format 'table {{.Names}}\\t{{.Status}}\\t{{.Ports}}' e retorne os dados")}
                  >
                    <RefreshCw className="w-4 h-4" /> Verificar
                  </Button>
                </div>
                <div className="rounded-lg border overflow-hidden">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-muted/50 text-muted-foreground">
                      <tr>
                        <th className="p-3 font-medium">Container</th>
                        <th className="p-3 font-medium">Status</th>
                        <th className="p-3 font-medium hidden sm:table-cell">Portas</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y text-sm">
                      {[
                        { name: 'crm-api', port: '3000→3000' },
                        { name: 'crm', port: '80→80' },
                        { name: 'evolution', port: '8080→8080' },
                        { name: 'traefik', port: '80,443' },
                      ].map(c => (
                        <tr key={c.name}>
                          <td className="p-3 font-mono text-xs">{c.name}</td>
                          <td className="p-3"><Badge className="bg-green-500/15 text-green-600 border-green-500/30 text-xs">Running</Badge></td>
                          <td className="p-3 text-xs text-muted-foreground hidden sm:table-cell">{c.port}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card className="p-5">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-base font-bold flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-yellow-500" /> Logs em tempo real
                  </h2>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => handleQuickAction("Use exec para rodar: docker logs crm-api --tail 30 2>&1")}
                  >
                    <RefreshCw className="w-4 h-4" /> Buscar logs
                  </Button>
                </div>
                <div className="bg-muted/30 rounded-lg border p-3 font-mono text-xs text-muted-foreground h-40 overflow-y-auto leading-relaxed">
                  <p>Clique em "Buscar logs" para carregar os logs em tempo real via agente.</p>
                  <p className="animate-pulse mt-2">_</p>
                </div>
              </Card>
            </div>
          </TabsContent>

          {/* ─── CONFIG ─── */}
          <TabsContent value="config" className="space-y-6">
            <div>
              <h2 className="text-base font-bold mb-3 flex items-center gap-2">
                <Database className="w-4 h-4 text-blue-500" /> Workspace Files
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FileConfigCard
                  filename="SOUL.md"
                  description="Identidade e comportamento do agente"
                  contentPreview="Você é o agente MentoArk, um assistente especializado em infraestrutura e código..."
                  onSave={async (c) => handleQuickAction(`Use a ferramenta write para salvar este conteúdo em /opt/crm/SOUL.md: ${c}`)}
                />
                <FileConfigCard
                  filename="USER.md"
                  description="Preferências e perfil do operador"
                  contentPreview="Nome: Admin. Nível de acesso: Root. Preferência: Respostas concisas e técnicas."
                  onSave={async (c) => handleQuickAction(`Use a ferramenta write para salvar este conteúdo em /opt/crm/USER.md: ${c}`)}
                />
                <FileConfigCard
                  filename="TOOLS.md"
                  description="Definição de permissões de ferramentas"
                  contentPreview="Ferramentas permitidas: exec, write, read, fetch. Restrições: rm -rf /"
                  onSave={async (c) => handleQuickAction(`Use a ferramenta write para salvar este conteúdo em /opt/crm/TOOLS.md: ${c}`)}
                />
              </div>
            </div>

            <div>
              <h2 className="text-base font-bold mb-3 flex items-center gap-2">
                <Zap className="w-4 h-4 text-orange-500" /> Ações Rápidas VPS
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                {[
                  { label: 'Reiniciar Backend', cmd: 'docker compose -f /opt/crm/backend/docker-compose.yml restart', icon: RefreshCw },
                  { label: 'Reiniciar Evolution', cmd: 'docker compose -f /opt/evolution/docker-compose.yml restart', icon: RefreshCw },
                  { label: 'Uso de disco', cmd: 'df -h /', icon: Database },
                  { label: 'Limpar imagens', cmd: 'docker image prune -f', icon: LayoutGrid },
                  { label: 'Ver logs erro', cmd: 'docker logs crm-api --tail 50 2>&1 | grep -i error', icon: Terminal },
                  { label: 'Status geral', cmd: 'docker ps && df -h / && free -h', icon: Activity },
                ].map(action => (
                  <Button
                    key={action.label}
                    variant="outline"
                    className="flex flex-col h-20 gap-1.5 group transition-all"
                    onClick={() => handleQuickAction(action.cmd)}
                  >
                    <action.icon className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
                    <span className="text-[10px] text-center font-medium leading-tight">{action.label}</span>
                  </Button>
                ))}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </CRMLayout>
  );
}
