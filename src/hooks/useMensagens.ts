import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { MensagemDB } from '@/types/whatsappChat';
import { useAuth } from './useAuth';

export function useMensagens(phone: string | null) {
  const { user } = useAuth();
  const [mensagens, setMensagens] = useState<MensagemDB[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchMensagens = useCallback(async () => {
    if (!phone || !user) { setMensagens([]); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('phone', phone)
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });

      if (error) throw error;

      const msgs: MensagemDB[] = [];
      data.forEach((r) => {
        if (r.user_message) {
          msgs.push({
            id: `${r.id}_user`,
            user_id: user.id,
            chat_id: phone,
            phone,
            role: 'user',
            content: r.user_message,
            message_type: 'text',
            active: true,
            created_at: r.created_at
          });
        }
        if (r.bot_message) {
          msgs.push({
            id: `${r.id}_bot`,
            user_id: user.id,
            chat_id: phone,
            phone,
            role: 'assistant',
            content: r.bot_message,
            message_type: 'text',
            active: true,
            created_at: r.created_at
          });
        }
      });
      setMensagens(msgs);
    } catch (err) {
      console.error('[useMensagens] error:', err);
    } finally {
      setLoading(false);
    }
  }, [phone, user]);

  useEffect(() => {
    fetchMensagens();
    if (!phone) return;
    const channel = supabase
      .channel(`chat_messages_${phone}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `phone=eq.${phone}` }, () => fetchMensagens())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [phone, fetchMensagens]);

  return { mensagens, loading, refetch: fetchMensagens };
}
