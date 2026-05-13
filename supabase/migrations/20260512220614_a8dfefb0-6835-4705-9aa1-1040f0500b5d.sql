-- 1. Corrigir tabela de histórico (estava sem user_id)
ALTER TABLE public.n8n_chat_histories ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
ALTER TABLE public.n8n_chat_histories ADD COLUMN IF NOT EXISTS instancia TEXT;

-- 2. Limpeza de conhecimento sem dono
DELETE FROM public.conhecimento WHERE user_id IS NULL;

-- 3. Garantir que agentes sem dono não interfiram no roteamento
UPDATE public.agentes SET ativo = false WHERE user_id IS NULL;

-- 4. Criar índices para performance e segurança
CREATE INDEX IF NOT EXISTS idx_agentes_instancia_user_ativo ON public.agentes(evolution_instancia, user_id) WHERE ativo = true;
CREATE INDEX IF NOT EXISTS idx_n8n_chat_histories_user_session ON public.n8n_chat_histories(user_id, session_id);
CREATE INDEX IF NOT EXISTS idx_conhecimento_user_id ON public.conhecimento(user_id);
