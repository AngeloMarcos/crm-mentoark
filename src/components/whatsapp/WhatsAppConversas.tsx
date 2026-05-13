import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LogOut, RefreshCw, Smartphone } from 'lucide-react';
import { ConversationList } from './ConversationList';
import { ChatWindow } from './ChatWindow';
import { ChatInput } from './ChatInput';
import { ClientInfoPanel } from './ClientInfoPanel';
import { WhatsAppConnector } from './WhatsAppConnector';
import { useConversas } from '@/hooks/useConversas';
import { useMensagens } from '@/hooks/useMensagens';
import { fetchConnectionStatus, disconnectInstance } from '@/services/evolutionService';
import { toast } from 'sonner';
import type { ConversaDB } from '@/types/whatsappChat';

export function WhatsAppConversas() {
  const [activeConversa, setActiveConversa] = useState<ConversaDB | null>(null);
  const [connectionState, setConnectionState] = useState<'open' | 'close' | 'connecting' | 'loading'>('loading');

  const { conversas, loading: conversasLoading, refetch: refetchConversas } = useConversas();
  const { mensagens, loading: msgsLoading, refetch: refetchMensagens } = useMensagens(activeConversa?.phone || null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { state } = await fetchConnectionStatus();
        if (!cancelled) setConnectionState(state);
      } catch {
        if (!cancelled) setConnectionState('close');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleConnected = useCallback(async () => {
    setConnectionState('open');
    refetchConversas();
  }, [refetchConversas]);

  const handleDisconnect = useCallback(async () => {
    try {
      await disconnectInstance();
      setConnectionState('close');
      setActiveConversa(null);
      toast.success('WhatsApp desconectado.');
    } catch {
      toast.error('Erro ao desconectar.');
    }
  }, []);

  const handleSelect = (conversa: ConversaDB) => { 
    setActiveConversa(conversa); 
  };

  if (connectionState !== 'open') {
    if (connectionState === 'loading') {
      return (
        <Card className="flex items-center justify-center h-[600px]">
          <div className="flex flex-col items-center gap-3">
            <RefreshCw className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Verificando conexão Evolution...</p>
          </div>
        </Card>
      );
    }
    return <WhatsAppConnector onConnected={handleConnected} />;
  }

  return (
    <Card className="flex h-[700px] overflow-hidden border-none shadow-xl bg-background">
      {/* Left - Conversation list */}
      <div className="w-[320px] border-r border-border flex flex-col bg-card/40">
        <div className="border-b border-border px-4 py-4 bg-card flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <h3 className="text-sm font-bold tracking-tight">Conversas</h3>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={() => refetchConversas()} className="h-8 w-8">
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={handleDisconnect} className="h-8 w-8 text-muted-foreground hover:text-destructive">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          <ConversationList 
            conversas={conversas} 
            loading={conversasLoading} 
            activeId={activeConversa?.id || null} 
            onSelect={handleSelect} 
          />
        </div>
      </div>

      {/* Center - Chat */}
      <div className="flex-1 flex flex-col min-w-0 bg-muted/5">
        <div className="flex-1 overflow-hidden">
          <ChatWindow conversa={activeConversa} mensagens={mensagens} loading={msgsLoading} />
        </div>
        <ChatInput phone={activeConversa?.phone || null} />
      </div>

      {/* Right - Client info */}
      <div className="w-[280px] border-l border-border bg-card/20 hidden xl:flex flex-col">
        <div className="border-b border-border px-4 py-4 bg-card">
          <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Detalhes do Lead</h3>
        </div>
        <div className="flex-1 overflow-hidden">
          <ClientInfoPanel conversa={activeConversa} />
        </div>
      </div>
    </Card>
  );
}
