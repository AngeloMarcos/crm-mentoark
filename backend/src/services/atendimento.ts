/**
 * atendimento.ts — Sprint Atendimento v1 (diagnosticos/SPRINT_ATENDIMENTO_V1.md), Fase 1.
 * A conversa passa a ter um ATENDIMENTO: um ciclo com estado, atendente e histórico.
 *
 * Regra do caminho quente: estas funções rodam depois de a mensagem ser gravada, sem await no
 * fluxo do webhook, e NUNCA lançam erro. Falha aqui não impede gravar mensagem nem a IA de responder.
 */
import { Pool } from 'pg';
import { log } from '../logger';

const JANELA_REABERTURA_MS = 24 * 3_600_000;
// Conflito no índice único parcial: já existe atendimento em andamento nesta conversa.
const SEM_DUPLICAR = `ON CONFLICT (user_id, instance_name, remote_jid) WHERE estado <> 'resolvido' DO NOTHING`;

// ── Regras puras ─────────────────────────────────────────────────────────────────────────────

/** Só conversa individual vira atendimento (grupo, canal e status ficam de fora). */
export function jidAtendivel(jid: string | null | undefined): boolean {
  return /@(s\.whatsapp\.net|lid|bsuid)$/.test(String(jid || ''));
}

export function ehReabertura(resolvidoEm: Date | null, agora: Date): boolean {
  return !!resolvidoEm && agora.getTime() - new Date(resolvidoEm).getTime() < JANELA_REABERTURA_MS;
}

export interface EstadoPausa {
  atendentePausouIa: boolean | null | undefined;
  atendimentoIa: string | null | undefined;
  iaPausadaAte: Date | null | undefined;
}

/**
 * Prazo vencido libera a IA na hora, mesmo antes de o cron limpar as colunas. Sem prazo, a pausa
 * vale até alguém devolver (é o caso dos contatos pausados antes desta sprint).
 */
export function iaEstaPausada(p: EstadoPausa, agora: Date): boolean {
  if (p.atendentePausouIa === true && p.iaPausadaAte && new Date(p.iaPausadaAte).getTime() <= agora.getTime()) return false;
  return p.atendentePausouIa === true || p.atendimentoIa === 'pause';
}

export interface AtendimentoAtual {
  estado: string;
  atendente_id: string | null;
  primeira_resposta_em: Date | null;
  primeira_resposta_humana_em: Date | null;
}

export interface Saida { origem: 'ia' | 'humano'; autorId: string | null }

export interface EfeitosSaida {
  primeiraRespostaEm: Date | null;
  primeiraRespostaHumanaEm: Date | null;
  atendenteId: string | null;
  estado: 'aberto' | null;
}

/** O que muda no atendimento quando sai uma mensagem. null = nada a gravar (o caso mais comum). */
export function efeitosDaSaida(at: AtendimentoAtual, saida: Saida, agora: Date): EfeitosSaida | null {
  const humano = saida.origem === 'humano';
  const efeitos: EfeitosSaida = {
    primeiraRespostaEm: at.primeira_resposta_em ? null : agora,
    primeiraRespostaHumanaEm: humano && !at.primeira_resposta_humana_em ? agora : null,
    atendenteId: humano && !at.atendente_id ? saida.autorId : null,
    // Quem pediu humano foi atendido: sai da fila "Aguardando humano".
    estado: humano && at.estado === 'aguardando' ? 'aberto' : null,
  };
  return Object.values(efeitos).some(v => v !== null) ? efeitos : null;
}

export type AcaoComEstado = 'atribuir' | 'transferir' | 'resolver' | 'reabrir' | 'pausar-ia';

/** Mensagem de recusa quando a ação não vale no estado atual; null = pode. */
export function erroDeEstado(estado: string, acao: AcaoComEstado): string | null {
  if (acao === 'reabrir') return estado === 'resolvido' ? null : 'Só é possível reabrir um atendimento resolvido.';
  return estado === 'resolvido' ? 'Este atendimento já foi resolvido. Reabra para continuar.' : null;
}

const MAX_MINUTOS_PAUSA = 7 * 24 * 60;

/** null = "até eu devolver". */
export function lerMinutosPausa(v: unknown): { minutos?: number | null; erro?: string } {
  if (v === null) return { minutos: null };
  if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_MINUTOS_PAUSA) return { minutos: v };
  return { erro: 'Informe os minutos da pausa (de 1 a 10080) ou null para pausar até devolver.' };
}

const MAX_NOTA = 4000;

export function lerNota(v: unknown): { texto?: string; erro?: string } {
  const texto = typeof v === 'string' ? v.trim() : '';
  if (!texto) return { erro: 'Escreva o texto da nota.' };
  if (texto.length > MAX_NOTA) return { erro: `A nota pode ter até ${MAX_NOTA} caracteres.` };
  return { texto };
}

export interface FiltrosConversas { estado: string | null; atendenteId: string | null; semAtendente: boolean }

export function lerFiltrosConversas(q: Record<string, unknown>, usuarioLogado: string): FiltrosConversas {
  return {
    estado: ['aberto', 'aguardando', 'resolvido'].includes(String(q.estado)) ? String(q.estado) : null,
    atendenteId: q.meus === '1' ? usuarioLogado : null,
    semAtendente: q.sem_atendente === '1',
  };
}

export function ehUuid(v: unknown): boolean {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

// ── Gravação (nunca lança) ───────────────────────────────────────────────────────────────────

export interface Conversa { userId: string; instancia: string; remoteJid: string; telefone: string }

export type Db = Pick<Pool, 'query'>;

export interface ExtrasEvento {
  autorId?: string | null; deAtendente?: string | null; paraAtendente?: string | null;
  motivoId?: string | null; texto?: string | null; ate?: Date | null;
}

export async function gravarEvento(
  db: Db, atendimentoId: string, userId: string, tipo: string, origem: string, extras: ExtrasEvento = {},
): Promise<void> {
  await db.query(
    `INSERT INTO atendimento_eventos (atendimento_id, user_id, tipo, origem, autor_id, de_atendente, para_atendente, motivo_id, texto, ate)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [atendimentoId, userId, tipo, origem, extras.autorId ?? null, extras.deAtendente ?? null, extras.paraAtendente ?? null,
     extras.motivoId ?? null, extras.texto ?? null, extras.ate ?? null]
  );
}

async function atendimentoEmAndamento(pool: Pool, c: Conversa): Promise<(AtendimentoAtual & { id: string }) | null> {
  const r = await pool.query(
    `SELECT id, estado, atendente_id, primeira_resposta_em, primeira_resposta_humana_em
     FROM atendimentos WHERE user_id = $1 AND instance_name = $2 AND remote_jid = $3 AND estado <> 'resolvido' LIMIT 1`,
    [c.userId, c.instancia, c.remoteJid]
  );
  return r.rows[0] || null;
}

async function abrir(pool: Pool, c: Conversa, origem: 'cliente' | 'atendente'): Promise<void> {
  const ultimo = (await pool.query(
    `SELECT id, resolvido_em FROM atendimentos
     WHERE user_id = $1 AND instance_name = $2 AND remote_jid = $3 AND estado = 'resolvido'
     ORDER BY resolvido_em DESC NULLS LAST LIMIT 1`,
    [c.userId, c.instancia, c.remoteJid]
  )).rows[0];
  const contato = (await pool.query(
    `SELECT id FROM contatos WHERE user_id = $1 AND telefone ILIKE $2 LIMIT 1`,
    [c.userId, `%${c.telefone.slice(-11)}`]
  )).rows[0];
  const r = await pool.query(
    `INSERT INTO atendimentos (user_id, instance_name, remote_jid, telefone, contato_id, estado, origem, reaberto_de)
     VALUES ($1, $2, $3, $4, $5, 'aberto', $6, $7) ${SEM_DUPLICAR} RETURNING id`,
    [c.userId, c.instancia, c.remoteJid, c.telefone, contato?.id ?? null, origem,
     ultimo && ehReabertura(ultimo.resolvido_em, new Date()) ? ultimo.id : null]
  );
  if (r.rows[0]) await gravarEvento(pool, r.rows[0].id, c.userId, 'aberto', origem === 'cliente' ? 'sistema' : 'humano');
}

/** Mensagem do cliente: garante que existe um atendimento em andamento nesta conversa. */
export async function registrarEntrada(pool: Pool, c: Conversa): Promise<void> {
  if (!jidAtendivel(c.remoteJid)) return;
  try {
    if (!(await atendimentoEmAndamento(pool, c))) await abrir(pool, c, 'cliente');
  } catch (err: any) {
    log.warn('ATENDIMENTO', 'Falha ao registrar entrada', { instancia: c.instancia, err: err?.message });
  }
}

/** Mensagem enviada pela IA ou por uma pessoa (CRM ou celular). */
export async function registrarSaida(pool: Pool, s: Conversa & Saida): Promise<void> {
  if (!jidAtendivel(s.remoteJid)) return;
  try {
    let at = await atendimentoEmAndamento(pool, s);
    if (!at && s.origem === 'humano') {
      await abrir(pool, s, 'atendente');
      at = await atendimentoEmAndamento(pool, s);
    }
    if (!at) return;
    const e = efeitosDaSaida(at, s, new Date());
    if (!e) return;
    // COALESCE na coluna: se duas saídas correrem juntas, vale a primeira (nunca sobrescreve).
    await pool.query(
      `UPDATE atendimentos SET
         primeira_resposta_em = COALESCE(primeira_resposta_em, $2),
         primeira_resposta_humana_em = COALESCE(primeira_resposta_humana_em, $3),
         atendente_id = COALESCE(atendente_id, $4),
         estado = COALESCE($5, estado),
         updated_at = NOW()
       WHERE id = $1`,
      [at.id, e.primeiraRespostaEm, e.primeiraRespostaHumanaEm, e.atendenteId, e.estado]
    );
    if (e.atendenteId) await gravarEvento(pool, at.id, s.userId, 'atribuido', 'sistema', { autorId: s.autorId, paraAtendente: e.atendenteId });
  } catch (err: any) {
    log.warn('ATENDIMENTO', 'Falha ao registrar saída', { instancia: s.instancia, origem: s.origem, err: err?.message });
  }
}

/** A IA passou a conversa para uma pessoa (cliente pediu atendente). */
export async function marcarAguardando(pool: Pool, c: Conversa): Promise<void> {
  if (!jidAtendivel(c.remoteJid)) return;
  try {
    if (!(await atendimentoEmAndamento(pool, c))) await abrir(pool, c, 'cliente');
    const r = await pool.query(
      `UPDATE atendimentos SET estado = 'aguardando', updated_at = NOW()
       WHERE user_id = $1 AND instance_name = $2 AND remote_jid = $3 AND estado = 'aberto' RETURNING id`,
      [c.userId, c.instancia, c.remoteJid]
    );
    if (r.rows[0]) await gravarEvento(pool, r.rows[0].id, c.userId, 'aguardando', 'ia');
  } catch (err: any) {
    log.warn('ATENDIMENTO', 'Falha ao marcar aguardando', { instancia: c.instancia, err: err?.message });
  }
}

/** Cron de 1 minuto: termina as pausas com prazo vencido e devolve quantas foram encerradas. */
export async function encerrarPausasVencidas(pool: Pool): Promise<number> {
  try {
    const vencidas = (await pool.query(
      `UPDATE contatos SET atendente_pausou_ia = false, ia_pausada_ate = NULL, updated_at = NOW()
       WHERE atendente_pausou_ia = true AND ia_pausada_ate <= NOW()
       RETURNING id, user_id, telefone`
    )).rows;
    for (const c of vencidas) {
      const sufixo = `%${String(c.telefone).slice(-11)}`;
      await pool.query(
        `UPDATE dados_cliente SET atendimento_ia = 'ativo', pausa_timestamp = NULL, pausa_duracao_min = NULL
         WHERE user_id = $1 AND telefone ILIKE $2`,
        [c.user_id, sufixo]
      ).catch(() => {});
      await pool.query(
        `INSERT INTO ia_pausa_log (user_id, telefone, acao, observacao) VALUES ($1, $2, 'auto_reativado', 'Pausa com prazo terminou')`,
        [c.user_id, c.telefone]
      ).catch(() => {});
      const at = (await pool.query(
        `SELECT id FROM atendimentos WHERE user_id = $1 AND estado <> 'resolvido' AND (contato_id = $2 OR telefone ILIKE $3)
         ORDER BY aberto_em DESC LIMIT 1`,
        [c.user_id, c.id, sufixo]
      ).catch(() => ({ rows: [] as any[] }))).rows[0];
      if (at) await gravarEvento(pool, at.id, c.user_id, 'ia_retomada', 'sistema').catch(() => {});
    }
    return vencidas.length;
  } catch (err: any) {
    log.warn('ATENDIMENTO', 'Falha ao encerrar pausas vencidas', { err: err?.message });
    return 0;
  }
}

// ── Pausa da IA pelo atendente (chamadas dentro de uma transação: erro aqui desfaz a ação) ───

async function marcarDadosCliente(db: Db, ownerId: string, telefone: string, valor: 'pause' | 'ativo'): Promise<void> {
  // UPDATE antes de INSERT: um ON CONFLICT que falhasse abortaria a transação inteira.
  const r = await db.query(
    `UPDATE dados_cliente SET atendimento_ia = $3::text, pausa_timestamp = CASE WHEN $3::text = 'pause' THEN NOW() END, pausa_duracao_min = NULL
     WHERE user_id = $1 AND telefone ILIKE $2`,
    [ownerId, `%${telefone.slice(-11)}`, valor]
  );
  if (!r.rowCount && valor === 'pause') {
    await db.query(`INSERT INTO dados_cliente (user_id, telefone, atendimento_ia, pausa_timestamp, pausa_duracao_min) VALUES ($1, $2, 'pause', NOW(), NULL)`, [ownerId, telefone]);
  }
}

/** Devolve o fim da pausa (null = até devolver), ou undefined se o contato não existir. */
export async function pausarIA(db: Db, ownerId: string, telefone: string, minutos: number | null): Promise<Date | null | undefined> {
  const r = await db.query(
    `UPDATE contatos SET atendente_pausou_ia = true, updated_at = NOW(),
            ia_pausada_ate = CASE WHEN $3::int IS NULL THEN NULL ELSE NOW() + make_interval(mins => $3::int) END
     WHERE user_id = $1 AND telefone ILIKE $2 RETURNING ia_pausada_ate`,
    [ownerId, `%${telefone.slice(-11)}`, minutos]
  );
  if (!r.rows[0]) return undefined;
  await marcarDadosCliente(db, ownerId, telefone, 'pause');
  await db.query(`INSERT INTO ia_pausa_log (user_id, telefone, acao, duracao_min) VALUES ($1, $2, 'pause', $3)`, [ownerId, telefone, minutos]);
  return r.rows[0].ia_pausada_ate;
}

/** Devolve true se a IA estava pausada. Vale a decisão humana, inclusive sobre a marca de robô. */
export async function devolverIA(db: Db, ownerId: string, telefone: string): Promise<boolean> {
  const sufixo = `%${telefone.slice(-11)}`;
  const antes = await db.query(`SELECT 1 FROM contatos WHERE user_id = $1 AND telefone ILIKE $2 AND atendente_pausou_ia = true LIMIT 1`, [ownerId, sufixo]);
  await db.query(
    `UPDATE contatos SET atendente_pausou_ia = false, ia_pausada_ate = NULL, bot_detectado = false, updated_at = NOW() WHERE user_id = $1 AND telefone ILIKE $2`,
    [ownerId, sufixo]
  );
  await marcarDadosCliente(db, ownerId, telefone, 'ativo');
  if (antes.rowCount) await db.query(`INSERT INTO ia_pausa_log (user_id, telefone, acao) VALUES ($1, $2, 'ativo')`, [ownerId, telefone]);
  return !!antes.rowCount;
}
