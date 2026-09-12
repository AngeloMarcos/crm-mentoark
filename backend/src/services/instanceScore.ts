/**
 * instanceScore.ts — cálculo REAL do "Score de Saúde" de uma instância WhatsApp (aba Instâncias,
 * `InstanceManagementPanel.tsx` → `ScoreInstancia.tsx`).
 *
 * [AUDITORIA] BUG GRAVE CORRIGIDO (Sprint Score Real + Maturador, 2026-08-09): até esta sprint,
 * `updateScore()` (frontend, `InstanceManagementPanel.tsx`) era 100% mock — usava `Math.random()`
 * pra `volume_diario`/`taxa_resposta`/`reclamacoes`/`tempo_dias`, só rodava quando o usuário
 * clicava manualmente, e o fallback de exibição sem nenhum cálculo era `whatsapp_score ?? 100`
 * ("Saudável"). Achado real do usuário: 2 números banidos na mesma semana, os dois mostrando
 * 100/100 o tempo todo — porque nunca houve cálculo nenhum, só o fallback otimista. Este módulo
 * substitui o mock por 4 fatores calculados a partir de dado real do próprio banco — não é uma
 * métrica oficial da Meta/WhatsApp (que não existe pra API não-oficial), é uma ESTIMATIVA
 * determinística baseada no que o CRM realmente sabe sobre a instância.
 *
 * Os 4 fatores (0-25 cada, soma 0-100) usam as mesmas faixas de pontuação que já existiam no
 * mock antigo (preservadas de propósito — são as mesmas descritas na cópia estática de
 * `ScoreInstancia.tsx`, ex: "manter volume abaixo de 150", "Semana 1: max 20 msg/dia" etc., então
 * manter os mesmos limiares evita que a UI e o cálculo real fiquem contando histórias diferentes):
 *
 *   1. Volume diário   — `whatsapp_messages` (from_me=true, instance_name=X, últimas 24h). Fonte
 *      única (não soma com `disparo_logs`): confirmado por leitura de `disparoProcessor.ts` que
 *      TODO envio de campanha já grava em `whatsapp_messages` (linha ~516) — somar as duas
 *      contaria a mesma mensagem 2x.
 *   2. Taxa de resposta — % de contatos (por `remote_jid`) que a instância mandou mensagem nos
 *      últimos 7 dias e que responderam (mensagem `from_me=false` da mesma pessoa, mesma janela).
 *      Heurística simples, documentada como tal (não é feita correlação temporal fina "resposta
 *      HÁ ATÉ 48h" — só "houve troca nos dois sentidos na janela"), suficiente pra distinguir
 *      "número que ninguém responde" (sinal de risco real) de "número com conversa normal".
 *   3. Reclamações     — `disparo_optouts` dos últimos 30 dias, atribuídos à instância que mandou
 *      a ÚLTIMA campanha (`disparo_logs.instancia`) pro contato ANTES do opt-out (subquery
 *      correlacionada por `telefone`, pega o envio mais recente antes da data do opt-out).
 *   4. Maturidade      — dias desde `agentes.evolution_conectado_em` (preenchido a partir desta
 *      sprint na conexão real; `created_at` como aproximação pra linhas antigas, ver migrations.ts).
 *
 * Override crítico (item mais importante do achado): uma instância desconectada/banida
 * (`state !== 'open'`) NUNCA deve aparecer como "Saudável" — implementado no FRONTEND
 * (`InstanceManagementPanel.tsx`), não aqui, porque o frontend já tem o estado de conexão mais
 * fresco possível (poll a cada 30s direto na Evolution, via `fetchConnectionStatus`) — mais
 * confiável do que este módulo tentar re-derivar o mesmo dado a partir de `integracoes_config`
 * (que só é sincronizado a cada 15min pelo cron de reconciliação). Ver
 * `ScoreInstancia.tsx`/`InstanceManagementPanel.tsx` pro override real.
 */
import { Pool } from 'pg';
import { log } from '../logger';

export interface ScoreFatores {
  volume_diario: number;
  taxa_resposta: number;
  reclamacoes: number;
  tempo_conta: number;
}

export interface ScoreResultado {
  total: number;
  fatores: ScoreFatores;
  // Dado bruto usado no cálculo — devolvido pra debug/teste, não persistido.
  bruto: {
    volume_diario: number;
    taxa_resposta: number | null; // null = sem dado suficiente (0 mensagens enviadas na janela)
    reclamacoes: number;
    tempo_dias: number;
  };
}

async function calcularVolumeDiario(pool: Pool, userId: string, instancia: string): Promise<number> {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS total FROM whatsapp_messages
     WHERE user_id = $1 AND instance_name = $2 AND from_me = true
       AND created_at >= NOW() - INTERVAL '24 hours'`,
    [userId, instancia]
  );
  return r.rows[0]?.total ?? 0;
}

async function calcularTaxaResposta(pool: Pool, userId: string, instancia: string): Promise<number | null> {
  const r = await pool.query(
    `WITH enviados AS (
       SELECT DISTINCT remote_jid FROM whatsapp_messages
       WHERE user_id = $1 AND instance_name = $2 AND from_me = true
         AND created_at >= NOW() - INTERVAL '7 days'
     ), respondidos AS (
       SELECT DISTINCT m.remote_jid FROM whatsapp_messages m
       JOIN enviados e ON e.remote_jid = m.remote_jid
       WHERE m.user_id = $1 AND m.instance_name = $2 AND m.from_me = false
         AND m.created_at >= NOW() - INTERVAL '7 days'
     )
     SELECT (SELECT COUNT(*) FROM enviados)::int AS total_enviados,
            (SELECT COUNT(*) FROM respondidos)::int AS total_respondidos`,
    [userId, instancia]
  );
  const { total_enviados, total_respondidos } = r.rows[0] || { total_enviados: 0, total_respondidos: 0 };
  if (!total_enviados) return null; // sem envio na janela — não dá pra medir resposta, não é "ruim"
  return (total_respondidos / total_enviados) * 100;
}

async function calcularReclamacoes(pool: Pool, userId: string, instancia: string): Promise<number> {
  // [AUDITORIA] LÓGICA: subquery correlacionada pega o disparo_logs.instancia do envio MAIS
  // RECENTE (status='sent', enviado_at <= data do opt-out) pra aquele telefone — evita atribuir
  // erroneamente o opt-out a QUALQUER instância que já tenha mandado campanha pro contato algum
  // dia (um EXISTS simples faria isso, se o contato tivesse recebido de 2+ instâncias antes de
  // sair). Comparação por RIGHT(telefone,11) — mesmo padrão já usado em disparoProcessor.ts pra
  // telefone não normalizado no mesmo formato em todo lugar do sistema.
  const r = await pool.query(
    `SELECT COUNT(*)::int AS total FROM disparo_optouts oo
     WHERE oo.user_id = $1
       AND oo.created_at >= NOW() - INTERVAL '30 days'
       AND (
         SELECT dl.instancia FROM disparo_logs dl
         WHERE dl.user_id = oo.user_id
           AND RIGHT(dl.telefone, 11) = RIGHT(oo.telefone, 11)
           AND dl.status = 'sent'
           AND dl.enviado_at <= oo.created_at
         ORDER BY dl.enviado_at DESC
         LIMIT 1
       ) = $2`,
    [userId, instancia]
  );
  return r.rows[0]?.total ?? 0;
}

function calcularTempoDias(evolutionConectadoEm: string | Date | null): number {
  if (!evolutionConectadoEm) return 0;
  const conectadoEm = new Date(evolutionConectadoEm).getTime();
  return Math.max(0, Math.floor((Date.now() - conectadoEm) / (1000 * 60 * 60 * 24)));
}

/**
 * Calcula o score real de UMA instância — não persiste, só calcula. `agente` precisa ter pelo
 * menos `user_id`, `evolution_instancia`, `evolution_conectado_em`/`created_at`.
 */
export async function calcularScoreInstancia(
  pool: Pool,
  agente: { user_id: string; evolution_instancia: string; evolution_conectado_em?: string | Date | null; created_at?: string | Date | null }
): Promise<ScoreResultado> {
  const { user_id, evolution_instancia } = agente;
  const [volumeDiario, taxaResposta, reclamacoes] = await Promise.all([
    calcularVolumeDiario(pool, user_id, evolution_instancia),
    calcularTaxaResposta(pool, user_id, evolution_instancia),
    calcularReclamacoes(pool, user_id, evolution_instancia),
  ]);
  const tempoDias = calcularTempoDias(agente.evolution_conectado_em ?? agente.created_at ?? null);

  // Mesmas faixas do mock antigo (preservadas — ver comentário de topo do arquivo).
  const v_score = volumeDiario < 50 ? 25 : volumeDiario <= 150 ? 15 : 5;
  // taxaResposta === null (sem envio na janela de 7d): fator neutro (15, "Atenção") — não é
  // "saudável" por padrão (esse era exatamente o bug original, fallback otimista sem dado real),
  // mas também não é justo penalizar como "crítico" uma instância nova/pouco usada sem sinal
  // nenhum de problema real.
  const r_score = taxaResposta === null ? 15 : taxaResposta > 30 ? 25 : taxaResposta >= 10 ? 15 : 5;
  const b_score = reclamacoes === 0 ? 25 : reclamacoes <= 3 ? 10 : 0;
  const m_score = tempoDias > 90 ? 25 : tempoDias >= 30 ? 15 : 5;

  const total = v_score + r_score + b_score + m_score;
  return {
    total,
    fatores: { volume_diario: v_score, taxa_resposta: r_score, reclamacoes: b_score, tempo_conta: m_score },
    bruto: { volume_diario: volumeDiario, taxa_resposta: taxaResposta, reclamacoes, tempo_dias: tempoDias },
  };
}

/** Calcula e persiste o score de UMA instância (`agentes.id`). Usado pela rota on-demand. */
export async function recalcularScoreAgente(pool: Pool, agenteId: string, userId?: string): Promise<ScoreResultado | null> {
  const params: any[] = [agenteId];
  let where = `id = $1`;
  if (userId) { where += ` AND user_id = $2`; params.push(userId); }
  const r = await pool.query(
    `SELECT id, user_id, evolution_instancia, evolution_conectado_em, created_at
     FROM agentes WHERE ${where} AND evolution_instancia IS NOT NULL LIMIT 1`,
    params
  );
  if (!r.rows.length) return null;
  const agente = r.rows[0];
  const resultado = await calcularScoreInstancia(pool, agente);
  await pool.query(
    `UPDATE agentes SET whatsapp_score = $1, score_fatores = $2, score_updated_at = NOW() WHERE id = $3`,
    [resultado.total, JSON.stringify(resultado.fatores), agenteId]
  );
  return resultado;
}

/**
 * Recalcula o score de TODAS as instâncias conectadas (todas as contas) — usado pelo cron
 * (`cron.ts`, a cada 15min, mesmo espírito de `reconciliarInstanciasEvolution`). Erros por
 * instância são isolados (uma falha não derruba o lote inteiro).
 */
export async function recalcularTodosScores(pool: Pool): Promise<{ atualizados: number; falhas: number }> {
  const r = await pool.query(
    `SELECT id FROM agentes WHERE evolution_instancia IS NOT NULL AND evolution_instancia <> ''`
  );
  let atualizados = 0;
  let falhas = 0;
  for (const row of r.rows) {
    try {
      const resultado = await recalcularScoreAgente(pool, row.id);
      if (resultado) atualizados++;
    } catch (err: any) {
      falhas++;
      log.warn('SCORE_INSTANCIA', 'Falha ao recalcular score', { agenteId: row.id, err: err?.message });
    }
  }
  return { atualizados, falhas };
}
