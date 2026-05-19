-- Add health score columns to agentes table
ALTER TABLE public.agentes 
ADD COLUMN IF NOT EXISTS whatsapp_score INTEGER DEFAULT 100,
ADD COLUMN IF NOT EXISTS score_updated_at TIMESTAMPTZ DEFAULT now(),
ADD COLUMN IF NOT EXISTS score_fatores JSONB DEFAULT '{}';

-- Constraint to keep score between 0 and 100
ALTER TABLE public.agentes
ADD CONSTRAINT whatsapp_score_range CHECK (whatsapp_score >= 0 AND whatsapp_score <= 100);
