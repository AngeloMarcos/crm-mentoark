import { describe, it, expect } from 'vitest';
import {
  CONFIG_PADRAO, ConfigInvalida, classificarLead, compilarConfig, mesclarConfig, normalizarTexto, notaDaLista,
} from '../src/utils/classificacao';

const cc = compilarConfig(CONFIG_PADRAO);
const base = { listas: [] as string[] };

describe('normalizarTexto', () => {
  it('remove acento, caixa e pontuação', () => {
    expect(normalizarTexto('  Corretór de IMÓVEIS!! ')).toBe('corretor de imoveis');
  });
});

describe('detecção de nicho', () => {
  it('categoria do WhatsApp Business em inglês', () => {
    const r = classificarLead({ ...base, businessCategoria: 'Real Estate', isBusiness: true }, cc);
    expect(r.nicho).toBe('imobiliario');
    expect(r.tipoPublico).toBe('b2b');
  });

  it('nome com acento e palavra-chave', () => {
    const r = classificarLead({ ...base, nome: 'João Corretor de Imóveis' }, cc);
    expect(r.nicho).toBe('imobiliario');
    expect(r.fontesNicho).toContain('nome');
  });

  it('nome do grupo de origem conta (sem data nem prefixo da importação)', () => {
    const r = classificarLead({ ...base, listas: ['Importação Grupo Corretores de Imóveis SP 20/09/2026'] }, cc);
    expect(r.nicho).toBe('imobiliario');
    expect(r.fontesNicho).toEqual(['grupo']);
  });

  it('não casa palavra dentro de outra', () => {
    const r = classificarLead({ ...base, nome: 'Espaço Central' }, cc); // "spa" dentro de "espaco"
    expect(r.nicho).toBeNull();
  });

  it('sem nenhum sinal fica sem nicho e indefinido', () => {
    const r = classificarLead({ ...base, nome: 'Maria' }, cc);
    expect(r.nicho).toBeNull();
    expect(r.tipoPublico).toBe('indefinido');
  });
});

describe('tipo de público', () => {
  it('grupo de consumidor final vira b2c', () => {
    const r = classificarLead({ ...base, listas: ['Importação Grupo Achadinhos e Promoções 10/09/2026'] }, cc);
    expect(r.tipoPublico).toBe('b2c');
    expect(r.motivos.some(m => m.regra === 'grupo_b2c')).toBe(true);
  });

  it('conta Business é b2b mesmo em grupo b2c', () => {
    const r = classificarLead({ ...base, isBusiness: true, listas: ['Importação Grupo Promoções 10/09/2026'] }, cc);
    expect(r.tipoPublico).toBe('b2b');
  });
});

describe('score', () => {
  it('soma os pontos e explica cada regra', () => {
    const r = classificarLead({
      ...base, whatsappStatus: 'valido', isBusiness: true, nomeConfiavel: true,
      businessCategoria: 'Real Estate', telefoneNormalizado: '5511987654321', temFoto: true,
      listas: ['Importação Grupo Corretores 01/09/2026', 'Importação Grupo Imobiliárias 02/09/2026'],
    }, cc);
    const regras = r.motivos.map(m => m.regra);
    expect(regras).toEqual(expect.arrayContaining(['valido', 'business', 'nome_real', 'nicho_alvo', 'ddd_interesse', 'multiplas_listas']));
    expect(r.score).toBe(25 + 20 + 10 + 15 + 10 + 10);
    expect(r.motivos.every(m => m.pontos !== 0)).toBe(true);
  });

  it('fixo é penalizado uma vez só (não soma com sem_whatsapp)', () => {
    const r = classificarLead({ ...base, tipoTelefone: 'fixo', whatsappStatus: 'sem_whatsapp' }, cc);
    expect(r.motivos.filter(m => m.pontos < 0).map(m => m.regra)).toEqual(['fixo']);
    expect(r.score).toBe(0);
  });

  it('nunca sai de 0..100', () => {
    const negativo = classificarLead({ ...base, whatsappStatus: 'sem_whatsapp' }, cc);
    expect(negativo.score).toBe(0);
    const pesos = { ...CONFIG_PADRAO.pesos, valido: 100, business: 100 };
    const alto = classificarLead({ ...base, whatsappStatus: 'valido', isBusiness: true }, compilarConfig({ ...CONFIG_PADRAO, pesos }));
    expect(alto.score).toBe(100);
  });

  it('respeita pesos e DDDs customizados', () => {
    const cfg = mesclarConfig({ pesos: { ddd_interesse: 30 }, ddds_interesse: ['21'] });
    const c2 = compilarConfig(cfg);
    const rj = classificarLead({ ...base, telefoneNormalizado: '5521987654321' }, c2);
    const sp = classificarLead({ ...base, telefoneNormalizado: '5511987654321' }, c2);
    expect(rj.score).toBe(30);
    expect(sp.score).toBe(0);
  });

  it('nicho fora dos alvos pontua menos que nicho-alvo', () => {
    const alvo = classificarLead({ ...base, businessCategoria: 'Real Estate' }, cc);
    const fora = classificarLead({ ...base, businessCategoria: 'Restaurant' }, cc);
    expect(fora.nicho).toBe('alimentacao');
    expect(alvo.score).toBeGreaterThan(fora.score);
  });
});

describe('mesclarConfig', () => {
  it('sem parâmetro devolve o padrão', () => {
    expect(mesclarConfig(undefined)).toEqual(CONFIG_PADRAO);
  });

  it('rejeita peso fora do intervalo e DDD inválido', () => {
    expect(() => mesclarConfig({ pesos: { valido: 500 } })).toThrow(ConfigInvalida);
    expect(() => mesclarConfig({ ddds_interesse: ['abc'] })).toThrow(ConfigInvalida);
  });

  it('dicionário novo é normalizado e nichos-alvo inexistentes são descartados', () => {
    const cfg = mesclarConfig({
      dicionario: { pet: { tipo: 'b2b', palavras: ['Pet Shop', 'Veterinário'] } },
      nichos_alvo: ['pet', 'imobiliario'],
    });
    expect(cfg.dicionario.pet.palavras).toEqual(['pet shop', 'veterinario']);
    expect(cfg.nichos_alvo).toEqual(['pet']);
  });

  it('nicho sem palavras é inválido', () => {
    expect(() => mesclarConfig({ dicionario: { vazio: { tipo: 'b2b', palavras: [] } } })).toThrow(ConfigInvalida);
  });
});

describe('notaDaLista', () => {
  it('sem nota quando menos da metade foi verificada', () => {
    expect(notaDaLista({ total: 100, verificados: 30, validos: 30, business: 5, com_nome: 50, score_medio: 60 })).toBeNull();
  });

  it('sem nota em lista vazia', () => {
    expect(notaDaLista({ total: 0, verificados: 0, validos: 0, business: 0, com_nome: 0, score_medio: null })).toBeNull();
  });

  it('A para lista boa e D para lista ruim', () => {
    expect(notaDaLista({ total: 100, verificados: 100, validos: 95, business: 40, com_nome: 90, score_medio: 75 })).toBe('A');
    expect(notaDaLista({ total: 100, verificados: 100, validos: 10, business: 0, com_nome: 5, score_medio: 5 })).toBe('D');
  });
});
