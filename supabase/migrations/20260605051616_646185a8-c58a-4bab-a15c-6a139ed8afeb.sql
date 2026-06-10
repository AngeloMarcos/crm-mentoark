CREATE TABLE IF NOT EXISTS public.whatsapp_chat_prefs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  remote_jid  TEXT NOT NULL,
  pinned      BOOLEAN DEFAULT false,
  archived    BOOLEAN DEFAULT false,
  muted_until TIMESTAMP WITH TIME ZONE,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, remote_jid)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_chat_prefs TO authenticated;
GRANT ALL ON public.whatsapp_chat_prefs TO service_role;

ALTER TABLE public.whatsapp_chat_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own chat preferences" ON public.whatsapp_chat_prefs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_wa_prefs_pinned ON public.whatsapp_chat_prefs(user_id, pinned) WHERE pinned = true;
CREATE INDEX IF NOT EXISTS idx_wa_prefs_archived ON public.whatsapp_chat_prefs(user_id, archived) WHERE archived = true;

CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_whatsapp_chat_prefs_updated_at
BEFORE UPDATE ON public.whatsapp_chat_prefs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();