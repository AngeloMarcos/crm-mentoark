-- ============================================================
-- ESTRUTURA BASE DE AUTENTICAÇÃO E PERMISSÕES (BACKEND CUSTOM)
-- ============================================================

-- 1. Tabela de Usuários (Central para o Backend Express)
CREATE TABLE IF NOT EXISTS public.users (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT        NOT NULL UNIQUE,
  password_hash   TEXT        NOT NULL,
  display_name    TEXT,
  avatar_url      TEXT,
  role            TEXT        NOT NULL DEFAULT 'user',
  active          BOOLEAN     NOT NULL DEFAULT true,
  email_verified  BOOLEAN     NOT NULL DEFAULT false,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Grant permissions for users
GRANT SELECT, INSERT, UPDATE, DELETE ON public.users TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.users TO service_role;
GRANT SELECT ON public.users TO anon;

-- Enable RLS
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users are viewable by everyone (for profiles)" ON public.users FOR SELECT USING (true);
CREATE POLICY "Admins can manage all users" ON public.users FOR ALL TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
);

-- 2. Tabela de Módulos (Permissões)
CREATE TABLE IF NOT EXISTS public.user_modulos (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  modulo     TEXT NOT NULL,
  ativo      BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, modulo)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_modulos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_modulos TO service_role;
ALTER TABLE public.user_modulos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own modules" ON public.user_modulos FOR SELECT USING (true);

-- 3. Tabelas de Opt-out e Anti-Ban
CREATE TABLE IF NOT EXISTS public.opt_out_contatos (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  telefone TEXT NOT NULL,
  keyword TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, telefone)
);

CREATE TABLE IF NOT EXISTS public.disparo_optouts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  telefone TEXT NOT NULL,
  motivo TEXT DEFAULT 'usuario_solicitou',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

GRANT ALL ON public.opt_out_contatos TO authenticated, service_role;
GRANT ALL ON public.disparo_optouts TO authenticated, service_role;

-- 4. Tabelas de IA e Mensagens (Sprint CRM+n8n)
CREATE TABLE IF NOT EXISTS public.ia_pausa_log (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id        UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  contato_id     UUID,
  telefone       TEXT,
  atendente_id   UUID,
  acao           TEXT NOT NULL CHECK (acao IN ('pause', 'ativo', 'auto_reativado')),
  duracao_min    INTEGER,
  observacao     TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.ai_fila (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  conversa_id     UUID,
  wa_message_id   TEXT        NOT NULL,
  instance_name   TEXT        NOT NULL,
  remote_jid      TEXT        NOT NULL,
  tipo            TEXT        NOT NULL,
  media_url       TEXT,
  media_mimetype  TEXT,
  conteudo_texto  TEXT,
  status          TEXT        NOT NULL DEFAULT 'pendente',
  tentativas      INT         NOT NULL DEFAULT 0,
  max_tentativas  INT         NOT NULL DEFAULT 3,
  erro_msg        TEXT,
  processar_apos  TIMESTAMPTZ NOT NULL DEFAULT now(),
  concluido_em    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.ia_pausa_log TO authenticated, service_role;
GRANT ALL ON public.ai_fila TO authenticated, service_role;

-- 5. Função de Auditoria Updated At (se não existir)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger para users
DROP TRIGGER IF EXISTS update_users_updated_at ON public.users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();
