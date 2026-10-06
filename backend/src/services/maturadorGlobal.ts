/**
 * maturadorGlobal.ts — Maturador Global (Sprint 9, 2026-10-06; era a "Etapa B" do relatório de
 * saúde): números de TODAS as contas que aderiram conversam entre si para ganhar histórico.
 *
 * [AUDITORIA] LÓGICA — regras de segurança (pesquisa de 2026 + decisões do usuário):
 *   1. NÚMERO NOVO NÃO ENVIA NADA — nem texto, reação, status, enquete ou "lido" — até o prazo de
 *      liberação: proteção de número novo (`protecao_ate`), fases perfil/aquecimento_1,
 *      quarentena, "conta em revisão" e, se o número já foi banido, 21 dias desde a 1ª conexão.
 *      Esses números são RECEPTORES: só recebem, ~1 mensagem a cada 2h, no máximo 6/dia
 *      (guia de aquecimento da Green-API: dias 2–4 só recebendo, 1 msg a cada 2h).
 *      A trava (`bloqueioEnvio`) vale também para o Maturador por conta (antes só barrava
 *      quarentena/banida).
 *   2. Quem escreve para receptor é só MENTOR: fase madura/pré-oficial, score ≥ 85, nenhum ban,
 *      no máximo 3 mensagens/dia de mentoria (mensagem sem resposta pesa contra o remetente).
 *   3. PROXY OBRIGATÓRIO e exclusivo por número (decisão do usuário): números no mesmo IP
 *      conversando entre si é o padrão de "fazenda" que leva a ban em cascata. Sem proxy
 *      aplicado na Evolution, o número não entra.
 *   4. Rede pequena e estável: no máximo 3 parceiros globais por número, preferindo contas
 *      diferentes; vínculo é mantido (não sorteia parceiro novo a cada dia).
 *   5. Queda suspeita/ban de um número pausa por 72h todos os parceiros globais dele.
 *   6. Adesão por conta (opt-in com termo) + liga/desliga geral no admin. Desligar desativa
 *      todos os vínculos globais na hora.
 *   7. Tráfego global não vira contato/lead, não aciona IA e não aparece na caixa de entrada
 *      (maturadorFiltro + `whatsapp_messages.maturador_global`).
 */
import { Pool } from 'pg';
import { log } from '../logger';
import { normalizar } from './saudeNumero';
import { invalidarNumerosMaturador } from './maturadorFiltro';

export const TERMO_GLOBAL_VERSAO = 'v1-2026-10-06';
export const MAX_PARCEIROS = 3;
export const ALVO_MENTORES_POR_RECEPTOR = 2;
export const ALVO_CONVERSAS_POR_NUMERO = 2;
export const MAX_MENTORIA_DIA_MENTOR = 3;
export const MAX_RECEBIDAS_DIA_RECEPTOR = 6;
export const DIAS_SO_RECEBE_APOS_BAN = 21;

export type PapelGlobal = 'receptor' | 'conversador' | 'mentor';

export interface InfoNumero {
  fase: string | null;
  protecao_ate: string | Date | null;
  protecao_liberada_em: string | Date | null;
  bans_total: number | null;
  primeira_conexao_em: string | Date | null;
  em_revisao_desde?: string | Date | null;
}

const ms = (d: string | Date | null | undefined) => (d ? new Date(d).getTime() : NaN);
const FASES_SO_RECEBE = new Set(['perfil', 'aquecimento_1', 'quarentena', 'banida']);

/**
 * Motivo pelo qual o número NÃO pode enviar nada (null = pode). Pura — usada pelo Maturador por
 * conta, pelo global e pelos testes.
 */
export function motivoSoRecebe(n: InfoNumero | null | undefined, agora = Date.now()): string | null {
  if (!n) return null; // número sem registro de saúde: as outras travas (fase/score) cuidam
  if (n.fase === 'banida') return 'número banido';
  if (n.fase === 'quarentena') return 'número em quarentena';
  if (n.em_revisao_desde) return 'conta em revisão';
  if (n.fase && FASES_SO_RECEBE.has(n.fase)) return `número novo (fase ${n.fase}) — só recebe`;
  const prot = ms(n.protecao_ate);
  if (Number.isFinite(prot) && prot > agora && !n.protecao_liberada_em) {
    return `número novo — só recebe até ${new Date(prot).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`;
  }
  if ((n.bans_total ?? 0) >= 1) {
    const libera = ms(n.primeira_conexao_em) + DIAS_SO_RECEBE_APOS_BAN * 86_400_000;
    if (Number.isFinite(libera) && libera > agora) {
      return `número com ban no histórico — só recebe até ${new Date(libera).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`;
    }
  }
  return null;
}

export function papelGlobal(n: InfoNumero, score: number | null, agora = Date.now()): PapelGlobal | null {
  if (n.fase === 'banida' || n.fase === 'quarentena') return null;
  if (motivoSoRecebe(n, agora)) return 'receptor';
  if ((n.fase === 'madura' || n.fase === 'pre_oficial') && (score ?? 0) >= 85 && (n.bans_total ?? 0) === 0) return 'mentor';
  return 'conversador';
}

// ── Trava de envio com cache (chamada pelo motor a cada envio) ───────────────────────────────
let cacheBloqueio: { em: number; mapa: Map<string, string | null> } | null = null;

/** Motivo de bloqueio de envio da instância, ou null. Cache de 60s. */
export async function bloqueioEnvio(pool: Pool, instancia: string): Promise<string | null> {
  if (!cacheBloqueio || Date.now() - cacheBloqueio.em > 60_000) {
    const r = await pool.query(
      `SELECT a.evolution_instancia, w.fase, w.protecao_ate, w.protecao_liberada_em, w.bans_total,
              w.primeira_conexao_em, w.em_revisao_desde
       FROM agentes a JOIN whatsapp_numeros w ON w.numero = regexp_replace(a.numero_conectado, '\\D', '', 'g')
       WHERE a.evolution_instancia IS NOT NULL`
    ).catch(() => ({ rows: [] as any[] }));
    const mapa = new Map<string, string | null>();
    for (const x of r.rows) mapa.set(x.evolution_instancia, motivoSoRecebe(x));
    cacheBloqueio = { em: Date.now(), mapa };
  }
  return cacheBloqueio.mapa.get(instancia) ?? null;
}
export function invalidarCacheBloqueio(): void { cacheBloqueio = null; }

// ── Montagem da rede (pura, testável) ────────────────────────────────────────────────────────
export interface Participante { agenteId: string; userId: string; papel: PapelGlobal }
export interface Vinculo { a: string; b: string; tipo: 'conversa' | 'mentoria' } // mentoria: a = mentor, b = receptor

/**
 * Decide quais vínculos manter e quais criar. Mantém os atuais que continuam válidos (rede
 * estável), depois completa: receptor até 2 mentores; quem envia até 2 conversas; ninguém passa de
 * MAX_PARCEIROS. Prefere parceiros de contas diferentes e com menos vínculos.
 */
export function planejarVinculos(participantes: Participante[], atuais: Vinculo[]): { manter: Vinculo[]; criar: Vinculo[] } {
  const p = new Map(participantes.map(x => [x.agenteId, x]));
  const valido = (v: Vinculo) => {
    const a = p.get(v.a), b = p.get(v.b);
    if (!a || !b) return false;
    if (v.tipo === 'mentoria') return a.papel === 'mentor' && b.papel === 'receptor';
    return a.papel !== 'receptor' && b.papel !== 'receptor';
  };
  const manter = atuais.filter(valido);
  const grau = new Map<string, number>();
  const ligados = new Set<string>();
  const chave = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);
  const add = (v: Vinculo) => {
    grau.set(v.a, (grau.get(v.a) ?? 0) + 1);
    grau.set(v.b, (grau.get(v.b) ?? 0) + 1);
    ligados.add(chave(v.a, v.b));
  };
  manter.forEach(add);
  const conta = (id: string, tipo: Vinculo['tipo']) =>
    [...manter, ...criar].filter(v => v.tipo === tipo && (v.a === id || v.b === id)).length;
  const criar: Vinculo[] = [];
  const livre = (id: string) => (grau.get(id) ?? 0) < MAX_PARCEIROS;
  const ordenar = (cands: Participante[], para: Participante) =>
    cands.sort((x, y) =>
      Number(x.userId === para.userId) - Number(y.userId === para.userId)
      || (grau.get(x.agenteId) ?? 0) - (grau.get(y.agenteId) ?? 0)
      || x.agenteId.localeCompare(y.agenteId));

  // 1) Receptores ganham mentores.
  for (const r of participantes.filter(x => x.papel === 'receptor')) {
    while (conta(r.agenteId, 'mentoria') < ALVO_MENTORES_POR_RECEPTOR && livre(r.agenteId)) {
      const m = ordenar(participantes.filter(x => x.papel === 'mentor' && livre(x.agenteId)
        && !ligados.has(chave(x.agenteId, r.agenteId))), r)[0];
      if (!m) break;
      const v: Vinculo = { a: m.agenteId, b: r.agenteId, tipo: 'mentoria' };
      criar.push(v); add(v);
    }
  }
  // 2) Quem envia ganha parceiros de conversa (dois sentidos).
  const remetentes = participantes.filter(x => x.papel !== 'receptor');
  for (const s of remetentes) {
    while (conta(s.agenteId, 'conversa') < ALVO_CONVERSAS_POR_NUMERO && livre(s.agenteId)) {
      const o = ordenar(remetentes.filter(x => x.agenteId !== s.agenteId && livre(x.agenteId)
        && !ligados.has(chave(x.agenteId, s.agenteId))), s)[0];
      if (!o) break;
      const v: Vinculo = { a: s.agenteId, b: o.agenteId, tipo: 'conversa' };
      criar.push(v); add(v);
    }
  }
  return { manter, criar };
}

// ── Execução (cron de 30 min) ────────────────────────────────────────────────────────────────
export async function globalLigado(pool: Pool): Promise<boolean> {
  const r = await pool.query(`SELECT ativo FROM maturador_global_config WHERE id = 1`).catch(() => ({ rows: [] as any[] }));
  return r.rows[0]?.ativo === true;
}

/** Participantes elegíveis agora, com o motivo de quem ficou de fora (para a tela). */
export async function avaliarParticipantes(pool: Pool, userId?: string) {
  const r = await pool.query(
    `SELECT a.id, a.user_id, a.nome, a.evolution_instancia, a.numero_conectado, a.papel AS funcao,
            a.whatsapp_score, a.score_updated_at, a.proxy_aplicado_em,
            w.fase, w.protecao_ate, w.protecao_liberada_em, w.bans_total, w.primeira_conexao_em, w.em_revisao_desde,
            COALESCE(ad.ativo, false) AS aderiu
     FROM agentes a
     LEFT JOIN whatsapp_numeros w ON w.numero = regexp_replace(a.numero_conectado, '\\D', '', 'g')
     LEFT JOIN maturador_global_adesao ad ON ad.user_id = a.user_id
     WHERE a.evolution_instancia IS NOT NULL ${userId ? 'AND a.user_id = $1' : ''}
     ORDER BY a.nome`,
    userId ? [userId] : []
  );
  return r.rows.map((x: any) => {
    const score = x.score_updated_at ? x.whatsapp_score : null;
    let fora: string | null = null;
    if (!x.aderiu) fora = 'conta não aderiu ao Aquecimento Global';
    else if (!x.numero_conectado) fora = 'instância desconectada';
    else if (!x.fase) fora = 'número sem registro de saúde';
    else if (x.funcao === 'pessoal') fora = 'número pessoal não participa';
    else if (!x.proxy_aplicado_em) fora = 'sem proxy próprio configurado';
    const papel = fora ? null : papelGlobal(x, score);
    if (!fora && !papel) fora = x.fase === 'quarentena' ? 'número em quarentena' : 'número banido';
    return {
      agenteId: x.id, userId: x.user_id, nome: x.nome, instancia: x.evolution_instancia,
      numero: x.numero_conectado ? normalizar(x.numero_conectado) : null,
      papel, fora, so_recebe: motivoSoRecebe(x), score, fase: x.fase,
    };
  });
}

export async function montarRedeGlobal(pool: Pool): Promise<{ ligado: boolean; participantes: number; criados: number; desativados: number }> {
  if (!(await globalLigado(pool))) {
    const off = await pool.query(
      `UPDATE maturador_pares SET ativo = false, pausado_motivo = 'Aquecimento Global desligado', updated_at = NOW()
       WHERE global AND ativo RETURNING user_id`
    );
    off.rows.forEach((x: any) => invalidarNumerosMaturador(x.user_id));
    return { ligado: false, participantes: 0, criados: 0, desativados: off.rowCount ?? 0 };
  }
  const todos = await avaliarParticipantes(pool);
  const participantes: Participante[] = todos.filter(x => x.papel).map(x => ({ agenteId: x.agenteId, userId: x.userId, papel: x.papel! }));
  const atuaisR = await pool.query(`SELECT id, agente_a_id, agente_b_id, tipo, ativo FROM maturador_pares WHERE global`);
  const atuais: (Vinculo & { id: string; ativo: boolean })[] = atuaisR.rows.map((x: any) => ({ id: x.id, a: x.agente_a_id, b: x.agente_b_id, tipo: x.tipo, ativo: x.ativo }));
  const { manter, criar } = planejarVinculos(participantes, atuais.filter(v => v.ativo));
  const manterIds = new Set((manter as any[]).map(v => v.id));

  // Desativa o que deixou de valer (papel mudou, saiu da adesão, perdeu proxy, caiu…).
  let desativados = 0;
  for (const v of atuais.filter(v => v.ativo && !manterIds.has(v.id))) {
    const r = await pool.query(
      `UPDATE maturador_pares SET ativo = false, pausado_motivo = 'Saiu do Aquecimento Global (papel, adesão ou proxy mudou)', updated_at = NOW()
       WHERE id = $1 RETURNING user_id`, [v.id]);
    if (r.rowCount) { desativados++; invalidarNumerosMaturador(r.rows[0].user_id); }
  }
  // Cria (ou reativa) os vínculos novos. Primeira mensagem espalhada nas próximas 1–3h.
  const dono = new Map(participantes.map(x => [x.agenteId, x.userId]));
  let criados = 0;
  for (const v of criar) {
    const r = await pool.query(
      `INSERT INTO maturador_pares (user_id, agente_a_id, agente_b_id, ativo, global, tipo, data_inicio, hora_inicio, hora_fim,
                                    proxima_mensagem_em, ultimo_remetente)
       VALUES ($1, $2, $3, true, true, $4, NOW(), 8, 21, NOW() + (($5)::text || ' minutes')::interval, 'b')
       ON CONFLICT (agente_a_id, agente_b_id) DO UPDATE SET ativo = true, global = true, tipo = EXCLUDED.tipo,
         pausado_motivo = NULL, falhas_consecutivas = 0, proxima_mensagem_em = EXCLUDED.proxima_mensagem_em, updated_at = NOW()
       WHERE maturador_pares.banido_em IS NULL AND maturador_pares.global -- nunca converte par da conta em global
       RETURNING user_id`,
      [dono.get(v.a), v.a, v.b, v.tipo, String(60 + Math.floor(Math.random() * 120))]
    ).catch(err => { log.warn('MATURADOR_GLOBAL', 'Falha ao criar vínculo', { err: err?.message }); return { rowCount: 0, rows: [] as any[] }; });
    if (r.rowCount) {
      criados++;
      invalidarNumerosMaturador(r.rows[0].user_id);
      invalidarNumerosMaturador(dono.get(v.b)!);
    }
  }
  // Queda suspeita/ban nas últimas 72h: todos os parceiros globais do número param 72h.
  // (os vínculos do próprio número caído já são desativados por aoQuedaSaude; aqui são os OUTROS
  // vínculos de quem conversava com ele — risco de ban em cascata por associação).
  await pool.query(
    `WITH caidos AS (
       SELECT ag.id, MAX(e.criado_em) AS em
       FROM whatsapp_eventos_saude e JOIN agentes ag ON regexp_replace(ag.numero_conectado, '\\D', '', 'g') = e.numero
       WHERE e.tipo IN ('ban_suspeito', 'ban_confirmado') AND e.criado_em >= NOW() - INTERVAL '72 hours'
       GROUP BY ag.id),
     parceiros AS (
       SELECT CASE WHEN mp.agente_a_id = c.id THEN mp.agente_b_id ELSE mp.agente_a_id END AS id, MAX(c.em) AS em
       FROM maturador_pares mp JOIN caidos c ON c.id IN (mp.agente_a_id, mp.agente_b_id)
       WHERE mp.global GROUP BY 1)
     UPDATE maturador_pares mp SET proxima_mensagem_em = p.em + INTERVAL '72 hours',
            pausado_motivo = 'Parceiro teve queda suspeita — pausa de 72h por segurança', updated_at = NOW()
     FROM parceiros p
     WHERE mp.global AND mp.ativo AND p.id IN (mp.agente_a_id, mp.agente_b_id)
       AND COALESCE(mp.proxima_mensagem_em, NOW()) < p.em + INTERVAL '72 hours'`
  ).catch(err => log.warn('MATURADOR_GLOBAL', 'Falha ao pausar parceiros de número caído', { err: err?.message }));

  if (criados || desativados) log.info('MATURADOR_GLOBAL', 'Rede atualizada', { participantes: participantes.length, criados, desativados });
  return { ligado: true, participantes: participantes.length, criados, desativados };
}
