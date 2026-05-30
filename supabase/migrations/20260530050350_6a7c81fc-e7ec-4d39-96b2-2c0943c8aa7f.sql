-- Create cargos table
CREATE TABLE IF NOT EXISTS public.cargos (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    nome TEXT NOT NULL,
    permissoes TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add cargo_id to users
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS cargo_id UUID REFERENCES public.cargos(id) ON DELETE SET NULL;

-- Enable RLS
ALTER TABLE public.cargos ENABLE ROW LEVEL SECURITY;

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cargos TO authenticated;
GRANT ALL ON public.cargos TO service_role;

-- Policies
CREATE POLICY "Admins can manage their own cargos" 
ON public.cargos 
FOR ALL 
USING (auth.uid() = user_id);

CREATE POLICY "Users can view cargos from their owner" 
ON public.cargos 
FOR SELECT 
USING (
    user_id IN (
        SELECT owner_id FROM public.users WHERE id = auth.uid()
    ) OR user_id = auth.uid()
);
