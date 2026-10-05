/**
 * Resolução da instância de prospecção (papel='prospeccao' em `agentes`), compartilhada entre
 * `entrar.ts` (entrar no grupo) e `validacao.ts` (ler convite/participantes) — extraído pra um
 * arquivo próprio pra evitar import circular entre os dois (achado real: sem isso, `validacao.ts`
 * continuava lendo só a instância fixa por env var, e a tela de Catálogo mostrava "nenhuma
 * instância configurada" mesmo com a instância de prospecção já escolhida na tela).
 */
import { Pool } from 'pg';
import { resolverOwnerId } from '../services/subscription';

export interface InstanciaProspeccao {
  agenteId: string; url: string; apiKey: string; instancia: string;
  healthScore: number | null; diasConectado: number | null;
}

/**
 * Só a instância com papel `prospeccao` pode entrar em grupo — regra de ouro do pedido.
 * `agentes` (instâncias WhatsApp) é recurso da conta RAIZ, compartilhado entre membros de equipe —
 * por isso resolve o dono antes de consultar, senão um membro de equipe nunca acha a instância que
 * a própria conta já tem configurada (mesmo padrão de webhook.ts/whatsapp.ts).
 */
export async function instanciaDeProspeccao(pool: Pool, userId: string): Promise<InstanciaProspeccao | null> {
  const cfg = await pool.query(`SELECT agente_id FROM radar_entrada_config WHERE user_id = $1`, [userId]);
  const agenteId = cfg.rows[0]?.agente_id;
  if (!agenteId) return null;
  const ownerId = await resolverOwnerId(pool, userId);
  const r = await pool.query(
    `SELECT id, evolution_server_url AS url, evolution_api_key AS api_key, evolution_instancia AS instancia,
            health_score, evolution_conectado_em
       FROM agentes
      WHERE id = $1 AND user_id = $2 AND papel = 'prospeccao' AND ativo = true
        AND evolution_server_url IS NOT NULL AND evolution_api_key IS NOT NULL AND evolution_instancia IS NOT NULL`,
    [agenteId, ownerId]);
  const a = r.rows[0];
  if (!a) return null;
  const diasConectado = a.evolution_conectado_em
    ? Math.floor((Date.now() - new Date(a.evolution_conectado_em).getTime()) / 86_400_000) : null;
  return { agenteId: a.id, url: a.url, apiKey: a.api_key, instancia: a.instancia, healthScore: a.health_score ?? null, diasConectado };
}

export interface CorteInstancia { corteDiasConectado: number; corteHealthScore: number }

/** Instância crua/fraca demais não entra em grupo (protege o número, não é burocracia). */
export function instanciaApta(i: InstanciaProspeccao, corte: CorteInstancia): { ok: true } | { ok: false; motivo: string } {
  if (typeof i.healthScore === 'number' && i.healthScore < corte.corteHealthScore) return { ok: false, motivo: `Score de Saúde (${i.healthScore}) abaixo do mínimo (${corte.corteHealthScore})` };
  if (typeof i.diasConectado === 'number' && i.diasConectado < corte.corteDiasConectado) return { ok: false, motivo: `conectada há só ${i.diasConectado} dia(s) — mínimo ${corte.corteDiasConectado}` };
  return { ok: true };
}
