import cron from 'node-cron';
import { pool } from './db';
import { log } from './logger';
import { reconciliarInstanciasEvolution } from './services/evolutionReconciliation';

export function initCronJobs() {
  // Todo dia às 03:00 (horário de Brasília) — Limpeza diária de tabelas de crescimento
  cron.schedule('0 3 * * *', async () => {
    try {
      log.info('CRON', 'Iniciando limpeza diária...');

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

      log.info('CRON', 'Limpeza diária concluída', {
        dedups: dedup.rowCount,
        tokens: tokens.rowCount,
        ratelimits: ratelimit.rowCount,
        oauthStates: oauth.rowCount,
      });
    } catch (err: any) {
      log.error('CRON', 'Erro na limpeza diária', { err: err.message });
    }
  }, { timezone: 'America/Sao_Paulo' });

  // Todo domingo às 02:00 (horário de Brasília) — limpeza de retenção LGPD (longo prazo)
  cron.schedule('0 2 * * 0', async () => {
    try {
      log.info('CRON', 'Iniciando limpeza semanal de retenção LGPD...');

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

      log.info('CRON', 'Limpeza semanal concluída', {
        disparos: logs.rowCount,
        catalogos: catLogs.rowCount,
        chats: chats.rowCount,
      });
    } catch (err: any) {
      log.error('CRON', 'Erro na limpeza semanal', { err: err.message });
    }
  }, { timezone: 'America/Sao_Paulo' });

  // A cada 5 minutos — reativar pausas de IA expiradas
  cron.schedule('*/5 * * * *', async () => {
    try {
      const r = await pool.query(`SELECT reativar_pausas_expiradas() AS reativados`);
      const count = Number(r.rows[0]?.reativados ?? 0);
      if (count > 0) {
        log.info('CRON', 'pausa(s) de IA reativada(s) automaticamente', { count });
      }
    } catch (err: any) {
      log.error('CRON', 'Erro ao reativar pausas', { err: err.message });
    }
  });

  // A cada 15 minutos — reconciliar integracoes_config/agent_configs contra o estado
  // real das instâncias na Evolution (ver services/evolutionReconciliation.ts — corrige
  // o drift que ficava acumulando silenciosamente, causa raiz documentada em AUDITORIA_LOG.md)
  cron.schedule('*/15 * * * *', async () => {
    try {
      const { corrigidos } = await reconciliarInstanciasEvolution(pool);
      if (corrigidos > 0) {
        log.info('CRON', 'Reconciliação de instâncias Evolution aplicou correções', { corrigidos });
      }
    } catch (err: any) {
      log.error('CRON', 'Erro na reconciliação de instâncias Evolution', { err: err.message });
    }
  }, { timezone: 'America/Sao_Paulo' });

  log.info('CRON', 'Jobs de limpeza e retenção LGPD registrados');
}
