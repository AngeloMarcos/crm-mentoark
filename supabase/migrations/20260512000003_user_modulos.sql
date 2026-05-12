-- ──────────────────────────────────────────────────────────────────────────────
-- RBAC por módulo — Sprint RBAC-1
-- ──────────────────────────────────────────────────────────────────────────────

-- 1) Tabela de permissões por módulo
CREATE TABLE IF NOT EXISTS user_modulos (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  modulo     TEXT NOT NULL,
  ativo      BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, modulo)
);

CREATE INDEX IF NOT EXISTS user_modulos_user_idx ON user_modulos (user_id);

COMMENT ON TABLE user_modulos IS 'Permissões de acesso por módulo do sistema para cada usuário.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 2) Garantir que os masters têm role = admin
-- ──────────────────────────────────────────────────────────────────────────────
UPDATE users
SET role = 'admin'
WHERE email IN ('angelobispofilho@gmail.com', 'mentoark@gmail.com');

-- ──────────────────────────────────────────────────────────────────────────────
-- 3) Seed: masters recebem TODOS os módulos
-- ──────────────────────────────────────────────────────────────────────────────
INSERT INTO user_modulos (user_id, modulo)
SELECT u.id, m.modulo
FROM users u
CROSS JOIN (VALUES
  ('dashboard'), ('leads'), ('contatos'), ('discagem'), ('funil'),
  ('whatsapp'), ('disparos'), ('campanhas'), ('workflows'), ('integracoes'),
  ('agentes'), ('catalogo'), ('cerebro'), ('galeria'), ('docs'), ('usuarios')
) AS m(modulo)
WHERE u.email IN ('angelobispofilho@gmail.com', 'mentoark@gmail.com')
ON CONFLICT (user_id, modulo) DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────────────
-- 4) Seed: usuários padrão (não-masters) recebem apenas módulos básicos
--    Se já existirem registros, não sobrescreve
-- ──────────────────────────────────────────────────────────────────────────────
INSERT INTO user_modulos (user_id, modulo)
SELECT u.id, m.modulo
FROM users u
CROSS JOIN (VALUES
  ('dashboard'), ('leads'), ('contatos'), ('discagem'),
  ('funil'), ('whatsapp'), ('disparos')
) AS m(modulo)
WHERE u.email NOT IN ('angelobispofilho@gmail.com', 'mentoark@gmail.com')
ON CONFLICT (user_id, modulo) DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────────────
-- 5) Trigger: novos usuários recebem módulos padrão automaticamente
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_seed_modulos_padrao()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Módulos padrão para qualquer novo usuário
  INSERT INTO user_modulos (user_id, modulo)
  SELECT NEW.id, m FROM unnest(ARRAY[
    'dashboard','leads','contatos','discagem','funil','whatsapp','disparos'
  ]) AS m
  ON CONFLICT (user_id, modulo) DO NOTHING;

  -- Se for master, dá todos os módulos e role = admin
  IF NEW.email IN ('angelobispofilho@gmail.com', 'mentoark@gmail.com') THEN
    UPDATE users SET role = 'admin' WHERE id = NEW.id;
    INSERT INTO user_modulos (user_id, modulo)
    SELECT NEW.id, m FROM unnest(ARRAY[
      'campanhas','workflows','integracoes','agentes','catalogo',
      'cerebro','galeria','docs','usuarios'
    ]) AS m
    ON CONFLICT (user_id, modulo) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_modulos ON users;
CREATE TRIGGER trg_seed_modulos
  AFTER INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION fn_seed_modulos_padrao();
