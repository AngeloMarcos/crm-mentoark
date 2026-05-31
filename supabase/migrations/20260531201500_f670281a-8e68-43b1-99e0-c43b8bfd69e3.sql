-- 1. dados_cliente: Adicionar colunas faltantes
ALTER TABLE public.dados_cliente
  ADD COLUMN IF NOT EXISTS nomewpp TEXT,
  ADD COLUMN IF NOT EXISTS telefone TEXT,
  ADD COLUMN IF NOT EXISTS atendimento_ia TEXT DEFAULT 'ativo',
  ADD COLUMN IF NOT EXISTS setor TEXT,
  ADD COLUMN IF NOT EXISTS nome_completo TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS renda_bruta NUMERIC,
  ADD COLUMN IF NOT EXISTS tipo_trabalho TEXT,
  ADD COLUMN IF NOT EXISTS estado_civil TEXT,
  ADD COLUMN IF NOT EXISTS fgts NUMERIC,
  ADD COLUMN IF NOT EXISTS valor_entrada NUMERIC,
  ADD COLUMN IF NOT EXISTS pausa_timestamp TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Garantir que telefone seja único se não for nulo (removendo duplicatas antes se necessário, mas aqui apenas tentamos o index)
-- CREATE UNIQUE INDEX IF NOT EXISTS idx_dados_cliente_telefone_unique ON public.dados_cliente(telefone) WHERE telefone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dados_cliente_telefone ON public.dados_cliente(telefone);
CREATE INDEX IF NOT EXISTS idx_dados_cliente_user_id ON public.dados_cliente(user_id);
CREATE INDEX IF NOT EXISTS idx_dados_cliente_atendimento_ia ON public.dados_cliente(atendimento_ia);

-- 2. agent_configs: Configuração do agente IA
CREATE TABLE IF NOT EXISTS public.agent_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  nome_agente TEXT NOT NULL DEFAULT 'Cris',
  prompt_sistema TEXT NOT NULL,
  saudacao_inicial TEXT,
  bloco_qualificacao TEXT,
  mensagem_encaminhamento TEXT,
  mensagem_encerramento TEXT,
  palavra_reativar TEXT DEFAULT 'Atendimento finalizado',
  sinal_pausa TEXT DEFAULT '251213',
  tempo_espera_mensagem INT DEFAULT 3,
  tempo_espera_resposta INT DEFAULT 1,
  modelo_llm TEXT DEFAULT 'gpt-4o',
  modelo_parser TEXT DEFAULT 'gpt-4o-mini',
  grupo_notificacao TEXT,
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_configs TO authenticated;
GRANT ALL ON public.agent_configs TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_configs_user_ativo
  ON public.agent_configs(user_id) WHERE ativo = true;

-- 3. chat_messages: Adicionar instancia se não existir
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS instancia TEXT;

CREATE INDEX IF NOT EXISTS idx_chat_messages_phone ON public.chat_messages(phone);
CREATE INDEX IF NOT EXISTS idx_chat_messages_user_id ON public.chat_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_active ON public.chat_messages(active);

-- 4. n8n_chat_histories: Adicionar colunas e índices
ALTER TABLE public.n8n_chat_histories
  ADD COLUMN IF NOT EXISTS instancia TEXT,
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_n8n_chat_histories_session ON public.n8n_chat_histories(session_id);
CREATE INDEX IF NOT EXISTS idx_n8n_chat_histories_user ON public.n8n_chat_histories(user_id);

-- 5. agent_prompts: Adicionar agent_config_id
ALTER TABLE public.agent_prompts
  ADD COLUMN IF NOT EXISTS agent_config_id UUID REFERENCES public.agent_configs(id) ON DELETE SET NULL;

-- 6. Trigger para updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_agent_configs_updated_at') THEN
    CREATE TRIGGER update_agent_configs_updated_at
      BEFORE UPDATE ON public.agent_configs
      FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at_column();
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_dados_cliente_updated_at') THEN
    CREATE TRIGGER update_dados_cliente_updated_at
      BEFORE UPDATE ON public.dados_cliente
      FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at_column();
  END IF;
END $$;

-- 7. RLS
ALTER TABLE public.agent_configs ENABLE ROW LEVEL SECURITY;
-- chat_messages já deve ter RLS, mas garantimos
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- Políticas usando auth.uid() para integração padrão Supabase
CREATE POLICY agent_configs_user_policy ON public.agent_configs
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Se já existir política na chat_messages, o CREATE POLICY IF NOT EXISTS (não nativo, simulado com DO)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'chat_messages_user_policy') THEN
    CREATE POLICY chat_messages_user_policy ON public.chat_messages
      FOR ALL TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
