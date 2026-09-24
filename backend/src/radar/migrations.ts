import { Pool } from 'pg';
import { log } from '../logger';

/** Migrations aditivas do Radar de Grupos (Etapa 1: catálogo). Nada aqui toca tabelas existentes. */
export async function migrarRadar(pool: Pool): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS radar_nichos (
        id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id           UUID        NOT NULL,
        nome              TEXT        NOT NULL,
        termos_busca      TEXT[]      NOT NULL DEFAULT '{}',
        palavras_positivas TEXT[]     NOT NULL DEFAULT '{}',
        palavras_negativas TEXT[]     NOT NULL DEFAULT '{}',
        regioes           TEXT[]      NOT NULL DEFAULT '{}',
        ativo             BOOLEAN     NOT NULL DEFAULT true,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (user_id, nome)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS radar_buscas (
        id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id          UUID        NOT NULL,
        request_id       UUID        NOT NULL,
        nicho_id         UUID        REFERENCES radar_nichos(id) ON DELETE SET NULL,
        provider         TEXT,
        consultas        JSONB       NOT NULL DEFAULT '[]'::jsonb,
        max_consultas    INTEGER     NOT NULL DEFAULT 10,
        status           TEXT        NOT NULL DEFAULT 'queued',
        consultas_feitas INTEGER     NOT NULL DEFAULT 0,
        custo_usd        NUMERIC(10,4) NOT NULL DEFAULT 0,
        novos            INTEGER     NOT NULL DEFAULT 0,
        existentes       INTEGER     NOT NULL DEFAULT 0,
        interrompida_por TEXT,
        aviso            TEXT,
        erro             TEXT,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
        finished_at      TIMESTAMPTZ,
        UNIQUE (user_id, request_id)
      )
    `);
    await pool.query(`ALTER TABLE radar_buscas ADD COLUMN IF NOT EXISTS links_vistos INTEGER NOT NULL DEFAULT 0`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_radar_buscas_user ON radar_buscas (user_id, created_at DESC)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS radar_grupos (
        id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id          UUID        NOT NULL,
        plataforma       TEXT        NOT NULL DEFAULT 'whatsapp',
        codigo_convite   TEXT        NOT NULL,
        url              TEXT        NOT NULL,
        nome             TEXT,
        descricao        TEXT,
        nicho_id         UUID        REFERENCES radar_nichos(id) ON DELETE SET NULL,
        regiao           TEXT,
        status           TEXT        NOT NULL DEFAULT 'descoberto',
        fonte            TEXT        NOT NULL DEFAULT 'busca',
        busca_id         UUID        REFERENCES radar_buscas(id) ON DELETE SET NULL,
        consulta         TEXT,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (user_id, plataforma, codigo_convite)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_radar_grupos_user_status ON radar_grupos (user_id, status, created_at DESC)`);
    // Etapa 2: pré-visualização do convite (sem entrar) e score. `nome` passa a guardar SÓ o nome real
    // do grupo (vindo da Evolution); o título da página onde o link foi achado vai para titulo_origem.
    const colunas = [
      'titulo_origem TEXT', 'jid TEXT', 'participantes INTEGER', 'criado_no_whatsapp TIMESTAMPTZ',
      'link_ativo BOOLEAN', 'somente_admins BOOLEAN', 'aprovacao_admin BOOLEAN', 'validado_em TIMESTAMPTZ',
      'erro_validacao TEXT', 'score INTEGER', 'score_motivos JSONB', 'avaliado_em TIMESTAMPTZ',
      'aderencia TEXT', 'aderencia_motivo TEXT', 'motivo_descarte TEXT', 'link_verificado_em TIMESTAMPTZ',
      'pct_com_telefone NUMERIC(5,2)', 'importado_lista_id UUID', 'importado_em TIMESTAMPTZ',
    ];
    for (const c of colunas) await pool.query(`ALTER TABLE radar_grupos ADD COLUMN IF NOT EXISTS ${c}`);
    await pool.query(
      `UPDATE radar_grupos SET titulo_origem = nome, nome = NULL
        WHERE fonte = 'busca' AND titulo_origem IS NULL AND validado_em IS NULL AND nome IS NOT NULL`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_radar_grupos_score ON radar_grupos (user_id, score DESC NULLS LAST)`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS radar_score_config (
        user_id    UUID        PRIMARY KEY,
        pesos      JSONB       NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    // Nichos: busca automática diária (rodízio de consultas) e DDDs para variações de consulta.
    for (const c of ['agendar BOOLEAN NOT NULL DEFAULT false', 'ddds TEXT[] NOT NULL DEFAULT \'{}\'', 'rodada INTEGER NOT NULL DEFAULT 0', 'ultima_busca_em TIMESTAMPTZ']) {
      await pool.query(`ALTER TABLE radar_nichos ADD COLUMN IF NOT EXISTS ${c}`);
    }
    await pool.query(`ALTER TABLE radar_buscas ADD COLUMN IF NOT EXISTS paginas_raspadas INTEGER NOT NULL DEFAULT 0`);
    // Páginas de diretório já raspadas: evita repetir e sustenta o teto diário.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS radar_paginas (
        id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     UUID        NOT NULL,
        url         TEXT        NOT NULL,
        status      TEXT        NOT NULL,
        links       INTEGER     NOT NULL DEFAULT 0,
        novos       INTEGER     NOT NULL DEFAULT 0,
        erro        TEXT,
        raspada_em  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_radar_paginas_user_url ON radar_paginas (user_id, url, raspada_em DESC)`);
    // Pausa por bloqueio/limite do provedor (busca) ou do WhatsApp (verificação de link): persiste entre reinícios.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS radar_pausas (
        recurso    TEXT        PRIMARY KEY,
        ate        TIMESTAMPTZ NOT NULL,
        motivo     TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    log.info('MIGRATIONS', 'radar (radar_nichos, radar_buscas, radar_grupos, radar_score_config, radar_pausas) OK');
  } catch (err: any) {
    log.error('MIGRATIONS', 'Falha na migration do radar', { err: err?.message, stack: err?.stack });
  }
}
