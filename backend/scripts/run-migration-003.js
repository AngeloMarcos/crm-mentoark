// One-off runner for migrations/003_kanban_pipeline_inbox.sql against crm_hml.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const sql = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '003_kanban_pipeline_inbox.sql'),
  'utf8'
);

const url = new URL(process.env.DATABASE_URL);
if (!/crm_hml$/.test(url.pathname)) {
  console.error(`Recusando executar: DATABASE_URL não aponta para crm_hml (pathname=${url.pathname})`);
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  const client = await pool.connect();
  try {
    console.log(`Conectado em ${url.hostname}:${url.port}${url.pathname} como ${url.username}`);
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('Migration 003 aplicada com sucesso (commit).');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Falhou, rollback aplicado:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
})();
