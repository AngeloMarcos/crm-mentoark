/**
 * API pública /v1 (2026-11-02, modelo Cubo): chaves, escopos, limite por minuto e paginação.
 */
import { describe, it, expect } from 'vitest';
import {
  gerarChave, hashChave, pareceChave, normalizarEscopos, temEscopo,
  criarLimitador, lerPaginacao, metadataDaPagina, lerIntervaloDatas, variantesTelefone,
} from '../src/services/apiKeys';

describe('chaves', () => {
  it('gera chave sk_live_ com prefixo e hash que batem', () => {
    const { chave, prefixo, hash } = gerarChave();
    expect(chave.startsWith('sk_live_')).toBe(true);
    expect(prefixo).toBe(chave.slice(0, 12));
    expect(hash).toBe(hashChave(chave));
    expect(pareceChave(chave)).toBe(true);
    expect(gerarChave().chave).not.toBe(chave);
  });

  it('recusa o que não parece chave', () => {
    expect(pareceChave('Bearer abc')).toBe(false);
    expect(pareceChave(undefined)).toBe(false);
    expect(pareceChave('sk_live_curta')).toBe(false);
  });
});

describe('escopos', () => {
  it('descarta recurso e ação desconhecidos', () => {
    expect(normalizarEscopos({ peoples: ['read', 'voar'], hack: ['read'], messages: ['read', 'create'] }))
      .toEqual({ peoples: ['read'], messages: ['create'] });
    expect(normalizarEscopos('tudo')).toEqual({});
    expect(normalizarEscopos(['peoples'])).toEqual({});
  });

  it('full_access libera tudo; senão só o escopo dado', () => {
    expect(temEscopo({ full_access: true }, 'messages', 'create')).toBe(true);
    expect(temEscopo({ scopes: { peoples: ['read'] } }, 'peoples', 'read')).toBe(true);
    expect(temEscopo({ scopes: { peoples: ['read'] } }, 'peoples', 'delete')).toBe(false);
    expect(temEscopo({ scopes: null }, 'peoples', 'read')).toBe(false);
  });
});

describe('limitador por minuto', () => {
  it('bloqueia acima do limite e zera na janela seguinte', () => {
    let t = 0;
    const lim = criarLimitador(2, () => t);
    expect(lim('k').ok).toBe(true);
    expect(lim('k').restante).toBe(0);
    expect(lim('k').ok).toBe(false);
    expect(lim('outra').ok).toBe(true);
    t = 60_000;
    expect(lim('k').ok).toBe(true);
  });
});

describe('variantes de telefone', () => {
  it('celular BR: com/sem 55 e com/sem o 9º dígito', () => {
    expect(variantesTelefone('(11) 97957-9548').sort())
      .toEqual(['11979579548', '1179579548', '5511979579548', '551179579548'].sort());
  });
  it('fixo não ganha variante sem 9; inválido dá vazio', () => {
    expect(variantesTelefone('1133334444').sort()).toEqual(['1133334444', '551133334444'].sort());
    expect(variantesTelefone('abc')).toEqual([]);
    expect(variantesTelefone(undefined)).toEqual([]);
  });
});

describe('paginação e datas', () => {
  it('page/perPage com padrão 10 e teto 100', () => {
    expect(lerPaginacao({})).toEqual({ page: 1, perPage: 10, offset: 0 });
    expect(lerPaginacao({ page: '3', perPage: '500' })).toEqual({ page: 3, perPage: 100, offset: 200 });
    expect(lerPaginacao({ page: '-1', perPage: 'x' })).toEqual({ page: 1, perPage: 10, offset: 0 });
    expect(metadataDaPagina(25, 2, 10)).toEqual({ total: 25, perPage: 10, currentPage: 2, lastPage: 3, firstPage: 1 });
    expect(metadataDaPagina(0, 1, 10).lastPage).toBe(1);
  });

  it('dd/MM/yyyy único ou intervalo, no fuso de Brasília', () => {
    expect(lerIntervaloDatas('01/11/2026')).toEqual({ de: '2026-11-01T03:00:00.000Z', ate: '2026-11-02T02:59:59.999Z' });
    expect(lerIntervaloDatas('01/10/2026,31/10/2026')?.ate).toBe('2026-11-01T02:59:59.999Z');
    expect(lerIntervaloDatas('2026-11-01')).toBeNull();
    expect(lerIntervaloDatas('')).toBeNull();
  });
});
