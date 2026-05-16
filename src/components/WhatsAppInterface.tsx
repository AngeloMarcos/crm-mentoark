import { useState, useMemo, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, User, Bot, Send, Phone, MoreVertical, Paperclip, Smile } from "lucide-react";

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
  lastMessage: string;
  timestamp: string;
  unread?: number;
  online?: boolean;
  avatar?: string;
  messages: Message[];
}

export function WhatsAppInterface() {
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [messageInput, setMessageInput] = useState("");

  // Dados mockados baseados no layout do Aesir ERP
  const [chats, setChats] = useState<Chat[]>([
    {
      id: "1",
      name: "João Silva",
      phone: "+55 (11) 98888-7777",
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

  return (
    <div className="flex h-[calc(100vh-12rem)] border rounded-2xl overflow-hidden bg-background shadow-sm">
      {/* Sidebar - Lista de Conversas */}
      <div className="w-80 md:w-96 border-r flex flex-col bg-muted/5">
        <div className="p-4 border-b space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold tracking-tight">Conversas</h2>
            <Badge variant="outline" className="rounded-full">{chats.length}</Badge>
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
              className={`p-4 flex items-start gap-3 cursor-pointer transition-colors hover:bg-muted/50 ${activeChatId === chat.id ? 'bg-primary/5 border-r-2 border-r-primary' : ''}`}
            >
              <div className="relative shrink-0">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <User className="h-6 w-6 text-primary" />
                </div>
                {chat.online && (
                  <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-background rounded-full"></span>
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
                <Badge className="ml-2 h-5 w-5 flex items-center justify-center rounded-full p-0 text-[10px]">
                  {chat.unread}
                </Badge>
              ) : null}
            </div>
          ))}
        </ScrollArea>
      </div>

      {/* Área do Chat */}
      <div className="flex-1 flex flex-col bg-muted/5">
        {activeChat ? (
          <>
            {/* Header do Chat */}
            <div className="p-4 border-b bg-background flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <User className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-bold text-sm">{activeChat.name}</p>
                  <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Phone className="h-3 w-3" /> {activeChat.phone}
                  </p>
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

            {/* Mensagens */}
            <ScrollArea className="flex-1 p-6 bg-[url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')] bg-repeat">
              <div className="space-y-4">
                {activeChat.messages.map((m) => {
                  const isAssistant = m.role === 'assistant';
                  return (
                    <div 
                      key={m.id} 
                      className={`flex ${isAssistant ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className={`max-w-[70%] rounded-2xl px-4 py-2 shadow-sm ${isAssistant ? 'bg-primary text-primary-foreground rounded-tr-none' : 'bg-background rounded-tl-none'}`}>
                        <p className="text-sm leading-relaxed">{m.content}</p>
                        <p className={`text-[10px] mt-1 text-right opacity-70`}>
                          {m.timestamp}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>

            {/* Input de Mensagem */}
            <div className="p-4 bg-background border-t">
              <div className="flex items-center gap-2 bg-muted/30 rounded-2xl p-2 px-4">
                <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground">
                  <Smile className="h-5 w-5" />
                </Button>
                <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground">
                  <Paperclip className="h-5 w-5" />
                </Button>
                <Input 
                  placeholder="Digite sua mensagem..." 
                  className="border-none bg-transparent focus-visible:ring-0 shadow-none h-10"
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                />
                <Button 
                  size="icon" 
                  className="shrink-0 rounded-xl h-9 w-9"
                  onClick={handleSendMessage}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 space-y-4">
            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
              <Bot className="h-10 w-10 text-primary" />
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-bold">Selecione uma conversa</h3>
              <p className="text-muted-foreground max-w-xs">
                Escolha um contato na lateral para visualizar o histórico de mensagens e interagir.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
