import cron from 'node-cron';
import { pool } from './db';

export function initCronJobs() {
  // Todo dia às 03:00 (horário de Brasília) — Limpeza diária de tabelas de crescimento
  cron.schedule('0 3 * * *', async () => {
    try {
      console.log('[CRON] Iniciando limpeza diária...');

      // 1. Limpar deduplicação de webhook (mais de 24h)
      const dedup = await pool.query(
        "DELETE FROM webhook_mensagens_processadas WHERE criado_em < NOW() - INTERVAL '24 hours'"
      ).catch(() => ({ rowCount: 0 }));

      // 2. Limpar refresh tokens revogados/expirados (mais de 30 dias)
      const tokens = await pool.query(
        "DELETE FROM refresh_tokens WHERE revoked = true AND expires_at < NOW() - INTERVAL '30 days'"
      ).catch(() => ({ rowCount: 0 }));

      // 3. Limpar rate limit de disparos de usuários inativos (mais de 7 dias)
      const ratelimit = await pool.query(
        "DELETE FROM disparo_rate_limit WHERE last_disparo_at < NOW() - INTERVAL '7 days'"
      ).catch(() => ({ rowCount: 0 }));

      // 4. Limpar oauth_state expirado
      const oauth = await pool.query(
        "DELETE FROM oauth_state WHERE expires_at < NOW()"
      ).catch(() => ({ rowCount: 0 }));

      console.log(`[CRON] Limpeza diária concluída: ${dedup.rowCount} dedups, ${tokens.rowCount} tokens, ${ratelimit.rowCount} ratelimits, ${oauth.rowCount} oauth_states removidos`);
    } catch (err: any) {
      console.error('[CRON] Erro na limpeza diária:', err.message);
    }
  }, { timezone: 'America/Sao_Paulo' });

  // Todo domingo às 02:00 (horário de Brasília) — limpeza de retenção LGPD (longo prazo)
  cron.schedule('0 2 * * 0', async () => {
    try {
      console.log('[CRON] Iniciando limpeza semanal de retenção LGPD...');

      // 1. disparo_logs: manter 90 dias
      const logs = await pool.query(
        "DELETE FROM disparo_logs WHERE created_at < NOW() - INTERVAL '90 days'"
      ).catch(() => ({ rowCount: 0 }));

      // 2. catalogo_mensagens_logs: manter 90 dias
      const catLogs = await pool.query(
        "DELETE FROM catalogo_mensagens_logs WHERE created_at < NOW() - INTERVAL '90 days'"
      ).catch(() => ({ rowCount: 0 }));

      // 3. n8n_chat_histories: manter 6 meses
      const chats = await pool.query(
        "DELETE FROM n8n_chat_histories WHERE created_at < NOW() - INTERVAL '6 months'"
      ).catch(() => ({ rowCount: 0 }));

      // 4. audit_log: manter 2 anos (se a tabela existir)
      const audit = await pool.query(
        "DELETE FROM audit_log WHERE created_at < NOW() - INTERVAL '2 years'"
      ).catch(() => ({ rowCount: 0 }));

      console.log(`[CRON] Limpeza semanal concluída: ${logs.rowCount} disparos, ${catLogs.rowCount} catálogos, ${chats.rowCount} chats removidos`);
    } catch (err: any) {
      console.error('[CRON] Erro na limpeza semanal:', err.message);
    }
  }, { timezone: 'America/Sao_Paulo' });

  console.log('[CRON] Jobs de limpeza e retenção LGPD registrados');
}
