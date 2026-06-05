ALTER TABLE public.whatsapp_messages 
  ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_wamsg_hidden ON public.whatsapp_messages(is_hidden) WHERE is_hidden = true;