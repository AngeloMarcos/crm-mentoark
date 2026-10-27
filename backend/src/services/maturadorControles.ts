/**
 * maturadorControles.ts — Sprint 7 do maturador v5 (2026-10-18, modelo ChipFlow — ver
 * docs/maturador/SPRINTS_MATURADOR_V5.md): controles por chip, rotina diária, velocidade e
 * reconhecimento do histórico do número.
 *
 *   - Controles (tabela `maturador_controles`, tudo ligado por padrão): conversas (desligado = só
 *     responde), grupos, mídia (fotos/áudios/figurinhas), canais, status, contatos. Grupos, mídia,
 *     canais e contatos ficam guardados para as Sprints 9–12.
 *   - Rotina: dorme 00–07 (nada sai), conversa 07–24, status só 14–20 (1 por dia).
 *   - Velocidade lenta/normal/rápida multiplica pausas e teto diário; fica TRAVADA em "lenta" nos 2
 *     primeiros dias e enquanto o número está em Perfil/Aquecimento 1 ("acelerar agora é o que mais
 *     derruba chip novo").
 *   - Histórico: número que já tinha uso antes de conectar começa adiantado (Aquecimento 2 ou 3).
 */
import { Pool } from 'pg';
import { log } from '../logger';

export type Velocidade = 'lenta' | 'normal' | 'rapida';
export const VELOCIDADES: Velocidade[] = ['lenta', 'normal', 'rapida'];
// Sprint 13: marcar_lida — dar ou não o visto azul nas mensagens do aquecimento (o ChipFlow vem sem).
export const CAMPOS_CONTROLE = ['conversas', 'grupos', 'midia', 'canais', 'status', 'contatos', 'marcar_lida'] as const;
export type CampoControle = typeof CAMPOS_CONTROLE[number];

// Sprint 10 (v5): quem vê o status do chip — só os parceiros do maturador (padrão, nunca chega a
// cliente) ou todos os contatos do número.
export type StatusVisibilidade = 'parceiros' | 'todos';
export const VISIBILIDADES: StatusVisibilidade[] = ['parceiros', 'todos'];

export interface Controles {
  conversas: boolean; grupos: boolean; midia: boolean; canais: boolean; status: boolean; contatos: boolean;
  marcar_lida: boolean;
  velocidade: Velocidade;
  status_visibilidade: StatusVisibilidade;
}
export const CONTROLES_PADRAO: Controles = {
  conversas: true, grupos: true, midia: true, canais: true, status: true, contatos: true, marcar_lida: true, velocidade: 'normal',
  status_visibilidade: 'parceiros',
};

// Fatores de velocidade: pausa multiplica o descanso entre mensagens/sessões; teto multiplica o limite diário.
export const FATOR_VELOCIDADE: Record<Velocidade, { pausa: number; teto: number }> = {
  lenta: { pausa: 1.6, teto: 0.6 },
  normal: { pausa: 1, teto: 1 },
  rapida: { pausa: 0.7, teto: 1.3 },
};

// Rotina (horário de Brasília).
export const ROTINA = { acordaHora: 7, statusDe: 14, statusAte: 20 } as const;
export const dormindo = (hora: number) => hora < ROTINA.acordaHora;
export const horaDeStatus = (hora: number) => hora >= ROTINA.statusDe && hora < ROTINA.statusAte;

const FASES_INICIAIS = new Set(['perfil', 'aquecimento_1']);
const HORAS_INICIO_LENTO = 48;

export interface InfoNumero { fase?: string | null; primeira_conexao_em?: string | Date | null }

/** Velocidade que vale agora: a escolhida, ou "lenta" travada no início do aquecimento. */
export function velocidadeEfetiva(escolhida: Velocidade, n: InfoNumero | null | undefined, agora = Date.now()): { efetivo: Velocidade; travado: boolean; motivo: string | null } {
  const desde = n?.primeira_conexao_em ? new Date(n.primeira_conexao_em).getTime() : NaN;
  const inicio = Number.isFinite(desde) && agora - desde < HORAS_INICIO_LENTO * 3_600_000;
  if (inicio || (n?.fase && FASES_INICIAIS.has(n.fase))) {
    return {
      efetivo: 'lenta', travado: true,
      motivo: inicio
        ? 'Os 2 primeiros dias são lentos de propósito — é o que faz o número aguentar o resto.'
        : 'Chip ainda em aquecimento inicial. A velocidade destrava quando ele sair desta fase — acelerar agora é o que mais derruba chip novo.',
    };
  }
  return { efetivo: escolhida, travado: false, motivo: null };
}

// ── Leitura com cache (o motor roda a cada minuto) ─────────────────────────────────────────
let cache: { em: number; mapa: Map<string, Controles> } | null = null;
export function invalidarCacheControles(): void { cache = null; }

export async function controlesPorAgente(pool: Pool): Promise<Map<string, Controles>> {
  if (cache && Date.now() - cache.em < 60_000) return cache.mapa;
  const r = await pool.query(`SELECT * FROM maturador_controles`).catch(() => ({ rows: [] as any[] }));
  const mapa = new Map<string, Controles>();
  for (const x of r.rows) {
    mapa.set(x.agente_id, {
      conversas: x.conversas, grupos: x.grupos, midia: x.midia, canais: x.canais, status: x.status, contatos: x.contatos, marcar_lida: x.marcar_lida !== false,
      velocidade: VELOCIDADES.includes(x.velocidade) ? x.velocidade : 'normal',
      status_visibilidade: x.status_visibilidade === 'todos' ? 'todos' : 'parceiros',
    });
  }
  cache = { em: Date.now(), mapa };
  return mapa;
}

export async function controlesDe(pool: Pool, agenteId: string): Promise<Controles> {
  return (await controlesPorAgente(pool)).get(agenteId) ?? CONTROLES_PADRAO;
}

export async function salvarControles(pool: Pool, agenteId: string, userId: string, mudancas: Partial<Controles>): Promise<Controles> {
  const atual = await controlesDe(pool, agenteId);
  const novo: Controles = { ...atual };
  for (const c of CAMPOS_CONTROLE) if (typeof (mudancas as any)[c] === 'boolean') (novo as any)[c] = (mudancas as any)[c];
  if (mudancas.velocidade && VELOCIDADES.includes(mudancas.velocidade)) novo.velocidade = mudancas.velocidade;
  if (mudancas.status_visibilidade && VISIBILIDADES.includes(mudancas.status_visibilidade)) novo.status_visibilidade = mudancas.status_visibilidade;
  await pool.query(
    `INSERT INTO maturador_controles (agente_id, user_id, conversas, grupos, midia, canais, status, contatos, velocidade, status_visibilidade, marcar_lida, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
     ON CONFLICT (agente_id) DO UPDATE SET conversas = $3, grupos = $4, midia = $5, canais = $6, status = $7,
       contatos = $8, velocidade = $9, status_visibilidade = $10, marcar_lida = $11, updated_at = NOW()`,
    [agenteId, userId, novo.conversas, novo.grupos, novo.midia, novo.canais, novo.status, novo.contatos, novo.velocidade, novo.status_visibilidade, novo.marcar_lida]
  );
  invalidarCacheControles();
  return novo;
}

// ── Estado de cada controle para a tela ("Ativo agora" × "começa quando amadurecer") ──────
const ORDEM_FASE = ['perfil', 'aquecimento_1', 'aquecimento_2', 'aquecimento_3', 'pre_oficial', 'madura'];
const faseAte = (fase: string | null | undefined, minima: string) =>
  ORDEM_FASE.indexOf(String(fase ?? 'madura')) >= ORDEM_FASE.indexOf(minima);

export interface EstadoControle { ligado: boolean; ativo_agora: boolean; situacao: string }

export function estadoControles(c: Controles, n: { fase?: string | null; so_recebe?: string | null }): Record<CampoControle, EstadoControle> {
  const fase = n.fase ?? null;
  const parado = fase === 'quarentena' || fase === 'banida';
  const est = (ligado: boolean, ativo: boolean, quandoNao: string): EstadoControle => ({
    ligado,
    ativo_agora: ligado && ativo && !parado,
    situacao: !ligado ? 'Desligado' : parado ? 'Parado — número em quarentena/banido' : ativo ? 'Ativo agora' : quandoNao,
  });
  return {
    conversas: est(c.conversas, !n.so_recebe, n.so_recebe && faseAte(fase, 'aquecimento_2')
      ? 'Respondendo — começa a puxar conversa quando o chip amadurecer' : 'Começa quando o chip amadurecer'),
    // Sprint 11 (v5): entra nos grupos cadastrados a partir do Aquecimento 2; fala se não estiver "só recebe".
    grupos: est(c.grupos, !!fase && faseAte(fase, 'aquecimento_2'), 'Começa no Aquecimento 2'),
    // Sprint 9 (v5): áudio/foto/figurinha a partir do Aquecimento 2 (ver maturadorMidia.chancesMidia).
    midia: est(c.midia, !!fase && faseAte(fase, 'aquecimento_2'), 'Começa no Aquecimento 2'),
    // Canais e contatos (Sprints 11/12): a Evolution 2.3.7 não tem rota para seguir canal nem para
    // salvar contato na agenda (o Baileys tem) — depende de atualizar a imagem da Evolution.
    canais: est(c.canais, false, 'Aguardando atualização da Evolution'),
    status: est(c.status, !n.so_recebe, 'Começa quando o chip amadurecer'),
    contatos: est(c.contatos, false, 'Aguardando atualização da Evolution — por enquanto salve no celular'),
    marcar_lida: est(c.marcar_lida, true, ''),
  };
}

// ── Progresso do aquecimento (dia X de 26) ─────────────────────────────────────────────────
// Dia em que cada fase começa (perfil 1 + aq1 4 + aq2 7 + aq3 7 + pré-oficial 7 = 26 dias).
const DIA_INICIO_FASE: Record<string, number> = { perfil: 0, aquecimento_1: 1, aquecimento_2: 5, aquecimento_3: 12, pre_oficial: 19, madura: 26 };
export const TOTAL_DIAS_AQUECIMENTO = 26;

export function progressoAquecimento(fase: string | null | undefined, faseDesde: string | Date | null | undefined, agora = Date.now()): { dia: number; percentual: number } {
  if (!fase || fase === 'madura') return { dia: TOTAL_DIAS_AQUECIMENTO, percentual: 100 };
  if (fase === 'quarentena' || fase === 'banida') return { dia: 0, percentual: 0 };
  const base = DIA_INICIO_FASE[fase] ?? 0;
  const dentro = faseDesde ? Math.max(0, (agora - new Date(faseDesde).getTime()) / 86_400_000) : 0;
  const proxima = Object.values(DIA_INICIO_FASE).filter(d => d > base).sort((a, b) => a - b)[0] ?? TOTAL_DIAS_AQUECIMENTO;
  const dia = Math.min(proxima, base + dentro);
  return { dia: Math.floor(dia), percentual: Math.min(99, Math.round((dia / TOTAL_DIAS_AQUECIMENTO) * 100)) };
}

// ── Histórico do número: quem já tinha uso começa adiantado ───────────────────────────────
/**
 * Cron (de hora em hora): número em Perfil/Aquecimento 1 conectado há menos de 7 dias, sem ban, que
 * trouxe histórico antigo na sincronização do WhatsApp (mensagens com `timestamp_wa` anterior à 1ª
 * conexão) — ≥ 180 dias e ≥ 200 mensagens → Aquecimento 3 (e libera a proteção de número novo);
 * ≥ 30 dias e ≥ 50 mensagens → Aquecimento 2. Uma vez por número (evento `historico_reconhecido`).
 */
export async function reconhecerHistorico(pool: Pool, mudarFase: (n: string, f: any, motivo: string, inst: string | null) => Promise<void>): Promise<number> {
  const r = await pool.query(
    `SELECT w.numero, w.fase, w.primeira_conexao_em, a.evolution_instancia AS instancia
     FROM whatsapp_numeros w
     JOIN LATERAL (SELECT evolution_instancia FROM agentes
                   WHERE regexp_replace(numero_conectado, '\\D', '', 'g') = w.numero AND evolution_instancia IS NOT NULL
                   ORDER BY updated_at DESC LIMIT 1) a ON true
     WHERE w.fase IN ('perfil', 'aquecimento_1') AND COALESCE(w.bans_total, 0) = 0
       AND w.primeira_conexao_em >= NOW() - INTERVAL '7 days'
       AND NOT EXISTS (SELECT 1 FROM whatsapp_eventos_saude e WHERE e.numero = w.numero AND e.tipo = 'historico_reconhecido')`
  ).catch(() => ({ rows: [] as any[] }));
  let promovidos = 0;
  for (const n of r.rows) {
    // Contexto admin: em homolog whatsapp_messages tem RLS por conta (sem contexto = 0 linhas).
    const { withTenantContext } = await import('../db');
    const h = (await withTenantContext({ isAdmin: true }, c => c.query(
      `SELECT COUNT(*)::int AS total, MIN(timestamp_wa) AS mais_antiga FROM whatsapp_messages
       WHERE instance_name = $1 AND timestamp_wa < $2::timestamptz - INTERVAL '1 day'`,
      [n.instancia, n.primeira_conexao_em]
    )).catch(() => ({ rows: [{ total: 0, mais_antiga: null }] }))).rows[0];
    const dias = h.mais_antiga ? (new Date(n.primeira_conexao_em).getTime() - new Date(h.mais_antiga).getTime()) / 86_400_000 : 0;
    const alvo = dias >= 180 && h.total >= 200 ? 'aquecimento_3' : dias >= 30 && h.total >= 50 ? 'aquecimento_2' : null;
    await pool.query(
      `INSERT INTO whatsapp_eventos_saude (numero, instancia, tipo, detalhe) VALUES ($1, $2, 'historico_reconhecido', $3)`,
      [n.numero, n.instancia, JSON.stringify({ mensagens: h.total, dias_de_historico: Math.floor(dias), fase_aplicada: alvo })]
    ).catch(() => {});
    if (!alvo) continue;
    if (alvo === 'aquecimento_3') {
      await pool.query(`UPDATE whatsapp_numeros SET protecao_liberada_em = COALESCE(protecao_liberada_em, NOW()) WHERE numero = $1`, [n.numero]).catch(() => {});
    }
    await mudarFase(n.numero, alvo, `número com histórico (${h.total} mensagens, ${Math.floor(dias)} dias antes de conectar) — começa adiantado`, n.instancia);
    promovidos++;
    log.info('MATURADOR', 'Histórico do número reconhecido', { numero: n.numero, fase: alvo, mensagens: h.total, dias: Math.floor(dias) });
  }
  return promovidos;
}
