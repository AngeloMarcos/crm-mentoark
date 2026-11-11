/**
 * Sprint Funil: perda com motivo e relatório do funil.
 */
import { describe, it, expect } from 'vitest';
import { motivoDePerdaFaltando, taxaConversao } from '../src/services/funilAuto';

describe('motivo ao perder um negócio', () => {
  it('etapa de perda sem motivo, com motivo obrigatório na conta: recusa', () => {
    expect(motivoDePerdaFaltando('perdido', null, true)).toBe(true);
  });

  it('etapa de perda sem motivo, sem exigência: aceita', () => {
    expect(motivoDePerdaFaltando('perdido', null, false)).toBe(false);
  });

  it('etapa de perda com motivo: aceita', () => {
    expect(motivoDePerdaFaltando('perdido', 'm1', true)).toBe(false);
  });

  it.each(['aberta', 'ganho'] as const)('etapa %s nunca pede motivo de perda', tipo => {
    expect(motivoDePerdaFaltando(tipo, null, true)).toBe(false);
  });
});

describe('conversão', () => {
  it('ganhos sobre o que fechou', () => {
    expect(taxaConversao(3, 1)).toBe(0.75);
  });

  it('nada fechou: sem taxa', () => {
    expect(taxaConversao(0, 0)).toBeNull();
  });
});
