ALTER TABLE public.whatsapp_messages 
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_wamsg_deleted ON public.whatsapp_messages(id) WHERE deleted_at IS NOT NULL;