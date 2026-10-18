/**
 * Sprint 4 do maturador sem ban (2026-10-17): banco de conversas, quem pode responder no maturador
 * e rampa de disparo por fase + freio de "sem resposta".
 */
import { describe, it, expect } from 'vitest';
import { TEMAS, aplicarVariacao, sortearTema } from '../src/services/maturadorDialogos';
import { podeResponderMaturador, motivoSoRecebe } from '../src/services/maturadorGlobal';
import { limiteDisparo, LIMITE_SEM_RESPOSTA_30D } from '../src/services/saudeNumero';

describe('banco de conversas', () => {
  it('tem 24 temas e todas as linhas resolvem spintax sem sobrar chave nem placeholder', () => {
    expect(TEMAS.length).toBe(24);
    for (const tema of TEMAS) {
      expect(tema.length).toBeGreaterThanOrEqual(4);
      for (const linha of tema) {
        expect(linha).not.toMatch(/\{\{/);
        for (let i = 0; i < 5; i++) {
          const t = aplicarVariacao(linha);
          expect(t).not.toMatch(/[{}|]/);
          expect(t.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });
  it('sorteio nunca repete o tema atual', () => {
    for (let i = 0; i < 200; i++) expect(sortearTema(3)).not.toBe(3);
  });
});

describe('podeResponderMaturador', () => {
  it('Perfil e Aquecimento 1 só recebem; Aquecimento 2+ responde', () => {
    expect(podeResponderMaturador({ fase: 'perfil' })).toBe(false);
    expect(podeResponderMaturador({ fase: 'aquecimento_1' })).toBe(false);
    for (const f of ['aquecimento_2', 'aquecimento_3', 'pre_oficial', 'madura']) expect(podeResponderMaturador({ fase: f })).toBe(true);
  });
  it('quarentena, banida e conta em revisão não respondem', () => {
    expect(podeResponderMaturador({ fase: 'quarentena' })).toBe(false);
    expect(podeResponderMaturador({ fase: 'banida' })).toBe(false);
    expect(podeResponderMaturador({ fase: 'aquecimento_2', em_revisao_desde: new Date() })).toBe(false);
  });
  it('número em Aquecimento 2 sob proteção continua "só recebe" (não inicia), mas pode responder', () => {
    const n = { fase: 'aquecimento_2', protecao_ate: new Date(Date.now() + 5 * 864e5), protecao_liberada_em: null, bans_total: 0, primeira_conexao_em: new Date() };
    expect(motivoSoRecebe(n)).toBeTruthy();
    expect(podeResponderMaturador(n)).toBe(true);
  });
});

describe('limiteDisparo — rampa por fase e freio de sem resposta', () => {
  it('Aquecimento 2/3: só contatos que já conversaram, 20 e 50 por dia', () => {
    expect(limiteDisparo('aquecimento_2', null, 90)).toMatchObject({ limite: 20, somenteConhecidos: true });
    expect(limiteDisparo('aquecimento_3', null, 90)).toMatchObject({ limite: 50, somenteConhecidos: true });
  });
  it('Pré-oficial e Madura: disparo frio liberado (100 e 200)', () => {
    expect(limiteDisparo('pre_oficial', null, 90)).toMatchObject({ limite: 100, somenteConhecidos: false });
    expect(limiteDisparo('madura', null, 90)).toMatchObject({ limite: 200, somenteConhecidos: false });
    expect(limiteDisparo(null, null, null)).toMatchObject({ limite: 200, somenteConhecidos: false });
  });
  it('muitas mensagens sem resposta em 30 dias → só contatos conhecidos', () => {
    const r = limiteDisparo('madura', null, 90, null, LIMITE_SEM_RESPOSTA_30D);
    expect(r).toMatchObject({ limite: 200, somenteConhecidos: true });
    expect(r.motivo).toMatch(/sem resposta/);
    expect(limiteDisparo('madura', null, 90, null, LIMITE_SEM_RESPOSTA_30D - 1).somenteConhecidos).toBe(false);
  });
  it('travas mais fortes continuam valendo (só recebe, score < 45, quarentena)', () => {
    expect(limiteDisparo('madura', null, 90, 'número novo').limite).toBe(0);
    expect(limiteDisparo('madura', null, 44).limite).toBe(0);
    expect(limiteDisparo('quarentena', null, 90).limite).toBe(0);
  });
});
