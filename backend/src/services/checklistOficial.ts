/**
 * checklistOficial.ts — checklist "Apto para API oficial" de um número conectado por QR Code
 * (Sprint 3 / H2, entregue na Sprint 7 em 2026-10-06).
 *
 * [AUDITORIA] LÓGICA: um item por linha, verde/vermelho, com o motivo. Os 5 primeiros o CRM mede
 * sozinho (fase, bans/quedas, score, resposta/opt-out, perfil); os 2 últimos dependem de
 * confirmação manual do cliente com data (e print, no caso do portfólio), gravada em
 * `whatsapp_numeros`. Tudo verde → `apto_api_oficial = true` (badge na instância). Número com ban
 * no histórico recebe a recomendação de usar um número novo na API oficial.
 *   - "Score ≥ 85 nos últimos 7 dias": o score v2 já é calculado sobre a janela de 7 dias, então
 *     usa o score atual (não existe histórico diário de score);
 *   - taxa de resposta/opt-out: janela de 7 dias; sem volume mínimo (20 envios) não reprova.
 */
import { Pool } from 'pg';
import { metricas7d, normalizar, ROTULO_FASE, Fase } from './saudeNumero';

export interface ItemChecklist { item: string; ok: boolean; detalhe: string; manual?: boolean }
export interface ChecklistOficial {
  agente_id: string; numero: string | null; apto: boolean; itens: ItemChecklist[]; recomendacao: string | null;
  confirmacoes: { app_business_desde: string | null; portfolio_verificado_em: string | null; portfolio_prova: string | null };
}

const DIA = 86_400_000;
const fmt = (d: any) => new Date(d).toLocaleDateString('pt-BR');

export async function calcularChecklistOficial(pool: Pool, agenteId: string, userId?: string): Promise<ChecklistOficial | null> {
  const a = (await pool.query(
    `SELECT id, evolution_instancia, numero_conectado, whatsapp_score, score_updated_at FROM agentes
     WHERE id = $1 ${userId ? 'AND user_id = $2' : ''}`,
    userId ? [agenteId, userId] : [agenteId]
  )).rows[0];
  if (!a) return null;
  const numero = a.numero_conectado ? normalizar(a.numero_conectado) : null;
  const w = numero ? (await pool.query(`SELECT * FROM whatsapp_numeros WHERE numero = $1`, [numero])).rows[0] : null;
  const itens: ItemChecklist[] = [];

  // 1. Fase madura e 21+ dias desde a primeira conexão
  const dias = w?.primeira_conexao_em ? Math.floor((Date.now() - new Date(w.primeira_conexao_em).getTime()) / DIA) : 0;
  const faseOk = ['pre_oficial', 'madura'].includes(w?.fase) && dias >= 21;
  itens.push({ item: 'Fase madura e 21 dias ou mais de uso', ok: faseOk,
    detalhe: w ? `${ROTULO_FASE[w.fase as Fase] || w.fase || 'sem fase'} · ${dias} dia(s) desde a 1ª conexão` : 'Número sem registro de saúde' });

  // 2. Sem ban e sem queda 401/402/403/406 em 21 dias
  const quedas = numero ? (await pool.query(
    `SELECT COUNT(*)::int AS n FROM whatsapp_eventos_saude WHERE numero = $1 AND tipo = 'ban_suspeito' AND criado_em >= NOW() - INTERVAL '21 days'`,
    [numero]
  )).rows[0].n : 0;
  const bans = w?.bans_total ?? 0;
  itens.push({ item: 'Nenhum ban e nenhuma queda suspeita em 21 dias', ok: bans === 0 && quedas === 0,
    detalhe: `${bans} ban(s) no histórico · ${quedas} queda(s) 401/402/403/406 em 21 dias` });

  // 3. Score ≥ 85
  const score = a.score_updated_at ? a.whatsapp_score : null;
  itens.push({ item: 'Score de saúde 85 ou mais', ok: score !== null && score >= 85,
    detalhe: score === null ? 'Score ainda não calculado' : `Score atual ${score} (janela de 7 dias)` });

  // 4. Resposta ≥ 30% e opt-out < 1%
  const m = await metricas7d(pool, a.evolution_instancia, numero || '');
  if (m.enviados < 20) {
    itens.push({ item: 'Resposta de 30% ou mais e opt-out abaixo de 1%', ok: true,
      detalhe: `Poucos disparos para medir (${m.enviados} em 7 dias) — não reprova` });
  } else {
    const resp = (m.respondidos / m.enviados) * 100;
    const opt = (m.optouts / m.enviados) * 100;
    itens.push({ item: 'Resposta de 30% ou mais e opt-out abaixo de 1%', ok: resp >= 30 && opt < 1,
      detalhe: `${resp.toFixed(0)}% de resposta · ${opt.toFixed(1)}% de opt-out (${m.enviados} envios em 7 dias)` });
  }

  // 5. Perfil completo
  itens.push({ item: 'Perfil completo (foto e nome)', ok: !!w?.perfil_completo,
    detalhe: w?.perfil_completo ? 'Configurado' : 'Falta foto ou nome no perfil do WhatsApp' });

  // 6. App WhatsApp Business em uso há 7+ dias (manual)
  const appOk = !!w?.app_business_desde && Date.now() - new Date(w.app_business_desde).getTime() >= 7 * DIA;
  itens.push({ item: 'App WhatsApp Business em uso há 7 dias ou mais', ok: appOk, manual: true,
    detalhe: w?.app_business_desde ? `Em uso desde ${fmt(w.app_business_desde)} (confirmado pelo cliente)` : 'Confirme a data em que o número passou a usar o app WhatsApp Business' });

  // 7. Portfólio Meta criado e empresa verificada (manual, com print)
  const portOk = !!w?.portfolio_verificado_em && !!w?.portfolio_prova;
  itens.push({ item: 'Portfólio Meta criado e empresa verificada', ok: portOk, manual: true,
    detalhe: portOk ? `Verificada em ${fmt(w.portfolio_verificado_em)}` : 'Confirme a data da verificação e anexe o print (link)' });

  const apto = itens.every(i => i.ok);
  if (numero) await pool.query(`UPDATE whatsapp_numeros SET apto_api_oficial = $2 WHERE numero = $1`, [numero, apto]).catch(() => {});
  return {
    agente_id: a.id, numero, apto, itens,
    recomendacao: bans >= 1 ? 'Recomendamos um número novo para a API oficial (este número já teve ban).' : null,
    confirmacoes: {
      app_business_desde: w?.app_business_desde ?? null,
      portfolio_verificado_em: w?.portfolio_verificado_em ?? null,
      portfolio_prova: w?.portfolio_prova ?? null,
    },
  };
}

/** Recalcula a aptidão de todos os números (cron horário de `avaliarFases`). */
export async function recalcularAptidaoOficial(pool: Pool): Promise<number> {
  const r = await pool.query(`SELECT id FROM agentes WHERE evolution_instancia IS NOT NULL AND numero_conectado IS NOT NULL`);
  let aptos = 0;
  for (const x of r.rows) {
    const c = await calcularChecklistOficial(pool, x.id).catch(() => null);
    if (c?.apto) aptos++;
  }
  return aptos;
}
