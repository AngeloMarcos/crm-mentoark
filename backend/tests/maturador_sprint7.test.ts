/**
 * Sprint 7 do maturador v5 (2026-10-18): controles por chip, rotina, velocidade e progresso.
 */
import { describe, it, expect } from 'vitest';
import {
  velocidadeEfetiva, estadoControles, progressoAquecimento, dormindo, horaDeStatus,
  CONTROLES_PADRAO, FATOR_VELOCIDADE, TOTAL_DIAS_AQUECIMENTO,
} from '../src/services/maturadorControles';

const dias = (n: number) => new Date(Date.now() - n * 86_400_000);

describe('velocidadeEfetiva', () => {
  it('trava em lenta nos 2 primeiros dias, mesmo com fase avançada', () => {
    expect(velocidadeEfetiva('rapida', { fase: 'madura', primeira_conexao_em: dias(1) })).toMatchObject({ efetivo: 'lenta', travado: true });
  });
  it('trava em lenta em Perfil e Aquecimento 1', () => {
    for (const fase of ['perfil', 'aquecimento_1']) {
      expect(velocidadeEfetiva('rapida', { fase, primeira_conexao_em: dias(10) })).toMatchObject({ efetivo: 'lenta', travado: true });
    }
  });
  it('libera a escolha depois disso', () => {
    expect(velocidadeEfetiva('rapida', { fase: 'aquecimento_2', primeira_conexao_em: dias(10) })).toEqual({ efetivo: 'rapida', travado: false, motivo: null });
    expect(velocidadeEfetiva('lenta', { fase: 'madura', primeira_conexao_em: dias(40) }).efetivo).toBe('lenta');
  });
  it('lenta descansa mais e manda menos; rápida o contrário', () => {
    expect(FATOR_VELOCIDADE.lenta.pausa).toBeGreaterThan(1);
    expect(FATOR_VELOCIDADE.lenta.teto).toBeLessThan(1);
    expect(FATOR_VELOCIDADE.rapida.pausa).toBeLessThan(1);
    expect(FATOR_VELOCIDADE.rapida.teto).toBeGreaterThan(1);
  });
});

describe('estadoControles', () => {
  it('chip que só recebe: conversas e status começam quando amadurecer', () => {
    const e = estadoControles(CONTROLES_PADRAO, { fase: 'perfil', so_recebe: 'número novo' });
    expect(e.conversas).toMatchObject({ ligado: true, ativo_agora: false, situacao: 'Começa quando o chip amadurecer' });
    expect(e.status.ativo_agora).toBe(false);
  });
  it('Aquecimento 2 só recebendo: já responde', () => {
    expect(estadoControles(CONTROLES_PADRAO, { fase: 'aquecimento_2', so_recebe: 'proteção' }).conversas.situacao).toMatch(/Respondendo/);
  });
  it('chip liberado: conversas e status ativos; desligado aparece desligado', () => {
    const e = estadoControles({ ...CONTROLES_PADRAO, status: false }, { fase: 'madura', so_recebe: null });
    expect(e.conversas.ativo_agora).toBe(true);
    expect(e.status).toMatchObject({ ligado: false, ativo_agora: false, situacao: 'Desligado' });
  });
  it('quarentena para tudo', () => {
    const e = estadoControles(CONTROLES_PADRAO, { fase: 'quarentena', so_recebe: 'quarentena' });
    expect(Object.values(e).every(x => !x.ativo_agora)).toBe(true);
  });
});

describe('progressoAquecimento', () => {
  it('madura = 100%, início do Perfil = 0%', () => {
    expect(progressoAquecimento('madura', null)).toEqual({ dia: TOTAL_DIAS_AQUECIMENTO, percentual: 100 });
    expect(progressoAquecimento('perfil', new Date())).toMatchObject({ dia: 0, percentual: 0 });
  });
  it('avança dentro da fase sem passar do início da próxima', () => {
    expect(progressoAquecimento('aquecimento_2', dias(3)).dia).toBe(8);   // começa no dia 5
    expect(progressoAquecimento('aquecimento_2', dias(30)).dia).toBe(12); // trava no início do Aq3
  });
});

describe('rotina', () => {
  it('dorme 00–07 e publica status só 14–20', () => {
    expect([0, 3, 6].every(dormindo)).toBe(true);
    expect([7, 12, 23].some(dormindo)).toBe(false);
    expect([14, 19].every(horaDeStatus)).toBe(true);
    expect([13, 20, 9].some(horaDeStatus)).toBe(false);
  });
});
