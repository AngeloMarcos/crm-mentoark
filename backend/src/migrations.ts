/**
 * migrations.ts — Migrações automáticas do banco de dados
 *
 * Executadas automaticamente na inicialização do backend (chamada em index.ts).
 * Todas as queries usam CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS
 * para serem 100% idempotentes — podem rodar múltiplas vezes sem erro.
 *
 * Ordem das migrações:
 *  1. Tabelas base (opt_out, webhook_dedup, contatos patches)
 *  2. Sprint 3: refresh_tokens, galeria, índices
 *  3. Sprint 5: oauth_state (CSRF protection)
 *  4. CRM Features: tabelas de funil, campanhas, SLA, etc.
 *  5. Sprint CRM+n8n: pausa IA, ia_pausa_log, colunas agentes
 *  6. Migration 002: whatsapp_messages v2 (schema canônico)
 *  7. Sprint Equipe/Kanban/SubPerfis: equipes, tarefas, sub_perfis
 */

import { Pool } from 'pg';

export async function runMigrations(pool: Pool): Promise<void> {
  // whatsapp_messages v1 (schema PT legado) removida — criada pela migration 002 em schema EN canônico

  await pool.query(`ALTER TABLE contatos ADD COLUMN IF NOT EXISTS push_name TEXT`);
  await pool.query(`ALTER TABLE contatos ADD COLUMN IF NOT EXISTS profile_pic_url TEXT`);
  await pool.query(`ALTER TABLE contatos ADD COLUMN IF NOT EXISTS ultima_mensagem_em TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE contatos ADD COLUMN IF NOT EXISTS opt_out BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE agentes ADD COLUMN IF NOT EXISTS n8n_webhook_url TEXT`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS opt_out_contatos (
      id BIGSERIAL PRIMARY KEY,
      user_id UUID NOT NULL,
      telefone TEXT NOT NULL,
      keyword TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (user_id, telefone)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_optout_user_telefone
    ON opt_out_contatos (user_id, telefone)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS disparo_optouts (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id UUID NOT NULL,
      telefone TEXT NOT NULL,
      motivo TEXT DEFAULT 'usuario_solicitou',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_disparo_optouts_user_telefone
    ON disparo_optouts (user_id, telefone, created_at DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS facebook_contas (
      id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id         UUID NOT NULL UNIQUE,
      ad_account_id   TEXT NOT NULL,
      nome_conta      TEXT,
      access_token    TEXT NOT NULL,
      token_expira_em TIMESTAMPTZ,
      criado_em       TIMESTAMPTZ DEFAULT NOW(),
      atualizado_em   TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS marketing_leads (
      id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id         UUID,
      meta_lead_id    TEXT UNIQUE,
      nome            TEXT,
      telefone        TEXT,
      email           TEXT,
      campanha        TEXT,
      campanha_id     TEXT,
      formulario_id   TEXT,
      plataforma      TEXT DEFAULT 'facebook',
      dados_extras    JSONB DEFAULT '{}',
      status_crm      TEXT DEFAULT 'novo',
      capturado_em    TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS facebook_campanhas (
      id              TEXT PRIMARY KEY,
      user_id         UUID,
      nome            TEXT,
      status          TEXT,
      objetivo        TEXT,
      plataforma      TEXT,
      orcamento_diario NUMERIC,
      orcamento_total  NUMERIC,
      inicio          DATE,
      fim             DATE,
      metricas        JSONB DEFAULT '{}',
      atualizado_em   TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS webhook_mensagens_processadas (
      message_id TEXT PRIMARY KEY,
      instancia  TEXT,
      criado_em  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE webhook_mensagens_processadas
      ADD COLUMN IF NOT EXISTS criado_em TIMESTAMPTZ DEFAULT NOW()
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_webhook_dedup_criado
    ON webhook_mensagens_processadas (criado_em)
  `).catch(() => {});

  // ── Sprint 3: Database Audit Fixes ─────────────────────────────────────────

  // 1. Criar refresh_tokens se não existir (necessário para auth.ts)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id UUID NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // 2. Criar galeria_midias se não existir (usada em galeria.ts)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS galeria_midias (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id UUID NOT NULL,
      url TEXT NOT NULL,
      filename TEXT NOT NULL,
      tamanho INTEGER,
      tipo TEXT,
      tags TEXT[] DEFAULT '{}',
      titulo TEXT,
      descricao TEXT,
      media_type TEXT,
      pasta TEXT DEFAULT 'geral',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // 3. marketing_leads: garantir NOT NULL e índice
  await pool.query(`
    ALTER TABLE marketing_leads
      ALTER COLUMN user_id SET NOT NULL
  `).catch(err => console.warn('[MIGRATIONS] marketing_leads.user_id já NOT NULL ou tem NULLs:', err.message));

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_marketing_leads_user_capturado
    ON marketing_leads (user_id, capturado_em DESC)
  `);

  // 4. facebook_campanhas: garantir NOT NULL e índice
  await pool.query(`
    ALTER TABLE facebook_campanhas
      ALTER COLUMN user_id SET NOT NULL
  `).catch(err => console.warn('[MIGRATIONS] facebook_campanhas.user_id já NOT NULL ou tem NULLs:', err.message));

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_facebook_campanhas_user
    ON facebook_campanhas (user_id)
  `);

  // 5. refresh_tokens: índice para limpeza eficiente
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires
    ON refresh_tokens (expires_at) WHERE revoked = false
  `);

  // 6. Limpeza de tokens expirados/revogados (mantém 30 dias de histórico)
  await pool.query(`
    DELETE FROM refresh_tokens
    WHERE revoked = true AND expires_at < NOW() - INTERVAL '30 days'
  `).catch(() => {});

  // 7. Limpeza de deduplicação de webhook (mantém 24h)
  await pool.query(`
    DELETE FROM webhook_mensagens_processadas
    WHERE criado_em < NOW() - INTERVAL '24 hours'
  `).catch(() => {});

  // 8. Índice em contatos para busca por telefone
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_contatos_user_telefone
    ON contatos (user_id, telefone)
  `).catch(() => {});

  // 9. Índice em whatsapp_messages para listagem de conversas
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_wamsg_session_user_desc
    ON whatsapp_messages (user_id, session_id, created_at DESC)
  `).catch(() => {});

  // ── Sprint 5: OAuth CSRF protection ────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS oauth_state (
      user_id    UUID PRIMARY KEY,
      nonce      TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    )
  `);

  // ── Tabelas de CRM — Sprint de Funcionalidades ──────────────────────────────

  await pool.query(`
    CREATE TABLE IF NOT EXISTS respostas_rapidas (
      id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id    UUID NOT NULL,
      atalho     TEXT NOT NULL,
      titulo     TEXT NOT NULL,
      mensagem   TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (user_id, atalho)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_respostas_rapidas_user
    ON respostas_rapidas (user_id, created_at DESC)
  `).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tags (
      id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id    UUID NOT NULL,
      nome       TEXT NOT NULL,
      cor        TEXT NOT NULL DEFAULT '#3b82f6',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (user_id, nome)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_tags_user
    ON tags (user_id)
  `).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS funil_estagios (
      id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id    UUID NOT NULL,
      nome       TEXT NOT NULL,
      cor        TEXT NOT NULL DEFAULT '#3b82f6',
      ordem      INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_funil_estagios_user_ordem
    ON funil_estagios (user_id, ordem)
  `).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS listas (
      id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id    UUID NOT NULL,
      nome       TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_listas_user
    ON listas (user_id, created_at DESC)
  `).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chamadas (
      id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id     UUID NOT NULL,
      contato_id  UUID NOT NULL,
      resultado   TEXT,
      notas       TEXT,
      duracao_seg INTEGER,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_chamadas_user_contato
    ON chamadas (user_id, contato_id, created_at DESC)
  `).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS timeline_eventos (
      id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id     UUID NOT NULL,
      contato_id  UUID NOT NULL,
      tipo        TEXT NOT NULL DEFAULT 'nota',
      titulo      TEXT NOT NULL,
      descricao   TEXT,
      data_evento TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_timeline_user_contato
    ON timeline_eventos (user_id, contato_id, data_evento DESC)
  `).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tarefas (
      id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id      UUID NOT NULL,
      contato_id   UUID NOT NULL,
      titulo       TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pendente',
      prioridade   TEXT NOT NULL DEFAULT 'media',
      prazo        TIMESTAMPTZ,
      concluida_at TIMESTAMPTZ,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_tarefas_user_contato
    ON tarefas (user_id, contato_id, prazo)
  `).catch(() => {});
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_tarefas_user_status
    ON tarefas (user_id, status, prazo)
  `).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dados_cliente (
      id              BIGSERIAL PRIMARY KEY,
      user_id         UUID NOT NULL,
      nomewpp         TEXT,
      telefone        TEXT,
      "Setor"         TEXT,
      atendimento_ia  BOOLEAN DEFAULT false,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dados_cliente_user
    ON dados_cliente (user_id, created_at DESC)
  `).catch(() => {});
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dados_cliente_telefone
    ON dados_cliente (user_id, telefone)
  `).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id           BIGSERIAL PRIMARY KEY,
      user_id      UUID NOT NULL,
      phone        TEXT,
      user_message TEXT,
      bot_message  TEXT,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_chat_messages_user_phone
    ON chat_messages (user_id, phone, created_at ASC)
  `).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS follow_ups (
      id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id      UUID NOT NULL,
      contato_id   UUID NOT NULL,
      data_retorno TIMESTAMPTZ NOT NULL,
      motivo       TEXT,
      observacao   TEXT,
      status       TEXT NOT NULL DEFAULT 'pendente',
      created_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_follow_ups_user_data
    ON follow_ups (user_id, data_retorno, status)
  `).catch(() => {});

  // ── SLA: adicionar colunas na tabela agentes ─────────────────────────────────
  await pool.query(`ALTER TABLE agentes ADD COLUMN IF NOT EXISTS sla_ativo                BOOLEAN DEFAULT false`).catch(() => {});
  await pool.query(`ALTER TABLE agentes ADD COLUMN IF NOT EXISTS sla_tme                  INTEGER DEFAULT 15`).catch(() => {});
  await pool.query(`ALTER TABLE agentes ADD COLUMN IF NOT EXISTS sla_ociosidade           INTEGER DEFAULT 30`).catch(() => {});
  await pool.query(`ALTER TABLE agentes ADD COLUMN IF NOT EXISTS sla_tma                  INTEGER DEFAULT 120`).catch(() => {});
  await pool.query(`ALTER TABLE agentes ADD COLUMN IF NOT EXISTS sla_acao_estouro         TEXT    DEFAULT 'none'`).catch(() => {});
  await pool.query(`ALTER TABLE agentes ADD COLUMN IF NOT EXISTS sla_notificar_supervisor BOOLEAN DEFAULT false`).catch(() => {});
  await pool.query(`ALTER TABLE agentes ADD COLUMN IF NOT EXISTS sla_email_supervisor     TEXT`).catch(() => {});

  // ── CRM: Disparos e Logs ──────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS disparos (
      id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id          UUID NOT NULL,
      nome             TEXT NOT NULL,
      status           TEXT DEFAULT 'rascunho',
      perfil_velocidade TEXT DEFAULT 'safe',
      horario_inicio   TEXT DEFAULT '08:00',
      horario_fim      TEXT DEFAULT '21:00',
      instancias_ids   TEXT[] DEFAULT '{}',
      total_leads      INTEGER DEFAULT 0,
      enviados         INTEGER DEFAULT 0,
      entregues        INTEGER DEFAULT 0,
      respondidos      INTEGER DEFAULT 0,
      falhas           INTEGER DEFAULT 0,
      mensagem_template TEXT,
      tipo_midia       TEXT DEFAULT 'texto',
      url_midia        TEXT,
      legenda_midia    TEXT,
      agendado_para    TIMESTAMPTZ,
      pausa_fins_semana BOOLEAN DEFAULT true,
      pausa_erros_consecutivos BOOLEAN DEFAULT true,
      limite_erros_consecutivos INTEGER DEFAULT 5,
      pausa_bloqueios_detectados BOOLEAN DEFAULT true,
      created_at       TIMESTAMPTZ DEFAULT NOW(),
      updated_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS disparo_logs (
      id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      disparo_id       UUID REFERENCES disparos(id) ON DELETE CASCADE,
      user_id          UUID NOT NULL,
      contato_id       UUID,
      telefone         TEXT NOT NULL,
      nome             TEXT,
      mensagem_enviada TEXT,
      status           TEXT DEFAULT 'pending',
      enviado_at       TIMESTAMPTZ,
      tentativas       INTEGER DEFAULT 0,
      erro             TEXT,
      created_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_disparo_logs_status
    ON disparo_logs (status) WHERE status = 'pending'
  `).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS disparo_rate_limit (
      user_id         UUID PRIMARY KEY,
      last_disparo_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});

  // Coluna para filtrar contatos por estágio do funil no disparo
  await pool.query(`ALTER TABLE contatos ADD COLUMN IF NOT EXISTS funil_estagio_id UUID`).catch(() => {});

  // Coluna humanizar_ia para disparos (humanização via Claude Haiku)
  await pool.query(`ALTER TABLE disparos ADD COLUMN IF NOT EXISTS humanizar_ia BOOLEAN DEFAULT false`).catch(() => {});

  // Tabela de permissões de módulos por usuário
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_modulos (
      id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id    UUID NOT NULL,
      modulo     TEXT NOT NULL,
      ativo      BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (user_id, modulo)
    )
  `).catch(() => {});
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_modulos_user
    ON user_modulos (user_id, ativo)
  `).catch(() => {});

  // ── Função get_next_disparo_batch para o processador ───────────────────────
  await pool.query(`
    CREATE OR REPLACE FUNCTION get_next_disparo_batch(batch_size INTEGER)
    RETURNS TABLE (
      log_id UUID,
      disparo_id UUID,
      user_id UUID,
      telefone TEXT,
      mensagem TEXT,
      tipo_midia TEXT,
      url_midia TEXT,
      legenda_midia TEXT
    ) AS $$
    BEGIN
      RETURN QUERY
      WITH next_msgs AS (
        SELECT l.id, l.disparo_id, l.user_id, l.telefone, l.mensagem_enviada,
               d.tipo_midia, d.url_midia, d.legenda_midia
        FROM disparo_logs l
        JOIN disparos d ON d.id = l.disparo_id
        WHERE l.status = 'pending'
          AND d.status = 'em_andamento'
          AND (d.agendado_para IS NULL OR d.agendado_para <= NOW())
        ORDER BY l.created_at ASC
        LIMIT batch_size
        FOR UPDATE SKIP LOCKED
      )
      UPDATE disparo_logs
      SET status = 'sending'
      FROM next_msgs
      WHERE disparo_logs.id = next_msgs.id
      RETURNING 
        next_msgs.id, next_msgs.disparo_id, next_msgs.user_id, next_msgs.telefone, 
        next_msgs.mensagem_enviada, next_msgs.tipo_midia, next_msgs.url_midia, next_msgs.legenda_midia;
    END;
    $$ LANGUAGE plpgsql;
  `).catch(err => console.error('[MIGRATIONS] Erro ao criar function get_next_disparo_batch:', err.message));

  // Garantir tabela integracoes_config
  await pool.query(`
    CREATE TABLE IF NOT EXISTS integracoes_config (
      id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id    UUID NOT NULL,
      tipo       TEXT NOT NULL,
      url        TEXT,
      api_key    TEXT,
      instancia  TEXT,
      token      TEXT,
      status     TEXT DEFAULT 'ativo',
      config     JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (user_id, tipo)
    )
  `).catch(() => {});

  // Colunas de score em agentes
  await pool.query(`ALTER TABLE agentes ADD COLUMN IF NOT EXISTS evolution_instancia TEXT`).catch(() => {});
  await pool.query(`ALTER TABLE agentes ADD COLUMN IF NOT EXISTS whatsapp_score INTEGER DEFAULT 100`).catch(() => {});

  // ── Tabela de Workflows ──────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workflows (
      id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      nome        TEXT NOT NULL DEFAULT 'Novo Workflow',
      descricao   TEXT,
      ativo       BOOLEAN NOT NULL DEFAULT false,
      nodes       JSONB NOT NULL DEFAULT '[]',
      edges       JSONB NOT NULL DEFAULT '[]',
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_workflows_user
    ON workflows (user_id, updated_at DESC)
  `).catch(() => {});

  // ── FKs faltantes para integridade referencial ───────────────────────────
  // Idempotentes: falham silenciosamente se já existirem
  const fksMissing = [
    `ALTER TABLE follow_ups         ADD CONSTRAINT fk_follow_ups_user         FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
    `ALTER TABLE funil_estagios     ADD CONSTRAINT fk_funil_estagios_user     FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
    `ALTER TABLE tags               ADD CONSTRAINT fk_tags_user               FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
    `ALTER TABLE respostas_rapidas  ADD CONSTRAINT fk_respostas_rapidas_user  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
    `ALTER TABLE galeria_midias     ADD CONSTRAINT fk_galeria_midias_user     FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
    `ALTER TABLE whatsapp_messages  ADD CONSTRAINT fk_whatsapp_messages_user  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
    `ALTER TABLE catalogos          ADD CONSTRAINT fk_catalogos_user          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
    `ALTER TABLE produtos           ADD CONSTRAINT fk_produtos_user           FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
    `ALTER TABLE produto_imagens    ADD CONSTRAINT fk_produto_imagens_user    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
    `ALTER TABLE facebook_contas    ADD CONSTRAINT fk_facebook_contas_user    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
    `ALTER TABLE facebook_campanhas ADD CONSTRAINT fk_facebook_campanhas_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
    `ALTER TABLE marketing_leads    ADD CONSTRAINT fk_marketing_leads_user    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
    `ALTER TABLE disparo_optouts    ADD CONSTRAINT fk_disparo_optouts_user    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
    `ALTER TABLE disparo_rate_limit ADD CONSTRAINT fk_disparo_rate_limit_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
    `ALTER TABLE opt_out_contatos   ADD CONSTRAINT fk_opt_out_contatos_user   FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
  ];
  for (const sql of fksMissing) {
    await pool.query(sql).catch(() => {}); // já existe → ignora
  }

  // ── Remover índices duplicados em users.email (se ainda existirem) ───────
  await pool.query(`DROP INDEX IF EXISTS idx_users_email`).catch(() => {});
  await pool.query(`DROP INDEX IF EXISTS idx_users_email_unique`).catch(() => {});

  // ── Sprint CRM+n8n: Unificação de banco ──────────────────────────────────

  // 1. Migrar dados_cliente.atendimento_ia de BOOLEAN → TEXT
  {
    const col = await pool.query(`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'dados_cliente' AND column_name = 'atendimento_ia'
    `).catch(() => ({ rows: [] as any[] }));
    if (col.rows[0]?.data_type === 'boolean') {
      await pool.query(`
        ALTER TABLE dados_cliente
          ALTER COLUMN atendimento_ia TYPE TEXT
          USING (CASE WHEN atendimento_ia THEN 'pause' ELSE 'ativo' END)
      `).catch(err => console.warn('[MIGRATIONS] atendimento_ia migration:', err.message));
      await pool.query(`
        ALTER TABLE dados_cliente
          ALTER COLUMN atendimento_ia SET DEFAULT 'ativo'
      `).catch(() => {});
      console.log('[MIGRATIONS] atendimento_ia migrado de BOOLEAN → TEXT');
    }
  }

  // 2. Colunas de pausa automática em dados_cliente
  await pool.query(`ALTER TABLE dados_cliente ADD COLUMN IF NOT EXISTS pausa_timestamp    TIMESTAMPTZ`).catch(() => {});
  await pool.query(`ALTER TABLE dados_cliente ADD COLUMN IF NOT EXISTS pausa_duracao_min  INTEGER DEFAULT 30`).catch(() => {});
  await pool.query(`ALTER TABLE dados_cliente ADD COLUMN IF NOT EXISTS pausa_atendente_id UUID`).catch(() => {});

  // 3. Tabela de auditoria de pausas de IA
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ia_pausa_log (
      id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id        UUID NOT NULL,
      contato_id     UUID,
      telefone       TEXT,
      atendente_id   UUID,
      acao           TEXT NOT NULL CHECK (acao IN ('pause', 'ativo', 'auto_reativado')),
      duracao_min    INTEGER,
      observacao     TEXT,
      created_at     TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ia_pausa_log_user
    ON ia_pausa_log (user_id, created_at DESC)
  `).catch(() => {});

  // 4. Colunas n8n/IA em agentes
  await pool.query(`ALTER TABLE agentes ADD COLUMN IF NOT EXISTS modelo              TEXT    DEFAULT 'claude-haiku-4-5-20251001'`).catch(() => {});
  await pool.query(`ALTER TABLE agentes ADD COLUMN IF NOT EXISTS temperatura         NUMERIC DEFAULT 0.7`).catch(() => {});
  await pool.query(`ALTER TABLE agentes ADD COLUMN IF NOT EXISTS max_tokens          INTEGER DEFAULT 1024`).catch(() => {});
  await pool.query(`ALTER TABLE agentes ADD COLUMN IF NOT EXISTS rag_ativo           BOOLEAN DEFAULT false`).catch(() => {});
  await pool.query(`ALTER TABLE agentes ADD COLUMN IF NOT EXISTS rag_threshold       NUMERIC DEFAULT 0.75`).catch(() => {});
  await pool.query(`ALTER TABLE agentes ADD COLUMN IF NOT EXISTS rag_resultados      INTEGER DEFAULT 3`).catch(() => {});
  await pool.query(`ALTER TABLE agentes ADD COLUMN IF NOT EXISTS evolution_api_key   TEXT`).catch(() => {});
  await pool.query(`ALTER TABLE agentes ADD COLUMN IF NOT EXISTS evolution_server_url TEXT`).catch(() => {});
  await pool.query(`ALTER TABLE agentes ADD COLUMN IF NOT EXISTS ativo               BOOLEAN DEFAULT true`).catch(() => {});

  // 5. Índice único em agentes.evolution_instancia (null não conflita)
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_agentes_evolution_instancia
    ON agentes (user_id, evolution_instancia)
    WHERE evolution_instancia IS NOT NULL
  `).catch(() => {});

  // 6. Índice único em agent_prompts: um prompt ativo por usuário
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_prompts_user_ativo
    ON agent_prompts (user_id)
    WHERE ativo = true
  `).catch(() => {});

  // 7. Colunas e índices em n8n_chat_histories para multi-tenant
  await pool.query(`ALTER TABLE n8n_chat_histories ADD COLUMN IF NOT EXISTS user_id   UUID`).catch(() => {});
  await pool.query(`ALTER TABLE n8n_chat_histories ADD COLUMN IF NOT EXISTS instancia  TEXT`).catch(() => {});
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_n8n_chat_user_session
    ON n8n_chat_histories (user_id, session_id, created_at DESC)
  `).catch(() => {});
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_n8n_chat_instancia
    ON n8n_chat_histories (instancia, created_at DESC)
  `).catch(() => {});

  // 8. Função PostgreSQL para reativar pausas expiradas (chamada pelo cron)
  await pool.query(`
    CREATE OR REPLACE FUNCTION reativar_pausas_expiradas()
    RETURNS INTEGER AS $$
    DECLARE
      reativados INTEGER := 0;
    BEGIN
      WITH expirados AS (
        UPDATE dados_cliente
        SET atendimento_ia   = 'ativo',
            pausa_timestamp  = NULL,
            pausa_duracao_min = NULL,
            pausa_atendente_id = NULL
        WHERE atendimento_ia = 'pause'
          AND pausa_timestamp IS NOT NULL
          AND pausa_timestamp + (pausa_duracao_min * INTERVAL '1 minute') < NOW()
        RETURNING id, user_id, telefone
      )
      INSERT INTO ia_pausa_log (user_id, telefone, acao, observacao)
      SELECT user_id, telefone, 'auto_reativado', 'Pausa expirada automaticamente'
      FROM expirados;

      GET DIAGNOSTICS reativados = ROW_COUNT;
      RETURN reativados;
    END;
    $$ LANGUAGE plpgsql;
  `).catch(err => console.warn('[MIGRATIONS] reativar_pausas_expiradas:', err.message));

  // 9. Índices de performance para n8n + FK de ia_pausa_log + unique dados_cliente(user_id, telefone)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dados_cliente_pausa_ativa
    ON dados_cliente (user_id, pausa_timestamp)
    WHERE atendimento_ia = 'pause'
  `).catch(() => {});
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_n8n_chat_session_desc
    ON n8n_chat_histories (session_id, created_at DESC)
  `).catch(() => {});
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_dados_cliente_user_telefone
    ON dados_cliente (user_id, telefone)
    WHERE telefone IS NOT NULL
  `).catch(() => {});
  // FK de ia_pausa_log → users
  await pool.query(`
    ALTER TABLE ia_pausa_log
      ADD CONSTRAINT fk_ia_pausa_log_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  `).catch(() => {});

  console.log('[MIGRATIONS] Sprint CRM+n8n concluído');

  // ── Migration 002: whatsapp_messages ────────────────────────────────────

  // Detecta schema antigo (colunas em PT) e dropa para recriar
  {
    const oldSchema = await pool.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'whatsapp_messages' AND column_name = 'instancia'
    `).catch(() => ({ rows: [] as any[] }));
    if (oldSchema.rows.length > 0) {
      await pool.query(`DROP TABLE IF EXISTS whatsapp_messages CASCADE`).catch(() => {});
      console.log('[MIGRATIONS] whatsapp_messages schema antigo removido');
    }
  }

  // Tabela principal
  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_messages (
      id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      instance_name   TEXT        NOT NULL,
      remote_jid      TEXT        NOT NULL,
      message_id      TEXT        NOT NULL,
      from_me         BOOLEAN     NOT NULL DEFAULT false,
      message_type    TEXT        NOT NULL DEFAULT 'text',
      content         TEXT,
      media_url       TEXT,
      media_mimetype  TEXT,
      quoted_id       TEXT,
      status          TEXT        NOT NULL DEFAULT 'received',
      agent_id        UUID        REFERENCES agentes(id) ON DELETE SET NULL,
      metadata        JSONB       NOT NULL DEFAULT '{}',
      timestamp_wa    TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT uq_whatsapp_message UNIQUE (message_id, instance_name)
    )
  `).catch(() => {});

  // Índices
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_wa_messages_conversation ON whatsapp_messages (user_id, remote_jid, timestamp_wa DESC NULLS LAST)`).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_wa_messages_instance ON whatsapp_messages (user_id, instance_name, created_at DESC)`).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_wa_messages_status_pending ON whatsapp_messages (user_id, status) WHERE status IN ('pending', 'failed')`).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_wa_messages_content_fts ON whatsapp_messages USING gin(to_tsvector('portuguese', coalesce(content, '')))`).catch(() => {});

  // Trigger updated_at
  await pool.query(`
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER LANGUAGE plpgsql AS $$
    BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
  `).catch(() => {});
  await pool.query(`DROP TRIGGER IF EXISTS trg_wa_messages_updated_at ON whatsapp_messages`).catch(() => {});
  await pool.query(`
    CREATE TRIGGER trg_wa_messages_updated_at
      BEFORE UPDATE ON whatsapp_messages
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()
  `).catch(() => {});

  // View de última mensagem por conversa
  await pool.query(`
    CREATE OR REPLACE VIEW whatsapp_conversations AS
    SELECT DISTINCT ON (user_id, instance_name, remote_jid)
      id, user_id, instance_name, remote_jid,
      content AS ultima_mensagem, from_me AS ultima_foi_minha,
      message_type AS ultimo_tipo, status AS ultimo_status,
      timestamp_wa AS ultimo_timestamp, created_at AS ultimo_created_at
    FROM whatsapp_messages
    ORDER BY user_id, instance_name, remote_jid, timestamp_wa DESC NULLS LAST
  `).catch(err => console.warn('[MIGRATIONS] whatsapp_conversations view:', err.message));

  // Função para IA buscar histórico
  await pool.query(`
    CREATE OR REPLACE FUNCTION get_conversation_history(
      p_user_id    UUID,
      p_remote_jid TEXT,
      p_instance   TEXT  DEFAULT NULL,
      p_limit      INT   DEFAULT 20
    )
    RETURNS TABLE (role TEXT, content TEXT, timestamp_wa TIMESTAMPTZ, message_type TEXT)
    LANGUAGE sql STABLE AS $$
      SELECT
        CASE WHEN from_me THEN 'assistant' ELSE 'user' END AS role,
        coalesce(content, '[' || message_type || ']')       AS content,
        timestamp_wa,
        message_type
      FROM whatsapp_messages
      WHERE user_id    = p_user_id
        AND remote_jid = p_remote_jid
        AND (p_instance IS NULL OR instance_name = p_instance)
        AND content    IS NOT NULL
        AND message_type = 'text'
      ORDER BY timestamp_wa ASC NULLS LAST
      LIMIT p_limit;
    $$
  `).catch(err => console.warn('[MIGRATIONS] get_conversation_history fn:', err.message));

  console.log('[MIGRATIONS] 002_whatsapp_messages OK');

  // ── Sprint Equipe / Kanban / Sub-perfis ──────────────────────────────────

  // Equipes
  await pool.query(`
    CREATE TABLE IF NOT EXISTS equipes (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      nome       TEXT NOT NULL,
      owner_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_equipes_owner ON equipes(owner_id)`).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS equipe_membros (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      equipe_id     UUID NOT NULL REFERENCES equipes(id) ON DELETE CASCADE,
      user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role          TEXT NOT NULL DEFAULT 'membro',
      convidado_por UUID REFERENCES users(id) ON DELETE SET NULL,
      joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(equipe_id, user_id)
    )
  `).catch(() => {});

  // Garantir colunas em equipe_membros em instâncias já criadas
  await pool.query(`ALTER TABLE equipe_membros ADD COLUMN IF NOT EXISTS convidado_por UUID REFERENCES users(id) ON DELETE SET NULL`).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_equipe_membros_user ON equipe_membros(user_id)`).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS equipe_chat (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      equipe_id  UUID NOT NULL REFERENCES equipes(id) ON DELETE CASCADE,
      user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conteudo   TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_equipe_chat_equipe ON equipe_chat(equipe_id, created_at DESC)`).catch(() => {});

  // Garantir convidado_por em equipe_membros (pode ter sido criada sem a coluna)
  await pool.query(`ALTER TABLE equipe_membros ADD COLUMN IF NOT EXISTS convidado_por UUID REFERENCES users(id) ON DELETE SET NULL`).catch(() => {});

  // Kanban
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kanban_colunas (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      nome       TEXT NOT NULL,
      ordem      INTEGER NOT NULL DEFAULT 0,
      cor        TEXT DEFAULT '#6366f1',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_kanban_colunas_user ON kanban_colunas(user_id, ordem)`).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tarefas (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      coluna_id     UUID REFERENCES kanban_colunas(id) ON DELETE SET NULL,
      titulo        TEXT NOT NULL,
      descricao     TEXT,
      resumo_ia     TEXT,
      prioridade    TEXT NOT NULL DEFAULT 'media',
      ordem         INTEGER NOT NULL DEFAULT 0,
      conversa_id   TEXT,
      origem        TEXT DEFAULT 'manual',
      criada_por    UUID REFERENCES users(id) ON DELETE SET NULL,
      atribuido_a   UUID REFERENCES users(id) ON DELETE SET NULL,
      sub_perfil_id UUID,
      contato_id    UUID,
      concluida     BOOLEAN NOT NULL DEFAULT false,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tarefas_user_coluna ON tarefas(user_id, coluna_id, ordem)`).catch(() => {});

  // Garantir colunas do Kanban em tarefas (caso a tabela já existia no schema CRM antigo)
  await pool.query(`ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS coluna_id     UUID REFERENCES kanban_colunas(id) ON DELETE SET NULL`).catch(() => {});
  await pool.query(`ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS resumo_ia     TEXT`).catch(() => {});
  await pool.query(`ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS conversa_id   TEXT`).catch(() => {});
  await pool.query(`ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS origem        TEXT DEFAULT 'manual'`).catch(() => {});
  await pool.query(`ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS criada_por    UUID REFERENCES users(id) ON DELETE SET NULL`).catch(() => {});
  await pool.query(`ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS atribuido_a   UUID REFERENCES users(id) ON DELETE SET NULL`).catch(() => {});
  await pool.query(`ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS sub_perfil_id UUID`).catch(() => {});
  await pool.query(`ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS concluida     BOOLEAN NOT NULL DEFAULT false`).catch(() => {});
  await pool.query(`ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS tags          TEXT[] DEFAULT '{}'`).catch(() => {});
  await pool.query(`ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS data_limite   TIMESTAMPTZ`).catch(() => {});
  await pool.query(`ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS contato_nome  TEXT`).catch(() => {});
  await pool.query(`ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS contato_telefone TEXT`).catch(() => {});
  await pool.query(`ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS remote_jid    TEXT`).catch(() => {});
  await pool.query(`ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS instance_name TEXT`).catch(() => {});
  await pool.query(`ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()`).catch(() => {});
  // Tornar contato_id nullable (pode ter sido criado como NOT NULL na versão antiga)
  await pool.query(`ALTER TABLE tarefas ALTER COLUMN contato_id DROP NOT NULL`).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tarefa_comentarios (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tarefa_id  UUID NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
      user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conteudo   TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `).catch(() => {});

  // Team (convites e papéis)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS team_members (
      id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_id            UUID REFERENCES users(id) ON DELETE SET NULL,
      email              TEXT NOT NULL,
      nome               TEXT,
      cargo              TEXT,
      status             TEXT NOT NULL DEFAULT 'convidado',
      convite_token      TEXT UNIQUE,
      convite_expira_at  TIMESTAMPTZ,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(owner_id, email)
    )
  `).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_team_members_owner ON team_members(owner_id)`).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_team_members_token ON team_members(convite_token) WHERE convite_token IS NOT NULL`).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS team_roles (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      nome        TEXT NOT NULL,
      cor         TEXT DEFAULT '#6366f1',
      descricao   TEXT,
      is_system   BOOLEAN NOT NULL DEFAULT false,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS team_member_roles (
      member_id UUID NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
      role_id   UUID NOT NULL REFERENCES team_roles(id) ON DELETE CASCADE,
      PRIMARY KEY(member_id, role_id)
    )
  `).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS team_role_permissions (
      role_id    UUID NOT NULL REFERENCES team_roles(id) ON DELETE CASCADE,
      permission TEXT NOT NULL,
      PRIMARY KEY(role_id, permission)
    )
  `).catch(() => {});

  // Sub-perfis
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sub_perfis (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      membro_id   UUID REFERENCES users(id) ON DELETE SET NULL,
      nome        TEXT NOT NULL,
      email       TEXT NOT NULL UNIQUE,
      senha_hash  TEXT NOT NULL,
      modulos     TEXT[] NOT NULL DEFAULT '{}',
      avatar_cor  TEXT DEFAULT '#6366f1',
      ativo       BOOLEAN NOT NULL DEFAULT true,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sub_perfis_user ON sub_perfis(user_id)`).catch(() => {});

  console.log('[MIGRATIONS] Equipe/Kanban/SubPerfis OK');

  // ── AI Providers & Uso ────────────────────────────────────────────────────

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_providers (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      nome              TEXT NOT NULL,
      slug              TEXT NOT NULL,
      modelo            TEXT NOT NULL,
      api_key_enc       TEXT NOT NULL,
      base_url          TEXT,
      suporta_visao     BOOLEAN NOT NULL DEFAULT false,
      suporta_audio     BOOLEAN NOT NULL DEFAULT false,
      custo_input_mtok  NUMERIC,
      custo_output_mtok NUMERIC,
      ativo             BOOLEAN NOT NULL DEFAULT true,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(user_id, slug)
    )
  `).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ai_providers_user ON ai_providers(user_id)`).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_uso_diario (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider_slug    TEXT NOT NULL,
      modelo           TEXT NOT NULL,
      data             DATE NOT NULL DEFAULT CURRENT_DATE,
      total_mensagens  INTEGER NOT NULL DEFAULT 0,
      tokens_entrada   BIGINT NOT NULL DEFAULT 0,
      tokens_saida     BIGINT NOT NULL DEFAULT 0,
      custo_usd        NUMERIC NOT NULL DEFAULT 0,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(user_id, provider_slug, modelo, data)
    )
  `).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ai_uso_diario_user_data ON ai_uso_diario(user_id, data DESC)`).catch(() => {});

  await pool.query(`
    CREATE OR REPLACE VIEW vw_ai_uso_30d AS
    SELECT
      user_id,
      provider_slug,
      modelo,
      SUM(total_mensagens)::int AS total_mensagens,
      SUM(tokens_entrada)::bigint AS tokens_entrada,
      SUM(tokens_saida)::bigint AS tokens_saida,
      SUM(custo_usd) AS custo_usd
    FROM ai_uso_diario
    WHERE data >= CURRENT_DATE - 30
    GROUP BY user_id, provider_slug, modelo
  `).catch(() => {});

  await pool.query(`
    CREATE OR REPLACE VIEW vw_conversas_ativas AS
    SELECT
      n.user_id,
      n.session_id,
      MAX(n.created_at) AS ultima_mensagem,
      COUNT(*)::int AS total_mensagens
    FROM n8n_chat_histories n
    WHERE n.created_at >= NOW() - INTERVAL '7 days'
    GROUP BY n.user_id, n.session_id
  `).catch(() => {});

  // Coluna provider_id em agentes (para associar ao ai_providers)
  await pool.query(`ALTER TABLE agentes ADD COLUMN IF NOT EXISTS provider_id UUID REFERENCES ai_providers(id) ON DELETE SET NULL`).catch(() => {});

  console.log('[MIGRATIONS] AI Providers/Uso OK');

  // ── WhatsApp Instances (fluxo QR simplificado) ───────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_instances (
      id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      nome            TEXT        NOT NULL,
      numero          TEXT,
      instance_name   TEXT        NOT NULL,
      status          TEXT        NOT NULL DEFAULT 'pendente',
      qr_code         TEXT,
      pairing_code    TEXT,
      qr_expires_at   TIMESTAMPTZ,
      conectado_em    TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT uq_wa_instance_name UNIQUE (instance_name),
      CONSTRAINT uq_wa_user_nome     UNIQUE (user_id, nome)
    )
  `).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_wa_instances_user ON whatsapp_instances(user_id, status)`).catch(() => {});

  // Coluna provider_id em agentes (referência ao ai_providers)
  await pool.query(`ALTER TABLE agentes ADD COLUMN IF NOT EXISTS provider_id UUID REFERENCES ai_providers(id) ON DELETE SET NULL`).catch(() => {});

  // Colunas n8n/Kanban em tarefas (garantir no VPS também)
  await pool.query(`ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS contato_nome     TEXT`).catch(() => {});
  await pool.query(`ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS contato_telefone TEXT`).catch(() => {});
  await pool.query(`ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS remote_jid       TEXT`).catch(() => {});
  await pool.query(`ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS instance_name    TEXT`).catch(() => {});

  // Coluna token em integracoes_config (usada pela rota POST /api/integracoes_config)
  await pool.query(`ALTER TABLE integracoes_config ADD COLUMN IF NOT EXISTS token TEXT`).catch(() => {});
  // nome pode vir nulo quando o frontend não envia — dar default pelo tipo
  await pool.query(`ALTER TABLE integracoes_config ALTER COLUMN nome SET DEFAULT ''`).catch(() => {});
  await pool.query(`ALTER TABLE integracoes_config ALTER COLUMN nome DROP NOT NULL`).catch(() => {});

  console.log('[MIGRATIONS] WhatsApp Instances + patches finais OK');

  // ── Garantir usuários admin master ────────────────────────────────────────
  // Lê MASTER_EMAILS do ambiente e garante que cada um existe como admin.
  // INITIAL_ADMIN_PASSWORD define a senha padrão (só usada na criação).
  // Se o usuário já existe, não altera nada.
  {
    const masterEmails = (process.env.MASTER_EMAILS || 'angelobispofilho@gmail.com,mentoark@gmail.com')
      .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
    const defaultPassword = process.env.INITIAL_ADMIN_PASSWORD || 'Mentoark@2025';
    const defaultNames: Record<string, string> = {
      'angelobispofilho@gmail.com': 'Angelo Marcos',
      'mentoark@gmail.com': 'Mentoark Admin',
    };

    for (const email of masterEmails) {
      try {
        const exists = await pool.query(`SELECT id FROM users WHERE email = $1`, [email]);
        if (!exists.rows.length) {
          await pool.query(
            `INSERT INTO users (email, password_hash, display_name, role, active, email_verified)
             VALUES ($1, crypt($2, gen_salt('bf', 10)), $3, 'admin', true, true)`,
            [email, defaultPassword, defaultNames[email] || email.split('@')[0]]
          );
          console.log(`[MIGRATIONS] Usuário admin criado: ${email}`);
        } else {
          // Garantir que é admin e está ativo
          await pool.query(
            `UPDATE users SET role = 'admin', active = true WHERE email = $1 AND (role != 'admin' OR active = false)`,
            [email]
          );
        }
      } catch (err: any) {
        console.warn(`[MIGRATIONS] Erro ao garantir admin ${email}:`, err.message);
      }
    }
    console.log('[MIGRATIONS] Usuários master verificados OK');
  }

  // ── whatsapp_message_status (status de entrega/leitura por messageId) ───────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_message_status (
      id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      message_id    TEXT        NOT NULL,
      instance_name TEXT        NOT NULL,
      status        TEXT        NOT NULL,
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (message_id, instance_name)
    )
  `).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_wa_msg_status_msg ON whatsapp_message_status(message_id)`).catch(() => {});

  // Colunas extras em whatsapp_messages que podem não existir em instâncias antigas
  await pool.query(`ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS is_read BOOLEAN NOT NULL DEFAULT false`).catch(() => {});
  await pool.query(`ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS push_name TEXT`).catch(() => {});
  // Quem enviou a mensagem manualmente (diferencia atendente humano da IA)
  await pool.query(`ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS sent_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL`).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_wa_messages_sent_by ON whatsapp_messages(sent_by_user_id) WHERE sent_by_user_id IS NOT NULL`).catch(() => {});

  console.log('[MIGRATIONS] whatsapp_message_status + patches OK');

  console.log('[MIGRATIONS] OK');
}
