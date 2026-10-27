/**
 * Sprint 13 do maturador v5 (2026-10-27): calibragem pelas conversas reais do ChipFlow — assuntos
 * específicos, ritmo, localização, status mais raro, rodízio de parceiros no Global, marcar como lida.
 */
import { describe, it, expect } from 'vitest';
import { ASSUNTOS, MAX_FALAS, textoPermitido } from '../src/services/maturadorIA';
import { chancesMidia, localizacaoDoChip, TETO_DIA_CHIP } from '../src/services/maturadorMidia';
import { intervaloNaSessaoMin, fatorDescanso } from '../src/services/maturadorProcessor';
import { planejarVinculos, vinculosVencidos, ROTACAO_HORAS, Participante } from '../src/services/maturadorGlobal';
import { estadoControles, CONTROLES_PADRAO } from '../src/services/maturadorControles';

describe('assuntos e tamanho', () => {
  it('~100 assuntos específicos, sem repetir e sem nada de negócio', () => {
    expect(ASSUNTOS.length).toBeGreaterThanOrEqual(90);
    expect(new Set(ASSUNTOS).size).toBe(ASSUNTOS.length);
    expect(ASSUNTOS.every(textoPermitido)).toBe(true);
  });
  it('conversa vai até 10 falas', () => expect(MAX_FALAS).toBe(10));
});

describe('ritmo', () => {
  it('intervalo na conversa: rápido (0,5–2) ou normal (2–9 min)', () => {
    for (let i = 0; i < 500; i++) {
      const m = intervaloNaSessaoMin();
      expect(m).toBeGreaterThanOrEqual(0.5);
      expect(m).toBeLessThanOrEqual(9);
    }
    expect(intervaloNaSessaoMin(() => 0.1)).toBeLessThan(2);   // ramo rápido
    expect(intervaloNaSessaoMin(() => 0.9)).toBeGreaterThan(2); // ramo normal
  });
  it('descanso maior no começo do aquecimento e menor na madura', () => {
    expect(fatorDescanso('perfil')).toBeGreaterThan(fatorDescanso('aquecimento_3'));
    expect(fatorDescanso('madura')).toBeLessThan(1);
    expect(fatorDescanso(null)).toBe(1);
  });
});

describe('mídia', () => {
  it('localização rara (≤ 2,5%) e só a partir do Aquecimento 2; áudio raro', () => {
    expect(chancesMidia('aquecimento_1').localizacao).toBe(0);
    expect(chancesMidia('madura').localizacao).toBeLessThanOrEqual(0.025);
    expect(chancesMidia('madura').audio).toBeLessThan(chancesMidia('madura').figurinha);
    expect(TETO_DIA_CHIP.localizacao).toBeGreaterThan(0);
  });
  it('localização fica a até ~3 km do centro da cidade da persona', () => {
    for (let i = 0; i < 200; i++) {
      const l = localizacaoDoChip('Curitiba');
      const km = Math.hypot((l.latitude + 25.4284) * 111, (l.longitude + 49.2733) * 111 * Math.cos(25.43 * Math.PI / 180));
      expect(km).toBeLessThan(3.2);
    }
    expect(localizacaoDoChip('Cidade que não existe').address).toBe('São Paulo');
  });
});

describe('rodízio de parceiros no Aquecimento Global', () => {
  const agora = Date.now();
  const h = (n: number) => new Date(agora - n * 3_600_000);
  it('só vence conversa com mais de 48 h e sem conversa em andamento; mentoria nunca', () => {
    const v = vinculosVencidos([
      { id: 'velho', ativo: true, tipo: 'conversa', vinculado_em: h(ROTACAO_HORAS + 1), msgs_restantes_sessao: 0 },
      { id: 'novo', ativo: true, tipo: 'conversa', vinculado_em: h(10), msgs_restantes_sessao: 0 },
      { id: 'no_meio', ativo: true, tipo: 'conversa', vinculado_em: h(100), msgs_restantes_sessao: 3 },
      { id: 'mentoria', ativo: true, tipo: 'mentoria', vinculado_em: h(100), msgs_restantes_sessao: 0 },
      { id: 'inativo', ativo: false, tipo: 'conversa', vinculado_em: h(100), msgs_restantes_sessao: 0 },
    ], agora);
    expect([...v]).toEqual(['velho']);
  });
  it('quem saiu por rodízio vai pro fim da fila', () => {
    const p: Participante[] = ['a', 'b', 'c'].map((id, i) => ({ agenteId: id, userId: `u${i}`, papel: 'conversador' as const }));
    const sem = planejarVinculos(p.slice(0, 2).concat(p[2]), [], new Set());
    const com = planejarVinculos(p, [], new Set(['a|b']));
    const parDeA = (r: ReturnType<typeof planejarVinculos>) => r.criar.find(v => v.a === 'a')?.b;
    expect(parDeA(sem)).toBe('b');  // sem rodízio, ordem natural
    expect(parDeA(com)).toBe('c');  // b acabou de sair → prefere c
  });
});

describe('controle "Marcar como lida"', () => {
  it('vem ligado e pode ser desligado', () => {
    expect(CONTROLES_PADRAO.marcar_lida).toBe(true);
    expect(estadoControles({ ...CONTROLES_PADRAO, marcar_lida: false }, { fase: 'madura', so_recebe: null }).marcar_lida.situacao).toBe('Desligado');
  });
});
