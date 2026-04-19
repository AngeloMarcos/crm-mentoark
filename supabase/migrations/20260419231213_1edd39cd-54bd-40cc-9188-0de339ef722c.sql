ALTER TABLE public.contatos ADD COLUMN IF NOT EXISTS valor_potencial numeric NOT NULL DEFAULT 0;
ALTER TABLE public.contatos ADD COLUMN IF NOT EXISTS responsavel text NOT NULL DEFAULT 'Equipe';
ALTER TABLE public.contatos ADD COLUMN IF NOT EXISTS temperatura text NOT NULL DEFAULT 'frio' CHECK (temperatura IN ('frio','morno','quente'));