import { Pool, PoolClient, types } from 'pg';
import dotenv from 'dotenv';
import { log } from './logger';
dotenv.config();

// OID 1700 = NUMERIC — pg retorna como string por padrão; forçar float
types.setTypeParser(1700, (val: string) => parseFloat(val));
// OID 700/701 = FLOAT4/FLOAT8 — já vêm como number, mas garantir
types.setTypeParser(700,  (val: string) => parseFloat(val));
types.setTypeParser(701,  (val: string) => parseFloat(val));

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  // O servidor VPS 147.93.9.172 não suporta conexões SSL
  ssl: process.env.DATABASE_URL?.includes('147.93.9.172') ? false : false
});

// Configura o search_path para incluir o schema 'auth'
pool.on('connect', (client) => {
  client.query('SET search_path TO public, auth');
});

pool.on('error', (err) => {
  log.error('DB', 'Unexpected error on idle client', { err: err?.message, stack: err?.stack });
});

// [AUDITORIA] LÓGICA: pool dedicado para migrations (DDL). Se DATABASE_URL_MIGRATIONS não
// estiver definida, cai para DATABASE_URL — comportamento idêntico ao de antes desta mudança
// (produção não define essa variável, então não é afetada). Existe porque, no piloto de RLS
// em homologação, `pool` (acima) passa a conectar como uma role restrita sem privilégio de
// DDL — migrations precisam continuar rodando com a role administrativa completa.
export const migrationsPool = process.env.DATABASE_URL_MIGRATIONS
  ? new Pool({
      connectionString: process.env.DATABASE_URL_MIGRATIONS,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: false,
    })
  : pool;

// [AUDITORIA] LÓGICA: versão de tenantContextMiddleware (middleware.ts) para código que roda
// FORA do ciclo de requisição HTTP normal (processamento de webhook, agentEngine.ts,
// disparoProcessor.ts) — mesmo propósito: propagar app.user_id/app.is_admin pro Postgres
// via SET LOCAL, pra que as políticas RLS do piloto (hoje só whatsapp_messages, só em
// homologação) funcionem também nesses caminhos de escrita. Sem isso, INSERTs vindos do
// agente de IA ou do motor de disparo falhariam o WITH CHECK da policy em homolog.
export async function withTenantContext<T>(
  ctx: { userId?: string | null; isAdmin?: boolean },
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [ctx.userId || '']);
    await client.query(`SELECT set_config('app.is_admin', $1, true)`, [ctx.isAdmin ? 'true' : 'false']);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
