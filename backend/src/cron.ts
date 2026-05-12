import cron from 'node-cron';
import { pool } from './db';

export function initCronJobs() {
  // Todo domingo às 02:00 — limpeza de retenção LGPD
  cron.schedule('0 2 * * 0', async () => {
    try {
      console.log('[CRON] Iniciando limpeza de retenção LGPD...');

      // disparo_logs: manter 90 dias
      const logs = await pool.query(
        "DELETE FROM disparo_logs WHERE created_at < NOW() - INTERVAL '90 days' RETURNING id"
      );

      // n8n_chat_histories: manter 6 meses
      const chats = await pool.query(
        "DELETE FROM n8n_chat_histories WHERE created_at < NOW() - INTERVAL '6 months' RETURNING id"
      );

      // audit_log: manter 2 anos
      const audit = await pool.query(
        "DELETE FROM audit_log WHERE created_at < NOW() - INTERVAL '2 years' RETURNING id"
      );

      console.log(`[CRON] Limpeza concluída: ${logs.rowCount} logs, ${chats.rowCount} chats, ${audit.rowCount} audits removidos`);
    } catch (err: any) {
      console.error('[CRON] Erro na limpeza:', err.message);
    }
  }, { timezone: 'America/Sao_Paulo' });

  console.log('[CRON] Jobs de retenção LGPD registrados');
}
