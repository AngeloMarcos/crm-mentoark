/**
 * Painel de chips (2026-10-27, modelo ChipFlow): o que cada card mostra que o chip está fazendo agora,
 * e nome fixo dos contatos do arquivo de contatos.
 */
import { describe, it, expect } from 'vitest';
import { atividadeDoChip, nomeDoContato } from '../src/services/maturadorPainel';

const agora = Date.UTC(2026, 9, 27, 18, 0, 0);
const base = { conectado: true, fase: 'madura', hora: 15, paresAtivos: 1, gruposAtivos: 0, ultimoEnvio: null, proxima: null, restantesSessao: 0, agora };
const min = (n: number) => new Date(agora + n * 60_000);

describe('atividadeDoChip', () => {
  it('desconectado vem antes de tudo', () => {
    expect(atividadeDoChip({ ...base, conectado: false }).atividade).toBe('desconectado');
  });
  it('quarentena/banida = parado; madrugada = dormindo', () => {
    expect(atividadeDoChip({ ...base, fase: 'quarentena' }).atividade).toBe('parado');
    expect(atividadeDoChip({ ...base, hora: 3 }).atividade).toBe('dormindo');
  });
  it('sem par nem grupo = em espera', () => {
    expect(atividadeDoChip({ ...base, paresAtivos: 0 }).atividade).toBe('em_espera');
    expect(atividadeDoChip({ ...base, paresAtivos: 0, gruposAtivos: 1, proxima: min(30) }).atividade).toBe('descansando');
  });
  it('mandou há pouco ou está no meio da conversa = aquecendo', () => {
    expect(atividadeDoChip({ ...base, ultimoEnvio: min(-3) }).atividade).toBe('aquecendo');
    expect(atividadeDoChip({ ...base, restantesSessao: 2, proxima: min(4) }).atividade).toBe('aquecendo');
  });
  it('entre conversas = descansando, com a hora em que volta', () => {
    const r = atividadeDoChip({ ...base, ultimoEnvio: min(-40), proxima: min(55) });
    expect(r).toEqual({ atividade: 'descansando', volta_em: min(55).toISOString() });
  });
});

describe('nomeDoContato', () => {
  it('o mesmo número recebe sempre o mesmo nome, e números diferentes variam', () => {
    expect(nomeDoContato('5511999990001')).toBe(nomeDoContato('5511999990001'));
    const nomes = new Set(Array.from({ length: 30 }, (_, i) => nomeDoContato(`55119999900${String(i).padStart(2, '0')}`)));
    expect(nomes.size).toBeGreaterThan(10);
  });
});
