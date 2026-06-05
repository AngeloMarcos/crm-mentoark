ALTER TABLE public.whatsapp_messages 
  ADD COLUMN IF NOT EXISTS reply_to_message_id TEXT,
  ADD COLUMN IF NOT EXISTS reply_to_content TEXT,
  ADD COLUMN IF NOT EXISTS reply_to_sender TEXT;

CREATE INDEX IF NOT EXISTS idx_wamsg_reply ON public.whatsapp_messages(reply_to_message_id) WHERE reply_to_message_id IS NOT NULL;

-- Ensure permissions are set (though table likely exists)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_messages TO authenticated;
GRANT ALL ON public.whatsapp_messages TO service_role;