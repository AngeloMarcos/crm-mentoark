-- 1. Adicionar user_id às tabelas que estavam compartilhadas
ALTER TABLE public.chats ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
ALTER TABLE public.dados_cliente ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

-- 2. Criar índices para performance e segurança (essencial para o filtro WHERE user_id = $1)
CREATE INDEX IF NOT EXISTS idx_chats_user_id ON public.chats(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_user_id ON public.chat_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_dados_cliente_user_id ON public.dados_cliente(user_id);

-- 3. Tentar recuperar o user_id para chat_messages baseado no chat (denormalização para performance)
-- UPDATE public.chat_messages cm SET user_id = c.user_id FROM public.chats c WHERE cm.phone = c.phone AND cm.user_id IS NULL AND c.user_id IS NOT NULL;
