/**
 * Sprint 8 do maturador v5 (2026-10-19): conversa escrita por IA, persona por chip, erros de
 * digitação no código, teto de custo e volta ao banco fixo em qualquer falha.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  gerarRoteiro, humanizar, personaDoChip, validarRoteiro, montarPrompt, estimativaCustoSessao,
  _zerarContadores, MIN_FALAS, MAX_FALAS,
} from '../src/services/maturadorIA';
import { estimarCustoUsd } from '../src/utils/aiCusto';

const queries: string[] = [];
const pool: any = { query: async (sql: string) => { queries.push(sql); return { rows: [] }; } };

let n = 0;
function providerFake(resposta?: (i: number) => string) {
  return {
    provider: {
      complete: async () => {
        n++;
        const linhas = Array.from({ length: 5 }, (_, j) => `fala ${j} da conversa número ${n} sobre o almoço de hoje`);
        return { text: resposta ? resposta(n) : JSON.stringify({ assunto: 'almoço', linhas }), toolCalls: [], inputTokens: 700, outputTokens: 250, finishReason: 'stop' };
      },
    },
    modelo: 'gpt-4o-mini', providerSlug: 'openai',
  } as any;
}

beforeEach(() => { _zerarContadores(); queries.length = 0; n = 0; delete process.env.MATURADOR_IA; delete process.env.MATURADOR_IA_MAX_SESSOES_DIA_CONTA; });
afterEach(() => { delete process.env.MATURADOR_IA; delete process.env.MATURADOR_IA_MAX_SESSOES_DIA_CONTA; });

describe('personaDoChip', () => {
  it('é fixa por chip e varia entre chips', () => {
    expect(personaDoChip('agente-1')).toEqual(personaDoChip('agente-1'));
    const estilos = new Set(Array.from({ length: 40 }, (_, i) => JSON.stringify(personaDoChip(`ag-${i}`))));
    expect(estilos.size).toBeGreaterThan(20);
  });
});

describe('humanizar', () => {
  const apressado = { ...personaDoChip('x'), estilo: 'apressado' as const, emoji: 0, risada: 'kkkk' };
  const caprichado = { ...apressado, estilo: 'caprichado' as const };
  it('apressado abrevia, tira acento e ponto final', () => {
    const t = humanizar('Você também está cansado hoje? Não aguento mais.', apressado, () => 0.01);
    expect(t).toMatch(/vc/);
    expect(t).not.toMatch(/[áéíóúãõç]/);
    expect(t).not.toMatch(/\.$/);
  });
  it('caprichado quase não mexe', () => {
    expect(humanizar('Você viu o jogo ontem?', caprichado, () => 0.99)).toBe('Você viu o jogo ontem?');
  });
  it('troca a risada pela do chip', () => {
    expect(humanizar('hahaha muito bom', { ...caprichado, risada: 'rsrs' }, () => 0.99)).toBe('rsrs muito bom');
  });
});

describe('validarRoteiro', () => {
  it('aceita JSON (com ou sem cerca de markdown) e corta no máximo de falas', () => {
    const linhas = Array.from({ length: 10 }, (_, i) => `fala ${i}`);
    expect(validarRoteiro('```json\n' + JSON.stringify({ assunto: 'x', linhas }) + '\n```')!.linhas).toHaveLength(MAX_FALAS);
  });
  it('recusa poucas falas, JSON quebrado e conteúdo de negócio', () => {
    expect(validarRoteiro(JSON.stringify({ linhas: ['oi', 'oi'] }))).toBeNull();
    expect(validarRoteiro('não é json')).toBeNull();
    expect(validarRoteiro(JSON.stringify({ linhas: ['oi', 'tudo bem?', 'olha esse link https://x.com'] }))).toBeNull();
    expect(validarRoteiro(JSON.stringify({ linhas: ['oi', 'tem desconto?', 'tem sim'] }))).toBeNull();
  });
});

describe('montarPrompt', () => {
  it('pede o número exato de falas e proíbe negócio', () => {
    const p = montarPrompt(personaDoChip('a'), personaDoChip('b'), 5, 'futebol', new Date());
    expect(p).toMatch(/Exatamente 5 falas/);
    expect(p).toMatch(/PROIBIDO/);
  });
});

describe('gerarRoteiro', () => {
  const base = { userId: 'u1', agenteQueAbre: 'a', agenteQueResponde: 'b' };

  it('100 sessões sem nenhuma fala repetida entre roteiros', async () => {
    process.env.MATURADOR_IA_MAX_SESSOES_DIA_CONTA = '1000';
    const vistas = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const r = await gerarRoteiro(pool, { ...base, providerOverride: providerFake() });
      expect(r!.linhas.length).toBeGreaterThanOrEqual(MIN_FALAS);
      for (const l of r!.linhas) { expect(vistas.has(l)).toBe(false); vistas.add(l); }
    }
  });

  it('registra o gasto em ai_uso_diario', async () => {
    await gerarRoteiro(pool, { ...base, providerOverride: providerFake() });
    expect(queries.some(q => q.includes('ai_uso_diario'))).toBe(true);
  });

  it('respeita o teto de sessões por conta por dia', async () => {
    process.env.MATURADOR_IA_MAX_SESSOES_DIA_CONTA = '2';
    const p = providerFake();
    expect(await gerarRoteiro(pool, { ...base, providerOverride: p })).not.toBeNull();
    expect(await gerarRoteiro(pool, { ...base, providerOverride: p })).not.toBeNull();
    expect(await gerarRoteiro(pool, { ...base, providerOverride: p })).toBeNull();
    // outra conta tem o próprio teto
    expect(await gerarRoteiro(pool, { ...base, userId: 'u2', providerOverride: p })).not.toBeNull();
  });

  it('volta pro banco fixo (null) com IA desligada, resposta ruim ou erro', async () => {
    process.env.MATURADOR_IA = 'off';
    expect(await gerarRoteiro(pool, { ...base, providerOverride: providerFake() })).toBeNull();
    delete process.env.MATURADOR_IA;
    expect(await gerarRoteiro(pool, { ...base, providerOverride: providerFake(() => 'blá') })).toBeNull();
    const quebrado: any = { provider: { complete: async () => { throw new Error('429'); } }, modelo: 'x', providerSlug: 'openai' };
    expect(await gerarRoteiro(pool, { ...base, providerOverride: quebrado })).toBeNull();
  });

  it('custo por sessão fica abaixo de US$ 0,001 no modelo padrão', () => {
    expect(estimarCustoUsd('gpt-4o-mini', 700, 250)).toBeLessThan(0.001);
    expect(estimativaCustoSessao()).toBeLessThan(0.001);
  });
});
