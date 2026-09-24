// Inteligência de respostas a disparos: classifica cada resposta (regras, sem IA) e aplica o efeito
// no contato — opt-out, recusa, robô de atendimento, interesse. Também mede a taxa REAL de interesse
// (a "taxa de resposta" bruta engana: boa parte é robô de atendimento).
import { Pool } from 'pg';
import { log } from '../logger';
import { classificarResposta, CategoriaResposta } from '../utils/respostas';
import { construirModelo, prever, ModeloPropensao, AmostraPropensao } from '../utils/propensao';

export const JANELA_RESPOSTA_HORAS = 72;

/** Contato "com nome de verdade": não é só número. Mesma regra dos dois lados (amostra e contato). */
const NOME_REAL = (col: string) => `(${col} IS NOT NULL AND ${col} !~ '^[0-9+() -]+$' AND length(trim(${col})) > 1)`;

export interface AplicarRespostaParams {
  userId: string;
  contatoId: string;
  messageId: string;
  texto: string | null;
  respondidoEm: Date | string;
  origem: 'webhook' | 'historico';
  telefone?: string | null;
}

/**
 * Grava a resposta e aplica o efeito no contato. Idempotente: a mesma mensagem nunca aplica duas vezes
 * (o webhook e o reprocessamento do histórico podem ver a mesma resposta).
 */
export async function aplicarResposta(pool: Pool, p: AplicarRespostaParams): Promise<CategoriaResposta | null> {
  const cls = classificarResposta(p.texto);
  const ins = await pool.query(
    `INSERT INTO contato_respostas (user_id, contato_id, message_id, categoria, trecho, respondido_em, origem)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (user_id, message_id) DO NOTHING RETURNING id`,
    [p.userId, p.contatoId, p.messageId, cls.categoria, (p.texto ?? '').slice(0, 200), p.respondidoEm, p.origem]);
  if (!ins.rowCount) return null;

  const c = cls.categoria;
  await pool.query(
    `UPDATE contatos SET
       opt_out = CASE WHEN $3 = 'opt_out' THEN true ELSE opt_out END,
       opt_out_at = CASE WHEN $3 = 'opt_out' AND opt_out IS NOT TRUE THEN now() ELSE opt_out_at END,
       bot_detectado = CASE WHEN $3 = 'auto_resposta' THEN true ELSE bot_detectado END,
       interesse_detectado_em = CASE WHEN $3 = 'interesse' THEN $4::timestamptz ELSE interesse_detectado_em END,
       temperatura = CASE WHEN $3 = 'interesse' THEN 'quente' ELSE temperatura END,
       -- resposta de robô nunca apaga uma resposta humana já registrada
       resposta_categoria = CASE
         WHEN $3 = 'auto_resposta' THEN COALESCE(resposta_categoria, 'auto_resposta')
         WHEN $3 = 'outra' THEN CASE WHEN resposta_categoria IS NULL OR resposta_categoria = 'auto_resposta' THEN 'outra' ELSE resposta_categoria END
         ELSE $3 END,
       resposta_em = CASE WHEN $3 = 'auto_resposta' AND resposta_em IS NOT NULL THEN resposta_em ELSE $4::timestamptz END,
       updated_at = now()
     WHERE id = $1 AND user_id = $2`,
    [p.contatoId, p.userId, c, p.respondidoEm]);

  if (c === 'opt_out' && p.telefone) {
    await pool.query(`INSERT INTO disparo_optouts (user_id, telefone, motivo) VALUES ($1,$2,'resposta_detectada')`, [p.userId, p.telefone]).catch(() => {});
  }
  return c;
}

/**
 * Chamado pelo webhook a cada mensagem recebida (fire-and-forget). Só considera quem recebeu disparo
 * nos últimos 7 dias — mensagem de cliente comum não é resposta de campanha.
 */
export async function registrarRespostaDeDisparo(
  pool: Pool, p: { userId: string; telefone: string; messageId: string; texto: string | null },
): Promise<void> {
  try {
    const digitos = String(p.telefone).replace(/\D/g, '');
    if (!digitos || !p.texto || digitos.length > 15) return;
    const r = await pool.query(
      `SELECT id, telefone_normalizado FROM contatos
        WHERE user_id = $1 AND ultimo_disparo_em > now() - interval '7 days'
          AND (telefone_normalizado = $2 OR RIGHT(regexp_replace(telefone, '\\D', '', 'g'), 11) = RIGHT($2, 11))
        ORDER BY ultimo_disparo_em DESC LIMIT 1`, [p.userId, digitos]);
    if (!r.rows[0]) return;
    await aplicarResposta(pool, {
      userId: p.userId, contatoId: r.rows[0].id, messageId: p.messageId, texto: p.texto,
      respondidoEm: new Date(), origem: 'webhook', telefone: r.rows[0].telefone_normalizado ?? digitos,
    });
  } catch (err: any) {
    log.warn('RESPOSTAS', 'falha ao registrar resposta de disparo', { err: err?.message });
  }
}

/**
 * Lê o histórico: para cada envio, classifica as respostas recebidas nas 72h seguintes (até 5).
 * Usado uma vez para preencher o passado e, depois, como reprocessamento seguro (idempotente).
 */
export async function reprocessarRespostas(pool: Pool, userId: string): Promise<Record<string, number>> {
  const r = await pool.query(
    `SELECT l.contato_id, l.telefone, m.message_id, m.content, m.created_at
       FROM disparo_logs l
       JOIN LATERAL (
         SELECT message_id, content, created_at FROM whatsapp_messages w
          WHERE w.user_id = l.user_id AND w.from_me = false AND w.content IS NOT NULL
            AND regexp_replace(split_part(w.remote_jid, '@', 1), '\\D', '', 'g') = regexp_replace(l.telefone, '\\D', '', 'g')
            AND w.created_at > l.enviado_at AND w.created_at < l.enviado_at + make_interval(hours => $2)
          ORDER BY w.created_at LIMIT 5) m ON true
      WHERE l.user_id = $1 AND l.status = 'sent' AND l.enviado_at IS NOT NULL AND l.contato_id IS NOT NULL
      ORDER BY m.created_at`, [userId, JANELA_RESPOSTA_HORAS]);

  const contagem: Record<string, number> = { lidas: r.rows.length, novas: 0 };
  for (const row of r.rows) {
    const cat = await aplicarResposta(pool, {
      userId, contatoId: row.contato_id, messageId: row.message_id, texto: row.content,
      respondidoEm: row.created_at, origem: 'historico', telefone: row.telefone,
    });
    if (cat) { contagem.novas++; contagem[cat] = (contagem[cat] ?? 0) + 1; }
  }
  return contagem;
}

// ── Métricas ──────────────────────────────────────────────────────────────────────────────────────
// Melhor categoria de cada envio nas 72h: interesse > opt_out > negativa > outra > auto_resposta.
const CTE_ENVIOS = `
  WITH env AS (
    SELECT l.id, l.disparo_id, l.contato_id, l.enviado_at, l.variante_idx, c.origem,
           EXTRACT(hour FROM l.enviado_at AT TIME ZONE 'America/Sao_Paulo')::int AS hora,
           ${NOME_REAL('l.nome')} AS nome_real,
           (SELECT r.categoria FROM contato_respostas r
             WHERE r.user_id = l.user_id AND r.contato_id = l.contato_id
               AND r.respondido_em > l.enviado_at AND r.respondido_em < l.enviado_at + make_interval(hours => ${JANELA_RESPOSTA_HORAS})
             ORDER BY CASE r.categoria WHEN 'interesse' THEN 1 WHEN 'opt_out' THEN 2 WHEN 'negativa' THEN 3 WHEN 'outra' THEN 4 ELSE 5 END
             LIMIT 1) AS cat
      FROM disparo_logs l LEFT JOIN contatos c ON c.id = l.contato_id
     WHERE l.user_id = $1 AND l.status = 'sent' AND l.enviado_at IS NOT NULL
  )`;

const AGREGADOS = `
  count(*)::int AS enviados,
  count(*) FILTER (WHERE cat IS NOT NULL)::int AS responderam,
  count(*) FILTER (WHERE cat IN ('interesse','negativa','opt_out','outra'))::int AS humanas,
  count(*) FILTER (WHERE cat = 'auto_resposta')::int AS robos,
  count(*) FILTER (WHERE cat = 'interesse')::int AS interesse,
  count(*) FILTER (WHERE cat = 'negativa')::int AS negativas,
  count(*) FILTER (WHERE cat = 'opt_out')::int AS opt_outs`;

export async function metricasRespostas(pool: Pool, userId: string) {
  const geral = await pool.query(`${CTE_ENVIOS} SELECT ${AGREGADOS} FROM env`, [userId]);
  const porOrigem = await pool.query(`${CTE_ENVIOS} SELECT COALESCE(origem, 'sem origem') AS chave, nome_real, ${AGREGADOS} FROM env GROUP BY 1, 2 ORDER BY 3 DESC`, [userId]);
  const porHora = await pool.query(`${CTE_ENVIOS} SELECT hora AS chave, ${AGREGADOS} FROM env GROUP BY 1 ORDER BY 1`, [userId]);
  const porDisparo = await pool.query(
    `${CTE_ENVIOS} SELECT e.disparo_id AS chave, d.nome, ${AGREGADOS.replace(/\bcat\b/g, 'e.cat')}
       FROM env e LEFT JOIN disparos d ON d.id = e.disparo_id GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 30`.replace('FROM env e', 'FROM env e'),
    [userId]);
  // Teste A/B: uma linha por (campanha, versão). Só campanhas com 2+ versões gravadas.
  const porVersao = await pool.query(
    `${CTE_ENVIOS}
     SELECT e.disparo_id, d.nome, e.variante_idx AS versao, ${AGREGADOS.replace(/\bcat\b/g, 'e.cat')}
       FROM env e LEFT JOIN disparos d ON d.id = e.disparo_id
      WHERE e.variante_idx IS NOT NULL
      GROUP BY 1, 2, 3
     HAVING e.disparo_id IN (SELECT disparo_id FROM env WHERE variante_idx IS NOT NULL GROUP BY 1 HAVING count(DISTINCT variante_idx) >= 2)
      ORDER BY 2, 3`, [userId]);
  return { janela_horas: JANELA_RESPOSTA_HORAS, geral: geral.rows[0], por_origem: porOrigem.rows, por_hora: porHora.rows, por_disparo: porDisparo.rows, por_versao: porVersao.rows };
}

// ── Propensão ─────────────────────────────────────────────────────────────────────────────────────
/** Recalcula a propensão de todos os contatos da conta a partir do histórico real de disparos. */
export async function recalcularPropensao(pool: Pool, userId: string): Promise<{ modelo: ModeloPropensao; atualizados: number }> {
  const r = await pool.query(
    `SELECT c.origem, ${NOME_REAL('l.nome')} AS nome_real,
            EXISTS (SELECT 1 FROM contato_respostas x WHERE x.user_id = l.user_id AND x.contato_id = l.contato_id
                     AND x.categoria IN ('interesse','negativa','opt_out','outra')
                     AND x.respondido_em > l.enviado_at AND x.respondido_em < l.enviado_at + make_interval(hours => ${JANELA_RESPOSTA_HORAS})) AS humano
       FROM disparo_logs l LEFT JOIN contatos c ON c.id = l.contato_id
      WHERE l.user_id = $1 AND l.status = 'sent' AND l.enviado_at IS NOT NULL`, [userId]);
  const amostras: AmostraPropensao[] = r.rows.map((x: any) => ({ origem: x.origem, nomeReal: !!x.nome_real, respondeuHumano: !!x.humano }));
  const modelo = construirModelo(amostras);

  let atualizados = 0;
  const origens: Array<['grupo' | 'importado' | 'outro', string]> = [
    ['grupo', `c.origem ILIKE '%grupo%'`],
    ['importado', `c.origem ILIKE '%import%' AND c.origem NOT ILIKE '%grupo%'`],
    ['outro', `(c.origem IS NULL OR (c.origem NOT ILIKE '%grupo%' AND c.origem NOT ILIKE '%import%'))`],
  ];
  for (const [nome, cond] of origens) {
    for (const nomeReal of [true, false]) {
      const p = prever(modelo, nome, nomeReal);
      const alvo = await pool.query(
        `UPDATE contatos c SET propensao = $2, propensao_calculada_em = now()
          WHERE c.user_id = $1 AND (${cond}) AND ${NOME_REAL('c.nome')} = $3`,
        [userId, p === null ? null : Math.round(p * 10000) / 100, nomeReal]);
      atualizados += alvo.rowCount ?? 0;
    }
  }
  return { modelo, atualizados };
}
