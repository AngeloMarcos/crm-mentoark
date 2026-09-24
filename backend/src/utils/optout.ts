/**
 * Detecção de pedido de descadastro por INTENÇÃO (verbo de cessação + objeto de comunicação, ou a
 * palavra isolada) — e não pela palavra solta no meio da frase.
 *
 * Porte (só pt-BR, simplificado) de `lib/opt-out/deteccao.ts` do DeskcommCRM.
 * MIT License — Copyright (c) 2026 Rafael Melgaço. https://github.com/melgarafael/DeskcommCRM
 *
 * Dois níveis, e a diferença importa:
 *  - `ehPedidoDeOptOut`   INEQUÍVOCO: autoriza gravar opt_out (estado que só uma pessoa desfaz).
 *  - `ehOptOutProvavel`   inclui o AMBÍGUO ("me deixa em paz"): sinal para parar de insistir e chamar um humano.
 * Corrige falsos positivos como "posso sair antes das 15h?" e "tem como parar a dor?".
 */

/** minúsculas, sem acento — a forma sobre a qual todos os padrões daqui rodam. */
export function normalizarTexto(texto: string): string {
  return texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/gu, '');
}

/** Palavra-chave enviada SOZINHA (mensagem inteira = a palavra). */
export const PALAVRAS_DE_OPT_OUT: ReadonlySet<string> = new Set([
  'stop', 'parar', 'pare', 'sair', 'cancelar', 'descadastrar', 'remover', 'unsubscribe',
]);

const VERBOS_DE_COMUNICACAO =
  'mandar|manda|mande|mandem|enviar|envia|envie|enviem|receber|recebe|escrever|escreve|' +
  'chamar|chama|ligar|liga|perturbar|perturba|encher|enche|insistir|insiste';

/** Objetos que NÃO são a comunicação em si — pedido, fatura, boleto: quem diz isso quer continuar sendo atendido. */
const OBJETOS_NAO_COMUNICATIVOS =
  'pedido|pedidos|encomenda|encomendas|pacote|pacotes|entrega|entregas|' +
  'fatura|faturas|boleto|boletos|cobranca|cobrancas|produto|produtos';

const DETERMINANTES_DE_OBJETO = 'o|a|os|as|meu|minha|meus|minhas|seu|sua|seus|suas|esse|essa|esses|essas|nesse|nessa';

const SEM_OBJETO_NAO_COMUNICATIVO = `(?!\\s+(?:${DETERMINANTES_DE_OBJETO})?\\s*(?:${OBJETOS_NAO_COMUNICATIVOS})\\b)`;

const FRASES_DE_OPT_OUT: readonly RegExp[] = [
  // "pare de me mandar", "parar de receber" — mas NÃO "pare de mandar o pedido nesse endereço"
  new RegExp(`\\bpar(?:ar|a|e|em)\\s+de\\s+(?:me\\s+)?(?:${VERBOS_DE_COMUNICACAO})\\b${SEM_OBJETO_NAO_COMUNICATIVO}`, 'u'),
  // "não quero (mais) receber" — mas "não quero receber ligação, só whatsapp" é troca de canal
  /\bnao\s+(?:quero|desejo|gostaria)\s+(?:de\s+)?(?:mais\s+)?receber\b(?!\s+(?:ligacao|ligacoes|chamada|chamadas|telefonema|telefonemas|telefone)\b)/u,
  /\bnao\s+quero\s+receber\s+mais\b/u,
  /\bnao\s+quero\s+mais\s+(?:mensagem|mensagens|contato|nada\s+de\s+voces)\b/u,
  // "não me mande mais" — mas NÃO "não me mande mais boletos"
  new RegExp(`\\bnao\\s+me\\s+(?:mande|manda|mandem|envie|envia|enviem|chame|chama|ligue|liga)\\s+mais\\b${SEM_OBJETO_NAO_COMUNICATIVO}`, 'u'),
  /\bme\s+(?:tira|tire|tirem|remove|remova|removam|retira|retire|exclui|exclua|apaga|apague)\s+(?:da|dessa|desta|de\s+sua|da\s+sua)\s+lista\b/u,
  /\bsair\s+d(?:a|essa|esta)\s+lista\b/u,
  /\bcancelar?\s+(?:a\s+)?(?:inscricao|assinatura)\b/u,
  /\b(?:me\s+)?descadastr\w*\b/u,
  /\bdescadastro\b/u,
];

/** Sugerem que a pessoa quer parar sem nomear a mensagem: só param a insistência, não bloqueiam. */
const FRASES_AMBIGUAS_DE_OPT_OUT: readonly RegExp[] = [
  /\bme\s+deixa?\s+(?:em\s+paz|quieto|quieta)\b/u,
  /\bja\s+(?:disse|falei)\s+que\s+nao\s+(?:quero|tenho\s+interesse)\b/u,
  /\bnao\s+(?:me\s+)?interessa\s+mais\b/u,
  /\bpara\s+com\s+isso\b/u,
];

function ehPalavraIsolada(normalizado: string): boolean {
  return PALAVRAS_DE_OPT_OUT.has(normalizado.replace(/[^a-z]/gu, ''));
}

export function ehPedidoDeOptOut(texto: string | null | undefined): boolean {
  if (!texto) return false;
  const n = normalizarTexto(texto.trim());
  if (n === '') return false;
  if (ehPalavraIsolada(n)) return true;
  return FRASES_DE_OPT_OUT.some(re => re.test(n));
}

export function ehOptOutProvavel(texto: string | null | undefined): boolean {
  if (!texto) return false;
  if (ehPedidoDeOptOut(texto)) return true;
  const n = normalizarTexto(texto.trim());
  return FRASES_AMBIGUAS_DE_OPT_OUT.some(re => re.test(n));
}
