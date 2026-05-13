export interface ConversaDB {
  id: string;
  user_id: string;
  phone: string;
  cliente_id?: string | null;
  status: string;
  last_message_at: string | null;
  message_count: number;
  created_at: string;
  updated_at: string;
  ultimo_texto?: string;
  nome_cliente?: string;
}

export interface MensagemDB {
  id: string;
  user_id: string;
  chat_id: string;
  phone: string;
  role: 'user' | 'assistant';
  content: string;
  message_type: string;
  media_url?: string | null;
  active: boolean;
  created_at: string;
}
