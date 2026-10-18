import { describe, it, expect } from 'vitest';
import { consultasDoNicho } from '../src/radar/busca';

// Busca manual repetida: com o rodízio (rodizio_pos) a próxima busca começa onde a anterior parou,
// em vez de refazer (e pagar de novo) as mesmas primeiras consultas.
describe('rodízio da busca manual', () => {
  const nicho = { termos_busca: ['corretores de imóveis', 'imobiliária'], regioes: ['São Paulo', 'Campinas'] };
  it('deslocamento pula as consultas já executadas e dá a volta na lista', () => {
    const todas = consultasDoNicho(nicho, { diretorios: [] });
    const primeira = consultasDoNicho(nicho, { max: 3, diretorios: [] });
    const segunda = consultasDoNicho(nicho, { max: 3, deslocamento: 3, diretorios: [] });
    expect(primeira).toEqual(todas.slice(0, 3));
    expect(segunda).toEqual(todas.slice(3, 6));
    expect(segunda.some(c => primeira.includes(c))).toBe(false);
    expect(consultasDoNicho(nicho, { max: 2, deslocamento: todas.length, diretorios: [] })).toEqual(todas.slice(0, 2));
  });
});
