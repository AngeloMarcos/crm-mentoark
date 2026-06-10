DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'integracoes_config_user_id_tipo_key'
    ) THEN
        ALTER TABLE public.integracoes_config ADD CONSTRAINT integracoes_config_user_id_tipo_key UNIQUE (user_id, tipo);
    END IF;
END $$;
GRANT ALL ON public.integracoes_config TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.integracoes_config TO authenticated;
