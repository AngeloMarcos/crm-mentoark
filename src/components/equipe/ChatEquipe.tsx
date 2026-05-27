import { useState, useEffect, useRef } from "react";
import { useEquipeChat } from "@/hooks/useEquipeChat";
import { useAuth } from "@/hooks/useAuth";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Send } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";

interface ChatEquipeProps {
  equipeId: string;
}

function iniciais(nome?: string, email?: string) {
  const base = (nome || email || "?").trim();
  const parts = base.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

export function ChatEquipe({ equipeId }: ChatEquipeProps) {
  const { user } = useAuth();
  const { mensagens, loading, enviarMensagem } = useEquipeChat(equipeId);
  const [novoTexto, setNovoTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll para o final
  useEffect(() => {
    if (scrollRef.current) {
      const scrollContainer = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [mensagens]);

  const handleEnviar = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!novoTexto.trim() || enviando) return;

    setEnviando(true);
    try {
      await enviarMensagem(novoTexto.trim());
      setNovoTexto("");
    } catch (error) {
      console.error("Erro ao enviar mensagem:", error);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="flex flex-col h-[500px]">
      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
        <div className="space-y-4">
          {loading && mensagens.length === 0 ? (
            <div className="text-center py-4 text-sm text-muted-foreground">
              Carregando mensagens...
            </div>
          ) : mensagens.length === 0 ? (
            <div className="text-center py-4 text-sm text-muted-foreground">
              Nenhuma mensagem ainda. Comece a conversa!
            </div>
          ) : (
            mensagens.map((msg) => {
              const isMe = msg.user_id === user?.id;
              return (
                <div
                  key={msg.id}
                  className={`flex items-start gap-2 ${
                    isMe ? "flex-row-reverse" : "flex-row"
                  }`}
                >
                  <Avatar className="h-8 w-8 mt-1">
                    <AvatarFallback className="text-[10px]">
                      {iniciais(msg.nome, msg.email)}
                    </AvatarFallback>
                  </Avatar>
                  <div
                    className={`flex flex-col max-w-[80%] ${
                      isMe ? "items-end" : "items-start"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold">
                        {isMe ? "Você" : msg.nome || msg.email}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {format(new Date(msg.created_at), "HH:mm")}
                      </span>
                    </div>
                    <div
                      className={`px-3 py-2 rounded-lg text-sm break-words w-full ${
                        isMe
                          ? "bg-primary text-primary-foreground rounded-tr-none"
                          : "bg-muted text-foreground rounded-tl-none"
                      }`}
                    >
                      {msg.conteudo}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>

      <form
        onSubmit={handleEnviar}
        className="p-4 border-t flex gap-2 items-center bg-background"
      >
        <Input
          placeholder="Mensagem para a equipe..."
          value={novoTexto}
          onChange={(e) => setNovoTexto(e.target.value)}
          disabled={enviando}
          className="flex-1"
        />
        <Button size="icon" type="submit" disabled={!novoTexto.trim() || enviando}>
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
