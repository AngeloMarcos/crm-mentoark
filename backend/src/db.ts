import { Pool, types } from 'pg';
import dotenv from 'dotenv';
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
  console.error('Unexpected error on idle client', err);
});
