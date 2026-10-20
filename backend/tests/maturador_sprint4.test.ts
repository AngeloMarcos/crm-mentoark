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

// 2026-10-20 (pedido do usuário): saúde do número não restringe mais o disparo — só banido trava.
describe('limiteDisparo — sem trava de saúde (só banido bloqueia)', () => {
  it('qualquer fase, score, quarentena, "só recebe" ou sem-resposta → 200/dia, disparo frio', () => {
    for (const fase of ['perfil', 'aquecimento_1', 'aquecimento_2', 'aquecimento_3', 'pre_oficial', 'madura', 'quarentena', null] as any[]) {
      expect(limiteDisparo(fase, null, 90)).toMatchObject({ limite: 200, somenteConhecidos: false, motivo: null });
    }
    expect(limiteDisparo('madura', null, 10, 'número novo', LIMITE_SEM_RESPOSTA_30D)).toMatchObject({ limite: 200, somenteConhecidos: false });
  });
  it('número banido continua bloqueado', () => {
    expect(limiteDisparo('banida', null, 90).limite).toBe(0);
  });
});
