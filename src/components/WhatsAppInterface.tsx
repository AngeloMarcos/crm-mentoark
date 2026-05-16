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
    <div className="flex h-[calc(100vh-5rem)] overflow-hidden rounded-xl border shadow-sm bg-background">

      {/* ── LEFT: Conversation List ── */}
      <div className="w-[320px] shrink-0 border-r flex flex-col bg-white">
        {/* Header */}
        <div className="px-4 pt-4 pb-2 border-b space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold">Conversas</h2>
              <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
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
            <div className="flex items-center gap-1 bg-muted/60 rounded-full px-3 py-1 text-xs font-medium text-foreground cursor-pointer">
              Status Especi...
              <X className="h-3 w-3 ml-1 text-muted-foreground" />
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b -mb-2">
            {(["Meus", "Fila", "Todos"] as const).map(t => {
              const key = t.toLowerCase() as ChatTab;
              return (
                <button
                  key={t}
                  onClick={() => setActiveTab(key)}
                  className={`flex-1 py-2 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === key
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </div>

        {/* Search */}
        <div className="px-3 py-2 border-b bg-white">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar..."
              className="pl-9 h-9 bg-muted/40 border-none text-sm"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        {/* Chat list */}
        <ScrollArea className="flex-1">
          {filteredChats.map(chat => (
            <div
              key={chat.id}
              onClick={() => setActiveChatId(chat.id)}
              className={`flex items-start gap-3 px-3 py-3 cursor-pointer border-b hover:bg-muted/30 transition-colors ${
                activeChatId === chat.id ? "bg-primary/5 border-l-2 border-l-primary" : ""
              }`}
            >
              {/* Avatar */}
              <div className="relative shrink-0">
                <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center font-bold text-sm text-primary uppercase">
                  {chat.name[0]}
                </div>
                {chat.online && (
                  <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white rounded-full" />
                )}
              </div>
              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-sm font-semibold truncate">{chat.name}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0 ml-1">{chat.timestamp}</span>
                </div>
                {chat.source && (
                  <p className="text-[10px] text-muted-foreground font-medium mb-0.5 uppercase tracking-wide">
                    ✓ {chat.source}
                  </p>
                )}
                <p className="text-xs text-muted-foreground truncate">{chat.lastMessage}</p>
                {chat.tag && (
                  <span className={`inline-block mt-1 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide ${TAG_COLORS[chat.tag] ?? "bg-gray-100 text-gray-600"}`}>
                    {chat.tag}
                  </span>
                )}
              </div>
              {chat.unread ? (
                <div className="w-5 h-5 rounded-full bg-green-500 text-white text-[10px] flex items-center justify-center font-bold shrink-0 mt-1">
                  {chat.unread}
                </div>
              ) : null}
            </div>
          ))}
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
            <div className="flex items-center justify-between px-4 py-3 border-b bg-white shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center font-bold text-sm text-primary uppercase">
                  {activeChat.name[0]}
                </div>
                <div>
                  <p className="text-sm font-semibold">{activeChat.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    via {activeChat.source ?? "teste"} · {activeChat.phone}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                  <Phone className="h-4 w-4" />
                </Button>
                <div className="flex items-stretch rounded-lg overflow-hidden border border-green-500">
                  <button className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white text-xs font-semibold transition-colors">
                    <Check className="h-3.5 w-3.5" /> Resolver
                  </button>
                  <button className="px-1.5 bg-green-500 hover:bg-green-600 text-white border-l border-green-400 transition-colors">
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                  <Info className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Messages */}
            <ScrollArea className="flex-1 bg-[#efeae2]">
              <div className="px-6 py-4 space-y-1">
                {activeChat.messages.map((m, i) => {
                  const isOut = m.role === "assistant";
                  const prevRole = i > 0 ? activeChat.messages[i - 1].role : null;
                  const showName = !isOut && prevRole !== "user";
                  return (
                    <div key={m.id} className={`flex ${isOut ? "justify-end" : "justify-start"} ${i > 0 && activeChat.messages[i-1].role === m.role ? "mt-0.5" : "mt-3"}`}>
                      <div className={`max-w-[65%] rounded-lg px-3 py-1.5 shadow-sm relative ${isOut ? "bg-[#d9fdd3] rounded-tr-none" : "bg-white rounded-tl-none"}`}>
                        {showName && (
                          <p className="text-[11px] font-bold text-primary mb-0.5">{m.senderName ?? activeChat.name}</p>
                        )}
                        <p className="text-sm leading-snug whitespace-pre-wrap">{m.content}</p>
                        <div className={`flex items-center justify-end gap-1 mt-0.5 ${isOut ? "text-green-700/70" : "text-muted-foreground"}`}>
                          <span className="text-[10px]">{m.timestamp}</span>
                          {isOut && <Check className="h-3 w-3" />}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            {/* Input */}
            <div className="border-t bg-white shrink-0">
              <div className="px-4 pt-2 pb-1 flex gap-3 border-b">
                <button
                  onClick={() => setInputMode("responder")}
                  className={`text-xs font-medium pb-1 border-b-2 transition-colors ${inputMode === "responder" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
                >
                  Responder
                </button>
                <button
                  onClick={() => setInputMode("nota")}
                  className={`flex items-center gap-1 text-xs font-medium pb-1 border-b-2 transition-colors ${inputMode === "nota" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
                >
                  🔒 Nota Privada
                </button>
              </div>
              <div className="px-4 py-2">
                <p className="text-[11px] text-muted-foreground mb-2">
                  Shift + enter para pular linha. Use '/' para atalhos rápidos.
                </p>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <Input
                      placeholder={inputMode === "nota" ? "Adicionar nota privada..." : "Digite uma mensagem..."}
                      className={`border-none bg-transparent p-0 shadow-none focus-visible:ring-0 text-sm resize-none ${inputMode === "nota" ? "text-amber-700" : ""}`}
                      value={messageInput}
                      onChange={e => setMessageInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
                      }}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between mt-2 pt-2 border-t">
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                      <Smile className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                      <Paperclip className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                      <span className="text-xs">A</span>
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                      <span className="text-xs font-bold">⚡</span>
                    </Button>
                  </div>
                  <Button
                    size="icon"
                    className="h-9 w-9 rounded-full bg-green-500 hover:bg-green-600 text-white shrink-0"
                    onClick={handleSendMessage}
                  >
                    <Mic className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </>
        ) : (
          /* Empty state */
          <div className="flex-1 flex flex-col items-center justify-center bg-[#f0f2f5] text-center gap-4">
            <div className="w-20 h-20 rounded-full bg-white/80 shadow flex items-center justify-center">
              <MessageSquare className="h-9 w-9 text-muted-foreground/40" />
            </div>
            <div className="space-y-1">
              <p className="font-semibold text-muted-foreground">Selecione uma conversa</p>
              <p className="text-sm text-muted-foreground/60">
                para visualizar as mensagens e o perfil do contato
              </p>
            </div>
            {!isConnected && !loadingStatus && (
              <Button onClick={handleConnect} disabled={connecting} size="sm" className="mt-2">
                {connecting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <QrCode className="h-4 w-4 mr-2" />}
                Conectar WhatsApp
              </Button>
            )}
          </div>
        )}
      </div>

      {/* ── RIGHT: Contact Profile Panel ── */}
      {activeChat && (
        <div className="w-[280px] shrink-0 border-l bg-white flex flex-col">
          {/* Panel header */}
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <h3 className="text-sm font-semibold">Perfil do Contato</h3>
            <Button
              variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground"
              onClick={() => setActiveChatId(null)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <ScrollArea className="flex-1">
            {/* Avatar + name + phone */}
            <div className="flex flex-col items-center pt-6 pb-4 px-4">
              <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary uppercase mb-3 ring-4 ring-primary/5">
                {activeChat.name[0]}
              </div>
              <div className="flex items-center gap-1.5 mb-1">
                <p className="font-bold text-sm">{activeChat.name}</p>
                <button className="text-muted-foreground hover:text-foreground transition-colors">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium mb-0.5">
                Telefone / WhatsApp
              </p>
              <p className="text-sm font-medium">{activeChat.phone}</p>
            </div>

            {/* CRM Button */}
            <div className="px-4 pb-4">
              <Button className="w-full h-9 text-sm font-semibold gap-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg">
                <LayoutGrid className="h-4 w-4" />
                Acessar Painel CRM
              </Button>
            </div>

            {/* Mídia, Links e Docs */}
            <div className="border-t px-4 py-3">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold">Mídia, Links e Docs</p>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[0, 1, 2, 3, 4, 5].map(i => (
                  <div
                    key={i}
                    className="aspect-square rounded-lg bg-orange-50 flex items-center justify-center cursor-pointer hover:bg-orange-100 transition-colors"
                  >
                    <Mic className="h-5 w-5 text-orange-400" />
                  </div>
                ))}
              </div>
            </div>

            {/* Observações do CRM */}
            <div className="border-t px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold">Observações do CRM</p>
                <button className="text-muted-foreground hover:text-foreground transition-colors">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>
              {activeChat.notes ? (
                <p className="text-xs text-foreground leading-relaxed">{activeChat.notes}</p>
              ) : (
                <p className="text-xs text-muted-foreground italic">Nenhuma observação neste cliente.</p>
              )}
            </div>

            {/* Cofre de Documentos */}
            <div className="border-t px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold">Cofre de Documentos</p>
                <button className="text-muted-foreground hover:text-foreground transition-colors">
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="text-xs text-muted-foreground italic">Nenhum documento salvo.</p>
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
