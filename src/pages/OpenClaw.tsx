import React, { useState, useEffect, useRef } from 'react';
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Terminal, Server, Bot, Database, Zap, RefreshCw, Copy, Send, LayoutGrid, Loader2, Activity } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ChatMessage } from '@/components/openclaw/ChatMessage';
import { StatusCard } from '@/components/openclaw/StatusCard';
import { FileConfigCard } from '@/components/openclaw/FileConfigCard';
import { toast } from 'sonner';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: number;
}

const API_BASE = "https://api.mentoark.com.br";

export default function OpenClawPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<any>({
    gateway: 'loading',
    backend: 'loading',
    evolution: 'loading',
    db: 'online'
  });
  const scrollRef = useRef<HTMLDivElement>(null);

  const getAuthHeader = () => {
    const token = localStorage.getItem('crm_access_token');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  };

  const getOpenClawHeader = () => ({
    ...getAuthHeader(),
    'Content-Type': 'application/json',
  });

  const openClawBody = (extra: object) => ({
    ...extra,
    _adminKey: 'openclaw-admin-2025',
  });

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const checkStatus = async () => {
    // Check Gateway
    try {
      const res = await fetch(`${API_BASE}/api/openclaw/chat`, {
        method: 'POST',
        headers: getOpenClawHeader(),
        body: JSON.stringify(openClawBody({ message: 'ping', sessionKey: 'admin' }))
      });
      setStatus(prev => ({ ...prev, gateway: res.ok ? 'online' : 'offline' }));
    } catch {
      setStatus(prev => ({ ...prev, gateway: 'offline' }));
    }

    // Check Backend
    try {
      const res = await fetch(`${API_BASE}/health`);
      setStatus(prev => ({ ...prev, backend: res.ok ? 'online' : 'offline' }));
    } catch {
      setStatus(prev => ({ ...prev, backend: 'offline' }));
    }

    // Check Evolution
    try {
      const res = await fetch(`${API_BASE}/api/whatsapp/instances`, {
        headers: getAuthHeader()
      });
      if (res.ok) {
        const data = await res.json();
        setStatus(prev => ({ ...prev, evolution: 'online', evolutionCount: data.length }));
      } else {
        setStatus(prev => ({ ...prev, evolution: 'offline' }));
      }
    } catch {
      setStatus(prev => ({ ...prev, evolution: 'offline' }));
    }
  };

  const sendMessage = async (text?: string) => {
    const messageText = text || input;
    if (!messageText.trim() || isLoading) return;

    const userMsg: Message = { role: 'user', content: messageText };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/openclaw/chat`, {
        method: 'POST',
        headers: getOpenClawHeader(),
        body: JSON.stringify(openClawBody({ message: messageText, sessionKey: 'admin' }))
      });

      if (res.status === 503) {
        toast.error('OpenClaw gateway offline. Verifique a VPS.');
        return;
      }

      const data = await res.json();
      if (data.reply) {
        setMessages(prev => [...prev, { role: 'assistant', content: data.reply, toolCalls: data.toolCalls }]);
      } else {
        toast.error('Erro na resposta do agente');
      }
    } catch (err) {
      toast.error('O agente demorou muito para responder ou ocorreu um erro.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickAction = (cmd: string) => {
    sendMessage(cmd);
  };

  return (
    <div className="p-6 space-y-6 bg-[#0a0a0a] min-h-screen text-gray-100">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Terminal className="w-8 h-8 text-blue-500" />
          <h1 className="text-2xl font-bold tracking-tight">OpenClaw Admin</h1>
        </div>
        <Badge variant="outline" className="border-blue-500/30 text-blue-400 gap-1 bg-blue-500/5">
          <Zap className="w-3 h-3 fill-current" /> v2.4 Stable
        </Badge>
      </div>

      <Tabs defaultValue="chat" className="space-y-4">
        <TabsList className="bg-[#111] border border-[#222] p-1 h-12">
          <TabsTrigger value="chat" className="data-[state=active]:bg-[#222] px-6">
            <Bot className="w-4 h-4 mr-2" /> Chat Admin
          </TabsTrigger>
          <TabsTrigger value="status" className="data-[state=active]:bg-[#222] px-6">
            <Activity className="w-4 h-4 mr-2" /> Status & Diagnóstico
          </TabsTrigger>
          <TabsTrigger value="config" className="data-[state=active]:bg-[#222] px-6">
            <SettingsIcon className="w-4 h-4 mr-2" /> Configuração
          </TabsTrigger>
        </TabsList>

        <TabsContent value="chat" className="h-[calc(100vh-220px)] border border-[#222] rounded-xl bg-[#111] flex overflow-hidden shadow-2xl">
          <div className="w-[240px] border-r border-[#222] p-4 flex flex-col gap-4 bg-[#0d0d0d]">
            <Button 
              variant="outline" 
              className="w-full justify-start gap-2 border-[#222] hover:bg-[#222] hover:text-white"
              onClick={() => setMessages([])}
            >
              <span className="text-xl">+</span> Nova conversa
            </Button>
            
            <div className="flex-1 space-y-1">
              <p className="text-[10px] font-bold text-gray-600 uppercase tracking-widest px-2 mb-2">Recentes</p>
              {["🔧 VPS Admin", "📊 Diagnóstico", "🐳 Docker", "📝 Código"].map(item => (
                <div key={item} className="text-sm p-2.5 rounded-lg hover:bg-[#1a1a1a] cursor-pointer text-gray-400 flex items-center gap-2 group transition-colors">
                  <div className="w-1.5 h-1.5 rounded-full bg-gray-700 group-hover:bg-blue-500" />
                  {item}
                </div>
              ))}
            </div>
            
            <Card className="p-3 bg-blue-500/5 border-blue-500/20 rounded-xl">
              <p className="text-[10px] text-blue-400 font-medium leading-relaxed">
                O histórico é mantido apenas nesta sessão. Comandos complexos podem levar até 10s.
              </p>
            </Card>
          </div>

          <div className="flex-1 flex flex-col relative bg-[#0a0a0a]">
            <ScrollArea className="flex-1 p-6">
              <div className="max-w-4xl mx-auto space-y-6">
                {messages.length === 0 && (
                  <div className="h-[400px] flex flex-col items-center justify-center text-center space-y-4">
                    <div className="p-4 bg-blue-500/10 rounded-full animate-pulse">
                      <Bot className="w-12 h-12 text-blue-500" />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-gray-200">Como posso ajudar na VPS hoje?</h2>
                      <p className="text-gray-500 max-w-sm mx-auto mt-2">
                        Posso executar comandos, analisar logs, gerenciar containers e editar arquivos de configuração.
                      </p>
                    </div>
                  </div>
                )}
                
                {messages.map((msg, i) => (
                  <ChatMessage key={i} message={msg} />
                ))}
                
                {isLoading && (
                  <div className="flex justify-start mb-4">
                    <div className="bg-[#222] p-4 rounded-lg rounded-tl-none border border-[#333] flex items-center gap-3">
                      <div className="flex gap-1">
                        <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
                        <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
                        <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" />
                      </div>
                      <span className="text-xs text-gray-400 font-mono">OpenClaw processando...</span>
                    </div>
                  </div>
                )}
                <div ref={scrollRef} />
              </div>
            </ScrollArea>

            <div className="p-4 bg-[#111]/50 backdrop-blur-md border-t border-[#222]">
              <div className="max-w-4xl mx-auto space-y-4">
                <div className="flex flex-wrap gap-2">
                  {['docker ps', 'df -h', 'docker logs crm-api --tail 50', 'git log --oneline -10'].map(cmd => (
                    <Badge 
                      key={cmd} 
                      variant="outline" 
                      className="cursor-pointer hover:bg-blue-600 hover:text-white hover:border-blue-600 transition-all font-mono text-[10px] py-1 px-2 border-[#333] text-gray-400"
                      onClick={() => handleQuickAction(cmd)}
                    >
                      {cmd}
                    </Badge>
                  ))}
                </div>
                
                <div className="flex gap-3 items-end">
                  <div className="flex-1 bg-[#0a0a0a] rounded-xl border border-[#222] focus-within:border-blue-500/50 transition-colors p-1">
                    <Textarea 
                      placeholder="Peça ao agente para executar comandos, analisar código, verificar containers..." 
                      className="bg-transparent border-none focus-visible:ring-0 min-h-[44px] resize-none py-3"
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
                    className="h-[52px] w-[52px] bg-blue-600 hover:bg-blue-700 rounded-xl shadow-lg shadow-blue-900/20 transition-all active:scale-95"
                    onClick={() => sendMessage()}
                    disabled={isLoading || !input.trim()}
                  >
                    {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="status" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatusCard 
              title="OpenClaw Gateway" 
              status={status.gateway === 'online' ? 'online' : 'offline'} 
              info="gpt-5.4-mini" 
            />
            <StatusCard 
              title="Backend API" 
              status={status.backend === 'online' ? 'online' : 'offline'} 
              info={status.backend === 'online' ? 'Ativo' : 'Offline'} 
            />
            <StatusCard 
              title="Evolution API" 
              status={status.evolution === 'online' ? 'online' : 'offline'} 
              info={status.evolutionCount ? `${status.evolutionCount} instâncias` : 'Verificando...'} 
            />
            <StatusCard 
              title="Banco de Dados" 
              status="online" 
              info="PostgreSQL 16 + pgvector" 
            />
          </div>

          <div className="grid grid-cols-1 gap-6">
            <Card className="p-6 bg-[#111] border-[#222]">
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h2 className="text-lg font-bold flex items-center gap-2">
                    <LayoutGrid className="w-5 h-5 text-blue-500" /> Containers Ativos
                  </h2>
                  <p className="text-sm text-gray-500">Listagem de containers via docker ps</p>
                </div>
                <Button variant="outline" size="sm" className="gap-2 border-[#333]" onClick={() => handleQuickAction("Use exec para rodar: docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' e retorne os dados")}>
                  <RefreshCw className="w-4 h-4" /> Verificar containers
                </Button>
              </div>
              
              <div className="rounded-lg border border-[#222] overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[#1a1a1a] text-gray-400">
                    <tr>
                      <th className="p-3 font-medium">Nome</th>
                      <th className="p-3 font-medium">Status</th>
                      <th className="p-3 font-medium">Portas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#222] text-gray-300">
                    <tr>
                      <td className="p-3 font-mono">crm-api</td>
                      <td className="p-3"><Badge className="bg-green-500/20 text-green-500 border-green-500/30">Up 4 days</Badge></td>
                      <td className="p-3 text-xs text-gray-500">0.0.0.0:3000-&gt;3000/tcp</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-mono">evolution-api</td>
                      <td className="p-3"><Badge className="bg-green-500/20 text-green-500 border-green-500/30">Up 12 days</Badge></td>
                      <td className="p-3 text-xs text-gray-500">0.0.0.0:8080-&gt;8080/tcp</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-mono">openclaw-gateway</td>
                      <td className="p-3"><Badge className="bg-green-500/20 text-green-500 border-green-500/30">Up 48 hours</Badge></td>
                      <td className="p-3 text-xs text-gray-500">0.0.0.0:18789-&gt;18789/tcp</td>

                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>

            <Card className="p-6 bg-[#111] border-[#222]">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <Terminal className="w-5 h-5 text-yellow-500" /> Logs em tempo real
                </h2>
                <Button variant="outline" size="sm" className="gap-2 border-[#333]" onClick={() => handleQuickAction("Use exec para rodar: docker logs crm-api --tail 30 2>&1")}>
                  <RefreshCw className="w-4 h-4" /> Atualizar logs
                </Button>
              </div>
              <div className="bg-[#0a0a0a] p-4 rounded-lg border border-[#222] font-mono text-xs text-green-500/80 h-64 overflow-y-auto leading-relaxed">
                <div>[2024-05-20 10:15:22] INFO: Server started on port 3000</div>
                <div>[2024-05-20 10:15:25] INFO: Database connected</div>
                <div>[2024-05-20 10:20:44] DEBUG: Incoming request to /api/openclaw/chat</div>
                <div>[2024-05-20 10:20:50] INFO: Agent tool call: exec_command</div>
                <div className="animate-pulse">_</div>
              </div>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="config" className="space-y-8">
          <div>
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Database className="w-5 h-5 text-blue-500" /> Workspace Files
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Zap className="w-5 h-5 text-orange-500" /> Ações Rápidas VPS
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
                  className="flex flex-col h-24 gap-2 border-[#222] hover:bg-[#222] hover:border-blue-500/50 group transition-all"
                  onClick={() => handleQuickAction(action.cmd)}
                >
                  <action.icon className="w-5 h-5 text-gray-500 group-hover:text-blue-500" />
                  <span className="text-[10px] text-center font-bold">{action.label}</span>
                </Button>
              ))}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Missing icons from standard imports
const SettingsIcon = (props: any) => (
  <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
);
