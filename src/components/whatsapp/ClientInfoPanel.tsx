import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Phone, User, Calendar, Bot, Loader2 } from 'lucide-react';
import type { ConversaDB } from '@/types/whatsappChat';
import { supabase } from '@/integrations/supabase/client';

interface ClientInfoPanelProps {
  conversa: ConversaDB | null;
}

interface ClientData {
  id: number;
  nome: string | null;
  telefone: string;
  setor: string | null;
  created_at?: string | null;
}

export function ClientInfoPanel({ conversa }: ClientInfoPanelProps) {
  const [client, setClient] = useState<ClientData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!conversa?.phone) { setClient(null); return; }
    setLoading(true);
    (async () => {
      try {
        const digits = conversa.phone.replace(/\D/g, "");
        const { data } = await supabase
          .from("dados_cliente")
          .select("id, nomewpp, Setor, created_at")
          .ilike("telefone", `%${digits.slice(-9)}%`)
          .maybeSingle();

        if (data) {
          setClient({
            id: data.id,
            nome: data.nomewpp,
            telefone: conversa.phone,
            setor: data.Setor,
            created_at: data.created_at,
          });
        } else {
          setClient(null);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    })();
  }, [conversa?.phone]);

  if (!conversa) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 px-4 text-center">
        <User className="w-12 h-12 text-muted-foreground/20" />
        <p className="text-xs text-muted-foreground">
          Selecione uma conversa para ver as informações do cliente.
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-4">
        <div className="flex flex-col items-center gap-2">
          <Avatar className="h-16 w-16">
            <AvatarFallback className="text-lg bg-primary/10 text-primary font-semibold">
              {(client?.nome || conversa.nome_cliente || conversa.phone.slice(-2)).slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <h3 className="text-sm font-semibold text-foreground text-center">
            {client?.nome || conversa.nome_cliente || 'Lead não identificado'}
          </h3>
        </div>
        <Separator />

        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <User className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="font-medium truncate">{client?.nome || 'Sem nome'}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">{conversa.phone}</span>
              </div>
              {client?.setor && (
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[10px] uppercase tracking-wider">{client.setor}</Badge>
                </div>
              )}
              {client?.created_at && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5 shrink-0" />
                  Desde {new Date(client.created_at).toLocaleDateString('pt-BR')}
                </div>
              )}
            </div>

            <Separator />
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Atividade</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-muted/50 p-2 text-center">
                  <p className="text-lg font-bold text-foreground">{conversa.message_count}</p>
                  <p className="text-[10px] text-muted-foreground">Msgs</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-2 text-center">
                  <p className="text-lg font-bold text-foreground capitalize text-sm">{conversa.status}</p>
                  <p className="text-[10px] text-muted-foreground">Status</p>
                </div>
              </div>
            </div>

            <Separator />
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Bot className="h-3.5 w-3.5 text-primary" />
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Inteligência Artificial</p>
              </div>
              <div className="rounded-lg bg-primary/5 border border-primary/10 p-2.5">
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {conversa.status === 'active' 
                    ? 'O agente IA está monitorando e respondendo esta conversa automaticamente.' 
                    : 'Conversa finalizada ou inativa.'}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
