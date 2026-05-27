-- ============================================================
-- TEAM FASE 1 — pessoas, perfis (roles), permissões, convites
-- Rodar no Postgres 147.93.9.172/crm
-- ============================================================

-- Pessoas da equipe (vinculadas a um owner = dono do workspace)
CREATE TABLE IF NOT EXISTS team_members (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id            uuid NOT NULL,
  user_id             uuid,                       -- preenchido após aceitar convite
  email               text NOT NULL,
  nome                text NOT NULL,
  cargo               text,
  bio                 text,
  avatar_url          text,
  status              text NOT NULL DEFAULT 'convidado',  -- convidado | ativo | inativo
  convite_token       text UNIQUE,
  convite_expira_at   timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, email)
);
CREATE INDEX IF NOT EXISTS team_members_owner_idx ON team_members(owner_id);
CREATE INDEX IF NOT EXISTS team_members_user_idx  ON team_members(user_id);

-- Perfis de permissão (presets + custom por owner)
CREATE TABLE IF NOT EXISTS team_roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL,
  nome        text NOT NULL,
  cor         text DEFAULT '#3b82f6',
  descricao   text,
  is_system   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, nome)
);
CREATE INDEX IF NOT EXISTS team_roles_owner_idx ON team_roles(owner_id);

-- Matriz de permissões da role
CREATE TABLE IF NOT EXISTS team_role_permissions (
  role_id   uuid NOT NULL REFERENCES team_roles(id) ON DELETE CASCADE,
  modulo    text NOT NULL,   -- leads, funil, whatsapp, disparos, campanhas, integracoes, equipe, chat, relatorios, configuracoes
  acao      text NOT NULL,   -- view | create | edit | delete | manage
  PRIMARY KEY (role_id, modulo, acao)
);

-- Pessoa <-> Role (N:N)
CREATE TABLE IF NOT EXISTS team_member_roles (
  member_id uuid NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  role_id   uuid NOT NULL REFERENCES team_roles(id)   ON DELETE CASCADE,
  PRIMARY KEY (member_id, role_id)
);

-- ============================================================
-- Seed das roles de sistema + auto-vincular owner como "ativo"
-- Cria as 4 roles padrão para CADA user existente como owner
-- ============================================================
DO $$
DECLARE u RECORD;
BEGIN
  FOR u IN SELECT id, email, display_name FROM users LOOP

    -- Roles de sistema
    INSERT INTO team_roles (owner_id, nome, cor, descricao, is_system)
    VALUES
      (u.id, 'Owner',  '#a855f7', 'Dono do workspace — acesso total',          true),
      (u.id, 'Admin',  '#0ea5e9', 'Gerencia equipe e configurações',            true),
      (u.id, 'Agente', '#10b981', 'Trabalha leads, WhatsApp e disparos',        true),
      (u.id, 'Viewer', '#64748b', 'Apenas visualização',                        true)
    ON CONFLICT (owner_id, nome) DO NOTHING;

    -- Permissões Owner = manage em tudo
    INSERT INTO team_role_permissions (role_id, modulo, acao)
    SELECT r.id, m.modulo, 'manage'
    FROM team_roles r
    CROSS JOIN (VALUES
      ('leads'),('funil'),('whatsapp'),('disparos'),('campanhas'),
      ('integracoes'),('equipe'),('chat'),('relatorios'),('configuracoes')
    ) AS m(modulo)
    WHERE r.owner_id = u.id AND r.nome = 'Owner'
    ON CONFLICT DO NOTHING;

    -- Admin = manage exceto integrações (edit) e configurações (edit)
    INSERT INTO team_role_permissions (role_id, modulo, acao)
    SELECT r.id, m.modulo, m.acao
    FROM team_roles r
    CROSS JOIN (VALUES
      ('leads','manage'),('funil','manage'),('whatsapp','manage'),
      ('disparos','manage'),('campanhas','manage'),('equipe','manage'),
      ('chat','manage'),('relatorios','manage'),
      ('integracoes','edit'),('configuracoes','edit')
    ) AS m(modulo, acao)
    WHERE r.owner_id = u.id AND r.nome = 'Admin'
    ON CONFLICT DO NOTHING;

    -- Agente = view+create+edit nos operacionais
    INSERT INTO team_role_permissions (role_id, modulo, acao)
    SELECT r.id, m.modulo, m.acao
    FROM team_roles r
    CROSS JOIN (VALUES
      ('leads','view'),('leads','create'),('leads','edit'),
      ('funil','view'),('funil','edit'),
      ('whatsapp','view'),('whatsapp','create'),('whatsapp','edit'),
      ('disparos','view'),('disparos','create'),('disparos','edit'),
      ('campanhas','view'),('chat','view'),('chat','create')
    ) AS m(modulo, acao)
    WHERE r.owner_id = u.id AND r.nome = 'Agente'
    ON CONFLICT DO NOTHING;

    -- Viewer = view em tudo operacional
    INSERT INTO team_role_permissions (role_id, modulo, acao)
    SELECT r.id, m.modulo, 'view'
    FROM team_roles r
    CROSS JOIN (VALUES
      ('leads'),('funil'),('whatsapp'),('disparos'),('campanhas'),('chat'),('relatorios')
    ) AS m(modulo)
    WHERE r.owner_id = u.id AND r.nome = 'Viewer'
    ON CONFLICT DO NOTHING;

    -- Cria team_member para o próprio owner (ativo, role Owner)
    INSERT INTO team_members (owner_id, user_id, email, nome, status)
    VALUES (u.id, u.id, u.email, COALESCE(u.display_name, u.email), 'ativo')
    ON CONFLICT (owner_id, email) DO UPDATE
      SET user_id = EXCLUDED.user_id, status = 'ativo';

    INSERT INTO team_member_roles (member_id, role_id)
    SELECT tm.id, tr.id
    FROM team_members tm
    JOIN team_roles tr ON tr.owner_id = tm.owner_id AND tr.nome = 'Owner'
    WHERE tm.owner_id = u.id AND tm.user_id = u.id
    ON CONFLICT DO NOTHING;

  END LOOP;
END $$;
