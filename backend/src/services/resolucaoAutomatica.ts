/**
 * resolucaoAutomatica.ts — atendimento "aberto" sem mensagem nem nota há N horas é encerrado sozinho (2026-11-10).
 * Sem isto ninguém resolvia nada em produção e "em andamento" só crescia.
 *
 * Regras: só o estado "aberto" (quem pediu atendente fica na fila); a pausa da IA NÃO muda (resolver pela tela
 * devolve à IA, mas fazer isso sozinho religaria a IA em conversas pausadas de propósito); `resolvido_em` é a hora
 * da última atividade e `resolvido_por` fica nulo — é assim que o relatório separa esses encerramentos.
 */
import { Pool } from 'pg';
import { log } from '../logger';

export const HORAS_INATIVIDADE_PADRAO = 24;
const MAX_HORAS = 30 * 24;
const LOTE = 500;

export function lerHorasInatividade(v: unknown): { horas?: number; erro?: string } {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_HORAS) return { horas: v };
  return { erro: `Informe as horas sem atividade (0 a ${MAX_HORAS}; 0 desliga).` };
}

export function deveResolverPorInatividade(
  at: { estado: string; ultimaAtividade: Date }, horas: number, agora: Date,
): boolean {
  return at.estado === 'aberto' && horas > 0 && agora.getTime() - new Date(at.ultimaAtividade).getTime() >= horas * 3_600_000;
}

/** Cron: devolve quantos atendimentos foram encerrados. Nunca lança. */
export async function resolverInativos(pool: Pool): Promise<number> {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.is_admin', 'true', true)`); // whatsapp_messages tem RLS no homolog
    const candidatos = (await client.query(
      `SELECT a.id, a.user_id, a.estado, h.horas, ult.ultima
       FROM atendimentos a
       LEFT JOIN atendimento_config cfg ON cfg.user_id = a.user_id
       CROSS JOIN LATERAL (SELECT COALESCE(cfg.resolver_inativo_horas, $1) AS horas) h
       CROSS JOIN LATERAL (
         SELECT GREATEST(
           a.aberto_em,
           (SELECT max(COALESCE(m.timestamp_wa, m.created_at)) FROM whatsapp_messages m
             WHERE m.user_id = a.user_id AND m.instance_name = a.instance_name AND m.remote_jid = a.remote_jid),
           (SELECT max(e.created_at) FROM atendimento_eventos e WHERE e.atendimento_id = a.id)
         ) AS ultima
       ) ult
       WHERE a.estado = 'aberto' AND h.horas > 0 AND ult.ultima < NOW() - make_interval(hours => h.horas)
       ORDER BY ult.ultima LIMIT ${LOTE}`,
      [HORAS_INATIVIDADE_PADRAO]
    )).rows;
    let encerrados = 0;
    const agora = new Date();
    for (const c of candidatos) {
      if (!deveResolverPorInatividade({ estado: c.estado, ultimaAtividade: c.ultima }, c.horas, agora)) continue;
      // estado = 'aberto' de novo no WHERE: se alguém mexeu desde a leitura, não sobrescreve.
      const r = await client.query(
        `UPDATE atendimentos SET estado = 'resolvido', resolvido_em = $2, resolvido_por = NULL, updated_at = NOW()
         WHERE id = $1 AND estado = 'aberto'`,
        [c.id, c.ultima]
      );
      if (!r.rowCount) continue;
      await client.query(
        `INSERT INTO atendimento_eventos (atendimento_id, user_id, tipo, origem, texto) VALUES ($1, $2, 'resolvido', 'sistema', $3)`,
        [c.id, c.user_id, `Sem atividade por ${c.horas} h`]
      );
      encerrados++;
    }
    await client.query('COMMIT');
    return encerrados;
  } catch (err: any) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    log.warn('ATENDIMENTO', 'Falha ao resolver atendimentos inativos', { err: err?.message });
    return 0;
  } finally {
    client?.release();
  }
}
