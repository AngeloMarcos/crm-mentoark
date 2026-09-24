import { Pool } from 'pg';
import { log } from '../logger';
import { consultarConvite, instanciaConectada, ClienteEvolution } from './evolutionGrupos';
import { CriteriosNicho, mesclarPesos, pontuarGrupo, PesosScore } from './scoring';

/** Instância usada SÓ para ler convites. Etapa 3 troca isto pelo papel `prospeccao` das instâncias. */
export function configLeitura(): { cliente: ClienteEvolution; instancia: string } | null {
  const base = process.env.EVOLUTION_API_URL;
  const apiKey = process.env.EVOLUTION_API_KEY;
  const instancia = process.env.RADAR_EVOLUTION_INSTANCE;
  if (!base || !apiKey || !instancia) return null;
  return { cliente: { base, apiKey }, instancia };
}

export class ValidacaoIndisponivel extends Error {}

let cacheConexao: { em: number; ok: boolean; instancia: string } | null = null;
async function conectada(cfg: NonNullable<ReturnType<typeof configLeitura>>): Promise<boolean> {
  if (cacheConexao && cacheConexao.instancia === cfg.instancia && Date.now() - cacheConexao.em < 60_000) return cacheConexao.ok;
  const ok = await instanciaConectada(cfg.cliente, cfg.instancia);
  cacheConexao = { em: Date.now(), ok, instancia: cfg.instancia };
  return ok;
}

export async function carregarPesos(pool: Pool, userId: string): Promise<PesosScore> {
  const r = await pool.query(`SELECT pesos FROM radar_score_config WHERE user_id = $1`, [userId]);
  return mesclarPesos(r.rows[0]?.pesos);
}

async function nichoDoGrupo(pool: Pool, userId: string, nichoId: string | null): Promise<CriteriosNicho | null> {
  if (!nichoId) return null;
  const r = await pool.query(
    `SELECT palavras_positivas, palavras_negativas, regioes FROM radar_nichos WHERE id = $1 AND user_id = $2`, [nichoId, userId]);
  return r.rows[0] ?? null;
}

/** Recalcula e grava o score de um grupo já validado. Puro sobre dados do banco; não chama a Evolution. */
export async function pontuarEGravar(pool: Pool, g: any, pesos: PesosScore, nicho: CriteriosNicho | null): Promise<void> {
  const r = pontuarGrupo({ nome: g.nome, descricao: g.descricao, participantes: g.participantes }, nicho, pesos);
  await pool.query(
    `UPDATE radar_grupos SET score = $2, score_motivos = $3::jsonb, avaliado_em = now(), updated_at = now() WHERE id = $1`,
    [g.id, r.score, JSON.stringify(r.motivos)]);
}

export async function pontuarTodos(pool: Pool, userId: string): Promise<number> {
  const pesos = await carregarPesos(pool, userId);
  const { rows } = await pool.query(
    `SELECT * FROM radar_grupos WHERE user_id = $1 AND validado_em IS NOT NULL AND link_ativo = true`, [userId]);
  const cacheNichos = new Map<string, CriteriosNicho | null>();
  for (const g of rows) {
    const k = g.nicho_id ?? '';
    if (!cacheNichos.has(k)) cacheNichos.set(k, await nichoDoGrupo(pool, userId, g.nicho_id));
    await pontuarEGravar(pool, g, pesos, cacheNichos.get(k)!);
  }
  return rows.length;
}

/**
 * Lê o convite (sem entrar) e grava nome, descrição, participantes e score.
 * Lança ValidacaoIndisponivel quando o problema é da instância/Evolution: o job tenta de novo depois
 * e o grupo NÃO é marcado como inválido por isso.
 */
export async function validarGrupo(pool: Pool, grupoId: string): Promise<'ok' | 'invalido' | 'ignorado'> {
  const { rows } = await pool.query(`SELECT * FROM radar_grupos WHERE id = $1`, [grupoId]);
  const g = rows[0];
  if (!g || g.plataforma !== 'whatsapp') return 'ignorado';
  if (['rejeitado'].includes(g.status)) return 'ignorado';

  const cfg = configLeitura();
  if (!cfg) throw new ValidacaoIndisponivel('Nenhuma instância configurada para leitura de convites (RADAR_EVOLUTION_INSTANCE)');
  if (!(await conectada(cfg))) throw new ValidacaoIndisponivel(`Instância ${cfg.instancia} não está conectada`);

  const res = await consultarConvite(cfg.cliente, cfg.instancia, g.codigo_convite);
  if (res.tipo === 'indisponivel') {
    await pool.query(`UPDATE radar_grupos SET erro_validacao = $2, updated_at = now() WHERE id = $1`, [g.id, res.motivo.slice(0, 300)]);
    throw new ValidacaoIndisponivel(res.motivo);
  }
  if (res.tipo === 'invalido') {
    await pool.query(
      `UPDATE radar_grupos SET status = 'invalido', link_ativo = false, erro_validacao = $2, validado_em = now(), updated_at = now() WHERE id = $1`,
      [g.id, res.motivo.slice(0, 300)]);
    log.info('RADAR', 'convite inválido', { grupoId: g.id });
    return 'invalido';
  }

  const i = res.info;
  const upd = await pool.query(
    `UPDATE radar_grupos SET jid = $2, nome = $3, descricao = $4, participantes = $5, criado_no_whatsapp = $6,
            somente_admins = $7, aprovacao_admin = $8, link_ativo = true, erro_validacao = NULL, validado_em = now(),
            status = CASE WHEN status = 'invalido' THEN 'descoberto' ELSE status END, updated_at = now()
      WHERE id = $1 RETURNING *`,
    [g.id, i.jid, i.nome, i.descricao, i.participantes, i.criadoEm, i.somenteAdmins, i.aprovacaoAdmin]);
  const pesos = await carregarPesos(pool, g.user_id);
  await pontuarEGravar(pool, upd.rows[0], pesos, await nichoDoGrupo(pool, g.user_id, g.nicho_id));
  return 'ok';
}
