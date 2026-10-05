/**
 * Etapa 3 do Radar: entrar em grupo pela própria Evolution (sem link externo). Ver
 * RELATORIO-EVOLUTION-ENTRAR.md para a origem de cada decisão abaixo — em especial: a Evolution
 * NÃO diferencia "entrou" de "aguardando aprovação" na resposta do accept-invite (ambas devolvem
 * {accepted:true, groupJid} igual); a confirmação real vem de uma segunda chamada (findGroupInfos)
 * alguns segundos depois. E "grupo cheio" nunca é lido de um erro da Evolution — é decidido antes
 * de tentar, pelo nº de participantes que a Etapa 2 já leu.
 */
import { Pool } from 'pg';
import { log } from '../logger';
import { classificarErroConvite, ClienteEvolution } from './evolutionGrupos';
import { buscarInfoGrupo } from '../utils/whatsappMediaStorage';
import { pausaAtiva, pausar, textoPausa } from './validacao';
import { grupoCheio } from './scoring';
import { CorteInstancia, InstanciaProspeccao, instanciaApta, instanciaDeProspeccao } from './instanciaProspeccao';

export { CorteInstancia, InstanciaProspeccao, instanciaApta, instanciaDeProspeccao } from './instanciaProspeccao';

export class EntradaIndisponivel extends Error {}

export type ResultadoEntrada =
  | { tipo: 'entrou'; groupJid: string }
  | { tipo: 'aguardando_aprovacao'; groupJid: string }
  | { tipo: 'invalido'; motivo: string }
  | { tipo: 'cheio' };

/** Aceita tanto a URL colada (https://chat.whatsapp.com/XXX) quanto o código bruto do convite. */
export function codigoDoConvite(codigoOuUrl: string): string {
  const bruto = String(codigoOuUrl || '').trim();
  const match = bruto.match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/i);
  return (match ? match[1] : bruto).replace(/[^A-Za-z0-9]/g, '');
}

/**
 * Estados do grupo (máquina pura, sem I/O): descoberto -> aprovado -> na_fila -> entrou |
 * aguardando_aprovacao | cheio | invalido | rejeitado. Qualquer outra transição é recusada.
 */
const TRANSICOES: Record<string, string[]> = {
  descoberto: ['aprovado', 'rejeitado'],
  aprovado: ['na_fila', 'rejeitado'],
  na_fila: ['entrou', 'aguardando_aprovacao', 'cheio', 'invalido', 'aprovado' /* devolvido por pausa/erro */],
  aguardando_aprovacao: ['entrou', 'rejeitado'],
  cheio: ['rejeitado'],
  invalido: [],
  rejeitado: ['descoberto'], // reversível: nicho editado pode reabilitar (mesma regra já usada em pontuarEGravar)
  entrou: [],
};

export function transicaoValida(de: string, para: string): boolean {
  return (TRANSICOES[de] ?? []).includes(para);
}

/** Só entra quem está pronto: estado certo, dentro do corte de nota/membros, e não cheio. */
export function podeEntrar(
  grupo: { status: string; score: number | null; participantes: number | null },
  corte: { corteScore: number; corteMembros: number },
  teto: { tamanho_max: number } = { tamanho_max: 1024 },
): { ok: true } | { ok: false; motivo: string } {
  if (!['aprovado', 'na_fila'].includes(grupo.status)) return { ok: false, motivo: `estado atual (${grupo.status}) não entra na fila de entrada` };
  if (grupoCheio(grupo.participantes, teto)) return { ok: false, motivo: 'grupo cheio (no teto do WhatsApp)' };
  if (typeof grupo.participantes === 'number' && grupo.participantes < corte.corteMembros) return { ok: false, motivo: `menos de ${corte.corteMembros} participantes` };
  if (typeof grupo.score === 'number' && grupo.score < corte.corteScore) return { ok: false, motivo: `nota abaixo de ${corte.corteScore}` };
  return { ok: true };
}

const dormir = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Chama o accept-invite (GET, confirmado no código real da Evolution — ver relatório). */
export async function aceitarConvite(c: ClienteEvolution, instancia: string, codigo: string): Promise<{ tipo: 'aceito'; groupJid: string } | { tipo: 'invalido'; motivo: string } | { tipo: 'indisponivel'; motivo: string }> {
  const url = `${c.base.replace(/\/+$/, '')}/group/acceptInviteCode/${encodeURIComponent(instancia)}?inviteCode=${encodeURIComponent(codigo)}`;
  try {
    const res = await (c.fetchImpl ?? fetch)(url, { headers: { apikey: c.apiKey }, signal: AbortSignal.timeout(20000) });
    const texto = await res.text();
    if (!res.ok) {
      const r = classificarErroConvite(res.status, texto);
      return r.tipo === 'ok' ? { tipo: 'indisponivel', motivo: 'resposta inesperada' } : r;
    }
    let corpo: any = null; try { corpo = JSON.parse(texto); } catch { /* corpo inválido */ }
    const groupJid = typeof corpo?.groupJid === 'string' ? corpo.groupJid : null;
    if (!groupJid) return { tipo: 'indisponivel', motivo: 'Evolution aceitou o convite mas não devolveu o groupJid' };
    return { tipo: 'aceito', groupJid };
  } catch (err: any) {
    return { tipo: 'indisponivel', motivo: `Falha de rede: ${err?.message ?? 'desconhecida'}` };
  }
}

/**
 * Confirma se a instância REALMENTE está no grupo (accept-invite sozinho não garante isso — ver
 * relatório). `findGroupInfos` falhando com "forbidden" é o sinal já usado no resto do sistema pra
 * "esta instância não é membro deste grupo" (mesmo texto que hoje detecta remoção de grupo).
 */
export async function confirmarParticipacao(
  url: string, apiKey: string, instancia: string, groupJid: string, esperaMs = 4000,
): Promise<'entrou' | 'aguardando_aprovacao' | 'indeterminado'> {
  await dormir(esperaMs);
  const info = await buscarInfoGrupo(url, apiKey, instancia, groupJid);
  if (info.erro === 'sem_acesso') return 'aguardando_aprovacao';
  if (info.erro === 'outro') return 'indeterminado';
  return 'entrou';
}

/**
 * Orquestra a entrada de UM grupo: valida estado/cortes, respeita pausa de emergência, aceita o
 * convite, confirma participação real, grava e devolve o resultado. Erro de instância/rede nunca
 * marca o grupo como inválido (mesma filosofia fail-closed do resto do Radar).
 */
export async function entrarNoGrupo(pool: Pool, grupoId: string): Promise<ResultadoEntrada | { tipo: 'ignorado' }> {
  const { rows } = await pool.query(`SELECT * FROM radar_grupos WHERE id = $1`, [grupoId]);
  const g = rows[0];
  if (!g || g.plataforma !== 'whatsapp') return { tipo: 'ignorado' };

  const pausaGlobal = await pausaAtiva(pool, 'entrada');
  if (pausaGlobal) throw new EntradaIndisponivel(`Entradas em grupo ${textoPausa(pausaGlobal)}`);

  const cfgRes = await pool.query(`SELECT * FROM radar_entrada_config WHERE user_id = $1`, [g.user_id]);
  const cfg = cfgRes.rows[0];
  if (!cfg) throw new EntradaIndisponivel('Nenhuma configuração de entrada em grupo definida (Radar → Configurações → Entrada em grupo)');

  const decisaoElegibilidade = podeEntrar(
    { status: g.status, score: g.score, participantes: g.participantes },
    { corteScore: cfg.corte_score, corteMembros: cfg.corte_membros },
  );
  if (!decisaoElegibilidade.ok) {
    if (grupoCheio(g.participantes)) {
      await pool.query(`UPDATE radar_grupos SET status = 'cheio', entrada_erro = NULL, updated_at = now() WHERE id = $1`, [g.id]);
      return { tipo: 'cheio' };
    }
    return { tipo: 'ignorado' };
  }

  const instancia = await instanciaDeProspeccao(pool, g.user_id);
  if (!instancia) throw new EntradaIndisponivel('Nenhuma instância com papel "prospecção" configurada para entrar em grupos');
  const apta = instanciaApta(instancia, { corteDiasConectado: cfg.corte_dias_conectado, corteHealthScore: cfg.corte_health_score });
  if (!apta.ok) throw new EntradaIndisponivel(`Instância de prospecção não está pronta: ${apta.motivo}`);

  const limiteDia = await entradasHoje(pool, g.user_id) >= cfg.limite_dia;
  if (limiteDia) throw new EntradaIndisponivel(`Limite diário de entradas (${cfg.limite_dia}) já atingido`);
  if (!dentroDaJanela(cfg.janela_inicio, cfg.janela_fim)) throw new EntradaIndisponivel('Fora da janela de horário configurada para entrar em grupos');

  await pool.query(`UPDATE radar_grupos SET status = 'na_fila', entrada_tentativas = entrada_tentativas + 1, entrada_tentativa_em = now(), updated_at = now() WHERE id = $1`, [g.id]);

  // Pausa aleatória configurável ANTES de entrar — não é burocracia, é o que evita cadência de robô.
  const minMs = Math.max(0, cfg.pausa_min_seg) * 1000;
  const maxMs = Math.max(minMs, cfg.pausa_max_seg * 1000);
  await dormir(minMs + Math.floor(Math.random() * Math.max(1, maxMs - minMs)));

  const aceite = await aceitarConvite({ base: instancia.url, apiKey: instancia.apiKey }, instancia.instancia, g.codigo_convite);
  if (aceite.tipo === 'indisponivel') {
    await pool.query(`UPDATE radar_grupos SET status = 'aprovado', entrada_erro = $2, updated_at = now() WHERE id = $1`, [g.id, aceite.motivo.slice(0, 300)]);
    throw new EntradaIndisponivel(aceite.motivo);
  }
  if (aceite.tipo === 'invalido') {
    await pool.query(
      `UPDATE radar_grupos SET status = 'invalido', link_ativo = false, motivo_descarte = 'link_invalido', entrada_erro = $2, updated_at = now() WHERE id = $1`,
      [g.id, aceite.motivo.slice(0, 300)]);
    return { tipo: 'invalido', motivo: aceite.motivo };
  }

  const confirmacao = await confirmarParticipacao(instancia.url, instancia.apiKey, instancia.instancia, aceite.groupJid);
  if (confirmacao === 'entrou') {
    await pool.query(
      `UPDATE radar_grupos SET status = 'entrou', jid = $2, entrou_em = now(), entrada_agente_id = $3,
              entrada_erro = NULL, extracao_agendada_para = now() + make_interval(hours => $4), updated_at = now()
        WHERE id = $1`,
      [g.id, aceite.groupJid, instancia.agenteId, cfg.extracao_apos_horas]);
    log.info('RADAR', 'entrou no grupo', { grupoId: g.id, groupJid: aceite.groupJid });
    return { tipo: 'entrou', groupJid: aceite.groupJid };
  }
  if (confirmacao === 'aguardando_aprovacao') {
    await pool.query(`UPDATE radar_grupos SET status = 'aguardando_aprovacao', jid = $2, entrada_agente_id = $3, entrada_erro = NULL, updated_at = now() WHERE id = $1`, [g.id, aceite.groupJid, instancia.agenteId]);
    return { tipo: 'aguardando_aprovacao', groupJid: aceite.groupJid };
  }
  // indeterminado: não confirma nem desmente — mantém em na_fila para a próxima checagem decidir, sem chutar.
  await pool.query(`UPDATE radar_grupos SET entrada_erro = 'confirmação indeterminada, tentando de novo depois', updated_at = now() WHERE id = $1`, [g.id]);
  throw new EntradaIndisponivel('Não foi possível confirmar a participação no grupo ainda — tentando de novo depois');
}

/** Conta TENTATIVAS de hoje (não só sucessos) — cada accept-invite é uma ação de risco no WhatsApp, mesmo quando não confirma entrada. */
export async function entradasHoje(pool: Pool, userId: string): Promise<number> {
  const r = await pool.query(
    `SELECT count(*)::int AS n FROM radar_grupos
      WHERE user_id = $1 AND (entrada_tentativa_em AT TIME ZONE 'America/Sao_Paulo')::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date`, [userId]);
  return r.rows[0]?.n ?? 0;
}

/** Janela de horário em America/Sao_Paulo — mesma zona já usada no resto do sistema (Disparos). */
export function dentroDaJanela(inicio: string, fim: string, agora = new Date()): boolean {
  const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(agora);
  return inicio <= fim ? (hora >= inicio && hora <= fim) : (hora >= inicio || hora <= fim);
}

/** Pausa de emergência da entrada em grupo — mesmo mecanismo já usado para busca/link_publico. */
export async function pararEntrada(pool: Pool, motivo: string, minutos = 24 * 60): Promise<void> {
  await pausar(pool, 'entrada', minutos, motivo);
}
