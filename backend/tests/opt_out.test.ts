/**
 * Opt-out por frase (2026-11-01, anti-banimento): reconhecer quem pede para parar, sem confundir
 * com um "não" de momento.
 */
import { describe, it, expect } from 'vitest';
import { ehPedidoOptOut } from '../src/services/optOut';

describe('ehPedidoOptOut', () => {
  it('palavras exatas de antes continuam valendo', () => {
    for (const t of ['sair', 'SAIR', 'Parar.', 'stop', 'Não quero mais', 'spam']) expect(ehPedidoOptOut(t)).toBe(true);
  });

  it('frases reais que antes passavam batido', () => {
    for (const t of [
      'Para de me mandar mensagem',
      'por favor parem de enviar isso',
      'não quero receber mensagens',
      'Não me mande mais nada',
      'me tira dessa lista',
      'remove meu número',
      'Eu não autorizei vocês a me chamarem',
      'quem te deu meu número?',
      'vou denunciar',
      'isso é spam',
    ]) expect(ehPedidoOptOut(t)).toBe(true);
  });

  it('não confunde "não" de momento nem conversa normal', () => {
    for (const t of [
      'agora não', 'não quero agora', 'não tenho interesse', 'vou pensar',
      'para quando é o teste?', 'pode parar de pensar, quero o teste', 'quero saber o preço',
      'não, obrigado', '', null,
    ]) expect(ehPedidoOptOut(t as string)).toBe(false);
  });
});
