-- ============================================================
-- MIGRATION: Fix Multi-Tenant Isolation
-- Diagnóstico e correção de registros sem user_id
-- Execute no pgAdmin: 147.93.9.172:5432 / db crm
-- ============================================================

-- ── 1. DIAGNÓSTICO: Verificar registros sem user_id ──────────
DO $$
DECLARE
  r RECORD;
  cnt INT;
BEGIN
  FOR r IN SELECT unnest(ARRAY[
    'agent_prompts','conhecimento','agentes','contatos','listas',
    'chamadas','tarefas','campanhas','disparo_logs','catalogos',
    'produtos','produto_imagens','integracoes_config','documents',
    'galeria_imagens'
  ]) AS tbl LOOP
    EXECUTE format('SELECT COUNT(*) FROM %I WHERE user_id IS NULL', r.tbl) INTO cnt;
    IF cnt > 0 THEN
      RAISE NOTICE 'ATENÇÃO: tabela % tem % registros com user_id NULL', r.tbl, cnt;
    END IF;
  END LOOP;
END;
$$;

-- ── 2. Ver usuários cadastrados no sistema ───────────────────
-- Execute manualmente para diagnóstico:
-- SELECT id, email, role, created_at FROM users ORDER BY created_at;

-- ── 3. Ver de quem são os agent_prompts existentes ──────────
-- Execute manualmente:
-- SELECT ap.user_id, u.email, ap.nome, ap.ativo
-- FROM agent_prompts ap
-- LEFT JOIN users u ON u.id = ap.user_id
-- ORDER BY ap.created_at;

-- ── 4. Garantir índices para performance multi-tenant ────────
CREATE INDEX IF NOT EXISTS idx_agent_prompts_user_id     ON agent_prompts(user_id);
CREATE INDEX IF NOT EXISTS idx_conhecimento_user_id      ON conhecimento(user_id);
CREATE INDEX IF NOT EXISTS idx_agentes_user_id           ON agentes(user_id);
CREATE INDEX IF NOT EXISTS idx_contatos_user_id          ON contatos(user_id);
CREATE INDEX IF NOT EXISTS idx_catalogos_user_id         ON catalogos(user_id);
CREATE INDEX IF NOT EXISTS idx_integracoes_config_uid    ON integracoes_config(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_user_id         ON documents(user_id);
CREATE INDEX IF NOT EXISTS idx_disparo_logs_user_id      ON disparo_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_galeria_imagens_user_id   ON galeria_imagens(user_id);
CREATE INDEX IF NOT EXISTS idx_user_modulos_user_id      ON user_modulos(user_id);

-- ── 5. Garantir NOT NULL em tabelas críticas ─────────────────
-- ATENÇÃO: Se houver registros com user_id NULL, o ALTER vai falhar.
-- Nesse caso, primeiro associe os registros ao usuário correto.

-- Para associar orphan records ao primeiro admin:
-- UPDATE agent_prompts SET user_id = (SELECT id FROM users WHERE role = 'admin' LIMIT 1)
-- WHERE user_id IS NULL;

-- Só executar os ALTERs abaixo depois de resolver os NULLs acima:
-- ALTER TABLE agent_prompts  ALTER COLUMN user_id SET NOT NULL;
-- ALTER TABLE conhecimento   ALTER COLUMN user_id SET NOT NULL;
-- ALTER TABLE agentes        ALTER COLUMN user_id SET NOT NULL;
-- ALTER TABLE integracoes_config ALTER COLUMN user_id SET NOT NULL;

-- ── 6. Verificar se evolution_instancia está duplicada ───────
SELECT evolution_instancia, COUNT(*), array_agg(user_id::text) AS users
FROM agentes
WHERE evolution_instancia IS NOT NULL AND evolution_instancia <> ''
GROUP BY evolution_instancia
HAVING COUNT(*) > 1;
-- Se retornar linhas, duas contas estão usando a mesma instância WhatsApp (problema grave)

-- ── 7. Verificar estrutura de users vs agent_prompts ─────────
SELECT
  u.email,
  u.id AS user_id_in_users,
  (SELECT COUNT(*) FROM agent_prompts ap WHERE ap.user_id = u.id) AS prompts,
  (SELECT COUNT(*) FROM conhecimento k WHERE k.user_id = u.id) AS conhecimentos,
  (SELECT COUNT(*) FROM agentes ag WHERE ag.user_id = u.id) AS agentes
FROM users u
ORDER BY u.created_at;
