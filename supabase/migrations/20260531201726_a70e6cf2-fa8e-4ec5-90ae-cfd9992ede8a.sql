-- Corrigir atendimento_ia para TEXT com valor padrão 'ativo'
ALTER TABLE public.dados_cliente 
  ALTER COLUMN atendimento_ia TYPE TEXT USING (CASE WHEN atendimento_ia = true THEN 'ativo' ELSE 'pause' END),
  ALTER COLUMN atendimento_ia SET DEFAULT 'ativo';

-- Unificar coluna setor (remover duplicata Setor se existir e garantir setor em minúsculo)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'dados_cliente' AND column_name = 'Setor') THEN
        UPDATE public.dados_cliente SET setor = "Setor" WHERE setor IS NULL;
        ALTER TABLE public.dados_cliente DROP COLUMN "Setor";
    END IF;
END $$;
