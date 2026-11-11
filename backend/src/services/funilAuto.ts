/**
 * funilAuto.ts — Funil que anda sozinho (2026-11-02, modelo atendIA — ver
 * diagnosticos/engenharia_reversa_atendia/RELATORIO_FUNIL_AUTOMATICO.md).
 *
 * Um funil por conta, um card por contato: a etapa é `contatos.funil_estagio_id` (a mesma que os
 * Disparos já filtram). Duas camadas:
 *  1. Ação da IA "mover_no_funil": durante a resposta, a IA pede para mover o card para uma etapa
 *     da lista que o agente liberou. O motor só executa DEPOIS que a resposta saiu; etapa de
 *     Ganho/Perdido nunca é destino da IA ("a IA não fecha venda sozinha").
 *  2. Automações da etapa: quando um card entra (pela IA, pela tela ou pela API), rodam uma vez,
 *     na ordem. Falha numa automação não desfaz o movimento: vira evento no histórico.
 * Todo movimento (feito ou recusado) vira linha em `funil_eventos`.
 */
import { Pool } from 'pg';
import type { MCPTool } from './mcp/tools';
import { log } from '../logger';

export type TipoEtapa = 'aberta' | 'ganho' | 'perdido';
export type OrigemMovimento = 'manual' | 'ia' | 'api' | 'automacao';

export interface AutomacaoEtapa {
  tipo: 'adicionar_etiqueta' | 'definir_responsavel';
  ativo: boolean;
  etiqueta?: string;
  responsavel?: string;
}

export interface EtapaFunil {
  id: string;
  nome: string;
  tipo: TipoEtapa;
  cor?: string | null;
  ordem?: number | null;
  automacoes?: AutomacaoEtapa[] | null;
}

export interface AcoesFunil {
  mover: { ativo: boolean; etapas: string[]; quando: string };
}

export const ETAPAS_PADRAO: Array<{ nome: string; cor: string; tipo: TipoEtapa }> = [
  { nome: 'Novo lead', cor: '#3b82f6', tipo: 'aberta' },
  { nome: 'Em conversa', cor: '#6366f1', tipo: 'aberta' },
  { nome: 'Interessado', cor: '#f59e0b', tipo: 'aberta' },
  { nome: 'Proposta', cor: '#8b5cf6', tipo: 'aberta' },
  { nome: 'Ganho', cor: '#10b981', tipo: 'ganho' },
  { nome: 'Perdido', cor: '#ef4444', tipo: 'perdido' },
];

/** Motivos de recusa, com o texto que aparece no histórico do card. */
export const MOTIVOS: Record<string, string> = {
  fora_da_lista: 'A IA pediu uma etapa que não está na lista liberada para ela.',
  ja_estava: 'Já estava nesta etapa — nada mudou.',
  etapa_fechada: 'Ganho/Perdido não é destino da IA: ela não fecha venda sozinha.',
  mensagem_nao_saiu: 'A resposta da IA não foi entregue, então o movimento foi cancelado.',
  sem_contato: 'Este contato não existe mais.',
  etapa_inexistente: 'A etapa escolhida não existe mais.',
  motivo_obrigatorio: 'Escolha o motivo da perda.',
  motivo_invalido: 'Motivo de perda inválido.',
};

/** Etapa de perda pede motivo quando a conta exige ("Motivo obrigatório" em Motivos e regras de atendimento). */
export function motivoDePerdaFaltando(tipoDestino: TipoEtapa, motivoId: string | null | undefined, obrigatorio: boolean): boolean {
  return tipoDestino === 'perdido' && obrigatorio && !motivoId;
}

/** Ganhos ÷ (ganhos + perdidos); null quando nada fechou. */
export function taxaConversao(ganhos: number, perdidos: number): number | null {
  return ganhos + perdidos > 0 ? ganhos / (ganhos + perdidos) : null;
}

const TIPOS_ETAPA = new Set<TipoEtapa>(['aberta', 'ganho', 'perdido']);
export const tipoEtapa = (v: unknown): TipoEtapa => (TIPOS_ETAPA.has(v as TipoEtapa) ? (v as TipoEtapa) : 'aberta');

/** Lê `agentes.acoes_funil` aceitando nulo/lixo. */
export function normalizarAcoesFunil(bruto: unknown): AcoesFunil {
  const m = (bruto && typeof bruto === 'object' ? (bruto as any).mover : null) || {};
  const etapas = Array.isArray(m.etapas) ? [...new Set(m.etapas.filter((e: unknown) => typeof e === 'string' && e))] as string[] : [];
  return {
    mover: {
      ativo: m.ativo === true,
      etapas: etapas.slice(0, 30),
      quando: typeof m.quando === 'string' ? m.quando.trim().slice(0, 1000) : '',
    },
  };
}

/** Automações válidas de uma etapa (o resto é descartado). Máximo 10. */
export function normalizarAutomacoes(bruto: unknown): AutomacaoEtapa[] {
  if (!Array.isArray(bruto)) return [];
  const saida: AutomacaoEtapa[] = [];
  for (const a of bruto) {
    if (!a || typeof a !== 'object') continue;
    const ativo = (a as any).ativo !== false;
    if ((a as any).tipo === 'adicionar_etiqueta') {
      const etiqueta = String((a as any).etiqueta || '').trim().slice(0, 60);
      saida.push({ tipo: 'adicionar_etiqueta', ativo, etiqueta });
    } else if ((a as any).tipo === 'definir_responsavel') {
      const responsavel = String((a as any).responsavel || '').trim().slice(0, 120);
      saida.push({ tipo: 'definir_responsavel', ativo, responsavel });
    }
    if (saida.length >= 10) break;
  }
  return saida;
}

/** Etapas para onde a IA pode mover: liberadas no agente, que ainda existem e estão abertas. */
export function etapasPermitidasIA(acoes: AcoesFunil, etapas: EtapaFunil[]): EtapaFunil[] {
  if (!acoes.mover.ativo) return [];
  const liberadas = new Set(acoes.mover.etapas);
  return etapas.filter(e => liberadas.has(e.id) && tipoEtapa(e.tipo) === 'aberta');
}

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/** Decide o pedido da IA (por nome ou id) sem tocar no banco. */
export function decidirMovimentoIA(
  permitidas: EtapaFunil[], todas: EtapaFunil[], etapaAtualId: string | null, destino: unknown,
): { ok: true; etapa: EtapaFunil } | { ok: false; motivo: keyof typeof MOTIVOS; etapa?: EtapaFunil } {
  const alvo = semAcento(String(destino ?? ''));
  const achar = (lista: EtapaFunil[]) => lista.find(e => e.id === destino || semAcento(e.nome) === alvo);
  const etapa = achar(permitidas);
  if (!etapa) {
    const fechada = achar(todas);
    return { ok: false, motivo: fechada && tipoEtapa(fechada.tipo) !== 'aberta' ? 'etapa_fechada' : 'fora_da_lista', etapa: fechada };
  }
  if (etapa.id === etapaAtualId) return { ok: false, motivo: 'ja_estava', etapa };
  return { ok: true, etapa };
}

/** Ferramenta oferecida ao modelo, só com as etapas liberadas (enum) e a regra de quando usar. */
export function montarFerramentaMover(permitidas: EtapaFunil[], quando: string, etapaAtual: EtapaFunil | null): MCPTool | null {
  if (!permitidas.length) return null;
  const nomes = permitidas.map(e => e.nome);
  return {
    name: 'mover_no_funil',
    description:
      `Move este cliente para outra etapa do funil de vendas quando a conversa mostrar isso. ` +
      `Etapa atual: ${etapaAtual ? `"${etapaAtual.nome}"` : 'fora do funil'}. ` +
      `Etapas permitidas: ${nomes.map(n => `"${n}"`).join(', ')}. ` +
      (quando ? `Quando usar: ${quando} ` : '') +
      `Use só com sinal claro na conversa; não use para a etapa em que ele já está. Não avise o cliente que moveu.`,
    input_schema: {
      type: 'object',
      properties: {
        etapa: { type: 'string', description: 'Nome exato da etapa de destino', enum: nomes },
        motivo: { type: 'string', description: 'O sinal da conversa que justifica, em uma frase curta' },
      },
      required: ['etapa', 'motivo'],
    },
  };
}

// ── Banco ────────────────────────────────────────────────────────────────────

export async function listarEtapas(pool: Pool, userId: string): Promise<EtapaFunil[]> {
  const r = await pool.query(
    `SELECT id, nome, COALESCE(tipo, 'aberta') AS tipo, cor, ordem, COALESCE(automacoes, '[]'::jsonb) AS automacoes
       FROM funil_estagios WHERE user_id = $1 ORDER BY ordem, created_at`, [userId]);
  return r.rows.map(e => ({ ...e, tipo: tipoEtapa(e.tipo) }));
}

/** Conta sem etapas ganha as padrão (Ganho/Perdido já marcados). Idempotente. */
export async function garantirEtapasPadrao(pool: Pool, userId: string): Promise<EtapaFunil[]> {
  const atuais = await listarEtapas(pool, userId);
  if (atuais.length) return atuais;
  for (const [i, e] of ETAPAS_PADRAO.entries()) {
    await pool.query(`INSERT INTO funil_estagios (user_id, nome, cor, ordem, tipo) VALUES ($1, $2, $3, $4, $5)`,
      [userId, e.nome, e.cor, i, e.tipo]);
  }
  return listarEtapas(pool, userId);
}

export async function registrarEventoFunil(pool: Pool, ev: {
  userId: string; contatoId: string; de?: string | null; para?: string | null; origem: OrigemMovimento;
  resultado: 'feito' | 'recusado' | 'falhou'; agenteId?: string | null; motivo?: string | null; motivoId?: string | null; detalhe?: Record<string, unknown>;
}): Promise<void> {
  await pool.query(
    `INSERT INTO funil_eventos (user_id, contato_id, de_estagio_id, para_estagio_id, origem, resultado, agente_id, motivo, detalhe, motivo_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [ev.userId, ev.contatoId, ev.de ?? null, ev.para ?? null, ev.origem, ev.resultado, ev.agenteId ?? null,
     ev.motivo?.slice(0, 500) ?? null, JSON.stringify(ev.detalhe ?? {}), ev.motivoId ?? null],
  ).catch(err => log.warn('FUNIL', 'Falha ao registrar evento', { err: err?.message }));
}

/**
 * Move o card e roda as automações da etapa de destino. `paraEstagioId = null` tira do funil.
 * Devolve o que aconteceu (para a tela mostrar e a IA receber de volta).
 */
export async function moverNoFunil(pool: Pool, p: {
  userId: string; contatoId: string; paraEstagioId: string | null; origem: OrigemMovimento;
  agenteId?: string | null; motivo?: string | null; motivoId?: string | null;
}): Promise<{ ok: boolean; motivo?: string; automacoes: Array<{ tipo: string; ok: boolean; erro?: string }> }> {
  const contato = (await pool.query(
    `SELECT id, funil_estagio_id, tags, responsavel FROM contatos WHERE id = $1 AND user_id = $2`, [p.contatoId, p.userId])).rows[0];
  if (!contato) return { ok: false, motivo: 'sem_contato', automacoes: [] };

  let destino: EtapaFunil | null = null;
  if (p.paraEstagioId) {
    destino = (await listarEtapas(pool, p.userId)).find(e => e.id === p.paraEstagioId) ?? null;
    if (!destino) return { ok: false, motivo: 'etapa_inexistente', automacoes: [] };
  }
  if ((contato.funil_estagio_id ?? null) === (destino?.id ?? null)) return { ok: false, motivo: 'ja_estava', automacoes: [] };

  // Perda: motivo do cadastro da conta (motivos.tipo = 'perda'); o nome vai também no texto do histórico.
  let motivoTexto = p.motivo ?? null;
  let motivoId: string | null = null;
  if (destino?.tipo === 'perdido') {
    const conta = (await pool.query(`SELECT COALESCE(owner_id, id) AS dono FROM users WHERE id = $1`, [p.userId])).rows[0]?.dono ?? p.userId;
    if (p.motivoId) {
      const m = (await pool.query(
        `SELECT id, nome FROM motivos WHERE id::text = $1 AND user_id = $2 AND tipo = 'perda' AND ativo`, [p.motivoId, conta])).rows[0];
      if (!m) return { ok: false, motivo: 'motivo_invalido', automacoes: [] };
      motivoId = m.id;
      motivoTexto = m.nome;
    } else {
      const obrigatorio = (await pool.query(`SELECT motivo_obrigatorio FROM atendimento_config WHERE user_id = $1`, [conta])
        .catch(() => ({ rows: [] as any[] }))).rows[0]?.motivo_obrigatorio === true;
      if (motivoDePerdaFaltando('perdido', null, obrigatorio)) return { ok: false, motivo: 'motivo_obrigatorio', automacoes: [] };
    }
  }

  await pool.query(
    `UPDATE contatos SET funil_estagio_id = $3, funil_entrou_em = CASE WHEN $3::uuid IS NULL THEN NULL ELSE NOW() END, updated_at = NOW()
      WHERE id = $1 AND user_id = $2`, [p.contatoId, p.userId, destino?.id ?? null]);
  await registrarEventoFunil(pool, {
    userId: p.userId, contatoId: p.contatoId, de: contato.funil_estagio_id, para: destino?.id ?? null,
    origem: p.origem, resultado: 'feito', agenteId: p.agenteId, motivo: motivoTexto, motivoId,
  });

  const resultados: Array<{ tipo: string; ok: boolean; erro?: string }> = [];
  for (const a of normalizarAutomacoes(destino?.automacoes).filter(a => a.ativo)) {
    try {
      if (a.tipo === 'adicionar_etiqueta') {
        if (!a.etiqueta) throw new Error('etiqueta não configurada');
        await pool.query(
          `UPDATE contatos SET tags = ARRAY(SELECT DISTINCT unnest(COALESCE(tags, '{}') || ARRAY[$3]::text[])), updated_at = NOW()
            WHERE id = $1 AND user_id = $2`, [p.contatoId, p.userId, a.etiqueta]);
      } else if (a.tipo === 'definir_responsavel') {
        if (!a.responsavel) throw new Error('responsável não configurado');
        await pool.query(`UPDATE contatos SET responsavel = $3, updated_at = NOW() WHERE id = $1 AND user_id = $2`,
          [p.contatoId, p.userId, a.responsavel]);
      }
      resultados.push({ tipo: a.tipo, ok: true });
    } catch (err: any) {
      resultados.push({ tipo: a.tipo, ok: false, erro: err?.message });
      await registrarEventoFunil(pool, {
        userId: p.userId, contatoId: p.contatoId, para: destino?.id ?? null, origem: 'automacao', resultado: 'falhou',
        motivo: `Automação "${a.tipo}" não rodou: ${err?.message}`,
      });
    }
  }
  if (resultados.length) {
    await registrarEventoFunil(pool, {
      userId: p.userId, contatoId: p.contatoId, para: destino?.id ?? null, origem: 'automacao', resultado: 'feito',
      motivo: `${resultados.filter(r => r.ok).length} de ${resultados.length} automação(ões) da etapa executada(s)`,
      detalhe: { automacoes: resultados },
    });
  }
  return { ok: true, automacoes: resultados };
}

/** Prepara a ação do funil para um turno da IA: ferramenta (ou null) + o que é preciso para decidir. */
export async function prepararFunilIA(pool: Pool, userId: string, agente: Record<string, any>, contatoId: string | null) {
  const acoes = normalizarAcoesFunil(agente.acoes_funil);
  if (!acoes.mover.ativo || !acoes.mover.etapas.length) return null;
  const todas = await listarEtapas(pool, userId).catch(() => [] as EtapaFunil[]);
  const permitidas = etapasPermitidasIA(acoes, todas);
  if (!permitidas.length) return null;
  const etapaAtualId = contatoId
    ? (await pool.query(`SELECT funil_estagio_id FROM contatos WHERE id = $1 AND user_id = $2`, [contatoId, userId]).catch(() => ({ rows: [] as any[] }))).rows[0]?.funil_estagio_id ?? null
    : null;
  const etapaAtual = todas.find(e => e.id === etapaAtualId) ?? null;
  const ferramenta = montarFerramentaMover(permitidas, acoes.mover.quando, etapaAtual);
  return ferramenta ? { ferramenta, permitidas, todas, etapaAtualId } : null;
}
