/**
 * metricasMaturacao.ts — painel admin MentoArk da maturação de números (Sprint 3 / H10, entregue
 * na Sprint 8 em 2026-10-06). Visão da PLATAFORMA (todas as contas), para recalibrar os limites
 * das fases (`LIMITE_FASE`/`DIAS_MINIMOS` em saudeNumero.ts).
 *
 * [AUDITORIA] LÓGICA: "pool global" e "mentores" dependem da Etapa B (pool compartilhado entre
 * contas), que NÃO foi construída — exige proxy por instância e consentimento. No lugar, o painel
 * mostra o equivalente que existe hoje: pares do Maturador (dentro de cada conta).
 *   - números por fase (agora);
 *   - Maturador: pares ativos/pausados, sessões (trocas de mensagem) por dia em 14 dias, pares
 *     pausados por falha (sessão abortada) nos últimos 30 dias;
 *   - restrições (queda suspeita, rate_limit) e bans confirmados em 30 dias POR FASE em que o
 *     número estava na hora (última mudança de fase antes do evento);
 *   - tempo médio da 1ª conexão até a fase "madura".
 */
import { Pool } from 'pg';

export async function metricasMaturacaoAdmin(pool: Pool) {
  const [porFase, pares, sessoes, abortadas, eventosPorFase, tempoMadura] = await Promise.all([
    pool.query(`SELECT COALESCE(fase, 'sem_fase') AS fase, COUNT(*)::int AS numeros FROM whatsapp_numeros GROUP BY 1 ORDER BY 2 DESC`),
    pool.query(`SELECT COUNT(*) FILTER (WHERE ativo)::int AS ativos, COUNT(*) FILTER (WHERE NOT ativo)::int AS pausados,
                       COUNT(DISTINCT user_id) FILTER (WHERE ativo)::int AS contas FROM maturador_pares`),
    pool.query(`SELECT (created_at AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
                       COUNT(*) FILTER (WHERE tipo = 'texto')::int AS mensagens,
                       COUNT(DISTINCT par_id)::int AS pares,
                       COUNT(*) FILTER (WHERE tipo IN ('status', 'enquete', 'reacao'))::int AS extras
                FROM maturador_mensagens WHERE created_at >= NOW() - INTERVAL '14 days'
                GROUP BY 1 ORDER BY 1`),
    pool.query(`SELECT COUNT(*)::int AS pares_pausados_por_falha FROM maturador_pares
                WHERE NOT ativo AND pausado_motivo IS NOT NULL AND updated_at >= NOW() - INTERVAL '30 days'`),
    pool.query(`SELECT COALESCE(f.fase, 'sem_registro') AS fase, e.tipo, COUNT(*)::int AS total
                FROM whatsapp_eventos_saude e
                LEFT JOIN LATERAL (
                  SELECT ef.detalhe->>'fase' AS fase FROM whatsapp_eventos_saude ef
                  WHERE ef.numero = e.numero AND ef.tipo = 'mudanca_fase' AND ef.criado_em < e.criado_em
                  ORDER BY ef.criado_em DESC LIMIT 1) f ON true
                WHERE e.tipo IN ('ban_suspeito', 'ban_confirmado', 'rate_limit', 'em_revisao')
                  AND e.criado_em >= NOW() - INTERVAL '30 days'
                GROUP BY 1, 2 ORDER BY 1, 2`),
    pool.query(`SELECT ROUND(AVG(EXTRACT(EPOCH FROM (e.criado_em - w.primeira_conexao_em)) / 86400)::numeric, 1) AS dias_medios,
                       COUNT(*)::int AS numeros
                FROM whatsapp_eventos_saude e JOIN whatsapp_numeros w ON w.numero = e.numero
                WHERE e.tipo = 'mudanca_fase' AND e.detalhe->>'fase' = 'madura'`),
  ]);
  return {
    numeros_por_fase: porFase.rows,
    maturador: { ...pares.rows[0], ...abortadas.rows[0], sessoes_por_dia: sessoes.rows },
    restricoes_30d_por_fase: eventosPorFase.rows,
    tempo_ate_madura: tempoMadura.rows[0],
    pool_global: null, // Etapa B não construída (ver cabeçalho)
  };
}
