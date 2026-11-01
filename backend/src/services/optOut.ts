/**
 * optOut.ts — reconhece pedido para PARAR de receber mensagens (2026-11-01, anti-banimento).
 *
 * Antes (webhook.ts) só valia a mensagem EXATAMENTE igual a uma palavra ("sair", "parar"...):
 * frases reais como "para de me mandar mensagem" ou "me tira dessa lista" passavam batido, a
 * próxima campanha chegava de novo e a pessoa denunciava o número — a causa nº 1 de banimento.
 *
 * Conservador de propósito: "agora não", "não quero agora", "não tenho interesse" NÃO são
 * opt-out (são um "não" de momento; a IA responde com a porta aberta e não insiste).
 */

/** minúsculas, sem acento, sem pontuação e espaços simples. */
export function normalizarTexto(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Mensagens que, sozinhas, são um pedido de saída. */
const PALAVRAS_EXATAS = new Set([
  'sair', 'stop', 'parar', 'pare', 'cancelar', 'remover', 'nao quero', 'spam', 'descadastrar',
  'me tira da lista', 'nao quero mais', 'para', 'chega', 'bloquear', 'unsubscribe',
]);

/** Frases em qualquer posição da mensagem. */
const FRASES: RegExp[] = [
  /\b(para|pare|parem|parar) de (me )?(mandar|enviar|chamar|incomodar|mandarem|enviarem)\b/,
  /\bnao (quero|desejo) (mais )?(receber|mensage)/,
  /\bnao (me )?(mande|envie|mandem|enviem|chame|chamem) mais\b/,
  /\b(me )?(tira|tire|remove|remova|exclui|exclua|retira|retire|apaga|apague) (o )?(meu numero|meu contato|da (sua |essa |dessa )?lista|dessa lista|daqui)\b/,
  /\bnao autorizei\b/,
  /\bquem (te |lhe |vos )?(deu|passou) (o )?meu (numero|contato|telefone)\b/,
  /\b(vou )?denunciar\b/,
  /\b(descadastr|cancelar (a )?inscri)/,
  /\bisso e spam\b/,
];

export function ehPedidoOptOut(texto: string | null | undefined): boolean {
  const t = normalizarTexto(String(texto || ''));
  if (!t) return false;
  if (PALAVRAS_EXATAS.has(t)) return true;
  return FRASES.some(re => re.test(t));
}
