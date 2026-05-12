-- ════════════════════════════════════════════════════════════════════════════
-- COLE ESTE SCRIPT NO PGADMIN (banco: crm)
-- Sprint RBAC — permissões por módulo + multi-tenant
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Tabela de módulos por usuário
CREATE TABLE IF NOT EXISTS user_modulos (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  modulo     TEXT NOT NULL,
  ativo      BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, modulo)
);
CREATE INDEX IF NOT EXISTS user_modulos_user_idx ON user_modulos (user_id);

-- 2) Promover masters a admin
UPDATE users
SET role = 'admin'
WHERE email IN ('angelobispofilho@gmail.com', 'mentoark@gmail.com');

-- 3) Masters recebem TODOS os módulos
INSERT INTO user_modulos (user_id, modulo)
SELECT u.id, m.modulo
FROM users u
CROSS JOIN (VALUES
  ('dashboard'),('leads'),('contatos'),('discagem'),('funil'),
  ('whatsapp'),('disparos'),('campanhas'),('workflows'),('integracoes'),
  ('agentes'),('catalogo'),('cerebro'),('galeria'),('docs'),('usuarios')
) AS m(modulo)
WHERE u.email IN ('angelobispofilho@gmail.com', 'mentoark@gmail.com')
ON CONFLICT (user_id, modulo) DO NOTHING;

-- 4) Demais usuários recebem apenas módulos padrão
INSERT INTO user_modulos (user_id, modulo)
SELECT u.id, m.modulo
FROM users u
CROSS JOIN (VALUES
  ('dashboard'),('leads'),('contatos'),('discagem'),
  ('funil'),('whatsapp'),('disparos')
) AS m(modulo)
WHERE u.email NOT IN ('angelobispofilho@gmail.com', 'mentoark@gmail.com')
ON CONFLICT (user_id, modulo) DO NOTHING;

-- 5) Trigger: novos usuários criados já recebem os módulos padrão automaticamente
CREATE OR REPLACE FUNCTION fn_seed_modulos_padrao()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO user_modulos (user_id, modulo)
  SELECT NEW.id, m FROM unnest(ARRAY[
    'dashboard','leads','contatos','discagem','funil','whatsapp','disparos'
  ]) AS m
  ON CONFLICT (user_id, modulo) DO NOTHING;

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

-- 6) Verificação final
SELECT u.email, u.role, array_agg(um.modulo ORDER BY um.modulo) AS modulos
FROM users u
LEFT JOIN user_modulos um ON um.user_id = u.id AND um.ativo = true
GROUP BY u.email, u.role
ORDER BY u.role DESC, u.email;
