-- Update disparos table with professional fields
ALTER TABLE public.disparos
ADD COLUMN IF NOT EXISTS perfil_velocidade TEXT DEFAULT 'safe',
ADD COLUMN IF NOT EXISTS limite_dia_instancia INTEGER DEFAULT 50,
ADD COLUMN IF NOT EXISTS instancias_ids UUID[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS entregues INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS respondidos INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS agendado_para TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS iniciado_em TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS concluido_em TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS pausa_fins_semana BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS pausa_erros_consecutivos BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS limite_erros_consecutivos INTEGER DEFAULT 5,
ADD COLUMN IF NOT EXISTS pausa_bloqueios_detectados BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS tipo_midia TEXT DEFAULT 'texto',
ADD COLUMN IF NOT EXISTS url_midia TEXT,
ADD COLUMN IF NOT EXISTS legenda_midia TEXT;

-- Index for scheduled campaigns
CREATE INDEX IF NOT EXISTS idx_disparos_agendado_para ON public.disparos(agendado_para) WHERE status = 'rascunho';
CREATE INDEX IF NOT EXISTS idx_disparos_status ON public.disparos(status);
