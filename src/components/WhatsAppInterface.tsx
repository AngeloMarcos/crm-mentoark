import { useState, useMemo, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { 
  Search, User, Bot, Send, Phone, MoreVertical, 
  Paperclip, Smile, QrCode, RefreshCw, Loader2, 
  CheckCircle2, Info, Calendar, MapPin, Mail, Tag,
  Clock, AlertTriangle
} from "lucide-react";
import { fetchConnectionStatus, createInstance, type StatusResult, type CreateInstanceResult } from "@/services/evolutionService";
import { toast } from "sonner";

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

interface Chat {
  id: string;
  name: string;
  phone: string;
  email?: string;
  address?: string;
  city?: string;
  status?: string;
  tags?: string[];
  lastMessage: string;
  timestamp: string;
  unread?: number;
  online?: boolean;
  messages: Message[];
  createdAt?: string;
}

export function WhatsAppInterface() {
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [messageInput, setMessageInput] = useState("");
  const [connectionStatus, setConnectionStatus] = useState<StatusResult | null>(null);
  const [qrData, setQrData] = useState<CreateInstanceResult | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [connecting, setConnecting] = useState(false);

  // Mock de dados enriquecidos para o lado direito (perfil do contato)
  const [chats, setChats] = useState<Chat[]>([
    {
      id: "1",
      name: "João Silva",
      phone: "+55 (11) 98888-7777",
      email: "joao.silva@email.com",
      address: "Av. Paulista, 1000",
      city: "São Paulo - SP",
      status: "Lead Qualificado",
      tags: ["Prioridade", "Interesse em Pro"],
      createdAt: "15/05/2026",
      lastMessage: "Olá, gostaria de saber mais sobre o plano Pro.",
      timestamp: "10:30",
      unread: 2,
      online: true,
      messages: [
        { id: "m1", role: "user", content: "Olá, gostaria de saber mais sobre o plano Pro.", timestamp: "10:30" }
      ]
    },
    {
      id: "2",
      name: "Maria Oliveira",
      phone: "+55 (21) 97777-6666",
      email: "maria.o@empresa.com.br",
      address: "Rua das Flores, 45",
      city: "Rio de Janeiro - RJ",
      status: "Cliente Ativo",
      tags: ["Fidelidade"],
      createdAt: "10/01/2026",
      lastMessage: "Obrigada pelo atendimento!",
      timestamp: "Ontem",
      messages: [
        { id: "m2", role: "user", content: "Quanto custa o serviço?", timestamp: "Ontem" },
        { id: "m3", role: "assistant", content: "Olá! Nossos planos começam em R$ 99/mês.", timestamp: "Ontem" },
        { id: "m4", role: "user", content: "Obrigada pelo atendimento!", timestamp: "Ontem" }
      ]
    }
  ]);

  const activeChat = useMemo(() => chats.find(c => c.id === activeChatId), [chats, activeChatId]);

  const filteredChats = useMemo(() => {
    return chats.filter(c => 
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
      c.phone.includes(searchTerm)
    );
  }, [chats, searchTerm]);

  // Lógica de Conexão com Evolution
  const checkStatus = async () => {
    try {
      const res = await fetchConnectionStatus();
      setConnectionStatus(res);
      if (res.state === 'open') {
        setQrData(null);
      }
    } catch (error) {
      console.error("Erro status:", error);
    } finally {
      setLoadingStatus(false);
    }
  };

  const handleConnect = async () => {
    try {
      setConnecting(true);
      const res = await createInstance();
      setQrData(res);
      if (res.state === 'open') {
        setConnectionStatus({ state: 'open', phoneNumber: res.phoneNumber });
        toast.success("WhatsApp conectado!");
      }
    } catch (error: any) {
      toast.error("Erro ao conectar: " + error.message);
    } finally {
      setConnecting(false);
    }
  };

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleSendMessage = () => {
    if (!messageInput.trim() || !activeChatId) return;

    const newMessage: Message = {
      id: Date.now().toString(),
      role: 'assistant',
      content: messageInput,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setChats(prev => prev.map(chat => {
      if (chat.id === activeChatId) {
        return {
          ...chat,
          messages: [...chat.messages, newMessage],
          lastMessage: messageInput,
          timestamp: newMessage.timestamp
        };
      }
      return chat;
    }));

    setMessageInput("");
  };

  const isConnected = connectionStatus?.state === 'open';

  return (
    <div className="flex h-[calc(100vh-12rem)] border rounded-2xl overflow-hidden bg-background shadow-xl">
      
      {/* Sidebar - Lista de Conversas */}
      <div className="w-80 md:w-96 border-r flex flex-col bg-muted/5">
        <div className="p-4 border-b space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold tracking-tight">Conversas</h2>
            <div className="flex gap-2">
              {!isConnected && (
                <Button variant="ghost" size="icon" className="h-8 w-8 text-amber-500 animate-pulse" onClick={handleConnect} title="Conectar WhatsApp">
                  <AlertTriangle className="h-4 w-4" />
                </Button>
              )}
              <Badge variant="outline" className="rounded-full">{chats.length}</Badge>
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Buscar contato..." 
              className="pl-9 bg-muted/50 border-none h-10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <ScrollArea className="flex-1">
          {filteredChats.map((chat) => (
            <div
              key={chat.id}
              onClick={() => setActiveChatId(chat.id)}
              className={`p-4 flex items-start gap-3 cursor-pointer transition-all hover:bg-muted/50 ${activeChatId === chat.id ? 'bg-primary/10 border-r-4 border-r-primary' : ''}`}
            >
              <div className="relative shrink-0">
                <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                  <User className="h-6 w-6 text-primary" />
                </div>
                {chat.online && (
                  <span className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-500 border-2 border-background rounded-full"></span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <p className="font-bold text-sm truncate">{chat.name}</p>
                  <span className="text-[10px] text-muted-foreground">{chat.timestamp}</span>
                </div>
                <p className="text-xs text-muted-foreground truncate line-clamp-1">
                  {chat.lastMessage}
                </p>
              </div>
              {chat.unread ? (
                <Badge className="ml-2 h-5 w-5 flex items-center justify-center rounded-full p-0 text-[10px] bg-primary">
                  {chat.unread}
                </Badge>
              ) : null}
            </div>
          ))}
        </ScrollArea>
      </div>

      {/* Área Central - Chat */}
      <div className="flex-1 flex flex-col bg-muted/5">
        {!isConnected && qrData?.qrCode ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-6 animate-in fade-in zoom-in-95">
            <div className="p-6 bg-white rounded-3xl shadow-2xl border border-border/50">
              <img src={qrData.qrCode} alt="WhatsApp QR Code" className="w-64 h-64" />
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-bold">Conecte seu WhatsApp</h3>
              <p className="text-muted-foreground max-w-sm text-sm">
                Escaneie o código acima com seu celular para sincronizar as mensagens com o Agente MentoArk.
              </p>
            </div>
            <Button variant="outline" onClick={checkStatus}>
              <RefreshCw className="h-4 w-4 mr-2" /> Já escaneei
            </Button>
          </div>
        ) : activeChat ? (
          <>
            <div className="p-4 border-b bg-background flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <User className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-bold text-sm">{activeChat.name}</p>
                  <div className="flex items-center gap-2">
                    <span className="flex h-1.5 w-1.5 rounded-full bg-green-500"></span>
                    <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">Online</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full">
                  <Search className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <ScrollArea className="flex-1 p-6 bg-[url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')] bg-repeat opacity-95">
              <div className="space-y-4">
                {activeChat.messages.map((m) => {
                  const isAssistant = m.role === 'assistant';
                  return (
                    <div key={m.id} className={`flex ${isAssistant ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[75%] rounded-2xl px-4 py-2 shadow-sm ${isAssistant ? 'bg-primary text-primary-foreground rounded-tr-none' : 'bg-background rounded-tl-none border'}`}>
                        <p className="text-sm leading-relaxed">{m.content}</p>
                        <p className={`text-[9px] mt-1 text-right opacity-70`}>{m.timestamp}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>

            <div className="p-4 bg-background border-t">
              <div className="flex items-center gap-2 bg-muted/30 rounded-2xl p-2 px-4">
                <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-primary">
                  <Smile className="h-5 w-5" />
                </Button>
                <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-primary">
                  <Paperclip className="h-5 w-5" />
                </Button>
                <Input 
                  placeholder="Digite sua mensagem..." 
                  className="border-none bg-transparent focus-visible:ring-0 shadow-none h-10"
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                />
                <Button size="icon" className="shrink-0 rounded-xl h-9 w-9 shadow-lg shadow-primary/20" onClick={handleSendMessage}>
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 space-y-4">
            <div className="w-24 h-24 rounded-3xl bg-primary/10 flex items-center justify-center ring-1 ring-primary/20">
              <Bot className="h-12 w-12 text-primary" />
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-bold">MentoArk WhatsApp Business</h3>
              <p className="text-muted-foreground max-w-xs text-sm">
                Selecione uma conversa para visualizar os dados do cliente e gerenciar o atendimento automático.
              </p>
              {!isConnected && (
                <Button onClick={handleConnect} disabled={connecting} className="mt-4 rounded-xl px-8 h-12 font-bold">
                  {connecting ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <QrCode className="h-5 w-5 mr-2" />}
                  Conectar Canal
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Sidebar Direita - Informações do Contato */}
      {activeChat && (
        <div className="w-80 border-l bg-background flex flex-col animate-in slide-in-from-right-4 duration-300">
          <div className="p-6 text-center border-b bg-muted/5">
            <div className="w-20 h-20 rounded-3xl bg-primary/10 flex items-center justify-center mx-auto mb-4 ring-4 ring-primary/5">
              <User className="h-10 w-10 text-primary" />
            </div>
            <h3 className="font-bold text-lg">{activeChat.name}</h3>
            <Badge variant="secondary" className="mt-2 rounded-lg font-bold text-[10px] uppercase tracking-wider">{activeChat.status}</Badge>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-6 space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Informações de Contato</h4>
                  <Info className="h-3 w-3 text-muted-foreground" />
                </div>
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground font-bold uppercase">Telefone</p>
                      <p className="text-sm font-medium">{activeChat.phone}</p>
                    </div>
                  </div>
                  {activeChat.email && (
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                        <Mail className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground font-bold uppercase">E-mail</p>
                        <p className="text-sm font-medium truncate w-44">{activeChat.email}</p>
                      </div>
                    </div>
                  )}
                  {activeChat.address && (
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                        <MapPin className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground font-bold uppercase">Endereço</p>
                        <p className="text-sm font-medium">{activeChat.address}</p>
                        <p className="text-[10px] text-muted-foreground">{activeChat.city}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <Separator className="opacity-50" />

              <div className="space-y-4">
                <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Histórico e Tags</h4>
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <div className="text-sm font-medium">Desde: {activeChat.createdAt}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <div className="text-sm font-medium">Último contato: {activeChat.timestamp}</div>
                  </div>
                  <div className="pt-2 flex flex-wrap gap-2">
                    {activeChat.tags?.map((tag, i) => (
                      <Badge key={i} variant="outline" className="text-[9px] font-bold bg-muted/50 border-none px-2 py-0.5">
                        <Tag className="h-2 w-2 mr-1" /> {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>

              <div className="pt-4">
                <Button className="w-full h-11 rounded-xl font-bold" variant="outline">
                  Ver Ficha Completa
                </Button>
              </div>
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
