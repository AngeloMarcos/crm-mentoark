-- Tabela de equipes
CREATE TABLE IF NOT EXISTS public.equipes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        TEXT NOT NULL,
  owner_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tabela de membros da equipe
CREATE TABLE IF NOT EXISTS public.equipe_membros (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipe_id       UUID NOT NULL REFERENCES public.equipes(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'membro', -- 'gerente' | 'membro'
  convidado_por   UUID REFERENCES auth.users(id),
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_equipe_membro UNIQUE (equipe_id, user_id)
);

-- Tabela de mensagens do chat da equipe
CREATE TABLE IF NOT EXISTS public.equipe_chat (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipe_id   UUID NOT NULL REFERENCES public.equipes(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  conteudo    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_equipe_membros_equipe ON public.equipe_membros(equipe_id);
CREATE INDEX IF NOT EXISTS idx_equipe_membros_user   ON public.equipe_membros(user_id);
CREATE INDEX IF NOT EXISTS idx_equipe_chat_equipe    ON public.equipe_chat(equipe_id, created_at DESC);

-- RLS
ALTER TABLE public.equipes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipe_membros ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipe_chat    ENABLE ROW LEVEL SECURITY;

-- Políticas: usuário vê apenas dados da equipe que pertence
CREATE POLICY equipes_owner ON public.equipes
  FOR ALL TO authenticated USING (owner_id = auth.uid());

CREATE POLICY equipe_membros_acesso ON public.equipe_membros
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR equipe_id IN (
    SELECT id FROM public.equipes WHERE owner_id = auth.uid()
  ));

CREATE POLICY equipe_chat_acesso ON public.equipe_chat
  FOR ALL TO authenticated
  USING (equipe_id IN (
    SELECT equipe_id FROM public.equipe_membros WHERE user_id = auth.uid()
    UNION
    SELECT id FROM public.equipes WHERE owner_id = auth.uid()
  ));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.equipes, public.equipe_membros, public.equipe_chat TO authenticated;
GRANT ALL ON public.equipes, public.equipe_membros, public.equipe_chat TO service_role;
