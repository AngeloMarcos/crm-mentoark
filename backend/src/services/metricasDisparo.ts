/**
 * metricasDisparo.ts — métricas reais de campanha e fila resiliente a quedas
 * (Sprint 4 / H3 + H4, 2026-10-05).
 *
 * [AUDITORIA] BUG (achados em produção, 04/10):
 *   - campanha com 109 enviados mostrava 0 entregues/0 respondidos: `disparo_logs` não guardava o
 *     ID da mensagem, então os ACKs (MESSAGES_UPDATE, já salvos em whatsapp_message_status) não
 *     casavam com o envio; `disparos.entregues/respondidos` nunca eram incrementados;
 *   - "Evolution API 500: Connection Closed" (instância caída) marcava o CONTATO como falha — 21
 *     de 24 falhas de uma campanha, queimando contatos válidos.
 * [AUDITORIA] FIX APLICADO:
 *   - o processador grava `message_id`; o webhook marca entregue/lido por ACK e respondido/opt-out
 *     pela resposta; `recalcularMetricasCampanhas` atualiza os contadores da campanha a cada minuto;
 *   - antes de enviar, checa a conexão (cache 30s); instância caída (ou erro 5xx/conexão) devolve
 *     o envio pra fila SEM contar como falha, pausa a campanha (`pausado_motivo='instancia_caida'`)
 *     e o cron retoma sozinho quando a instância volta `open` (queda 401/403 vira quarentena pela
 *     saúde do número e NÃO é retomada sozinha);
 *   - falha classificada em `tipo_falha`: numero_invalido | instancia_caida | restricao | erro_desconhecido.
 */
import { Pool } from 'pg';
import { log } from '../logger';
import { instanciaConectada } from './maturadorProcessor';

export type TipoFalha = 'numero_invalido' | 'instancia_caida' | 'restricao' | 'erro_desconhecido';

/** Classifica o erro da Evolution. `instancia_caida` nunca é culpa do contato. */
export function classificarFalha(statusHttp: number | undefined, mensagem: string, codigoRede?: string): TipoFalha {
  const m = String(mensagem || '').toLowerCase();
  if (codigoRede && ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'UND_ERR_CONNECT_TIMEOUT'].includes(codigoRede)) return 'instancia_caida';
  if (m.includes('connection closed') || m.includes('not connected') || m.includes('connection lost')
      || m.includes('instance does not exist') || m.includes('instance not found')) return 'instancia_caida';
  if (statusHttp === 404 && m.includes('instance')) return 'instancia_caida';
  if (m.includes('"exists":false') || m.includes('exists: false') || m.includes('not registered')
      || m.includes('não existe no whatsapp') || m.includes('invalid number') || m.includes('jid')) return 'numero_invalido';
  if (statusHttp === 403 || statusHttp === 429 || m.includes('forbidden') || m.includes('rate-overlimit') || m.includes('rate limit')) return 'restricao';
  if (statusHttp !== undefined && statusHttp >= 500) return 'instancia_caida';
  return 'erro_desconhecido';
}

// ── Conexão da instância com cache de 30s (sem Redis: processo único) ────────────────────────
const cacheConexao = new Map<string, { em: number; aberta: boolean }>();
export async function instanciaAberta(url: string, apiKey: string, instancia: string): Promise<boolean> {
  const c = cacheConexao.get(instancia);
  if (c && Date.now() - c.em < 30_000) return c.aberta;
  const aberta = await instanciaConectada(url, apiKey, instancia).catch(() => false);
  cacheConexao.set(instancia, { em: Date.now(), aberta });
  return aberta;
}
export function marcarInstanciaFechada(instancia: string): void {
  cacheConexao.set(instancia, { em: Date.now(), aberta: false });
}

/** Devolve o envio pra fila (sem contar falha) e pausa a campanha por instância caída. */
export async function pausarPorInstanciaCaida(pool: Pool, disparoId: string, logId: string, instancia: string, detalhe: string): Promise<void> {
  marcarInstanciaFechada(instancia);
  await pool.query(
    `UPDATE disparo_logs SET status = 'pending', erro = $2, tipo_falha = 'instancia_caida' WHERE id = $1`,
    [logId, `Instância ${instancia} desconectada — será reenviado quando voltar (${detalhe.slice(0, 120)})`]
  ).catch(() => {});
  const r = await pool.query(
    `UPDATE disparos SET status = 'pausado', pausado_em = NOW(), pausado_motivo = 'instancia_caida', updated_at = NOW(),
            aviso = $2
     WHERE id = $1 AND status IN ('em_andamento','agendado') RETURNING id`,
    [disparoId, `Instância ${instancia} desconectada. Nenhum contato foi marcado como falha — a campanha retoma sozinha quando a instância reconectar.`]
  ).catch(() => ({ rowCount: 0 } as any));
  if (r.rowCount) log.warn('DISPARO', 'Campanha pausada: instância desconectada (contato devolvido à fila)', { disparoId, instancia });
}

/**
 * Cron: retoma campanhas pausadas por instância caída quando ALGUMA instância delas voltou
 * `open` e o número não está em quarentena/banido. Queda 401/403 (ban suspeito) já pausa com
 * outro motivo (saudeNumero.ts) e fica esperando o usuário.
 */
export async function retomarCampanhasInstanciaCaida(pool: Pool): Promise<number> {
  const camp = await pool.query(
    `SELECT id, user_id, instancias_ids FROM disparos WHERE status = 'pausado' AND pausado_motivo = 'instancia_caida'`
  ).catch(() => ({ rows: [] as any[] }));
  let retomadas = 0;
  for (const d of camp.rows) {
    const inst = await pool.query(
      `SELECT a.evolution_server_url AS url, a.evolution_api_key AS api_key, a.evolution_instancia AS instancia, w.fase
       FROM agentes a
       LEFT JOIN whatsapp_numeros w ON w.numero = regexp_replace(a.numero_conectado, '\\D', '', 'g')
       WHERE a.user_id = $1 AND a.evolution_instancia IS NOT NULL
         AND (cardinality($2::uuid[]) = 0 OR a.id = ANY($2::uuid[]))`,
      [d.user_id, d.instancias_ids || []]
    ).catch(() => ({ rows: [] as any[] }));
    let algumaAberta = false;
    for (const i of inst.rows) {
      if (!i.url || i.fase === 'quarentena' || i.fase === 'banida') continue;
      if (await instanciaAberta(i.url, i.api_key, i.instancia)) { algumaAberta = true; break; }
    }
    if (!algumaAberta) continue;
    await pool.query(
      `UPDATE disparos SET status = 'em_andamento', aviso = NULL, pausado_em = NULL, pausado_motivo = NULL, updated_at = NOW()
       WHERE id = $1 AND status = 'pausado' AND pausado_motivo = 'instancia_caida'`,
      [d.id]
    );
    retomadas++;
    log.info('DISPARO', 'Campanha retomada: instância reconectou', { disparoId: d.id });
  }
  return retomadas;
}

// ── ACK / resposta / opt-out → disparo_logs ──────────────────────────────────────────────────
const ENTREGUE = new Set(['DELIVERY_ACK', 'READ', 'PLAYED', '3', '4', '5']);
const LIDO = new Set(['READ', 'PLAYED', '4', '5']);

/** Webhook MESSAGES_UPDATE: marca entregue/lido no envio da campanha com este message_id. */
export async function registrarAckDisparo(pool: Pool, messageId: string, status: unknown): Promise<void> {
  const s = String(status ?? '').toUpperCase();
  if (!ENTREGUE.has(s)) return;
  await pool.query(
    `UPDATE disparo_logs SET entregue_em = COALESCE(entregue_em, NOW()),
            lido_em = CASE WHEN $2 THEN COALESCE(lido_em, NOW()) ELSE lido_em END
     WHERE message_id = $1`,
    [messageId, LIDO.has(s)]
  ).catch(() => {});
}

/** Resposta (ou opt-out) do contato até 72h depois do envio mais recente da campanha. */
export async function marcarRespostaNoEnvio(pool: Pool, userId: string, telefone: string, optout: boolean): Promise<void> {
  const d = String(telefone || '').replace(/\D/g, '');
  if (d.length < 10 || d.length > 13) return;
  await pool.query(
    `UPDATE disparo_logs SET
       respondido_em = COALESCE(respondido_em, NOW()),
       optout_em = CASE WHEN $3 THEN COALESCE(optout_em, NOW()) ELSE optout_em END
     WHERE id = (
       SELECT id FROM disparo_logs
       WHERE user_id = $1 AND status = 'sent' AND enviado_at >= NOW() - INTERVAL '72 hours'
         AND RIGHT(regexp_replace(telefone, '\\D', '', 'g'), 11) = RIGHT($2, 11)
       ORDER BY enviado_at DESC LIMIT 1)`,
    [userId, d, optout]
  ).catch(() => {});
}

/**
 * Recalcula os contadores da campanha a partir dos logs (fonte da verdade). `todas=false` só mexe
 * em campanhas com atividade recente — roda a cada minuto.
 */
export async function recalcularMetricasCampanhas(pool: Pool, todas = false): Promise<number> {
  const r = await pool.query(
    `UPDATE disparos d SET
       entregues = m.entregues, lidos = m.lidos, respondidos = m.respondidos, optouts = m.optouts
     FROM (
       SELECT disparo_id,
              COUNT(*) FILTER (WHERE entregue_em IS NOT NULL)::int AS entregues,
              COUNT(*) FILTER (WHERE lido_em IS NOT NULL)::int AS lidos,
              COUNT(*) FILTER (WHERE respondido_em IS NOT NULL)::int AS respondidos,
              COUNT(*) FILTER (WHERE optout_em IS NOT NULL)::int AS optouts
       FROM disparo_logs
       WHERE ${todas ? 'TRUE' : `disparo_id IN (SELECT id FROM disparos WHERE status IN ('em_andamento','agendado','pausado')
                                   OR updated_at >= NOW() - INTERVAL '4 days')`}
       GROUP BY disparo_id
     ) m
     WHERE d.id = m.disparo_id
       AND (d.entregues IS DISTINCT FROM m.entregues OR d.lidos IS DISTINCT FROM m.lidos
            OR d.respondidos IS DISTINCT FROM m.respondidos OR d.optouts IS DISTINCT FROM m.optouts)`
  ).catch(err => { log.warn('DISPARO', 'Falha ao recalcular métricas', { err: err?.message }); return { rowCount: 0 } as any; });
  return r.rowCount ?? 0;
}

/**
 * Auditoria das campanhas antigas: liga cada envio antigo à mensagem gravada em whatsapp_messages
 * (mesma instância, mesmo número, enviada até 2 min depois) pra recuperar o message_id, aplica o
 * último ACK conhecido (whatsapp_message_status) e marca resposta/opt-out pelas respostas já
 * classificadas (contato_respostas) nas 72h seguintes. Idempotente.
 */
export async function auditarMetricasAntigas(pool: Pool): Promise<Record<string, number>> {
  // (UPDATE não aceita FROM LATERAL referenciando a própria tabela — subconsulta correlacionada.)
  const liga = await pool.query(
    `UPDATE disparo_logs dl SET message_id = (
       SELECT m.message_id FROM whatsapp_messages m
       WHERE m.user_id = dl.user_id AND m.instance_name = dl.instancia AND m.from_me = true
         AND m.remote_jid = regexp_replace(dl.telefone, '\\D', '', 'g') || '@s.whatsapp.net'
         AND m.created_at BETWEEN dl.enviado_at - INTERVAL '1 minute' AND dl.enviado_at + INTERVAL '2 minutes'
       ORDER BY abs(extract(epoch FROM m.created_at - dl.enviado_at)) LIMIT 1)
     WHERE dl.status = 'sent' AND dl.message_id IS NULL AND dl.instancia IS NOT NULL AND dl.enviado_at IS NOT NULL`
  ).catch(err => { log.warn('DISPARO', 'Auditoria: falha ao ligar message_id', { err: err?.message }); return { rowCount: 0 } as any; });
  const ack = await pool.query(
    `UPDATE disparo_logs dl SET
       entregue_em = COALESCE(dl.entregue_em, s.updated_at),
       lido_em = CASE WHEN s.status IN ('READ','PLAYED') THEN COALESCE(dl.lido_em, s.updated_at) ELSE dl.lido_em END
     FROM whatsapp_message_status s
     WHERE s.message_id = dl.message_id AND s.instance_name = dl.instancia
       AND s.status IN ('DELIVERY_ACK','READ','PLAYED') AND dl.entregue_em IS NULL`
  ).catch(() => ({ rowCount: 0 } as any));
  const janela = `cr.user_id = dl.user_id AND cr.contato_id = dl.contato_id
         AND cr.respondido_em > dl.enviado_at AND cr.respondido_em < dl.enviado_at + INTERVAL '72 hours'`;
  const resp = await pool.query(
    `UPDATE disparo_logs dl SET
       respondido_em = (SELECT MIN(cr.respondido_em) FROM contato_respostas cr WHERE ${janela} AND cr.categoria <> 'auto_resposta'),
       optout_em = COALESCE(dl.optout_em,
         (SELECT MIN(cr.respondido_em) FROM contato_respostas cr WHERE ${janela} AND cr.categoria = 'opt_out'))
     WHERE dl.status = 'sent' AND dl.contato_id IS NOT NULL AND dl.respondido_em IS NULL
       AND EXISTS (SELECT 1 FROM contato_respostas cr WHERE ${janela} AND cr.categoria <> 'auto_resposta')`
  ).catch(err => { log.warn('DISPARO', 'Auditoria: falha ao marcar respostas', { err: err?.message }); return { rowCount: 0 } as any; });
  const caida = await pool.query(
    `UPDATE disparo_logs SET tipo_falha = 'instancia_caida'
     WHERE status = 'failed' AND tipo_falha IS NULL
       AND (erro ILIKE '%connection closed%' OR erro ILIKE '%not connected%')`
  ).catch(() => ({ rowCount: 0 } as any));
  const campanhas = await recalcularMetricasCampanhas(pool, true);
  return { ligados: liga.rowCount ?? 0, acks: ack.rowCount ?? 0, respostas: resp.rowCount ?? 0, falhasInstanciaCaida: caida.rowCount ?? 0, campanhas };
}
