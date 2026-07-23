import cron from 'node-cron';
import { pool, withTenantContext } from './db';
import { log } from './logger';
import { reconciliarInstanciasEvolution } from './services/evolutionReconciliation';
import { retentarMidiaPendente } from './services/mediaRetry';

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

      // 5. whatsapp_messages: expurgo físico definitivo de mensagens soft-deletadas há
      // mais de 90 dias (ver [AUDITORIA] em migrations.ts — deleted_at adicionado após
      // incidente de perda de dados documentado em AUDITORIA_LOG.md)
      // [AUDITORIA] FIX APLICADO (2026-07-21): piloto de RLS em whatsapp_messages, só
      // homologação — expurgo é cross-tenant por design (job de sistema), precisa de bypass.
      const waMessages = await withTenantContext({ isAdmin: true }, (client) => client.query(
        "DELETE FROM whatsapp_messages WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '90 days'"
      )).catch(() => ({ rowCount: 0 }));

      log.info('CRON', 'Limpeza semanal concluída', {
        disparos: logs.rowCount,
        catalogos: catLogs.rowCount,
        chats: chats.rowCount,
        waMessagesExpurgadas: waMessages.rowCount,
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

  // [AUDITORIA] LÓGICA (Sprint 5 — salvaguarda antiban de teto diário, 2026-07-23): reativa
  // campanhas de disparo pausadas automaticamente por terem atingido o teto diário de
  // segurança (ver disparoProcessor.ts) — só depois de 24h corridas desde a pausa. Mesma
  // cadência de 5min do job de pausas de IA logo acima (não precisa ser mais frequente,
  // a janela de reativação é de 24h).
  cron.schedule('*/5 * * * *', async () => {
    try {
      const r = await pool.query(`SELECT reativar_disparos_por_limite_diario() AS reativados`);
      const count = Number(r.rows[0]?.reativados ?? 0);
      if (count > 0) {
        log.info('CRON', 'campanha(s) de disparo reativada(s) após teto diário expirar', { count });
      }
    } catch (err: any) {
      log.error('CRON', 'Erro ao reativar campanhas por teto diário', { err: err.message });
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

  // Todo dia às 04:00 (horário de Brasília) — Sprint A do plano de mídia (ver
  // diagnosticos/AUDITORIA_LOG.md): retenta decriptografar/salvar mídia cuja media_url ainda
  // não migrou pra local:// (decrypt falhou na primeira tentativa, ex: Evolution fora do ar
  // no momento do recebimento). Só re-processa falha conhecida, não é polling de mensagens
  // novas nem varredura de contatos — não reabre o risco de banimento discutido nesta sessão.
  cron.schedule('0 4 * * *', async () => {
    try {
      const { tentadas, recuperadas } = await retentarMidiaPendente(pool);
      if (tentadas > 0) {
        log.info('CRON', 'Retry diário de mídia concluído', { tentadas, recuperadas });
      }
    } catch (err: any) {
      log.error('CRON', 'Erro no retry diário de mídia', { err: err.message });
    }
  }, { timezone: 'America/Sao_Paulo' });

  log.info('CRON', 'Jobs de limpeza e retenção LGPD registrados');
}
