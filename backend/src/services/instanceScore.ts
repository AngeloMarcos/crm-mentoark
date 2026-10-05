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
import { calcularScoreSaude, ItemScore, invalidarCacheSaude } from './saudeNumero';

// [AUDITORIA] BUG CORRIGIDO (Etapa A — Saúde de Instâncias, 2026-10-05): os 4 fatores acima
// (volume, resposta, reclamações, tempo) ignoravam histórico de ban, quedas forçadas e idade real
// do NÚMERO — um número com 2 bans aparecia como "80 — Saudável" e ficava liberado pra disparo.
// [AUDITORIA] FIX APLICADO: o cálculo passou a ser o de `saudeNumero.calcularScoreSaude` (começa
// em 100 e desconta ban, ban recente, quedas 401/402/403/406, quedas comuns, idade do número,
// opt-out, resposta baixa e falha de envio; +5 perfil completo). `score_fatores` agora guarda
// `{ versao: 2, rotulo, itens: [{ fator, pontos, info }] }` — a tela mostra cada desconto. O
// comentário de topo descreve a versão 1, mantido como histórico.

export interface ScoreResultado {
  total: number;
  rotulo: string;
  itens: ItemScore[];
}

/** Calcula e persiste o score de UMA instância (`agentes.id`). Usado pela rota on-demand. */
export async function recalcularScoreAgente(pool: Pool, agenteId: string, userId?: string): Promise<ScoreResultado | null> {
  const params: any[] = [agenteId];
  let where = `id = $1`;
  if (userId) { where += ` AND user_id = $2`; params.push(userId); }
  const r = await pool.query(
    `SELECT id, evolution_instancia, numero_conectado FROM agentes
     WHERE ${where} AND evolution_instancia IS NOT NULL LIMIT 1`,
    params
  );
  if (!r.rows.length) return null;
  const agente = r.rows[0];
  const s = await calcularScoreSaude(pool, agente.evolution_instancia, agente.numero_conectado);
  await pool.query(
    `UPDATE agentes SET whatsapp_score = $1, score_fatores = $2, score_updated_at = NOW() WHERE id = $3`,
    [s.total, JSON.stringify({ versao: 2, rotulo: s.rotulo, itens: s.itens }), agenteId]
  );
  return { total: s.total, rotulo: s.rotulo, itens: s.itens };
}

/**
 * Recalcula o score de TODAS as instâncias conectadas (todas as contas) — usado pelo cron
 * (`cron.ts`, a cada 15min). Erros por instância são isolados.
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
  invalidarCacheSaude();
  return { atualizados, falhas };
}
