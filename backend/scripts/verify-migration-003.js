require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const expectedTables = [
  'pipelines',
  'pipeline_stages',
  'deals',
  'deal_stage_history',
  'conversations',
];

(async () => {
  try {
    const { rows } = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1)
       ORDER BY table_name`,
      [expectedTables]
    );
    console.log('Tabelas encontradas:', rows.map(r => r.table_name));
    const missing = expectedTables.filter(t => !rows.some(r => r.table_name === t));
    if (missing.length) {
      console.error('FALTANDO:', missing);
      process.exit(1);
    }

    const col = await pool.query(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name = 'whatsapp_messages' AND column_name = 'conversation_id'`
    );
    console.log('whatsapp_messages.conversation_id:', col.rows);

    const idx = await pool.query(
      `SELECT indexname FROM pg_indexes
       WHERE tablename IN ('deals','whatsapp_messages') AND indexname LIKE 'idx_%'
       ORDER BY indexname`
    );
    console.log('Índices criados:', idx.rows.map(r => r.indexname));

    console.log('OK: todas as tabelas/coluna/índices esperados estão presentes em crm_hml.');
  } catch (err) {
    console.error('Erro na verificação:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
