import { Pool } from 'pg';
import { processarDisparos } from './services/disparoProcessor';
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

async function test() {
  console.log('Iniciando processamento manual (SSL=false)...');
  await processarDisparos(pool);
  console.log('Processamento concluído.');
  await pool.end();
}

test().catch(console.error);
