/**
 * Classifica a resposta a um disparo — só regras, sem IA.
 *
 *  opt_out       pediu para parar (inequívoco)            → grava opt_out
 *  negativa      recusou ("não tenho interesse")          → não insistir por um tempo
 *  auto_resposta robô/atendimento automático da empresa   → tira de follow-up e mede à parte
 *  interesse     demonstrou interesse                     → lead quente
 *  outra         neutra/dúvida/saudação
 *
 * A ORDEM importa: opt-out → negativa → robô → interesse. "Não tenho interesse" contém "tenho
 * interesse", e um robô de boas-vindas pode conter "gostaria de conhecer": por isso a recusa e o
 * robô são checados antes do interesse.
 */
import { ehOptOutProvavel, ehPedidoDeOptOut, normalizarTexto } from './optout';

export type CategoriaResposta = 'opt_out' | 'negativa' | 'auto_resposta' | 'interesse' | 'outra';

export interface ClassificacaoResposta { categoria: CategoriaResposta; motivo: string }

/** Recusa educada — não é pedido de descadastro, mas a pessoa disse que não. */
const RECUSA: readonly RegExp[] = [
  /\bnao\s+(?:tenho|tem|temos)\s+interesse\b/u,
  /\bsem\s+interesse\b/u,
  /\bnao\s+(?:preciso|precisamos|necessito)\b/u,
  /\bnao\s+(?:quero|queremos|desejo)\b(?!\s+(?:sair|cancelar))/u,
  /\bnao\s+(?:obrigad[oa]|)\s*(?:no\s+momento|agora)\b/u,
  /\bno\s+momento\s+nao\s+(?:tenho|preciso|quero|temos)\b/u,
  /\bnao\s+(?:é|e)\s+(?:pra|para)\s+mim\b/u,
  /\bnao\s+me\s+interessa\b/u,
  /\bpode\s+tirar\b/u,
];

/** Assinaturas de atendimento automático / saudação de empresa (não de pessoa). */
const AUTO: readonly RegExp[] = [
  /\bagrade(?:ce|cemos)\s+(?:seu|o|sua|a|pelo|pela)\s+(?:contato|mensagem)\b/u,
  /\bagrade(?:ce|cemos)\s+por\s+(?:entrar\s+em\s+)?contato\b/u,
  /\b(?:seja|sejam)\s+(?:muito\s+)?bem[- ]?vind[oa]s?\b/u,
  /\bbem[- ]?vind[oa]s?\s+(?:a|ao|à|ao\s+nosso)\b/u,
  /\bcomo\s+(?:podemos|posso|possamos)\s+(?:te\s+|lhe\s+|o\s+|a\s+)?ajudar\b/u,
  /\bem\s+que\s+posso\s+(?:te\s+|lhe\s+)?ajudar\b/u,
  /\bno\s+que\s+posso\s+(?:te\s+|lhe\s+)?ajudar\b/u,
  /\bassim\s+que\s+possivel\b/u,
  /\bem\s+instantes\b/u,
  /\bretornarei\s+assim\b/u,
  /\bhorario\s+de\s+atendimento\b/u,
  /\batendimento\s+(?:de|das)\s+(?:segunda|seg)\b/u,
  /\bfora\s+do\s+horario\b/u,
  /\bno\s+momento\s+(?:nao\s+)?(?:estou|estamos|posso|podemos)\s+(?:em\s+)?(?:atend|aten|dispon)/u,
  /\b(?:resposta|mensagem)\s+automatica\b/u,
  /\bdigite\s+(?:o\s+)?(?:numero|\d|a\s+opcao)/u,
  /\bescolha\s+(?:uma\s+)?(?:das\s+)?opcoes?\b/u,
  /\bja\s+recebemos\s+(?:sua|a)\s+(?:solicitacao|mensagem)\b/u,
  /\buma\s+de\s+nossas\s+atendentes\b/u,
  /\bpara\s+agilizar\s+(?:o\s+|seu\s+)?atendimento\b/u,
  /\bnosso\s+(?:time|equipe)\s+(?:ira|vai|ja)\s+(?:te\s+)?(?:responder|retornar|atender|entrar)\b/u,
];

/** Interesse — sempre depois de opt-out, recusa e robô. */
const INTERESSE: readonly RegExp[] = [
  /\bquero\b/u,
  /\bpode\s+(?:mostrar|enviar|mandar|explicar|falar)\b/u,
  /\bgostaria\s+de\s+(?:conhecer|saber|ver|entender|mais\s+informacoes)\b/u,
  /\btenho\s+interesse\b/u,
  /\bquanto\s+(?:custa|e|fica|sai)\b/u,
  /\bcomo\s+funciona\b/u,
  /\bmanda\s+(?:a\s+|uma\s+)?(?:proposta|informacoes|valores|mais)\b/u,
  /\bme\s+(?:envia|envie|manda|mande|passa|passe)\s+(?:mais|os\s+valores|a\s+proposta|informacoes|detalhes)\b/u,
  /\bvamos\s+(?:marcar|conversar|agendar)\b/u,
  /\bmais\s+informacoes\b/u,
  /\bme\s+(?:conta|explica|fala)\s+mais\b/u,
];

export function classificarResposta(texto: string | null | undefined): ClassificacaoResposta {
  const bruto = (texto ?? '').trim();
  if (!bruto) return { categoria: 'outra', motivo: 'sem texto' };
  if (ehPedidoDeOptOut(bruto)) return { categoria: 'opt_out', motivo: 'pedido de descadastro' };

  const n = normalizarTexto(bruto);
  if (ehOptOutProvavel(bruto) || RECUSA.some(re => re.test(n))) return { categoria: 'negativa', motivo: 'recusou' };

  const auto = AUTO.find(re => re.test(n));
  if (auto) return { categoria: 'auto_resposta', motivo: 'atendimento automático' };

  if (INTERESSE.some(re => re.test(n))) return { categoria: 'interesse', motivo: 'demonstrou interesse' };
  return { categoria: 'outra', motivo: 'neutra' };
}
