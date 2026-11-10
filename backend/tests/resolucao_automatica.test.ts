/**
 * Resolução automática de atendimento por inatividade (2026-11-10).
 */
import { describe, it, expect } from 'vitest';
import { lerHorasInatividade, deveResolverPorInatividade, resolverInativos } from '../src/services/resolucaoAutomatica';

const AGORA = new Date('2026-11-10T12:00:00Z');
const horasAtras = (h: number) => new Date(AGORA.getTime() - h * 3_600_000);

describe('prazo configurado pela conta', () => {
  it('0 desliga', () => {
    expect(lerHorasInatividade(0)).toEqual({ horas: 0 });
  });

  it('aceita horas inteiras até 30 dias', () => {
    expect(lerHorasInatividade(24)).toEqual({ horas: 24 });
    expect(lerHorasInatividade(720)).toEqual({ horas: 720 });
  });

  it.each([-1, 721, 1.5, '24', null, undefined])('recusa %s', v => {
    expect(lerHorasInatividade(v as any).erro).toBeTruthy();
  });
});

describe('quando resolver sozinho', () => {
  it('aberto e sem atividade há mais que o prazo', () => {
    expect(deveResolverPorInatividade({ estado: 'aberto', ultimaAtividade: horasAtras(25) }, 24, AGORA)).toBe(true);
  });

  it('exatamente no prazo também resolve', () => {
    expect(deveResolverPorInatividade({ estado: 'aberto', ultimaAtividade: horasAtras(24) }, 24, AGORA)).toBe(true);
  });

  it('com atividade recente não resolve', () => {
    expect(deveResolverPorInatividade({ estado: 'aberto', ultimaAtividade: horasAtras(23) }, 24, AGORA)).toBe(false);
  });

  it('quem pediu atendente continua na fila, por mais antigo que seja', () => {
    expect(deveResolverPorInatividade({ estado: 'aguardando', ultimaAtividade: horasAtras(500) }, 24, AGORA)).toBe(false);
  });

  it('prazo 0 nunca resolve', () => {
    expect(deveResolverPorInatividade({ estado: 'aberto', ultimaAtividade: horasAtras(500) }, 0, AGORA)).toBe(false);
  });
});

describe('cron', () => {
  it('falha de banco não derruba o processo e devolve zero', async () => {
    const pool = { connect: async () => { throw new Error('banco fora'); }, query: async () => { throw new Error('banco fora'); } } as any;
    await expect(resolverInativos(pool)).resolves.toBe(0);
  });
});
