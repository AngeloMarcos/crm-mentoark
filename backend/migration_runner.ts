import { pool } from './src/db';
import { runMigrations } from './src/migrations';

async function main() {
  try {
    console.log('Running migrations...');
    await runMigrations(pool);
    console.log('Migrations finished successfully');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

main();