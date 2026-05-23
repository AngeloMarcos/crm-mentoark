-- ============================================================
-- SPRINT 9 — Configurar módulos padrão para 2 usuários
-- Rodar no Postgres da VPS (147.93.9.172/crm) via psql ou pgAdmin
-- ============================================================

-- ---------- 1. DIAGNÓSTICO ----------
-- Confirma que os usuários existem e mostra estado atual dos módulos.
-- NOTA: a tabela de usuários no Postgres do CRM é `users` (não auth.users do Supabase).
-- Se sua tabela tiver outro nome, ajuste abaixo.

SELECT
  u.id,
  u.email,
  COUNT(um.modulo)                        AS total_registros,
  COUNT(*) FILTER (WHERE um.ativo)        AS modulos_ativos,
  COALESCE(array_agg(um.modulo) FILTER (WHERE um.ativo), '{}') AS lista_ativos
FROM users u
LEFT JOIN user_modulos um ON um.user_id = u.id
WHERE u.email IN ('gkl15.working@gmail.com', 'grotheraphael@gmail.com')
GROUP BY u.id, u.email
ORDER BY u.email;

-- ---------- 2. APLICAR CORREÇÃO ----------
-- Insere os 7 módulos padrão (TODOS_MODULOS com padrao=true em modulos.ts).
-- ON CONFLICT garante que reativa caso já exista com ativo=false.

INSERT INTO user_modulos (user_id, modulo, ativo)
SELECT u.id, m.modulo, true
FROM users u
CROSS JOIN (VALUES
  ('dashboard'),
  ('leads'),
  ('contatos'),
  ('discagem'),
  ('funil'),
  ('whatsapp'),
  ('disparos')
) AS m(modulo)
WHERE u.email IN ('gkl15.working@gmail.com', 'grotheraphael@gmail.com')
ON CONFLICT (user_id, modulo) DO UPDATE SET ativo = true;

-- ---------- 3. VERIFICAR RESULTADO ----------
SELECT
  u.email,
  array_agg(um.modulo ORDER BY um.modulo) FILTER (WHERE um.ativo) AS modulos_ativos
FROM users u
LEFT JOIN user_modulos um ON um.user_id = u.id
WHERE u.email IN ('gkl15.working@gmail.com', 'grotheraphael@gmail.com')
GROUP BY u.email
ORDER BY u.email;

-- Resultado esperado para cada usuário:
-- {contatos, dashboard, discagem, disparos, funil, leads, whatsapp}
