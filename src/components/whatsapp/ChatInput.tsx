import { useState, useRef } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { sendWhatsAppMessage } from '@/services/n8nService';

interface ChatInputProps {
  phone: string | null;
  disabled?: boolean;
}

export function ChatInput({ phone, disabled }: ChatInputProps) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || !phone) return;
    if (trimmed.length > 2000) { toast.error('Mensagem muito longa (máx 2000 caracteres)'); return; }

    setSending(true);
    const result = await sendWhatsAppMessage({
      phone,
      message: trimmed,
    });
    setSending(false);

    if (result.ok) {
      setText('');
      textareaRef.current?.focus();
    } else {
      toast.error(result.error || 'Erro ao enviar mensagem');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const isDisabled = disabled || !phone || sending;

  return (
    <div className="border-t border-border p-3 flex items-end gap-2 bg-card">
      <Textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={phone ? 'Digite sua mensagem...' : 'Selecione uma conversa'}
        disabled={isDisabled}
        maxLength={2000}
        rows={1}
        className="min-h-[40px] max-h-[120px] resize-none"
      />
      <Button
        size="icon"
        onClick={handleSend}
        disabled={isDisabled || !text.trim()}
        className="shrink-0 bg-emerald-600 hover:bg-emerald-700 h-10 w-10"
      >
        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
      </Button>
    </div>
  );
}
