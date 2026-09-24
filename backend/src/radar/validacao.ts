import { Pool } from 'pg';
import { log } from '../logger';
import { consultarConvite, instanciaConectada, ClienteEvolution } from './evolutionGrupos';
import { buscarPaginaConvite } from './paginaConvite';
import { avaliarAderencia, CriteriosNicho, mesclarPesos, pontuarGrupo, PesosScore } from './scoring';

/** Instância usada SÓ para ler convites (participantes). Etapa 3 troca isto pelo papel `prospeccao`. */
export function configLeitura(): { cliente: ClienteEvolution; instancia: string } | null {
  const base = process.env.EVOLUTION_API_URL;
  const apiKey = process.env.EVOLUTION_API_KEY;
  const instancia = process.env.RADAR_EVOLUTION_INSTANCE;
  if (!base || !apiKey || !instancia) return null;
  return { cliente: { base, apiKey }, instancia };
}

export class ValidacaoIndisponivel extends Error {}

// ── Pausas persistentes (bloqueio/limite do provedor de busca ou do WhatsApp) ──────────────────────
export async function pausaAtiva(pool: Pool, recurso: string): Promise<{ ate: Date; motivo: string } | null> {
  const r = await pool.query(`SELECT ate, motivo FROM radar_pausas WHERE recurso = $1 AND ate > now()`, [recurso]);
  return r.rows[0] ? { ate: new Date(r.rows[0].ate), motivo: r.rows[0].motivo ?? '' } : null;
}

export async function pausar(pool: Pool, recurso: string, minutos: number, motivo: string): Promise<void> {
  await pool.query(
    `INSERT INTO radar_pausas (recurso, ate, motivo) VALUES ($1, now() + make_interval(mins => $2), $3)
     ON CONFLICT (recurso) DO UPDATE SET ate = EXCLUDED.ate, motivo = EXCLUDED.motivo, updated_at = now()`,
    [recurso, minutos, motivo.slice(0, 300)]);
  log.warn('RADAR', 'recurso pausado por bloqueio/limite', { recurso, minutos, motivo });
}

export function textoPausa(p: { ate: Date; motivo: string }): string {
  const hora = p.ate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  return `pausado até ${hora} — ${p.motivo}`;
}

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

type NichoCompleto = CriteriosNicho & { termos_busca: string[] };

async function nichoDoGrupo(pool: Pool, userId: string, nichoId: string | null): Promise<NichoCompleto | null> {
  if (!nichoId) return null;
  const r = await pool.query(
    `SELECT termos_busca, palavras_positivas, palavras_negativas, regioes FROM radar_nichos WHERE id = $1 AND user_id = $2`, [nichoId, userId]);
  return r.rows[0] ?? null;
}

/** O termo usado na busca que achou o grupo ("corretores" em `corretores "chat.whatsapp.com" São Paulo`). */
export function termoDaConsulta(consulta: string | null): string[] {
  if (!consulta) return [];
  const t = consulta.split(/\s"(?:chat\.whatsapp\.com|t\.me)"/)[0].trim();
  return t ? [t] : [];
}

/**
 * Recalcula score e aderência de um grupo e grava. Se a aderência é baixa e a opção estiver ligada,
 * descarta sozinho (status `rejeitado`, motivo registrado). O descarte é reversível: se depois o grupo
 * passar a condizer (nicho editado), volta a `descoberto`; aprovar/rejeitar manualmente sempre vale.
 */
export async function pontuarEGravar(pool: Pool, g: any, pesos: PesosScore, nicho: NichoCompleto | null): Promise<void> {
  const r = pontuarGrupo({ nome: g.nome, descricao: g.descricao, participantes: g.participantes, pctComTelefone: g.pct_com_telefone === null || g.pct_com_telefone === undefined ? null : Number(g.pct_com_telefone) }, nicho, pesos);
  const ad = avaliarAderencia({ nome: g.nome, descricao: g.descricao }, nicho, termoDaConsulta(g.consulta));

  let status = g.status as string;
  let descarte: string | null | undefined; // undefined = não mexe
  if (ad.nivel === 'baixa' && pesos.auto_rejeitar_baixa_aderencia >= 1 && status === 'descoberto') {
    status = 'rejeitado';
    descarte = `baixa_aderencia: ${ad.motivo}`;
  } else if (ad.nivel !== 'baixa' && status === 'rejeitado' && String(g.motivo_descarte ?? '').startsWith('baixa_aderencia')) {
    status = 'descoberto';
    descarte = null;
  }

  await pool.query(
    `UPDATE radar_grupos SET score = $2, score_motivos = $3::jsonb, avaliado_em = now(),
            aderencia = $4, aderencia_motivo = $5, status = $6,
            motivo_descarte = CASE WHEN $7::boolean THEN $8 ELSE motivo_descarte END, updated_at = now()
      WHERE id = $1`,
    [g.id, r.score, JSON.stringify(r.motivos), ad.nivel, ad.motivo, status, descarte !== undefined, descarte ?? null]);
}

/** Normaliza nome de grupo para comparar ("Corretores SP " == "corretores sp"). */
export const chaveNome = (n: string | null | undefined) => (n ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Liga o catálogo às importações de grupo que já aconteceram (mesmo jid, ou mesmo nome): marca o grupo como
 * "já importado" (não é lead novo) e traz a % de participantes com telefone visível, que entra no score.
 * Só preenche campos do Radar; não mexe em contatos nem em listas.
 */
export async function vincularImportados(pool: Pool, userId: string): Promise<number> {
  const imp = await pool.query(
    `SELECT DISTINCT ON (group_jid) group_jid, nome, lista_id, pct_com_telefone, created_at
       FROM grupo_importacoes WHERE user_id = $1 ORDER BY group_jid, created_at DESC`, [userId]);
  if (!imp.rows.length) return 0;
  const porJid = new Map<string, any>();
  const porNome = new Map<string, any>();
  for (const i of imp.rows) { porJid.set(i.group_jid, i); const k = chaveNome(i.nome); if (k) porNome.set(k, i); }

  const gr = await pool.query(
    `SELECT * FROM radar_grupos WHERE user_id = $1 AND plataforma = 'whatsapp' AND (jid IS NOT NULL OR nome IS NOT NULL)`, [userId]);
  const pesos = await carregarPesos(pool, userId);
  const cache = new Map<string, NichoCompleto | null>();
  let n = 0;
  for (const g of gr.rows) {
    const i = (g.jid && porJid.get(g.jid)) || porNome.get(chaveNome(g.nome));
    if (!i) continue;
    const pct = i.pct_com_telefone === null ? null : Number(i.pct_com_telefone);
    const mudou = g.importado_lista_id !== i.lista_id || Number(g.pct_com_telefone ?? -1) !== Number(pct ?? -1);
    if (!mudou) continue;
    const upd = await pool.query(
      `UPDATE radar_grupos SET importado_lista_id = $2, importado_em = $3, pct_com_telefone = $4, updated_at = now() WHERE id = $1 RETURNING *`,
      [g.id, i.lista_id, i.created_at, pct]);
    const k = g.nicho_id ?? '';
    if (!cache.has(k)) cache.set(k, await nichoDoGrupo(pool, userId, g.nicho_id));
    if (upd.rows[0].nome) await pontuarEGravar(pool, upd.rows[0], pesos, cache.get(k)!);
    n++;
  }
  return n;
}

export async function pontuarTodos(pool: Pool, userId: string): Promise<number> {
  const pesos = await carregarPesos(pool, userId);
  // Inclui grupos só com nome (verificação pública) e os lidos pela Evolution; ignora inválidos.
  const { rows } = await pool.query(
    `SELECT * FROM radar_grupos WHERE user_id = $1 AND nome IS NOT NULL AND status <> 'invalido'`, [userId]);
  const cacheNichos = new Map<string, NichoCompleto | null>();
  for (const g of rows) {
    const k = g.nicho_id ?? '';
    if (!cacheNichos.has(k)) cacheNichos.set(k, await nichoDoGrupo(pool, userId, g.nicho_id));
    await pontuarEGravar(pool, g, pesos, cacheNichos.get(k)!);
  }
  return rows.length;
}

const dormir = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Verifica o link pela página pública do WhatsApp (sem instância, sem entrar). Link morto → `invalido`
 * (descartado); link vivo → grava o nome e avalia score/aderência. Bloqueio do WhatsApp pausa a verificação.
 */
export async function verificarLinkPublico(pool: Pool, grupoId: string): Promise<'ok' | 'invalido' | 'ignorado'> {
  const { rows } = await pool.query(`SELECT * FROM radar_grupos WHERE id = $1`, [grupoId]);
  const g = rows[0];
  if (!g || g.plataforma !== 'whatsapp' || g.status === 'rejeitado') return 'ignorado';

  const p = await pausaAtiva(pool, 'link_publico');
  if (p) throw new ValidacaoIndisponivel(`Verificação de links ${textoPausa(p)}`);

  await dormir(Math.floor(Math.random() * 1500)); // jitter: sem cadência de robô
  const res = await buscarPaginaConvite(g.codigo_convite);

  if (res.tipo === 'indisponivel') {
    await pool.query(`UPDATE radar_grupos SET erro_validacao = $2, updated_at = now() WHERE id = $1`, [g.id, res.motivo.slice(0, 300)]);
    if (res.bloqueio) await pausar(pool, 'link_publico', Number(process.env.RADAR_LINK_PAUSA_MIN) || 30, res.motivo);
    throw new ValidacaoIndisponivel(res.motivo);
  }
  if (res.tipo === 'invalido') {
    await pool.query(
      `UPDATE radar_grupos SET status = 'invalido', link_ativo = false, motivo_descarte = 'link_invalido',
              erro_validacao = $2, link_verificado_em = now(), updated_at = now() WHERE id = $1`,
      [g.id, res.motivo.slice(0, 300)]);
    return 'invalido';
  }

  const upd = await pool.query(
    `UPDATE radar_grupos SET nome = $2, link_ativo = true, erro_validacao = NULL, link_verificado_em = now(),
            status = CASE WHEN status = 'invalido' THEN 'descoberto' ELSE status END,
            motivo_descarte = CASE WHEN status = 'invalido' THEN NULL ELSE motivo_descarte END, updated_at = now()
      WHERE id = $1 RETURNING *`, [g.id, res.nome]);
  const pesos = await carregarPesos(pool, g.user_id);
  await pontuarEGravar(pool, upd.rows[0], pesos, await nichoDoGrupo(pool, g.user_id, g.nicho_id));
  await vincularImportados(pool, g.user_id).catch(() => {});
  return 'ok';
}

/**
 * Lê o convite pela Evolution (participantes, descrição, criação) — exige instância conectada.
 * Lança ValidacaoIndisponivel quando o problema é da instância/Evolution: o grupo NÃO é marcado inválido.
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
      `UPDATE radar_grupos SET status = 'invalido', link_ativo = false, motivo_descarte = 'link_invalido',
              erro_validacao = $2, validado_em = now(), updated_at = now() WHERE id = $1`,
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
