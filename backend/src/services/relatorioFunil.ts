/**
 * relatorioFunil.ts — relatório do funil (diagnosticos/SPRINT_FUNIL_PERDA_RELATORIO.md).
 * Base: `funil_eventos` feitos pela equipe, IA ou API (sem as linhas de automação). Período em dias de Brasília.
 */
import { Pool } from 'pg';
import { taxaConversao } from './funilAuto';

const MOVIMENTOS = `
  ev AS (
    SELECT ev.id, ev.contato_id, ev.para_estagio_id, ev.created_at, ev.motivo_id, e.tipo AS tipo_para
    FROM funil_eventos ev LEFT JOIN funil_estagios e ON e.id = ev.para_estagio_id
    WHERE ev.user_id = $1 AND ev.resultado = 'feito' AND ev.origem <> 'automacao'
  )`;

const inteiro = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v)));

export async function montarRelatorioFunil(pool: Pool, userId: string, de: Date, ate: Date) {
  const params = [userId, de, ate];
  const [resumo, etapas, perdas] = await Promise.all([
    pool.query(`
      WITH ${MOVIMENTOS},
      inicio AS (SELECT contato_id, min(created_at) AS entrou FROM ev WHERE para_estagio_id IS NOT NULL GROUP BY contato_id),
      fechados AS (
        SELECT DISTINCT ON (contato_id, tipo_para) contato_id, tipo_para, created_at
        FROM ev WHERE tipo_para IN ('ganho', 'perdido') AND created_at >= $2 AND created_at < $3
        ORDER BY contato_id, tipo_para, created_at DESC
      )
      SELECT
        (SELECT count(*) FROM inicio WHERE entrou >= $2 AND entrou < $3)::int AS entraram,
        count(*) FILTER (WHERE f.tipo_para = 'ganho')::int AS ganhos,
        count(*) FILTER (WHERE f.tipo_para = 'perdido')::int AS perdidos,
        COALESCE(sum(c.valor_potencial) FILTER (WHERE f.tipo_para = 'ganho'), 0) AS valor_ganho,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM f.created_at - i.entrou)) FILTER (WHERE f.tipo_para = 'ganho') AS ciclo_p50,
        percentile_cont(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM f.created_at - i.entrou)) FILTER (WHERE f.tipo_para = 'ganho') AS ciclo_p90
      FROM fechados f
      LEFT JOIN inicio i ON i.contato_id = f.contato_id
      LEFT JOIN contatos c ON c.id = f.contato_id`, params),
    // Tempo na etapa: de entrar até o próximo movimento do mesmo card (saída dentro do período).
    pool.query(`
      WITH ${MOVIMENTOS},
      estadias AS (
        SELECT para_estagio_id AS etapa, created_at AS entrou,
               LEAD(created_at) OVER (PARTITION BY contato_id ORDER BY created_at, id) AS saiu
        FROM ev
      )
      SELECT e.id, e.nome, COALESCE(e.tipo, 'aberta') AS tipo, e.cor,
             (SELECT count(*) FROM contatos c WHERE c.user_id = $1 AND c.funil_estagio_id = e.id)::int AS cards,
             (SELECT COALESCE(sum(c.valor_potencial), 0) FROM contatos c WHERE c.user_id = $1 AND c.funil_estagio_id = e.id) AS valor,
             count(s.saiu)::int AS sairam,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM s.saiu - s.entrou)) AS tempo_p50
      FROM funil_estagios e
      LEFT JOIN estadias s ON s.etapa = e.id AND s.saiu >= $2 AND s.saiu < $3
      WHERE e.user_id = $1
      GROUP BY e.id ORDER BY e.ordem, e.created_at`, params),
    pool.query(`
      WITH ${MOVIMENTOS},
      perdas AS (
        SELECT DISTINCT ON (contato_id) contato_id, motivo_id
        FROM ev WHERE tipo_para = 'perdido' AND created_at >= $2 AND created_at < $3
        ORDER BY contato_id, created_at DESC
      )
      SELECT COALESCE(m.nome, 'Sem motivo') AS nome, count(*)::int AS total
      FROM perdas p LEFT JOIN motivos m ON m.id = p.motivo_id
      GROUP BY 1 ORDER BY 2 DESC, 1`, params),
  ]);
  const r = resumo.rows[0];
  return {
    resumo: {
      entraram: r.entraram, ganhos: r.ganhos, perdidos: r.perdidos,
      conversao: taxaConversao(r.ganhos, r.perdidos), valorGanho: Number(r.valor_ganho),
      cicloSeg: { p50: inteiro(r.ciclo_p50), p90: inteiro(r.ciclo_p90) },
    },
    etapas: etapas.rows.map(e => ({
      id: e.id, nome: e.nome, tipo: e.tipo, cor: e.cor, cards: e.cards, valor: Number(e.valor), sairam: e.sairam, tempoSeg: inteiro(e.tempo_p50),
    })),
    motivosPerda: perdas.rows,
  };
}
