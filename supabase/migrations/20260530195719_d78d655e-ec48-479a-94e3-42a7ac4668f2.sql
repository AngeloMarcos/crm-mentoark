-- 1. Limpar duplicatas na tabela contatos antes de criar o índice UNIQUE
-- Mantemos apenas o registro mais antigo (menor ID ou menor created_at) para cada par (user_id, telefone)
DELETE FROM public.contatos a
USING public.contatos b
WHERE a.id > b.id
  AND a.user_id = b.user_id
  AND a.telefone = b.telefone
  AND a.telefone IS NOT NULL;

-- 2. Remover o índice simples antigo
DROP INDEX IF EXISTS idx_contatos_user_telefone;

-- 3. Criar o índice UNIQUE para permitir UPSERT (INSERT ... ON CONFLICT)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_contatos_user_telefone 
ON public.contatos (user_id, telefone) 
WHERE telefone IS NOT NULL;
