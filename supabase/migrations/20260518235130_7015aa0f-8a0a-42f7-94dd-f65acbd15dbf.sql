CREATE TABLE IF NOT EXISTS public.follow_ups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contato_id UUID REFERENCES public.contatos(id) ON DELETE CASCADE,
  data_retorno TIMESTAMPTZ NOT NULL,
  motivo TEXT,
  observacao TEXT,
  status TEXT DEFAULT 'pendente' 
    CHECK (status IN ('pendente', 'concluido', 'atrasado')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.follow_ups ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view their own follow-ups" 
ON public.follow_ups 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own follow-ups" 
ON public.follow_ups 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own follow-ups" 
ON public.follow_ups 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own follow-ups" 
ON public.follow_ups 
FOR DELETE 
USING (auth.uid() = user_id);
