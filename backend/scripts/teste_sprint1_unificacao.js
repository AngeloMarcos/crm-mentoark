// Teste real pós-migração Sprint 1 — confirma que agentEngine.ts responde usando agentes.prompt_sistema
// (não mais agent_configs), com IA_TEST_MODE=true (sem envio real de WhatsApp).
process.env.IA_TEST_MODE = 'true';
const { pool } = require('/app/dist/db.js');
const { processarMensagem } = require('/app/dist/services/agentEngine.js');

const USER_ID = '435ee472-0fc3-4015-995a-ae6e1c80606d';
const INSTANCIA = 'crm_435ee4720fc3_2';
const TELEFONE = '5511979579548';

function entrada(msgId, texto) {
  return {
    instancia: INSTANCIA, messageId: msgId, telefone: TELEFONE,
    pushName: 'Teste Sprint1 Unificacao', texto, tipo: 'text',
    timestamp: Math.floor(Date.now() / 1000), userId: USER_ID,
  };
}

(async () => {
  const checkpoint = await pool.query(`SELECT COALESCE(MAX(id), 0) AS maxid FROM n8n_chat_histories WHERE session_id = $1`, [TELEFONE]);
  const idAntes = checkpoint.rows[0].maxid;
  await pool.query(`UPDATE contatos SET atendente_pausou_ia = false WHERE user_id = $1 AND telefone = $2`, [USER_ID, TELEFONE]);

  console.log('=== Teste 1: resposta normal, config vindo 100% de agentes (agent_configs não é mais lida) ===');
  await processarMensagem(pool, entrada('TESTE-SPRINT1-A-' + Date.now(), 'Oi, quero saber sobre os planos.'));

  console.log('\n=== Teste 2: MCP tools filtradas — desabilita tudo, IA não deve conseguir chamar nenhuma ferramenta ===');
  await pool.query(`UPDATE agentes SET mcp_tools = '{}' WHERE id = 'b82912cb-fd9b-4337-8586-1dba99abc59a'`);
  await processarMensagem(pool, entrada('TESTE-SPRINT1-B-' + Date.now(), 'Me conta o histórico de mensagens que já trocamos.'));
  await pool.query(`UPDATE agentes SET mcp_tools = NULL WHERE id = 'b82912cb-fd9b-4337-8586-1dba99abc59a'`); // restaura: null = todas habilitadas

  console.log('\n=== Limpeza ===');
  await pool.query(`UPDATE contatos SET atendente_pausou_ia = true WHERE user_id = $1 AND telefone = $2`, [USER_ID, TELEFONE]);
  const del = await pool.query(`DELETE FROM n8n_chat_histories WHERE session_id = $1 AND id > $2`, [TELEFONE, idAntes]);
  console.log('linhas removidas:', del.rowCount);
  await pool.end();
})().catch(err => { console.error('ERRO:', err); process.exit(1); });
