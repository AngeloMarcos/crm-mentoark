/**
 * Quem pode receber um disparo — regras puras, com o MOTIVO de cada exclusão (nada some em silêncio).
 * Rodada na pré-checagem (recorte da audiência) e de novo no envio. Inspirado em `elegibilidade.ts`
 * do DeskcommCRM (MIT, Copyright (c) 2026 Rafael Melgaço).
 */
export interface ContatoParaChecagem {
  id: string;
  telefone: string | null;
  telefone_normalizado: string | null;
  tipo_telefone: string | null;
  whatsapp_status: string | null;
  opt_out: boolean | null;
  bot_detectado: boolean | null;
  resposta_categoria: string | null;
  resposta_em: string | Date | null;
  ultimo_disparo_em: string | Date | null;
  nome_confiavel: boolean | null;
  propensao: number | string | null;
}

export interface OpcoesElegibilidade {
  agora?: Date;
  cooldownHoras?: number;          // 0 = sem cooldown
  excluirRobos?: boolean;          // padrão true
  excluirSemNome?: boolean;        // padrão false (80% dos contatos de grupo não têm nome)
  diasSuprimirNegativa?: number;   // padrão 90
}

export type MotivoExclusao =
  | 'sem_telefone' | 'telefone_invalido' | 'grupo_ou_lid' | 'opt_out' | 'resposta_negativa'
  | 'robo' | 'sem_whatsapp' | 'cooldown' | 'sem_nome';

export const ROTULOS_EXCLUSAO: Record<MotivoExclusao, string> = {
  sem_telefone: 'sem telefone',
  telefone_invalido: 'telefone inválido ou fixo',
  grupo_ou_lid: 'grupo ou número oculto (LID)',
  opt_out: 'pediu para não receber',
  resposta_negativa: 'já recusou',
  robo: 'atendimento automático (robô)',
  sem_whatsapp: 'sem WhatsApp',
  cooldown: 'em cooldown',
  sem_nome: 'sem nome',
};

const ms = (d: string | Date | null): number => (d ? new Date(d).getTime() : NaN);

export function avaliarElegibilidade(c: ContatoParaChecagem, o: OpcoesElegibilidade = {}): MotivoExclusao | null {
  const agora = (o.agora ?? new Date()).getTime();
  const digitos = String(c.telefone_normalizado || c.telefone || '').replace(/\D/g, '');

  if (!digitos) return 'sem_telefone';
  if (c.tipo_telefone === 'invalido' || c.tipo_telefone === 'fixo') return 'telefone_invalido';
  if (digitos.length > 15) return 'grupo_ou_lid';
  if (c.opt_out === true) return 'opt_out';

  const cat = c.resposta_categoria;
  if (cat === 'opt_out') return 'opt_out';
  if (cat === 'negativa') {
    const quando = ms(c.resposta_em);
    const janela = (o.diasSuprimirNegativa ?? 90) * 86_400_000;
    if (!Number.isFinite(quando) || agora - quando < janela) return 'resposta_negativa';
  }
  if (c.bot_detectado === true && o.excluirRobos !== false) return 'robo';
  if (c.whatsapp_status === 'sem_whatsapp') return 'sem_whatsapp';

  const cooldown = (o.cooldownHoras ?? 0) * 3_600_000;
  if (cooldown > 0) {
    const ultimo = ms(c.ultimo_disparo_em);
    if (Number.isFinite(ultimo) && agora - ultimo < cooldown) return 'cooldown';
  }
  if (o.excluirSemNome === true && c.nome_confiavel !== true) return 'sem_nome';
  return null;
}

export interface RecorteAudiencia {
  total: number;
  elegiveis: ContatoParaChecagem[];
  excluidos: Partial<Record<MotivoExclusao, number>>;
}

/** Separa elegíveis (ordenados por propensão, do mais provável ao menos; sem histórico por último) dos excluídos. */
export function montarRecorte(contatos: ContatoParaChecagem[], o: OpcoesElegibilidade = {}): RecorteAudiencia {
  const excluidos: Partial<Record<MotivoExclusao, number>> = {};
  const elegiveis: ContatoParaChecagem[] = [];
  for (const c of contatos) {
    const motivo = avaliarElegibilidade(c, o);
    if (motivo) excluidos[motivo] = (excluidos[motivo] ?? 0) + 1;
    else elegiveis.push(c);
  }
  const p = (c: ContatoParaChecagem) => (c.propensao === null || c.propensao === undefined ? -1 : Number(c.propensao));
  const ordenados = elegiveis.map((c, i) => ({ c, i })).sort((a, b) => p(b.c) - p(a.c) || a.i - b.i).map(x => x.c);
  return { total: contatos.length, elegiveis: ordenados, excluidos };
}
