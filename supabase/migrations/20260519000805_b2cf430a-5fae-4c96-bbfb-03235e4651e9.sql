-- Create tags table if it really doesn't exist
CREATE TABLE IF NOT EXISTS public.tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  cor TEXT DEFAULT '#3b82f6',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, nome)
);

-- Enable RLS
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can manage their own tags" ON public.tags
  FOR ALL USING (auth.uid() = user_id);
