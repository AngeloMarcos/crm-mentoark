/**
 * maturadorGrupos.ts — Sprint 11 do maturador v5 (2026-10-23, modelo ChipFlow — ver
 * docs/maturador/SPRINTS_MATURADOR_V5.md): grupos do aquecimento.
 *
 *   - "Seus grupos": até 5 convites por conta. Só os chips DA CONTA entram.
 *   - Entrada aos poucos: cada chip entra em no máximo 2 grupos por dia, com pelo menos 2 h entre
 *     uma entrada e outra, e só a partir do Aquecimento 2 com o controle "Grupos" ligado. No
 *     máximo 1 entrada por conta a cada rodada (10 min), com sorteio para não virar relógio.
 *   - Antes de entrar, o convite é lido (mesmo código do Radar): comunidade é descartada, grupo
 *     cheio não entra, link revogado vira "inválido". Erro de instância/rede/429 NUNCA marca o
 *     grupo como inválido — tenta de novo depois.
 *   - Conversa no grupo: com 2+ chips da conta dentro, eles conversam entre si em turnos (mesmo
 *     roteiro por IA da Sprint 8, ou banco de temas), sessões curtas e pausa longa; teto por grupo e
 *     por chip por dia. Chip que "só recebe" entra mas não fala.
 *   - Cada mensagem enviada é registrada no filtro do maturador (nunca vira contato/IA/lead).
 */
import { Pool } from 'pg';
import { log } from '../logger';
import { evolutionFetch, sanitizeEvolutionUrl } from '../utils/resilientFetch';
import { consultarConvite } from '../radar/evolutionGrupos';
import { aceitarConvite, confirmarParticipacao, codigoDoConvite } from '../radar/entrar';
import { saudePorInstancia } from './saudeNumero';
import { bloqueioEnvio, bloqueioEnvioGeral } from './maturadorGlobal';
import { controlesPorAgente, CONTROLES_PADRAO, dormindo } from './maturadorControles';
import { registrarIdMaturador } from './maturadorFiltro';
import { gerarRoteiro, humanizar, personaDoChip } from './maturadorIA';
import { TEMAS, aplicarVariacao, sortearTema } from './maturadorDialogos';

export const MAX_GRUPOS_POR_CONTA = 5;
export const MAX_ENTRADAS_DIA_CHIP = 2;
export const HORAS_ENTRE_ENTRADAS = 2;
export const TETO_PARTICIPANTES = 1024;
export const MAX_MSGS_DIA_GRUPO = 15;
export const MAX_MSGS_DIA_CHIP_GRUPOS = 6;
const TEMA_IA = -1;
const TZ = 'America/Sao_Paulo';

const FASES_GRUPO = new Set(['aquecimento_2', 'aquecimento_3', 'pre_oficial', 'madura']);
/** Grupos a partir do Aquecimento 2 (entrar em grupo cedo demais é sinal forte de chip de spam). */
export function faseEntraEmGrupo(fase: string | null | undefined): boolean {
  return !!fase && FASES_GRUPO.has(fase);
}

function horaBrasilia(): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
}
const rand = (min: number, max: number) => min + Math.random() * (max - min);

// ── Cadastro ────────────────────────────────────────────────────────────────────────────────
export async function adicionarGrupo(pool: Pool, userId: string, link: string): Promise<{ erro?: string; grupo?: any }> {
  const codigo = codigoDoConvite(String(link || ''));
  if (codigo.length < 10) return { erro: 'Cole o link de convite do grupo (https://chat.whatsapp.com/...)' };
  const total = (await pool.query(`SELECT COUNT(*)::int AS n FROM maturador_grupos WHERE user_id = $1`, [userId])).rows[0].n;
  if (total >= MAX_GRUPOS_POR_CONTA) return { erro: `Máximo de ${MAX_GRUPOS_POR_CONTA} grupos por conta` };
  const r = await pool.query(
    `INSERT INTO maturador_grupos (user_id, codigo) VALUES ($1, $2) ON CONFLICT (user_id, codigo) DO NOTHING RETURNING *`,
    [userId, codigo]);
  if (!r.rowCount) return { erro: 'Esse grupo já está na lista' };
  return { grupo: r.rows[0] };
}

export async function removerGrupo(pool: Pool, userId: string, grupoId: string): Promise<boolean> {
  return ((await pool.query(`DELETE FROM maturador_grupos WHERE id = $1 AND user_id = $2`, [grupoId, userId])).rowCount ?? 0) > 0;
}

export async function listarGrupos(pool: Pool, userId: string): Promise<any[]> {
  const g = await pool.query(`SELECT * FROM maturador_grupos WHERE user_id = $1 ORDER BY created_at`, [userId]);
  const m = await pool.query(
    `SELECT m.grupo_id, m.agente_id, m.estado, m.erro, m.tentativa_em, a.nome
     FROM maturador_grupo_membros m JOIN agentes a ON a.id = m.agente_id
     WHERE m.grupo_id = ANY($1::uuid[])`, [g.rows.map((x: any) => x.id)]);
  const hoje = await pool.query(
    `SELECT grupo_id, COUNT(*)::int AS n FROM maturador_grupo_mensagens
     WHERE grupo_id = ANY($1::uuid[]) AND (created_at AT TIME ZONE '${TZ}')::date = (NOW() AT TIME ZONE '${TZ}')::date
     GROUP BY grupo_id`, [g.rows.map((x: any) => x.id)]);
  const msgs = new Map(hoje.rows.map((x: any) => [x.grupo_id, x.n]));
  return g.rows.map((x: any) => ({
    id: x.id, codigo: x.codigo, link: `https://chat.whatsapp.com/${x.codigo}`, nome: x.nome, participantes: x.participantes,
    estado: x.estado, motivo: x.motivo, verificado_em: x.verificado_em, mensagens_hoje: msgs.get(x.id) ?? 0,
    membros: m.rows.filter((y: any) => y.grupo_id === x.id).map((y: any) => ({ agente_id: y.agente_id, nome: y.nome, estado: y.estado, erro: y.erro, em: y.tentativa_em })),
  }));
}

// ── Quem pode entrar / falar ────────────────────────────────────────────────────────────────
type Chip = { id: string; user_id: string; instancia: string; url: string; key: string; fase: string | null };

async function chipsDaConta(pool: Pool, userId: string): Promise<Chip[]> {
  const r = await pool.query(
    `SELECT id, user_id, evolution_instancia AS instancia, evolution_server_url AS url, evolution_api_key AS key
     FROM agentes WHERE user_id = $1 AND evolution_instancia IS NOT NULL AND evolution_server_url IS NOT NULL`, [userId]);
  const saude = await saudePorInstancia(pool);
  return r.rows.map((x: any) => ({ ...x, fase: saude.get(x.instancia)?.fase ?? null }));
}

/** Pode ENTRAR em grupo: fase Aq2+, controle ligado, sem trava dura (ban/quarentena/revisão). */
async function podeEntrar(pool: Pool, c: Chip, ctrls: Map<string, any>): Promise<boolean> {
  if (!(ctrls.get(c.id) ?? CONTROLES_PADRAO).grupos) return false;
  if (!faseEntraEmGrupo(c.fase)) return false;
  return !(await bloqueioEnvioGeral(pool, c.instancia));
}

/** Pode FALAR no grupo: tudo acima e não estar no modo "só recebe". */
async function podeFalar(pool: Pool, c: Chip, ctrls: Map<string, any>): Promise<boolean> {
  return (await podeEntrar(pool, c, ctrls)) && !(await bloqueioEnvio(pool, c.instancia));
}

/** Entradas que o chip já tentou hoje e há quanto tempo foi a última (horas). */
export function liberadoParaEntrar(tentativas: { em: Date }[], agora = Date.now()): boolean {
  const hoje = new Date(agora).toLocaleDateString('en-CA', { timeZone: TZ });
  const doDia = tentativas.filter(t => new Date(t.em).toLocaleDateString('en-CA', { timeZone: TZ }) === hoje);
  if (doDia.length >= MAX_ENTRADAS_DIA_CHIP) return false;
  const ultima = Math.max(0, ...tentativas.map(t => new Date(t.em).getTime()));
  return agora - ultima >= HORAS_ENTRE_ENTRADAS * 3_600_000;
}

// ── Entrada ─────────────────────────────────────────────────────────────────────────────────
async function tentarUmaEntrada(pool: Pool, userId: string, ctrls: Map<string, any>): Promise<string | null> {
  const grupos = (await pool.query(
    `SELECT * FROM maturador_grupos WHERE user_id = $1 AND estado IN ('pendente', 'ativo') ORDER BY created_at`, [userId])).rows;
  if (!grupos.length) return null;
  const membros = (await pool.query(
    `SELECT grupo_id, agente_id, estado, tentativa_em FROM maturador_grupo_membros WHERE grupo_id = ANY($1::uuid[])`,
    [grupos.map((g: any) => g.id)])).rows;
  const chips = await chipsDaConta(pool, userId);

  for (const chip of chips.sort(() => Math.random() - 0.5)) {
    if (!(await podeEntrar(pool, chip, ctrls))) continue;
    const meus = membros.filter((m: any) => m.agente_id === chip.id);
    if (!liberadoParaEntrar(meus.map((m: any) => ({ em: m.tentativa_em })))) continue;
    // Grupo em que o chip ainda não está (falha antiga, > 24 h, pode tentar de novo).
    const alvo = grupos.find((g: any) => {
      const m = meus.find((x: any) => x.grupo_id === g.id);
      return !m || (m.estado === 'falhou' && Date.now() - new Date(m.tentativa_em).getTime() > 24 * 3_600_000);
    });
    if (!alvo) continue;
    const cli = { base: sanitizeEvolutionUrl(chip.url), apiKey: chip.key };

    // 1) Lê o convite (uma vez por grupo, ou de novo se ainda não leu com sucesso).
    if (!alvo.verificado_em) {
      const c = await consultarConvite(cli, chip.instancia, alvo.codigo);
      if (c.tipo === 'indisponivel') { log.info('MATURADOR_GRUPOS', 'Convite indisponível agora — tenta depois', { grupo: alvo.id, motivo: c.motivo }); return null; }
      if (c.tipo === 'invalido') {
        await pool.query(`UPDATE maturador_grupos SET estado = 'invalido', motivo = $2, verificado_em = NOW() WHERE id = $1`, [alvo.id, 'Link revogado ou expirado']);
        return `grupo ${alvo.id} inválido`;
      }
      const i = c.info;
      const estado = i.comunidade ? 'comunidade' : (i.participantes ?? 0) >= TETO_PARTICIPANTES ? 'cheio' : 'pendente';
      const motivo = i.comunidade ? 'É uma comunidade, não um grupo' : estado === 'cheio' ? 'Grupo cheio' : null;
      await pool.query(
        `UPDATE maturador_grupos SET nome = $2, participantes = $3, group_jid = $4, estado = $5, motivo = $6, verificado_em = NOW() WHERE id = $1`,
        [alvo.id, i.nome, i.participantes, i.jid, estado, motivo]);
      if (estado !== 'pendente') return `grupo ${alvo.id} descartado: ${motivo}`;
    }

    // 2) Entra.
    const r = await aceitarConvite(cli, chip.instancia, alvo.codigo);
    if (r.tipo === 'indisponivel') {
      await pool.query(
        `INSERT INTO maturador_grupo_membros (grupo_id, agente_id, estado, erro, tentativa_em) VALUES ($1, $2, 'falhou', $3, NOW())
         ON CONFLICT (grupo_id, agente_id) DO UPDATE SET estado = 'falhou', erro = $3, tentativa_em = NOW()`,
        [alvo.id, chip.id, r.motivo.slice(0, 200)]);
      return `chip ${chip.instancia} não entrou: ${r.motivo}`;
    }
    if (r.tipo === 'invalido') {
      await pool.query(`UPDATE maturador_grupos SET estado = 'invalido', motivo = $2 WHERE id = $1`, [alvo.id, 'Link revogado ou expirado']);
      return `grupo ${alvo.id} inválido`;
    }
    const conf = await confirmarParticipacao(cli.base, chip.key, chip.instancia, r.groupJid);
    const estadoMembro = conf === 'aguardando_aprovacao' ? 'aguardando_aprovacao' : 'entrou';
    await pool.query(
      `INSERT INTO maturador_grupo_membros (grupo_id, agente_id, estado, erro, tentativa_em) VALUES ($1, $2, $3, NULL, NOW())
       ON CONFLICT (grupo_id, agente_id) DO UPDATE SET estado = $3, erro = NULL, tentativa_em = NOW()`,
      [alvo.id, chip.id, estadoMembro]);
    await pool.query(`UPDATE maturador_grupos SET estado = 'ativo', group_jid = COALESCE(group_jid, $2), motivo = NULL WHERE id = $1`, [alvo.id, r.groupJid]);
    log.info('MATURADOR_GRUPOS', 'Chip entrou em grupo do aquecimento', { grupo: alvo.id, instancia: chip.instancia, estado: estadoMembro });
    return `chip ${chip.instancia} → ${estadoMembro}`;
  }
  return null;
}

// ── Conversa no grupo ───────────────────────────────────────────────────────────────────────
function delayDigitacao(texto: string): number {
  return Math.min(12000, 1500 + texto.length * rand(55, 90));
}

async function conversarNoGrupo(pool: Pool, g: any, ctrls: Map<string, any>): Promise<string | null> {
  if (!g.group_jid || (g.proxima_em && new Date(g.proxima_em).getTime() > Date.now())) return null;
  const hojeSQL = `(created_at AT TIME ZONE '${TZ}')::date = (NOW() AT TIME ZONE '${TZ}')::date`;
  const doGrupo = (await pool.query(`SELECT COUNT(*)::int AS n FROM maturador_grupo_mensagens WHERE grupo_id = $1 AND ${hojeSQL}`, [g.id])).rows[0].n;
  if (doGrupo >= MAX_MSGS_DIA_GRUPO) return null;

  const membros = (await pool.query(
    `SELECT a.id, a.user_id, a.evolution_instancia AS instancia, a.evolution_server_url AS url, a.evolution_api_key AS key
     FROM maturador_grupo_membros m JOIN agentes a ON a.id = m.agente_id
     WHERE m.grupo_id = $1 AND m.estado = 'entrou'`, [g.id])).rows;
  const saude = await saudePorInstancia(pool);
  const falantes: Chip[] = [];
  for (const x of membros) {
    const c = { ...x, fase: saude.get(x.instancia)?.fase ?? null };
    if (!(await podeFalar(pool, c, ctrls))) continue;
    const n = (await pool.query(`SELECT COUNT(*)::int AS n FROM maturador_grupo_mensagens WHERE agente_id = $1 AND ${hojeSQL}`, [c.id])).rows[0].n;
    if (n < MAX_MSGS_DIA_CHIP_GRUPOS) falantes.push(c);
  }
  // Conversa só faz sentido com 2+ chips da conta dentro do grupo.
  if (falantes.length < 2) return null;

  // Turno: nunca o mesmo chip duas vezes seguidas.
  const opcoes = falantes.filter(f => f.id !== g.ultimo_agente);
  const de = opcoes[Math.floor(Math.random() * opcoes.length)];
  const outro = falantes.find(f => f.id !== de.id)!;

  let tema: number | null = g.tema_atual;
  let linha: number = g.linha_atual ?? 0;
  let roteiro = tema === TEMA_IA ? g.roteiro_ia : null;
  const linhas = () => (tema === TEMA_IA ? roteiro?.linhas : tema !== null && tema >= 0 ? TEMAS[tema] : null) as string[] | null;
  let novo = false;
  if (!linhas() || linha >= linhas()!.length) {
    roteiro = await gerarRoteiro(pool, { userId: de.user_id, agenteQueAbre: de.id, agenteQueResponde: outro.id, assuntoAnterior: g.roteiro_ia?.assunto ?? null });
    tema = roteiro ? TEMA_IA : sortearTema(g.tema_atual === TEMA_IA ? null : g.tema_atual);
    linha = 0;
    novo = !!roteiro;
  }
  const fala = linhas()![linha];
  const texto = tema === TEMA_IA ? humanizar(fala, personaDoChip(de.id)) : aplicarVariacao(fala);

  const resp = await evolutionFetch(`${sanitizeEvolutionUrl(de.url)}/message/sendText/${de.instancia}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: de.key },
    body: JSON.stringify({ number: g.group_jid, text: texto, delay: delayDigitacao(texto) }),
  }).catch(() => null);
  if (!resp?.ok) {
    await pool.query(`UPDATE maturador_grupos SET proxima_em = NOW() + INTERVAL '60 minutes' WHERE id = $1`, [g.id]);
    return `falha ao falar no grupo ${g.id} (${resp?.status ?? 'rede'})`;
  }
  const id: string | null = ((await resp.json().catch(() => null)) as any)?.key?.id || null;
  registrarIdMaturador(id);
  await pool.query(
    `INSERT INTO maturador_grupo_mensagens (grupo_id, agente_id, message_id, texto) VALUES ($1, $2, $3, $4)`, [g.id, de.id, id, texto]);

  linha++;
  const acabou = linha >= linhas()!.length;
  // Sessão: 1–4 min entre falas; acabou o assunto, o grupo descansa 2–5 h.
  const proximaMin = acabou ? rand(120, 300) : rand(1, 4);
  await pool.query(
    `UPDATE maturador_grupos SET tema_atual = $2, linha_atual = $3, ultimo_agente = $4,
       proxima_em = NOW() + ($5 || ' minutes')::interval,
       roteiro_ia = CASE WHEN $6::boolean THEN $7::jsonb ELSE roteiro_ia END
     WHERE id = $1`,
    [g.id, tema, linha, de.id, proximaMin.toFixed(2), novo, novo ? JSON.stringify(roteiro) : null]);
  return `chip ${de.instancia} falou no grupo ${g.id}`;
}

/** Chip que pediu para entrar em grupo com aprovação: confere de novo a cada ~3 h se já foi aceito. */
async function reconferirAprovacoes(pool: Pool, userId: string): Promise<void> {
  const r = await pool.query(
    `SELECT m.grupo_id, m.agente_id, g.group_jid, a.evolution_instancia AS instancia, a.evolution_server_url AS url, a.evolution_api_key AS key
     FROM maturador_grupo_membros m
     JOIN maturador_grupos g ON g.id = m.grupo_id
     JOIN agentes a ON a.id = m.agente_id
     WHERE g.user_id = $1 AND m.estado = 'aguardando_aprovacao' AND g.group_jid IS NOT NULL
       AND m.tentativa_em < NOW() - INTERVAL '3 hours'
     LIMIT 3`, [userId]);
  for (const x of r.rows) {
    const conf = await confirmarParticipacao(sanitizeEvolutionUrl(x.url), x.key, x.instancia, x.group_jid, 0);
    await pool.query(
      `UPDATE maturador_grupo_membros SET estado = $3, tentativa_em = CASE WHEN $3 = 'entrou' THEN tentativa_em ELSE NOW() END
       WHERE grupo_id = $1 AND agente_id = $2`,
      [x.grupo_id, x.agente_id, conf === 'entrou' ? 'entrou' : 'aguardando_aprovacao']);
  }
}

// ── Rodada (cron a cada 2 min) ──────────────────────────────────────────────────────────────
// Chance de tentar uma entrada por rodada: ~7% a cada 2 min ≈ 1 tentativa a cada ~30 min por conta,
// sempre dentro dos limites por chip (2/dia, ≥ 2 h).
const CHANCE_ENTRADA_RODADA = 0.07;
let rodando = false;
export async function processarGruposMaturador(pool: Pool): Promise<{ entradas: number; mensagens: number }> {
  if (rodando) return { entradas: 0, mensagens: 0 };
  rodando = true;
  let entradas = 0, mensagens = 0;
  try {
    const hora = horaBrasilia();
    if (dormindo(hora) || hora >= 22) return { entradas, mensagens };
    const ctrls = await controlesPorAgente(pool);
    const contas = (await pool.query(`SELECT DISTINCT user_id FROM maturador_grupos WHERE estado IN ('pendente', 'ativo')`)).rows;
    for (const { user_id } of contas) {
      try {
        // Entrada: sorteio por rodada para não entrar em horário cravado.
        if (hora >= 9 && hora < 21 && Math.random() < CHANCE_ENTRADA_RODADA) {
          const r = await tentarUmaEntrada(pool, user_id, ctrls);
          if (r) { entradas++; log.info('MATURADOR_GRUPOS', r, { userId: user_id }); }
        }
        await reconferirAprovacoes(pool, user_id);
        const ativos = (await pool.query(`SELECT * FROM maturador_grupos WHERE user_id = $1 AND estado = 'ativo'`, [user_id])).rows;
        for (const g of ativos) {
          const r = await conversarNoGrupo(pool, g, ctrls);
          if (r && !r.startsWith('falha')) mensagens++;
          else if (r) log.warn('MATURADOR_GRUPOS', r, { userId: user_id });
        }
      } catch (err: any) {
        log.warn('MATURADOR_GRUPOS', 'Falha na rodada da conta', { userId: user_id, err: err?.message });
      }
    }
  } finally {
    rodando = false;
  }
  return { entradas, mensagens };
}
