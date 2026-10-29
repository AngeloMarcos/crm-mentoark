/**
 * maturadorPainel.ts — painel de chips do Aquecimento (2026-10-27, pedido do usuário: "um painel parecido com
 * o do ChipFlow para a maturação e conectar os chips"). Monta, num lugar só, o que cada card mostra:
 * conexão real (Evolution), o que o chip está fazendo agora (aquecendo / descansando / em espera /
 * dormindo / desconectado), fase e progresso, velocidade, recibo de leitura, proxy, anotação e contatos.
 *
 * Contatos: a Evolution 2.3.7 não salva contato na agenda do aparelho (o Baileys tem `addOrEditContact`,
 * mas não é exposto). Mesmo jeito do ChipFlow ("Receber arquivo de contatos no WhatsApp"): o chip manda
 * para ELE MESMO (conversa "Você") os cartões de contato dos parceiros de aquecimento — o usuário toca e
 * salva no celular.
 */
import { Pool } from 'pg';
import { log } from '../logger';
import { evolutionFetch, sanitizeEvolutionUrl } from '../utils/resilientFetch';
import { instanciaConectada } from './maturadorProcessor';
import { saudeDoUsuario } from './saudeNumero';
import { bloqueioEnvio } from './maturadorGlobal';
import {
  controlesPorAgente, CONTROLES_PADRAO, velocidadeEfetiva, progressoAquecimento, dormindo, TOTAL_DIAS_AQUECIMENTO, ROTINA,
} from './maturadorControles';

const TZ = 'America/Sao_Paulo';
const horaBrasilia = () => Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));

export type Atividade = 'desconectado' | 'parado' | 'dormindo' | 'aquecendo' | 'descansando' | 'em_espera';

/** O que o chip está fazendo agora (regra pura, testável). */
export function atividadeDoChip(p: {
  conectado: boolean; fase: string | null; hora: number; paresAtivos: number; gruposAtivos: number;
  ultimoEnvio: Date | null; proxima: Date | null; restantesSessao: number; agora?: number;
}): { atividade: Atividade; volta_em: string | null } {
  const agora = p.agora ?? Date.now();
  if (!p.conectado) return { atividade: 'desconectado', volta_em: null };
  if (p.fase === 'quarentena' || p.fase === 'banida') return { atividade: 'parado', volta_em: null };
  if (dormindo(p.hora)) return { atividade: 'dormindo', volta_em: null };
  if (!p.paresAtivos && !p.gruposAtivos) return { atividade: 'em_espera', volta_em: null };
  const recente = p.ultimoEnvio && agora - p.ultimoEnvio.getTime() < 8 * 60_000;
  const emSessao = p.restantesSessao > 0 && (!p.proxima || p.proxima.getTime() - agora < 10 * 60_000);
  if (recente || emSessao) return { atividade: 'aquecendo', volta_em: null };
  return { atividade: 'descansando', volta_em: p.proxima && p.proxima.getTime() > agora ? p.proxima.toISOString() : null };
}

export async function montarPainel(pool: Pool, ownerId: string): Promise<{ resumo: any; chips: any[] }> {
  const saude = await saudeDoUsuario(pool, ownerId);
  const ctrls = await controlesPorAgente(pool);
  const ag = (await pool.query(
    `SELECT a.id, a.nome, a.created_at, a.evolution_instancia, a.evolution_server_url, a.evolution_api_key, a.numero_conectado,
            a.proxy_host, a.proxy_pais, a.proxy_org, a.proxy_testado_em,
            mc.anotacao, mc.contatos_enviados_em
     FROM agentes a LEFT JOIN maturador_controles mc ON mc.agente_id = a.id
     WHERE a.user_id = $1 AND a.evolution_instancia IS NOT NULL ORDER BY a.created_at`, [ownerId])).rows;
  const ids = ag.map((x: any) => x.id);
  const [pares, envios, grupos] = await Promise.all([
    pool.query(
      `SELECT a.id, COUNT(mp.id) FILTER (WHERE mp.ativo)::int AS ativos,
              MIN(mp.proxima_mensagem_em) FILTER (WHERE mp.ativo) AS proxima,
              COALESCE(MAX(mp.msgs_restantes_sessao) FILTER (WHERE mp.ativo), 0)::int AS restantes
       FROM unnest($1::uuid[]) AS a(id)
       LEFT JOIN maturador_pares mp ON a.id IN (mp.agente_a_id, mp.agente_b_id) AND mp.banido_em IS NULL
       GROUP BY a.id`, [ids]),
    pool.query(
      `SELECT de_agente_id AS id, MAX(created_at) AS ultimo,
              COUNT(*) FILTER (WHERE (created_at AT TIME ZONE '${TZ}')::date = (NOW() AT TIME ZONE '${TZ}')::date)::int AS hoje
       FROM maturador_mensagens WHERE de_agente_id = ANY($1::uuid[]) GROUP BY de_agente_id`, [ids]),
    pool.query(
      `SELECT m.agente_id AS id, COUNT(*)::int AS n FROM maturador_grupo_membros m JOIN maturador_grupos g ON g.id = m.grupo_id
       WHERE m.agente_id = ANY($1::uuid[]) AND m.estado = 'entrou' AND g.estado = 'ativo' GROUP BY m.agente_id`, [ids]),
  ]);
  const P = new Map(pares.rows.map((x: any) => [x.id, x]));
  const E = new Map(envios.rows.map((x: any) => [x.id, x]));
  const G = new Map(grupos.rows.map((x: any) => [x.id, x.n]));
  const S = new Map(saude.map((s: any) => [s.agente_id, s]));
  const hora = horaBrasilia();

  // Conexão real de cada chip (em paralelo, cada uma com o timeout do próprio helper).
  const conexoes = await Promise.all(ag.map((x: any) =>
    x.evolution_server_url ? instanciaConectada(sanitizeEvolutionUrl(x.evolution_server_url), x.evolution_api_key, x.evolution_instancia).catch(() => false) : Promise.resolve(false)));

  const chips = [];
  for (let i = 0; i < ag.length; i++) {
    const x = ag[i];
    const s: any = S.get(x.id) ?? {};
    const c = ctrls.get(x.id) ?? CONTROLES_PADRAO;
    const p: any = P.get(x.id) ?? { ativos: 0, proxima: null, restantes: 0 };
    const e: any = E.get(x.id) ?? { ultimo: null, hoje: 0 };
    const conectado = conexoes[i] === true;
    const ativ = atividadeDoChip({
      conectado, fase: s.fase ?? null, hora, paresAtivos: p.ativos, gruposAtivos: G.get(x.id) ?? 0,
      ultimoEnvio: e.ultimo ? new Date(e.ultimo) : null, proxima: p.proxima ? new Date(p.proxima) : null, restantesSessao: p.restantes,
    });
    chips.push({
      agente_id: x.id, nome: x.nome, instancia: x.evolution_instancia,
      numero: s.numero ?? (String(x.numero_conectado || '').replace(/\D/g, '') || null),
      conectado, ...ativ,
      fase: s.fase ?? null, fase_rotulo: s.fase_rotulo ?? null, so_recebe: await bloqueioEnvio(pool, x.evolution_instancia),
      progresso: { ...progressoAquecimento(s.fase ?? null, s.fase_desde ?? null), total_dias: TOTAL_DIAS_AQUECIMENTO },
      enviadas_hoje: e.hoje, pares_ativos: p.ativos, grupos_ativos: G.get(x.id) ?? 0,
      criado_em: x.created_at,
      velocidade: { escolhido: c.velocidade, ...velocidadeEfetiva(c.velocidade, { fase: s.fase ?? null, primeira_conexao_em: s.primeira_conexao_em ?? null }) },
      marcar_lida: c.marcar_lida,
      proxy: x.proxy_host ? { pais: x.proxy_pais, org: x.proxy_org, testado_em: x.proxy_testado_em } : null,
      anotacao: x.anotacao ?? '',
      contatos_enviados_em: x.contatos_enviados_em,
    });
  }
  const comProblema = chips.filter(c => !c.conectado || c.atividade === 'parado').length;
  return {
    resumo: { total: chips.length, de_pe: chips.filter(c => c.conectado).length, com_problema: comProblema, acorda: `${String(ROTINA.acordaHora).padStart(2, '0')}:00` },
    chips,
  };
}

export async function salvarAnotacao(pool: Pool, agenteId: string, userId: string, texto: string): Promise<void> {
  await pool.query(
    `INSERT INTO maturador_controles (agente_id, user_id, anotacao, updated_at) VALUES ($1, $2, $3, NOW())
     ON CONFLICT (agente_id) DO UPDATE SET anotacao = $3, updated_at = NOW()`,
    [agenteId, userId, String(texto || '').slice(0, 1000)]);
}

// ── Arquivo de contatos ──────────────────────────────────────────────────────────────────────
const NOMES = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elaine', 'Fábio', 'Gabi', 'Henrique', 'Isabela', 'João', 'Karen', 'Lucas',
  'Mariana', 'Nando', 'Olívia', 'Paulo', 'Rafa', 'Sabrina', 'Thiago', 'Vanessa', 'Wesley', 'Yasmin'];
const SOBRENOMES = ['Silva', 'Souza', 'Oliveira', 'Santos', 'Lima', 'Costa', 'Pereira', 'Almeida', 'Rocha', 'Martins', 'Gomes', 'Ribeiro'];

/** Nome fixo e comum para um número (o mesmo número recebe sempre o mesmo nome). */
export function nomeDoContato(numero: string): string {
  const h = [...numero].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 11);
  return `${NOMES[h % NOMES.length]} ${SOBRENOMES[(h >>> 5) % SOBRENOMES.length]}`;
}

/** Envia, do chip para ele mesmo, os cartões de contato dos parceiros de aquecimento (pares + grupos). */
export async function enviarArquivoContatos(pool: Pool, ownerId: string, agenteId: string): Promise<{ erro?: string; enviados?: number }> {
  const a = (await pool.query(
    `SELECT id, evolution_instancia, evolution_server_url, evolution_api_key, numero_conectado FROM agentes WHERE id = $1 AND user_id = $2`,
    [agenteId, ownerId])).rows[0];
  if (!a) return { erro: 'Número não encontrado nesta conta' };
  const proprio = String(a.numero_conectado || '').replace(/\D/g, '');
  if (proprio.length < 10) return { erro: 'Conecte o número antes' };
  const r = await pool.query(
    `SELECT DISTINCT regexp_replace(COALESCE(o.numero_conectado, ''), '\\D', '', 'g') AS numero
     FROM (
       SELECT CASE WHEN mp.agente_a_id = $1 THEN mp.agente_b_id ELSE mp.agente_a_id END AS outro
       FROM maturador_pares mp WHERE $1 IN (mp.agente_a_id, mp.agente_b_id) AND mp.banido_em IS NULL
       UNION
       SELECT m2.agente_id FROM maturador_grupo_membros m1
       JOIN maturador_grupo_membros m2 ON m2.grupo_id = m1.grupo_id AND m2.agente_id <> m1.agente_id AND m2.estado = 'entrou'
       WHERE m1.agente_id = $1 AND m1.estado = 'entrou'
     ) t JOIN agentes o ON o.id = t.outro`, [agenteId]);
  const numeros = r.rows.map((x: any) => x.numero).filter((n: string) => n.length >= 10 && n !== proprio).slice(0, 50);
  if (!numeros.length) return { erro: 'Este número ainda não tem parceiros de aquecimento' };
  const resp = await evolutionFetch(`${sanitizeEvolutionUrl(a.evolution_server_url)}/message/sendContact/${a.evolution_instancia}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: a.evolution_api_key },
    body: JSON.stringify({ number: proprio, contact: numeros.map((n: string) => ({ fullName: nomeDoContato(n), wuid: n, phoneNumber: `+${n}` })) }),
  }).catch(() => null);
  if (!resp?.ok) {
    const corpo = await resp?.text().catch(() => '') ?? '';
    log.warn('MATURADOR_PAINEL', 'Falha ao enviar arquivo de contatos', { agenteId, status: resp?.status, corpo: corpo.slice(0, 200) });
    return { erro: resp?.status === 423 ? 'Este número ainda está na fase em que só recebe — tente quando ele amadurecer' : 'O WhatsApp não aceitou o envio agora. Tente de novo em alguns minutos.' };
  }
  await pool.query(
    `INSERT INTO maturador_controles (agente_id, user_id, contatos_enviados_em, updated_at) VALUES ($1, $2, NOW(), NOW())
     ON CONFLICT (agente_id) DO UPDATE SET contatos_enviados_em = NOW(), updated_at = NOW()`, [agenteId, ownerId]);
  return { enviados: numeros.length };
}
