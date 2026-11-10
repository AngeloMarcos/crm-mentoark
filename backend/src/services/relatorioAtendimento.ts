/**
 * relatorioAtendimento.ts — Sprint Relatórios de Atendimento v1 (diagnosticos/SPRINT_RELATORIOS_ATENDIMENTO.md).
 * Todas as contas são sobre a coorte de atendimentos ABERTOS no período (fuso de Brasília), sem os criados pela
 * migração inicial (o aberto_em deles é a última mensagem, não a chegada do cliente).
 */
import { Pool } from 'pg';

const DIA_MS = 86_400_000;
const FUSO_BRASILIA_MS = 3 * 3_600_000; // UTC−3, sem horário de verão desde 2019
const MAX_DIAS = 92;
const DIAS_PADRAO = 7;

function dataValida(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [a, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d));
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Meia-noite de Brasília do dia 'AAAA-MM-DD', como instante UTC. */
const meiaNoite = (dia: string) => new Date(Date.parse(`${dia}T00:00:00Z`) + FUSO_BRASILIA_MS);
const diaDe = (instante: Date) => new Date(instante.getTime() - FUSO_BRASILIA_MS).toISOString().slice(0, 10);

export interface Periodo { de?: Date; ate?: Date; dias?: number; erro?: string }

/** `de` e `ate` são dias inteiros (inclusive). Devolve o intervalo [de, ate) em UTC. */
export function lerPeriodo(q: Record<string, unknown>, agora: Date = new Date()): Periodo {
  const de = typeof q.de === 'string' && q.de ? q.de : null;
  const ate = typeof q.ate === 'string' && q.ate ? q.ate : null;
  if ((de && !dataValida(de)) || (ate && !dataValida(ate))) return { erro: 'Datas no formato AAAA-MM-DD.' };
  const fimDia = ate ?? diaDe(agora);
  const fim = new Date(meiaNoite(fimDia).getTime() + DIA_MS);
  const inicio = de ? meiaNoite(de) : new Date(fim.getTime() - DIAS_PADRAO * DIA_MS);
  const dias = Math.round((fim.getTime() - inicio.getTime()) / DIA_MS);
  if (dias < 1) return { erro: 'A data inicial é depois da final.' };
  if (dias > MAX_DIAS) return { erro: `O período pode ter até ${MAX_DIAS} dias.` };
  return { de: inicio, ate: fim, dias };
}

// Coorte do período + metas do número (tela SLA / Gestão; sem meta, os padrões da tela).
const COORTE = `
  WITH a AS (
    SELECT at.*, COALESCE(ag.sla_tme, 15) AS meta_resposta_min, COALESCE(ag.sla_tma, 120) AS meta_resolucao_min
    FROM atendimentos at
    LEFT JOIN LATERAL (
      SELECT sla_tme, sla_tma FROM agentes WHERE evolution_instancia = at.instance_name ORDER BY created_at LIMIT 1
    ) ag ON true
    WHERE at.user_id = $1 AND at.origem <> 'migracao' AND at.aberto_em >= $2 AND at.aberto_em < $3
      AND ($4::text IS NULL OR at.instance_name = $4)
  )`;

const seg = (col: string, p: number) =>
  `percentile_cont(${p}) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ${col} - aberto_em))`;

const inteiro = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v)));

export async function montarRelatorio(pool: Pool, ownerId: string, p: Required<Omit<Periodo, 'erro'>>, instancia: string | null) {
  const params = [ownerId, p.de, p.ate, instancia];
  const [resumo, dias, atendentes, motivos] = await Promise.all([
    pool.query(`${COORTE}
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE estado = 'resolvido')::int AS resolvidos,
             count(*) FILTER (WHERE estado <> 'resolvido')::int AS em_andamento,
             count(*) FILTER (WHERE reaberto_de IS NOT NULL)::int AS reabertos,
             count(*) FILTER (WHERE atendente_id IS NULL)::int AS sem_atendente,
             count(*) FILTER (WHERE estado = 'resolvido' AND primeira_resposta_humana_em IS NULL)::int AS resolvidos_so_ia,
             count(*) FILTER (WHERE primeira_resposta_em IS NOT NULL)::int AS respondidos,
             count(*) FILTER (WHERE primeira_resposta_humana_em IS NOT NULL)::int AS respondidos_humano,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM atendimento_eventos e WHERE e.atendimento_id = a.id AND e.tipo = 'aguardando'))::int AS pediram_humano,
             count(*) FILTER (WHERE primeira_resposta_humana_em - aberto_em <= meta_resposta_min * INTERVAL '1 minute')::int AS humano_na_meta,
             count(*) FILTER (WHERE estado = 'resolvido' AND resolvido_em - aberto_em <= meta_resolucao_min * INTERVAL '1 minute')::int AS resolvidos_na_meta,
             ${seg('primeira_resposta_em', 0.5)} AS resposta_p50, ${seg('primeira_resposta_em', 0.9)} AS resposta_p90,
             ${seg('primeira_resposta_humana_em', 0.5)} AS resposta_humana_p50, ${seg('primeira_resposta_humana_em', 0.9)} AS resposta_humana_p90,
             ${seg('resolvido_em', 0.5)} AS resolucao_p50, ${seg('resolvido_em', 0.9)} AS resolucao_p90
      FROM a`, params),
    pool.query(`${COORTE}
      SELECT to_char(d, 'YYYY-MM-DD') AS dia,
             count(a.id)::int AS abertos,
             count(a.id) FILTER (WHERE a.estado = 'resolvido')::int AS resolvidos
      FROM generate_series(($2::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date,
                           (($3::timestamptz - INTERVAL '1 day') AT TIME ZONE 'America/Sao_Paulo')::date, INTERVAL '1 day') d
      LEFT JOIN a ON (a.aberto_em AT TIME ZONE 'America/Sao_Paulo')::date = d::date
      GROUP BY d ORDER BY d`, params),
    pool.query(`${COORTE}
      SELECT u.id, COALESCE(u.display_name, u.email) AS nome,
             count(a.id) FILTER (WHERE a.atendente_id = u.id)::int AS atribuidos,
             count(a.id) FILTER (WHERE a.resolvido_por = u.id)::int AS resolvidos,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM a.primeira_resposta_humana_em - a.aberto_em))
               FILTER (WHERE a.atendente_id = u.id) AS resposta_humana_p50,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM a.resolvido_em - a.aberto_em))
               FILTER (WHERE a.atendente_id = u.id) AS resolucao_p50
      FROM users u LEFT JOIN a ON a.atendente_id = u.id OR a.resolvido_por = u.id
      WHERE COALESCE(u.owner_id, u.id) = $1
      GROUP BY u.id ORDER BY atribuidos DESC, nome`, params),
    pool.query(`${COORTE}
      SELECT COALESCE(m.nome, 'Sem motivo') AS nome, count(*)::int AS total
      FROM a LEFT JOIN motivos m ON m.id = a.motivo_resolucao_id
      WHERE a.estado = 'resolvido'
      GROUP BY 1 ORDER BY 2 DESC, 1`, params),
  ]);

  const r = resumo.rows[0];
  return {
    periodo: { de: diaDe(p.de), ate: diaDe(new Date(p.ate.getTime() - DIA_MS)), dias: p.dias },
    resumo: {
      total: r.total, resolvidos: r.resolvidos, emAndamento: r.em_andamento, reabertos: r.reabertos, semAtendente: r.sem_atendente,
      resolvidosSoIa: r.resolvidos_so_ia, respondidos: r.respondidos, respondidosHumano: r.respondidos_humano,
      pediramHumano: r.pediram_humano, humanoNaMeta: r.humano_na_meta, resolvidosNaMeta: r.resolvidos_na_meta,
      respostaSeg: { p50: inteiro(r.resposta_p50), p90: inteiro(r.resposta_p90) },
      respostaHumanaSeg: { p50: inteiro(r.resposta_humana_p50), p90: inteiro(r.resposta_humana_p90) },
      resolucaoSeg: { p50: inteiro(r.resolucao_p50), p90: inteiro(r.resolucao_p90) },
    },
    dias: dias.rows,
    atendentes: atendentes.rows.map(a => ({
      id: a.id, nome: a.nome, atribuidos: a.atribuidos, resolvidos: a.resolvidos,
      respostaHumanaSeg: inteiro(a.resposta_humana_p50), resolucaoSeg: inteiro(a.resolucao_p50),
    })),
    motivos: motivos.rows,
  };
}

/** Situação agora (sem período): contagem do que está em andamento e a fila de quem pediu humano. */
export async function montarAgora(pool: Pool, ownerId: string, instancia: string | null) {
  const [cont, fila] = await Promise.all([
    pool.query(
      `SELECT count(*) FILTER (WHERE estado = 'aberto')::int AS abertos,
              count(*) FILTER (WHERE estado = 'aguardando')::int AS aguardando,
              count(*) FILTER (WHERE atendente_id IS NULL)::int AS sem_atendente
       FROM atendimentos WHERE user_id = $1 AND estado <> 'resolvido' AND ($2::text IS NULL OR instance_name = $2)`,
      [ownerId, instancia]
    ),
    pool.query(
      `SELECT at.id, at.instance_name, at.remote_jid, at.telefone,
              COALESCE(NULLIF(c.nome, c.telefone), c.push_name, at.telefone) AS nome,
              u.display_name AS atendente_nome,
              COALESCE((SELECT max(e.created_at) FROM atendimento_eventos e WHERE e.atendimento_id = at.id AND e.tipo = 'aguardando'), at.updated_at) AS desde
       FROM atendimentos at
       LEFT JOIN contatos c ON c.id = at.contato_id
       LEFT JOIN users u ON u.id = at.atendente_id
       WHERE at.user_id = $1 AND at.estado = 'aguardando' AND ($2::text IS NULL OR at.instance_name = $2)
       ORDER BY desde ASC LIMIT 20`,
      [ownerId, instancia]
    ),
  ]);
  const c = cont.rows[0];
  return { abertos: c.abertos, aguardando: c.aguardando, semAtendente: c.sem_atendente, fila: fila.rows };
}
