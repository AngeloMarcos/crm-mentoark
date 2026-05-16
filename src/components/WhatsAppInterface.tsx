import { useState, useMemo, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Search, User, Send, Phone, Paperclip, Smile,
  QrCode, RefreshCw, Loader2, CheckCircle2, Info,
  ChevronDown, ChevronRight, X, Pencil, Plus,
  Mic, LayoutGrid, MessageSquare, SlidersHorizontal,
  UserPlus, AlertTriangle, Check,
} from "lucide-react";
import { fetchConnectionStatus, createInstance, disconnectInstance, type StatusResult, type CreateInstanceResult } from "@/services/evolutionService";
import { toast } from "sonner";

type ChatTab = "todos" | "fila" | "meus";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  senderName?: string;
}

interface Chat {
  id: string;
  name: string;
  phone: string;
  status?: string;
  tag?: string;
  lastMessage: string;
  timestamp: string;
  unread?: number;
  online?: boolean;
  source?: string;
  messages: Message[];
  notes?: string;
}

const TAG_COLORS: Record<string, string> = {
  LEAD: "bg-blue-100 text-blue-700",
  NEGOCIAÇÃO: "bg-sky-100 text-sky-700",
  FECHAMENTO: "bg-green-100 text-green-700",
  ATIVO: "bg-emerald-100 text-emerald-700",
};

const MOCK_CHATS: Chat[] = [
  {
    id: "1",
    name: "João Silva",
    phone: "5511988887777",
    status: "Lead Qualificado",
    tag: "LEAD",
    source: "teste",
    lastMessage: "Olá, gostaria de saber mais sobre o plano Pro.",
    timestamp: "14:47",
    unread: 2,
    online: true,
    notes: "",
    messages: [
      { id: "m1", role: "user", content: "Salve", timestamp: "13:45", senderName: "João" },
      { id: "m2", role: "assistant", content: "Vai trampar hj?", timestamp: "13:50", senderName: "Agente" },
      { id: "m3", role: "user", content: "ja to trampando irmao, eu nao durmo", timestamp: "13:50", senderName: "João" },
      { id: "m4", role: "assistant", content: "Call??", timestamp: "13:51", senderName: "Agente" },
      { id: "m5", role: "user", content: "jaja entro ai", timestamp: "13:51", senderName: "João" },
      { id: "m6", role: "assistant", content: "eae", timestamp: "14:46", senderName: "Agente" },
      { id: "m7", role: "assistant", content: "bora", timestamp: "14:46", senderName: "Agente" },
      { id: "m8", role: "user", content: "To la", timestamp: "14:47", senderName: "João" },
    ],
  },
  {
    id: "2",
    name: "Nathiele Santos",
    phone: "5511977776666",
    tag: "FECHAMENTO",
    source: "TESTE",
    lastMessage: "anhh ta bom, se nao ficar...",
    timestamp: "14:53",
    online: false,
    notes: "",
    messages: [
      { id: "n1", role: "user", content: "Boa tarde! Quero fechar o plano.", timestamp: "14:40", senderName: "Nathiele" },
      { id: "n2", role: "assistant", content: "Perfeito! Vou preparar o contrato.", timestamp: "14:41", senderName: "Agente" },
      { id: "n3", role: "user", content: "anhh ta bom, se nao ficar...", timestamp: "14:53", senderName: "Nathiele" },
    ],
  },
  {
    id: "3",
    name: "447974905007",
    phone: "447974905007",
    tag: "NEGOCIAÇÃO",
    source: "TESTE",
    lastMessage: "testado",
    timestamp: "13:51",
    online: false,
    notes: "",
    messages: [
      { id: "k1", role: "user", content: "testado", timestamp: "13:51", senderName: "447974905007" },
    ],
  },
  {
    id: "4",
    name: "Emanuel Pires",
    phone: "5511966665555",
    tag: "LEAD",
    source: "TESTE",
    lastMessage: "https://meet.google.com/...",
    timestamp: "13:33",
    online: false,
    notes: "",
    messages: [
      { id: "e1", role: "user", content: "https://meet.google.com/abc-defg-hij", timestamp: "13:33", senderName: "Emanuel" },
    ],
  },
];

export function WhatsAppInterface() {
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ChatTab>("todos");
  const [searchTerm, setSearchTerm] = useState("");
  const [messageInput, setMessageInput] = useState("");
  const [inputMode, setInputMode] = useState<"responder" | "nota">("responder");
  const [connectionStatus, setConnectionStatus] = useState<StatusResult | null>(null);
  const [qrData, setQrData] = useState<CreateInstanceResult | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [chats, setChats] = useState<Chat[]>(MOCK_CHATS);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeChat = useMemo(() => chats.find(c => c.id === activeChatId), [chats, activeChatId]);

  const filteredChats = useMemo(() =>
    chats.filter(c =>
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.phone.includes(searchTerm)
    ),
    [chats, searchTerm]
  );

  const checkStatus = async (silent = true) => {
    try {
      const res = await fetchConnectionStatus();
      setConnectionStatus(res);
      if (res.state === "open") setQrData(null);
    } catch (e) {
      if (!silent) toast.error("Erro ao verificar status");
    } finally {
      setLoadingStatus(false);
    }
  };

  const handleConnect = async () => {
    try {
      setConnecting(true);
      try { await disconnectInstance(); } catch {}
      const res = await createInstance();
      setQrData(res);
      if (res.state === "open") {
        setConnectionStatus({ state: "open", phoneNumber: res.phoneNumber });
        toast.success("WhatsApp conectado!");
      } else if (res.qrCode) {
        toast.info("Escaneie o QR Code");
      } else {
        toast.error("Evolution não retornou QR Code");
      }
    } catch (err: any) {
      toast.error("Erro: " + err.message);
    } finally {
      setConnecting(false);
    }
  };

  useEffect(() => {
    checkStatus();
    const t = setInterval(checkStatus, 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeChatId, chats]);

  const handleSendMessage = () => {
    if (!messageInput.trim() || !activeChatId) return;
    const msg: Message = {
      id: Date.now().toString(),
      role: "assistant",
      content: messageInput,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      senderName: "Agente",
    };
    setChats(prev => prev.map(c =>
      c.id === activeChatId
        ? { ...c, messages: [...c.messages, msg], lastMessage: messageInput, timestamp: msg.timestamp }
        : c
    ));
    setMessageInput("");
  };

  const isConnected = connectionStatus?.state === "open";

  return (
    <div className="flex h-[calc(100vh-5rem)] overflow-hidden rounded-2xl border shadow-xl bg-background/60 backdrop-blur-xl animate-in fade-in duration-500">

      {/* ── LEFT: Conversation List ── */}
      <div className="w-[340px] shrink-0 border-r flex flex-col bg-card/30 backdrop-blur-sm">
        {/* Header */}
        <div className="px-5 pt-5 pb-3 border-b space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <MessageSquare className="h-4.5 w-4.5 text-primary" />
              </div>
              <h2 className="text-lg font-bold tracking-tight">Conversas</h2>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
              </span>
            </div>
            <div className="flex items-center gap-1">
              {!isConnected && (
                <Button variant="ghost" size="icon" className="h-8 w-8 text-amber-500" onClick={handleConnect} title="Conectar WhatsApp">
                  <AlertTriangle className="h-4 w-4" />
                </Button>
              )}
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                <SlidersHorizontal className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                <UserPlus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Filter chip */}
          <div className="flex gap-2">
            <div className="flex items-center gap-1.5 bg-primary/5 hover:bg-primary/10 border border-primary/10 rounded-full px-3 py-1 text-[11px] font-semibold text-primary cursor-pointer transition-all active:scale-95">
              Status Especial
              <X className="h-3 w-3 ml-1 opacity-60 hover:opacity-100" />
            </div>
            <div className="flex items-center gap-1.5 bg-muted/50 hover:bg-muted border border-transparent rounded-full px-3 py-1 text-[11px] font-semibold text-muted-foreground cursor-pointer transition-all active:scale-95">
              Etiqueta
              <ChevronDown className="h-3 w-3 ml-1 opacity-60" />
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 p-1 bg-muted/40 rounded-lg">
            {(["Meus", "Fila", "Todos"] as const).map(t => {
              const key = t.toLowerCase() as ChatTab;
              const isActive = activeTab === key;
              return (
                <button
                  key={t}
                  onClick={() => setActiveTab(key)}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${
                    isActive
                      ? "bg-white shadow-sm text-primary ring-1 ring-black/5"
                      : "text-muted-foreground hover:text-foreground hover:bg-white/50"
                  }`}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </div>

        {/* Search */}
        <div className="px-4 py-3 border-b bg-card/20">
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
            <Input
              placeholder="Buscar por nome ou telefone..."
              className="pl-9 h-10 bg-background/50 border-muted focus:bg-background focus:ring-primary/20 transition-all text-sm rounded-xl"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        {/* Chat list */}
        <ScrollArea className="flex-1">
          <div className="divide-y divide-border/50">
            {filteredChats.map(chat => {
              const isActive = activeChatId === chat.id;
              return (
                <div
                  key={chat.id}
                  onClick={() => setActiveChatId(chat.id)}
                  className={`flex items-start gap-4 px-5 py-4 cursor-pointer transition-all relative group ${
                    isActive 
                      ? "bg-primary/[0.04] after:absolute after:left-0 after:top-0 after:bottom-0 after:w-1 after:bg-primary" 
                      : "hover:bg-muted/30"
                  }`}
                >
                  {/* Avatar */}
                  <div className="relative shrink-0">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-bold text-base uppercase transition-transform group-hover:scale-105 ${
                      isActive ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20" : "bg-primary/10 text-primary"
                    }`}>
                      {chat.name[0]}
                    </div>
                    {chat.online && (
                      <span className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 border-2 border-background rounded-full shadow-sm" />
                    )}
                  </div>
                  {/* Info */}
                  <div className="flex-1 min-w-0 py-0.5">
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-sm font-bold truncate ${isActive ? "text-primary" : "text-foreground"}`}>
                        {chat.name}
                      </span>
                      <span className="text-[10px] font-medium text-muted-foreground shrink-0 ml-2">{chat.timestamp}</span>
                    </div>
                    
                    <div className="flex items-center gap-1.5 mb-1.5">
                      {chat.source && (
                        <span className="text-[9px] px-1.5 py-0.5 bg-muted font-bold text-muted-foreground rounded tracking-tight uppercase">
                          {chat.source}
                        </span>
                      )}
                      {chat.tag && (
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide shadow-sm ${TAG_COLORS[chat.tag] ?? "bg-gray-100 text-gray-600"}`}>
                          {chat.tag}
                        </span>
                      )}
                    </div>

                    <p className={`text-xs truncate ${isActive ? "text-foreground/80 font-medium" : "text-muted-foreground"}`}>
                      {chat.lastMessage}
                    </p>
                  </div>
                  {chat.unread ? (
                    <div className="min-w-[20px] h-5 px-1.5 rounded-full bg-green-500 text-white text-[10px] flex items-center justify-center font-black shadow-lg shadow-green-500/20 shrink-0 animate-in zoom-in">
                      {chat.unread}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      {/* ── CENTER: Chat Area ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* QR Code screen */}
        {!isConnected && qrData?.qrCode ? (
          <div className="flex-1 flex flex-col items-center justify-center bg-[#f0f2f5] p-8 text-center space-y-6">
            <div className="p-5 bg-white rounded-2xl shadow-lg border">
              {qrData.qrCode.startsWith("data:image") ? (
                <img src={qrData.qrCode} alt="QR Code" className="w-56 h-56" />
              ) : (
                <div className="w-56 h-56 flex items-center justify-center bg-muted/20 rounded-xl">
                  <p className="text-xs text-muted-foreground">QR Code indisponível</p>
                </div>
              )}
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-bold">Conecte seu WhatsApp</h3>
              <p className="text-sm text-muted-foreground max-w-xs">
                Abra o WhatsApp → Dispositivos conectados → Conectar dispositivo
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => checkStatus(false)}>
              <RefreshCw className="h-4 w-4 mr-2" /> Já escaneei
            </Button>
          </div>
        ) : activeChat ? (
          <>
            {/* Chat header */}
            <div className="flex items-center justify-between px-6 py-4 border-b bg-background/40 backdrop-blur-md shrink-0 z-10 shadow-sm">
              <div className="flex items-center gap-4">
                <div className="w-11 h-11 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center font-bold text-lg text-primary uppercase shadow-inner">
                  {activeChat.name[0]}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-base font-bold tracking-tight">{activeChat.name}</p>
                    <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
                  </div>
                  <p className="text-[11px] font-medium text-muted-foreground">
                    <span className="text-primary font-bold">✓ {activeChat.source ?? "CRM"}</span> · {activeChat.phone}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button variant="outline" size="icon" className="h-10 w-10 rounded-xl hover:bg-primary/5 hover:text-primary transition-colors">
                  <Phone className="h-4.5 w-4.5" />
                </Button>
                <div className="flex items-stretch rounded-xl overflow-hidden shadow-lg shadow-green-500/20 border border-green-500/30">
                  <button className="flex items-center gap-2 px-5 py-2 bg-green-500 hover:bg-green-600 text-white text-xs font-bold transition-all active:scale-95">
                    <Check className="h-4 w-4" /> Resolver Conversa
                  </button>
                  <button className="px-2.5 bg-green-500 hover:bg-green-600 text-white border-l border-white/20 transition-colors">
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </div>
                <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl text-muted-foreground hover:bg-muted transition-colors">
                  <Info className="h-4.5 w-4.5" />
                </Button>
              </div>
            </div>

            {/* Messages */}
            <ScrollArea className="flex-1 bg-muted/10 relative">
              {/* WhatsApp background pattern (using CSS) */}
              <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[url('https://web.whatsapp.com/img/bg-chat-tile-dark_a4be512e71aaddda92969c3641b2cc2f.png')] dark:opacity-[0.05]" />
              
              <div className="px-8 py-6 space-y-1 relative z-1">
                {activeChat.messages.map((m, i) => {
                  const isOut = m.role === "assistant";
                  const prevRole = i > 0 ? activeChat.messages[i - 1].role : null;
                  const showName = !isOut && prevRole !== "user";
                  return (
                    <div key={m.id} className={`flex ${isOut ? "justify-end" : "justify-start"} ${i > 0 && activeChat.messages[i-1].role === m.role ? "mt-0.5" : "mt-4"}`}>
                      <div className={`max-w-[70%] rounded-2xl px-4 py-2.5 shadow-sm relative animate-in slide-in-from-bottom-2 duration-300 ${
                        isOut 
                          ? "bg-primary text-primary-foreground rounded-tr-none shadow-primary/10" 
                          : "bg-background rounded-tl-none border border-border/50 shadow-black/[0.02]"
                      }`}>
                        {showName && (
                          <p className="text-[11px] font-black text-primary mb-1 uppercase tracking-wider">{m.senderName ?? activeChat.name}</p>
                        )}
                        <p className="text-sm leading-relaxed whitespace-pre-wrap font-medium">{m.content}</p>
                        <div className={`flex items-center justify-end gap-1.5 mt-1.5 ${isOut ? "text-primary-foreground/70" : "text-muted-foreground/60"}`}>
                          <span className="text-[10px] font-bold">{m.timestamp}</span>
                          {isOut && <Check className="h-3 w-3 opacity-80" />}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            {/* Input */}
            <div className="border-t bg-background/50 backdrop-blur-lg shrink-0 p-4">
              <div className="flex gap-4 p-1 bg-muted/40 rounded-xl mb-3 w-fit">
                <button
                  onClick={() => setInputMode("responder")}
                  className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${inputMode === "responder" ? "bg-background shadow-sm text-primary ring-1 ring-black/5" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Responder
                </button>
                <button
                  onClick={() => setInputMode("nota")}
                  className={`flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${inputMode === "nota" ? "bg-amber-500 shadow-sm text-white ring-1 ring-black/5" : "text-muted-foreground hover:text-foreground"}`}
                >
                  <Info className="h-3 w-3" /> Nota Privada
                </button>
              </div>
              
              <div className="bg-background rounded-2xl border border-border/50 shadow-sm overflow-hidden focus-within:ring-2 focus-within:ring-primary/20 transition-all">
                <div className="px-4 py-3 bg-muted/20 border-b border-border/30 flex items-center justify-between">
                  <p className="text-[11px] font-bold text-muted-foreground/70 uppercase tracking-widest">
                    {inputMode === "nota" ? "Anotando privadamente..." : "Enviando como Agente..."}
                  </p>
                  <p className="text-[10px] font-medium text-muted-foreground/50 italic">
                    Shift + Enter para nova linha
                  </p>
                </div>
                
                <div className="p-2 flex items-end gap-2">
                  <div className="flex-1 relative">
                    <textarea
                      placeholder={inputMode === "nota" ? "O que aconteceu nesta conversa?" : "Escreva sua mensagem aqui..."}
                      className="w-full min-h-[80px] max-h-[200px] p-3 text-sm bg-transparent border-none focus:ring-0 resize-none font-medium placeholder:text-muted-foreground/40"
                      value={messageInput}
                      onChange={e => setMessageInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSendMessage();
                        }
                      }}
                    />
                  </div>
                  <div className="flex flex-col gap-2 p-1">
                    <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl hover:bg-primary/5 hover:text-primary transition-colors">
                      <Paperclip className="h-5 w-5" />
                    </Button>
                    <Button 
                      className={`h-9 w-9 rounded-xl shadow-lg transition-all active:scale-90 ${messageInput.trim() ? "bg-primary hover:bg-primary/90 shadow-primary/20" : "bg-muted text-muted-foreground opacity-50"}`}
                      disabled={!messageInput.trim()}
                      onClick={handleSendMessage}
                    >
                      <Send className="h-4.5 w-4.5" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : (
          /* Empty state */
          <div className="flex-1 flex flex-col items-center justify-center bg-muted/5 text-center p-8 gap-6 animate-in fade-in duration-700">
            <div className="w-24 h-24 rounded-3xl bg-primary/5 shadow-inner flex items-center justify-center animate-bounce duration-[3000ms]">
              <MessageSquare className="h-10 w-10 text-primary/30" />
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-bold tracking-tight">Suas conversas aparecem aqui</h3>
              <p className="text-sm text-muted-foreground/70 max-w-[280px] mx-auto leading-relaxed">
                Selecione um contato na lista ao lado para começar a interagir ou visualizar o histórico.
              </p>
            </div>
            {!isConnected && !loadingStatus && (
              <Button onClick={handleConnect} disabled={connecting} size="lg" className="rounded-2xl shadow-xl shadow-primary/20 gap-2 font-bold px-8">
                {connecting ? <Loader2 className="h-5 w-5 animate-spin" /> : <QrCode className="h-5 w-5" />}
                Conectar WhatsApp
              </Button>
            )}
          </div>
        )}
      </div>

      {/* ── RIGHT: Contact Profile Panel ── */}
      {activeChat && (
        <div className="w-[300px] shrink-0 border-l bg-card/20 backdrop-blur-md flex flex-col animate-in slide-in-from-right duration-500">
          {/* Panel header */}
          <div className="flex items-center justify-between px-5 py-4 border-b bg-background/40">
            <h3 className="text-sm font-bold tracking-tight">Detalhes do Contato</h3>
            <Button
              variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-muted"
              onClick={() => setActiveChatId(null)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <ScrollArea className="flex-1">
            {/* Avatar + name + phone */}
            <div className="flex flex-col items-center pt-8 pb-6 px-5 bg-gradient-to-b from-primary/[0.03] to-transparent">
              <div className="w-24 h-24 rounded-[2rem] bg-primary/10 border-4 border-background flex items-center justify-center text-3xl font-black text-primary uppercase mb-4 shadow-xl shadow-primary/10 transition-transform hover:scale-105 duration-500">
                {activeChat.name[0]}
              </div>
              <div className="flex items-center gap-2 mb-1.5">
                <p className="font-black text-base tracking-tight">{activeChat.name}</p>
                <button className="p-1 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="bg-muted/50 rounded-full px-4 py-1 flex flex-col items-center">
                <p className="text-[9px] text-muted-foreground/60 uppercase font-black tracking-[0.15em] mb-0.5">
                  WhatsApp Principal
                </p>
                <p className="text-xs font-bold text-foreground/80 leading-none pb-0.5">{activeChat.phone}</p>
              </div>
            </div>

            {/* CRM Button */}
            <div className="px-5 pb-6">
              <Button className="w-full h-11 text-xs font-black gap-2.5 bg-primary hover:bg-primary/90 text-white rounded-2xl shadow-lg shadow-primary/20 transition-all active:scale-95">
                <LayoutGrid className="h-4 w-4" />
                ABRIR NO CRM
              </Button>
            </div>

            {/* Mídia, Links e Docs */}
            <div className="border-t border-border/40 px-5 py-5">
            <div className="flex items-center justify-between mb-4">
                <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">Mídia Recente</p>
                <ChevronRight className="h-4 w-4 text-muted-foreground/40" />
              </div>
              <div className="grid grid-cols-3 gap-2.5">
                {[0, 1, 2, 3, 4, 5].map(i => (
                  <div
                    key={i}
                    className="aspect-square rounded-xl bg-primary/5 flex items-center justify-center cursor-pointer hover:bg-primary/10 border border-primary/5 transition-all hover:scale-105"
                  >
                    <Mic className="h-5 w-5 text-primary/40" />
                  </div>
                ))}
              </div>
            </div>

            {/* Observações do CRM */}
            <div className="border-t border-border/40 px-5 py-5 bg-amber-500/[0.02]">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-black uppercase tracking-widest text-amber-600/70">Anotações do CRM</p>
                <button className="p-1 rounded-md text-amber-600/40 hover:text-amber-600 hover:bg-amber-500/10 transition-all">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>
              {activeChat.notes ? (
                <p className="text-xs font-medium text-foreground/80 leading-relaxed bg-white/50 p-3 rounded-xl border border-amber-500/10 italic">"{activeChat.notes}"</p>
              ) : (
                <div className="flex flex-col items-center justify-center py-4 px-2 bg-muted/20 rounded-xl border border-dashed border-muted-foreground/20">
                  <Plus className="h-4 w-4 text-muted-foreground/30 mb-1" />
                  <p className="text-[10px] font-bold text-muted-foreground/40 uppercase tracking-tighter">Sem anotações</p>
                </div>
              )}
            </div>

            {/* Cofre de Documentos */}
            <div className="border-t border-border/40 px-5 py-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">Documentos</p>
                <button className="p-1 rounded-md text-muted-foreground/40 hover:text-primary hover:bg-primary/10 transition-all">
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="bg-muted/10 border border-dashed border-border p-4 rounded-xl flex flex-col items-center">
                <Plus className="h-4 w-4 text-muted-foreground/20 mb-1" />
                <p className="text-[10px] font-black text-muted-foreground/30 uppercase tracking-tighter">Adicionar Arquivo</p>
              </div>
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
