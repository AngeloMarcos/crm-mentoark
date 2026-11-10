/**
 * Sprint Relatórios de Atendimento v1: período do relatório (fuso de Brasília).
 */
import { describe, it, expect } from 'vitest';
import { lerPeriodo } from '../src/services/relatorioAtendimento';

// 10/11/2026 15:00 em Brasília.
const AGORA = new Date('2026-11-10T18:00:00Z');

describe('período do relatório', () => {
  it('padrão: últimos 7 dias contando hoje, de meia-noite a meia-noite em Brasília', () => {
    const p = lerPeriodo({}, AGORA);
    expect(p.erro).toBeUndefined();
    expect(p.de!.toISOString()).toBe('2026-11-04T03:00:00.000Z');
    expect(p.ate!.toISOString()).toBe('2026-11-11T03:00:00.000Z');
    expect(p.dias).toBe(7);
  });

  it('datas informadas incluem o último dia inteiro', () => {
    const p = lerPeriodo({ de: '2026-11-01', ate: '2026-11-01' }, AGORA);
    expect(p.de!.toISOString()).toBe('2026-11-01T03:00:00.000Z');
    expect(p.ate!.toISOString()).toBe('2026-11-02T03:00:00.000Z');
    expect(p.dias).toBe(1);
  });

  it('aceita até 92 dias', () => {
    expect(lerPeriodo({ de: '2026-08-11', ate: '2026-11-10' }, AGORA).dias).toBe(92);
    expect(lerPeriodo({ de: '2026-08-10', ate: '2026-11-10' }, AGORA).erro).toMatch(/92/);
  });

  it('recusa data invertida', () => {
    expect(lerPeriodo({ de: '2026-11-10', ate: '2026-11-01' }, AGORA).erro).toBeTruthy();
  });

  it.each(['2026-13-01', '10/11/2026', "2026-11-01' OR 1=1", '2026-02-30'])('recusa data inválida %s', de => {
    expect(lerPeriodo({ de, ate: '2026-11-10' }, AGORA).erro).toBeTruthy();
  });

  it('só uma das datas: a outra vem do padrão', () => {
    expect(lerPeriodo({ ate: '2026-11-05' }, AGORA).de!.toISOString()).toBe('2026-10-30T03:00:00.000Z');
    expect(lerPeriodo({ de: '2026-11-08' }, AGORA).ate!.toISOString()).toBe('2026-11-11T03:00:00.000Z');
  });
});
