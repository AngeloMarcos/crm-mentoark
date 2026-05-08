import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Configura o search_path para incluir o schema 'auth'
pool.on('connect', (client) => {
  client.query('SET search_path TO public, auth');
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});
