import cron from 'node-cron';
import { pool, withTenantContext } from './db';
import { log } from './logger';
import { reconciliarInstanciasEvolution } from './services/evolutionReconciliation';
import { retentarMidiaPendente } from './services/mediaRetry';
import { recalcularTodosScores } from './services/instanceScore';
import { processarMaturador } from './services/maturadorProcessor';
import { limparMidiaExpirada, limparVariantesExpiradas } from './utils/whatsappMediaStorage';
import { enfileirarBusca, enfileirarLinkPublico } from './radar/fila';
import { criarBuscaAgendada } from './radar/busca';

// [AUDITORIA] FIX APLICADO (Sprint Limpeza de Disco, 2026-08-23): dias de retenção pra mídia
// recebida (áudio/imagem/vídeo/documento) salva em disco — configurável via env pra poder
// apertar/afrouxar sem novo deploy, default 30 dias (decisão explícita do usuário, ver
// AUDITORIA_LOG.md). Ver `limparMidiaExpirada()` (utils/whatsappMediaStorage.ts) pro porquê.
const DIAS_RETENCAO_MIDIA = Number(process.env.DIAS_RETENCAO_MIDIA_WHATSAPP) || 30;

// [AUDITORIA] FIX APLICADO (Sprint Grupos/Template, 2026-09-04): retenção bem mais curta que a
// de mídia recebida — arquivo de variação (`gerarVariacaoImagem()`, `variar_imagem` em
// Disparos) é gerado um por MENSAGEM e descartável assim que a Evolution buscou a URL pra
// entregar; poucas horas já é folga generosa contra retry lento.
const HORAS_RETENCAO_VARIANTES = Number(process.env.HORAS_RETENCAO_VARIANTES_IMAGEM) || 12;

export function initCronJobs() {
  // Radar de Grupos: busca automática diária dos nichos marcados como "agendar" (rodízio de consultas, só traz
  // grupos novos). Espaça os nichos para não estourar o ritmo do provedor de busca.
  cron.schedule('10 5 * * *', async () => {
    try {
      const r = await pool.query(`SELECT * FROM radar_nichos WHERE agendar = true AND ativo = true ORDER BY ultima_busca_em NULLS FIRST LIMIT 5`);
      let criadas = 0;
      for (const n of r.rows) {
        if (await criarBuscaAgendada(pool, n, enfileirarBusca)) criadas++;
      }
      if (r.rows.length) log.info('CRON', 'Radar: buscas agendadas', { nichos: r.rows.length, criadas });
    } catch (err: any) {
      log.error('CRON', 'Erro nas buscas agendadas do Radar', { err: err.message });
    }
  }, { timezone: 'America/Sao_Paulo' });

  // Radar de Grupos: revalida os links do catálogo pela página pública (sem instância, sem entrar em nada);
  // lote pequeno e ritmo baixo na fila.
  cron.schedule('30 4 * * *', async () => {
    try {
      const lote = Number(process.env.RADAR_REVALIDAR_LOTE) || 40;
      const dias = Number(process.env.RADAR_REVALIDAR_DIAS) || 7;
      const r = await pool.query(
        `SELECT id FROM radar_grupos WHERE plataforma = 'whatsapp' AND status IN ('descoberto','aprovado')
           AND (link_verificado_em IS NULL OR link_verificado_em < now() - make_interval(days => $1))
         ORDER BY link_verificado_em NULLS FIRST LIMIT $2`, [dias, lote]);
      if (r.rows.length) {
        await enfileirarLinkPublico(r.rows.map((x: any) => x.id));
        log.info('CRON', 'Radar: revalidação de convites enfileirada', { grupos: r.rows.length });
      }
    } catch (err: any) {
      log.error('CRON', 'Erro na revalidação do Radar', { err: err.message });
    }
  }, { timezone: 'America/Sao_Paulo' });

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

  // A cada 6 horas — limpeza das variações de imagem geradas por `variar_imagem` (Disparos).
  // [AUDITORIA] BUG CORRIGIDO (achado 2026-09-04, revisão pós-Sprint Grupos/Template):
  // `gerarVariacaoImagem()` grava um arquivo novo POR MENSAGEM enviada com essa opção ligada,
  // sem nenhuma limpeza — campanha de milhares de destinatários acumulava milhares de arquivos
  // pra sempre em disco (a limpeza de mídia semanal, `limparMidiaExpirada` abaixo, só cobre
  // mídia RECEBIDA rastreada em `whatsapp_messages`, não isso). Retenção curta (12h default,
  // ver `HORAS_RETENCAO_VARIANTES_IMAGEM`) e cadência mais frequente que a limpeza semanal —
  // proporcional ao volume real (pode chegar a milhares de arquivos/dia numa campanha grande).
  cron.schedule('0 */6 * * *', async () => {
    try {
      const r = await limparVariantesExpiradas(HORAS_RETENCAO_VARIANTES);
      if (r.arquivosRemovidos) {
        log.info('CRON', 'Limpeza de variações de imagem concluída', r);
      }
    } catch (err: any) {
      log.error('CRON', 'Erro na limpeza de variações de imagem', { err: err.message });
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

      // 6. Mídia de WhatsApp em disco (áudio/imagem/vídeo/documento) mais velha que
      // DIAS_RETENCAO_MIDIA — ver [AUDITORIA] em whatsappMediaStorage.ts. Achado real: 9GB/mês
      // acumulando sem nenhuma limpeza, na mesma VPS que já teve disco cheio derrubar o Postgres
      // 2x. Só o ARQUIVO é removido — a mensagem continua no histórico, só sem anexo.
      const midia = await limparMidiaExpirada(pool, DIAS_RETENCAO_MIDIA).catch((err: any) => {
        log.error('CRON', 'Erro na limpeza de mídia expirada', { err: err?.message });
        return { arquivosRemovidos: 0, bytesLiberados: 0, mensagensAtualizadas: 0 };
      });

      log.info('CRON', 'Limpeza semanal concluída', {
        disparos: logs.rowCount,
        catalogos: catLogs.rowCount,
        chats: chats.rowCount,
        waMessagesExpurgadas: waMessages.rowCount,
        midiaArquivosRemovidos: midia.arquivosRemovidos,
        midiaBytesLiberados: midia.bytesLiberados,
        diasRetencaoMidia: DIAS_RETENCAO_MIDIA,
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

  // A cada 15 minutos — reconciliar integracoes_config/agentes contra o estado
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

  // [AUDITORIA] FIX APLICADO (Sprint Score Real, 2026-08-09): Score de Saúde deixou de ser
  // 100% mock (Math.random(), só rodava com clique manual, fallback de exibição sem cálculo
  // nenhum = 100/"Saudável" — achado grave: 2 números banidos na semana e o score mostrava
  // 100/100 nos dois). Recalcula TODAS as instâncias conectadas a cada 15min (mesma cadência da
  // reconciliação Evolution logo acima — não precisa ser mais frequente, é uma métrica de
  // tendência, não algo que precise de segundo-a-segundo) com dado real (`instanceScore.ts`,
  // ver comentário completo lá). Botão "Recalcular score" (frontend) chama o cálculo sob
  // demanda pra feedback imediato sem esperar o próximo tick deste cron.
  cron.schedule('*/15 * * * *', async () => {
    try {
      const { atualizados, falhas } = await recalcularTodosScores(pool);
      if (atualizados > 0 || falhas > 0) {
        log.info('CRON', 'Score de Saúde recalculado', { atualizados, falhas });
      }
    } catch (err: any) {
      log.error('CRON', 'Erro ao recalcular Score de Saúde', { err: err.message });
    }
  }, { timezone: 'America/Sao_Paulo' });

  // [AUDITORIA] LÓGICA (Sprint Score Real + Maturador, 2026-08-09, item 2): motor do Maturador
  // de Números — mesmo espírito de `disparoProcessor.ts` (ciclo com delay variável, nunca
  // rajada), mas trocando mensagem PRÉ-ESCRITA (zero IA/token) entre 2 instâncias da MESMA
  // conta, pra simular tráfego orgânico em número novo. Cadência de 1min (bem mais lenta que os
  // 2s do disparoProcessor de propósito — aqui não tem fila de contatos reais esperando, só
  // pares `ativo=true`, o motor só precisa checar se já passou tempo suficiente desde a última
  // troca daquele par). `ativo` nasce sempre `false` (ver migrations.ts) — este cron não faz
  // nada até o usuário ativar pelo menos 1 par manualmente na UI.
  cron.schedule('*/1 * * * *', async () => {
    try {
      const { processados, enviados } = await processarMaturador(pool);
      if (enviados > 0) {
        log.info('CRON', 'Maturador de Números: mensagens trocadas', { processados, enviados });
      }
    } catch (err: any) {
      log.error('CRON', 'Erro no motor do Maturador de Números', { err: err.message });
    }
  });

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

  // [AUDITORIA] LÓGICA (2026-09-10 — trial de 3 dias): marca assinaturas de trial vencido como
  // 'expirada'. `subscription.ts` já resolve isso em tempo real a cada request (não depende deste
  // cron), mas o job mantém a coluna coerente pro painel super-admin e pra relatórios. Cadência
  // de 30min é folgada de sobra pra uma janela de 3 dias.
  cron.schedule('*/30 * * * *', async () => {
    try {
      const r = await pool.query(
        `UPDATE assinaturas SET status = 'expirada', updated_at = now()
         WHERE status = 'trial' AND trial_fim IS NOT NULL AND trial_fim < now()`
      );
      if (r.rowCount) log.info('CRON', 'Assinaturas de trial expiradas', { count: r.rowCount });
    } catch (err: any) {
      log.error('CRON', 'Erro ao expirar assinaturas de trial', { err: err.message });
    }
  }, { timezone: 'America/Sao_Paulo' });

  log.info('CRON', 'Jobs de limpeza e retenção LGPD registrados');
}
