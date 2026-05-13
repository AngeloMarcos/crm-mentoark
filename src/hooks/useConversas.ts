import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { ConversaDB } from '@/types/whatsappChat';
import { useAuth } from './useAuth';

export function useConversas() {
  const { user } = useAuth();
  const [conversas, setConversas] = useState<ConversaDB[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchConversas = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      // First, get all unique phones from chat_messages for this user
      const { data, error } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Group by phone to create "Conversa" objects
      const map = new Map<string, ConversaDB>();
      data.forEach((r) => {
        const phone = r.phone || 'unknown';
        if (!map.has(phone)) {
          map.set(phone, {
            id: phone, // using phone as ID for now
            user_id: user.id,
            phone,
            status: 'active',
            last_message_at: r.created_at,
            message_count: 1,
            created_at: r.created_at,
            updated_at: r.created_at,
            ultimo_texto: r.bot_message || r.user_message || '',
            nome_cliente: r.nomewpp || undefined,
          });
        } else {
          const cur = map.get(phone)!;
          cur.message_count++;
          if (new Date(r.created_at) > new Date(cur.last_message_at!)) {
            cur.last_message_at = r.created_at;
            cur.ultimo_texto = r.bot_message || r.user_message || cur.ultimo_texto;
          }
        }
      });

      setConversas(Array.from(map.values()).sort((a, b) => new Date(b.last_message_at!).getTime() - new Date(a.last_message_at!).getTime()));
    } catch (err) {
      console.error('[useConversas] error:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchConversas();
    const channel = supabase
      .channel('chat_messages_realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, () => fetchConversas())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchConversas]);

  return { conversas, loading, refetch: fetchConversas };
}
