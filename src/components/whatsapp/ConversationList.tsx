import { useState, useMemo } from 'react';
import { MessageCircle, Search, Clock, Calendar } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { formatDistanceToNow, isToday, isAfter, subDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { ConversaDB } from '@/types/whatsappChat';

interface ConversationListProps {
  conversas: ConversaDB[];
  loading: boolean;
  activeId: string | null;
  onSelect: (conversa: ConversaDB) => void;
  profilePictures?: Record<string, string | null>;
}

type StatusFilter = 'all' | 'active' | 'waiting' | 'resolved';
type DateFilter = 'all' | 'today' | '7days';

function getInitials(name?: string, phone?: string): string {
  if (name) {
    const parts = name.trim().split(' ');
    return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase().slice(0, 2);
  }
  return phone?.slice(-2) || '??';
}

function formatPhone(phone: string): string {
  const clean = phone.replace(/\D/g, '');
  if (clean.length >= 11) {
    return `(${clean.slice(-11, -9)}) ${clean.slice(-9, -4)}-${clean.slice(-4)}`;
  }
  return phone;
}

const STATUS_MAP: Record<StatusFilter, string> = {
  all: 'Todos',
  active: 'Aberto',
  waiting: 'Aguardando',
  resolved: 'Resolvido',
};

const DATE_MAP: Record<DateFilter, string> = {
  all: 'Todas',
  today: 'Hoje',
  '7days': '7 dias',
};

export function ConversationList({ conversas, loading, activeId, onSelect, profilePictures }: ConversationListProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');

  const filtered = useMemo(() => {
    let list = conversas;

    if (statusFilter !== 'all') {
      const statusMapping: Record<string, string[]> = {
        active: ['active'],
        waiting: ['waiting', 'pending'],
        resolved: ['resolved', 'closed', 'finished'],
      };
      list = list.filter(c => statusMapping[statusFilter]?.includes(c.status?.toLowerCase() || 'active'));
    }

    if (dateFilter !== 'all') {
      const now = new Date();
      list = list.filter(c => {
        const dateStr = c.last_message_at || c.created_at;
        if (!dateStr) return false;
        const date = new Date(dateStr);
        if (dateFilter === 'today') return isToday(date);
        if (dateFilter === '7days') return isAfter(date, subDays(now, 7));
        return true;
      });
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        (c.nome_cliente || '').toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        (c.ultimo_texto || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [conversas, statusFilter, dateFilter, search]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 space-y-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-xs"
          />
        </div>
        <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
          {(Object.keys(STATUS_MAP) as StatusFilter[]).map(key => (
            <button
              key={key}
              onClick={() => setStatusFilter(key)}
              className={cn(
                'px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors whitespace-nowrap',
                statusFilter === key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              )}
            >
              {STATUS_MAP[key]}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-4 text-muted-foreground px-4 text-center">
          <MessageCircle className="h-8 w-8 opacity-30" />
          <p className="text-xs">Nenhuma conversa encontrada.</p>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="divide-y divide-border/50">
            {filtered.map((c) => (
              <button
                key={c.id}
                onClick={() => onSelect(c)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-accent/10',
                  activeId === c.id && 'bg-primary/5 border-l-2 border-l-primary'
                )}
              >
                <Avatar className="h-10 w-10 shrink-0">
                  {profilePictures?.[c.phone] && (
                    <AvatarImage src={profilePictures[c.phone]!} alt={c.nome_cliente || c.phone} />
                  )}
                  <AvatarFallback className="text-xs bg-primary/10 text-primary font-semibold">
                    {getInitials(c.nome_cliente, c.phone)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium truncate">
                      {c.nome_cliente || formatPhone(c.phone)}
                    </span>
                    {c.last_message_at && (
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {formatDistanceToNow(new Date(c.last_message_at), { addSuffix: false, locale: ptBR })}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {c.ultimo_texto || 'Sem mensagens'}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
