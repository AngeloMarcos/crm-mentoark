import { useEffect, useRef } from 'react';
import { MessageCircle, Image as ImageIcon, Bot, User } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import type { MensagemDB, ConversaDB } from '@/types/whatsappChat';

interface ChatWindowProps {
  conversa: ConversaDB | null;
  mensagens: MensagemDB[];
  loading: boolean;
}

function formatTime(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return 'Hoje';
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Ontem';
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch { return ''; }
}

function groupMessagesByDate(msgs: MensagemDB[]): { date: string; messages: MensagemDB[] }[] {
  const groups: { date: string; messages: MensagemDB[] }[] = [];
  let currentDate = '';
  for (const m of msgs) {
    const d = formatDate(m.created_at);
    if (d !== currentDate) {
      currentDate = d;
      groups.push({ date: d, messages: [m] });
    } else {
      groups[groups.length - 1].messages.push(m);
    }
  }
  return groups;
}

export function ChatWindow({ conversa, mensagens, loading }: ChatWindowProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mensagens]);

  if (!conversa) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
        <MessageCircle className="h-12 w-12 opacity-20" />
        <div className="text-center space-y-1 max-w-xs px-4">
          <p className="text-sm font-medium text-foreground/60">Selecione uma conversa</p>
          <p className="text-xs text-muted-foreground">Escolha um contato ao lado para ver o histórico de conversas.</p>
        </div>
      </div>
    );
  }

  const groups = groupMessagesByDate(mensagens);

  return (
    <div className="flex flex-col h-full bg-muted/5">
      <div className="border-b border-border px-4 py-3 bg-card flex items-center gap-3">
        <Avatar className="h-9 w-9">
          <AvatarFallback className="text-xs bg-primary/10 text-primary font-semibold">
            {(conversa.nome_cliente || conversa.phone).slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{conversa.nome_cliente || conversa.phone}</p>
          <p className="text-[11px] text-muted-foreground">{conversa.phone}</p>
        </div>
      </div>

      <ScrollArea className="flex-1 px-4 py-3">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        ) : mensagens.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <MessageCircle className="h-8 w-8 text-muted-foreground/30" />
            <p className="text-xs text-muted-foreground text-center">Nenhuma mensagem ainda.</p>
          </div>
        ) : (
          <div className="space-y-1">
            {groups.map((group) => (
              <div key={group.date}>
                <div className="flex justify-center my-3">
                  <span className="px-3 py-1 rounded-full bg-muted text-[10px] text-muted-foreground font-medium">
                    {group.date}
                  </span>
                </div>
                <div className="space-y-2">
                  {group.messages.map((m) => (
                    <div
                      key={m.id}
                      className={cn('flex', m.role === 'user' ? 'justify-start' : 'justify-end')}
                    >
                      <div
                        className={cn(
                          'rounded-2xl px-3.5 py-2 max-w-[85%] shadow-sm',
                          m.role === 'user'
                            ? 'bg-card border border-border rounded-bl-sm'
                            : 'bg-primary text-primary-foreground rounded-br-sm'
                        )}
                      >
                        <div className="flex items-center gap-1.5 mb-1 opacity-70">
                          {m.role === 'user' ? (
                            <><User className="h-3 w-3" /><span className="text-[10px] font-medium">Cliente</span></>
                          ) : (
                            <><Bot className="h-3 w-3" /><span className="text-[10px] font-medium">Agente IA</span></>
                          )}
                        </div>
                        <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">{m.content}</p>
                        <p className={cn(
                          'text-[10px] mt-1 text-right opacity-60'
                        )}>
                          {formatTime(m.created_at)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
