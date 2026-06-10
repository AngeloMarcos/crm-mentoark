-- Renomear colunas existentes para o padrão do backend
ALTER TABLE public.whatsapp_messages RENAME COLUMN conteudo TO content;
ALTER TABLE public.whatsapp_messages RENAME COLUMN tipo TO message_type;
ALTER TABLE public.whatsapp_messages RENAME COLUMN instancia TO instance_name;
ALTER TABLE public.whatsapp_messages RENAME COLUMN midia_url TO media_url;
ALTER TABLE public.whatsapp_messages RENAME COLUMN midia_mime TO media_mimetype;

-- Adicionar message_id se não existir (ID real do WhatsApp)
-- Como 'id' atual é UUID, vamos manter 'id' como PK e usar 'message_id' para o ID do WhatsApp
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS message_id TEXT;

-- Tentar migrar IDs antigos se possível (muitas vezes o 'id' UUID foi usado por engano)
-- Mas se forem IDs reais do WhatsApp no campo 'id', vamos copiar
UPDATE public.whatsapp_messages SET message_id = id WHERE message_id IS NULL AND id NOT LIKE '%-%-%-%-%';

-- Adicionar colunas de resposta se não existirem
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS reply_to_message_id TEXT;
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS reply_to_content TEXT;
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS reply_to_sender TEXT;

-- Adicionar colunas de controle se não existirem
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT false;
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT false;
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS sent_by_user_id UUID REFERENCES auth.users(id);

-- Criar constraint de unicidade para evitar duplicatas e permitir ON CONFLICT
-- Nota: Pode falhar se houver duplicatas. Vamos limpar antes.
DELETE FROM public.whatsapp_messages a USING public.whatsapp_messages b 
WHERE a.id < b.id AND a.message_id = b.message_id AND a.instance_name = b.instance_name AND a.message_id IS NOT NULL;

ALTER TABLE public.whatsapp_messages ADD CONSTRAINT whatsapp_messages_msg_inst_key UNIQUE (message_id, instance_name);

-- Garantir permissões
GRANT ALL ON public.whatsapp_messages TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_messages TO authenticated;

-- Criar tabela de status de mensagens se não existir
CREATE TABLE IF NOT EXISTS public.whatsapp_message_status (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id TEXT NOT NULL,
    instance_name TEXT NOT NULL,
    status TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(message_id, instance_name)
);

GRANT ALL ON public.whatsapp_message_status TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_message_status TO authenticated;
ALTER TABLE public.whatsapp_message_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view statuses of their messages" ON public.whatsapp_message_status FOR SELECT USING (true);
