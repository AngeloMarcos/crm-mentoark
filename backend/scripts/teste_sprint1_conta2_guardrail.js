// Segunda conta de teste (5319f0ed) — agentes tem linha mas SEM prompt_sistema real.
// Confirma o guard-rail do incidente Cris: sem prompt real, a IA NÃO responde (nem com
// persona genérica) — mesmo após a unificação de config.
process.env.IA_TEST_MODE = 'true';
const { pool } = require('/app/dist/db.js');
const { processarMensagem } = require('/app/dist/services/agentEngine.js');

const USER_ID = '5319f0ed-61b3-4232-80e1-f236bb751e49';
const INSTANCIA = 'crm_5319f0ed61b3';
const TELEFONE = '5511900000002';

(async () => {
  await pool.query(
    `INSERT INTO contatos (user_id, telefone, nome, atendente_pausou_ia)
     VALUES ($1, $2, 'Teste Guardrail Conta2', false)
     ON CONFLICT (user_id, telefone) DO UPDATE SET atendente_pausou_ia = false`,
    [USER_ID, TELEFONE]
  ).catch(err => console.log('contato upsert (ok se já existir de outro jeito):', err.message));

  const checkpoint = await pool.query(`SELECT COALESCE(MAX(id), 0) AS maxid FROM n8n_chat_histories WHERE session_id = $1`, [TELEFONE]);
  const idAntes = checkpoint.rows[0].maxid;

  console.log('=== Teste: conta sem prompt_sistema real — esperado ZERO resposta (nenhum log IA_SANDBOX) ===');
  await processarMensagem(pool, {
    instancia: INSTANCIA, messageId: 'TESTE-GUARDRAIL-' + Date.now(), telefone: TELEFONE,
    pushName: 'Teste Guardrail Conta2', texto: 'Oi, alguém aí?', tipo: 'text',
    timestamp: Math.floor(Date.now() / 1000), userId: USER_ID,
  });

  const del = await pool.query(`DELETE FROM n8n_chat_histories WHERE session_id = $1 AND id > $2`, [TELEFONE, idAntes]);
  console.log('\nlinhas de histórico criadas por este teste (deve ser 0, já que não deveria ter respondido):', del.rowCount);
  await pool.query(`DELETE FROM contatos WHERE user_id = $1 AND telefone = $2 AND nome = 'Teste Guardrail Conta2'`, [USER_ID, TELEFONE]);
  await pool.end();
})().catch(err => { console.error('ERRO:', err); process.exit(1); });
