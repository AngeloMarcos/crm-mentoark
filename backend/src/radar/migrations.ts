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
    log.info('MIGRATIONS', 'radar (radar_nichos, radar_buscas, radar_grupos) OK');
  } catch (err: any) {
    log.error('MIGRATIONS', 'Falha na migration do radar', { err: err?.message, stack: err?.stack });
  }
}
