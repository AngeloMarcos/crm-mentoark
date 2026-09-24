process.env.RADAR_SEARCH_DELAY_MS = '1';
process.env.RADAR_SEARCH_JITTER_MS = '1';
import { describe, it, expect } from 'vitest';
import { extrairLinks } from '../src/radar/extrairLinks';
import { gerarConsultas } from '../src/radar/consultas';
import { coletarLinks, RadarSearchError, SimulatedProvider, SearchProvider, statusDaBusca } from '../src/radar/searchProvider';
import { GoogleCseProvider } from '../src/radar/providers/googleCse';
import { SerperProvider } from '../src/radar/providers/serper';
import { criarProvider } from '../src/radar/providers';
import { importarCsv, parseCsv } from '../src/radar/importarPlanilha';

const COD = 'ABCDEFGHIJKLMNOPQRSTUV'; // 22 chars

describe('extrairLinks', () => {
  it('extrai e deduplica pelo código', () => {
    const l = extrairLinks(`veja https://chat.whatsapp.com/${COD} e chat.whatsapp.com/invite/${COD}?x=1`);
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ plataforma: 'whatsapp', codigo: COD });
  });
  it('ignora código curto demais e longo demais', () => {
    expect(extrairLinks('chat.whatsapp.com/abc123')).toHaveLength(0);
    expect(extrairLinks('chat.whatsapp.com/' + 'A'.repeat(30))).toHaveLength(0);
  });
  it('cataloga t.me e ignora rotas de sistema', () => {
    const l = extrairLinks('https://t.me/corretoresSP e t.me/share/url e t.me/joinchat/AAAAAEabcdefg');
    expect(l.map(x => x.codigo)).toEqual(['corretoresSP', 'AAAAAEabcdefg']);
    expect(l.every(x => x.plataforma === 'telegram')).toBe(true);
  });
  it('texto vazio', () => { expect(extrairLinks(null)).toEqual([]); });
});

describe('gerarConsultas', () => {
  const nicho = { nome: 'Imob', termos_busca: ['corretores', 'imobiliária'], regioes: ['São Paulo'] };
  it('gera termos sem região e com região', () => {
    const q = gerarConsultas(nicho);
    expect(q[0]).toBe('corretores "chat.whatsapp.com"');
    expect(q).toContain('corretores "chat.whatsapp.com" São Paulo');
  });
  it('respeita max e telegram opcional', () => {
    expect(gerarConsultas(nicho, { max: 2 })).toHaveLength(2);
    expect(gerarConsultas(nicho, { incluirTelegram: true }).some(q => q.endsWith('"t.me"'))).toBe(true);
    expect(gerarConsultas(nicho).some(q => q.endsWith('"t.me"'))).toBe(false);
  });
  it('não duplica', () => {
    expect(gerarConsultas({ nome: 'x', termos_busca: ['a', 'a'], regioes: [] })).toHaveLength(1);
  });
});

describe('coletarLinks', () => {
  const resp = (n: string) => [{ titulo: 't', snippet: `chat.whatsapp.com/${COD}`, link: `https://x.com/${n}` }];
  it('deduplica entre consultas e respeita teto de chamadas', async () => {
    const p = new SimulatedProvider({ a: resp('1'), b: resp('2'), c: resp('3') });
    const r = await coletarLinks(p, ['a', 'b', 'c'], { maxChamadas: 2 });
    expect(r.chamadasFeitas).toBe(2);
    expect(r.grupos).toHaveLength(1);
    expect(r.linksVistos).toBe(2);
    expect(r.interrompidaPor).toBe('teto_chamadas');
  });
  it('respeita teto de custo', async () => {
    const caro: SearchProvider = { nome: 'c', custoPorChamadaUsd: 0.5, buscar: async () => ({ resultados: [], chamadas: 1 }) };
    const r = await coletarLinks(caro, ['a', 'b', 'c'], { maxChamadas: 10, maxCustoUsd: 1 });
    expect(r.chamadasFeitas).toBe(2);
    expect(r.interrompidaPor).toBe('teto_custo');
  });
  it('passa ao provider só o que ainda cabe no teto', async () => {
    const vistos: number[] = [];
    const p: SearchProvider = { nome: 'p', custoPorChamadaUsd: 0, buscar: async (_q, max) => { vistos.push(max); return { resultados: [], chamadas: 3 }; } };
    await coletarLinks(p, ['a', 'b'], { maxChamadas: 4 });
    expect(vistos).toEqual([4, 1]);
  });
  it('erro de escopo busca interrompe; escopo consulta continua; páginas já gastas contam', async () => {
    let n = 0;
    const p: SearchProvider = { nome: 'x', custoPorChamadaUsd: 0, buscar: async () => { n++; throw new RadarSearchError('boom', 'consulta'); } };
    const r = await coletarLinks(p, ['a', 'b'], { maxChamadas: 5 });
    expect(n).toBe(2);
    expect(r.interrompidaPor).toBeNull();
    const p2: SearchProvider = { nome: 'x', custoPorChamadaUsd: 0.1, buscar: async () => { throw new RadarSearchError('chave', 'busca', 401, 2, resp('9')); } };
    const r2 = await coletarLinks(p2, ['a', 'b'], { maxChamadas: 5 });
    expect(r2.consultasFeitas).toBe(1);
    expect(r2.chamadasFeitas).toBe(2);
    expect(r2.grupos).toHaveLength(1);
    expect(r2.interrompidaPor).toBe('erro_provider');
  });
});

const json = (status: number, body: any) => (async () => new Response(JSON.stringify(body), { status })) as any;
const org = (link: string, extra: any = {}) => ({ organic: [{ title: 'T', snippet: 'S', link, ...extra }] });

describe('SerperProvider', () => {
  it('extrai organic e sitelinks, com corpo gl/hl/num/page', async () => {
    let corpo: any;
    const f = (async (_u: any, init: any) => {
      corpo = JSON.parse(init.body);
      return new Response(JSON.stringify(org('https://a.com', { sitelinks: [{ title: 'S1', link: 'https://b.com' }] })), { status: 200 });
    }) as any;
    const r = await new SerperProvider('k', { fetchImpl: f, maxPaginas: 1 }).buscar('q', 5);
    expect(r.resultados.map(x => x.link)).toEqual(['https://a.com', 'https://b.com']);
    expect(corpo).toMatchObject({ q: 'q', gl: 'br', hl: 'pt-br', num: 10, page: 1 });
    expect(r.chamadas).toBe(1);
  });
  it('pagina até vir vazio ou até o limite de chamadas', async () => {
    const paginas: number[] = [];
    const f = (async (_u: any, init: any) => {
      const p = JSON.parse(init.body).page;
      paginas.push(p);
      return new Response(JSON.stringify(p < 3 ? org('https://a.com/' + p) : { organic: [] }), { status: 200 });
    }) as any;
    const r = await new SerperProvider('k', { fetchImpl: f, maxPaginas: 5 }).buscar('q', 10);
    expect(paginas).toEqual([1, 2, 3]);
    expect(r.chamadas).toBe(3);
    paginas.length = 0;
    const r2 = await new SerperProvider('k', { fetchImpl: f, maxPaginas: 5 }).buscar('q', 2);
    expect(paginas).toEqual([1, 2]);
    expect(r2.chamadas).toBe(2);
  });
  it('401 e 402 são erro de busca com mensagem clara', async () => {
    await expect(new SerperProvider('k', { fetchImpl: json(401, {}) }).buscar('q', 3)).rejects.toMatchObject({ escopo: 'busca', status: 401 });
    await expect(new SerperProvider('k', { fetchImpl: json(402, {}) }).buscar('q', 3)).rejects.toMatchObject({ escopo: 'busca', status: 402 });
  });
  it('429 repete com backoff e depois pausa a busca; 5xx vira erro de consulta', async () => {
    let n = 0;
    const f429 = (async () => { n++; return new Response('', { status: 429 }); }) as any;
    await expect(new SerperProvider('k', { fetchImpl: f429, backoffMs: 0 }).buscar('q', 3)).rejects.toMatchObject({ escopo: 'busca', status: 429 });
    expect(n).toBe(3);
    await expect(new SerperProvider('k', { fetchImpl: json(503, {}), backoffMs: 0 }).buscar('q', 3)).rejects.toMatchObject({ escopo: 'consulta' });
  });
  it('recupera de um 429 transitório contando uma chamada só', async () => {
    let n = 0;
    const f = (async () => {
      n++;
      return n === 1 ? new Response('', { status: 429 }) : new Response(JSON.stringify({ organic: [] }), { status: 200 });
    }) as any;
    const r = await new SerperProvider('k', { fetchImpl: f, backoffMs: 0 }).buscar('q', 3);
    expect(r.chamadas).toBe(1);
  });
  it('nunca repete após falha de rede (ambíguo) e conta a chamada', async () => {
    let n = 0;
    const f = (async () => { n++; throw new Error('timeout'); }) as any;
    await expect(new SerperProvider('k', { fetchImpl: f }).buscar('q', 3)).rejects.toMatchObject({ escopo: 'consulta', chamadas: 1 });
    expect(n).toBe(1);
  });
  it('falha na página 2 preserva páginas já pagas e seus resultados', async () => {
    let n = 0;
    const f = (async () => {
      n++;
      return n === 1 ? new Response(JSON.stringify(org('https://a.com')), { status: 200 }) : new Response('', { status: 401 });
    }) as any;
    await expect(new SerperProvider('k', { fetchImpl: f, maxPaginas: 3 }).buscar('q', 3))
      .rejects.toMatchObject({ chamadas: 1, resultadosParciais: [{ link: 'https://a.com' }] });
  });
});

describe('GoogleCseProvider (legado)', () => {
  it('mapeia itens; 403 é erro de busca', async () => {
    const p = new GoogleCseProvider('k', 'cx', json(200, { items: [{ title: 'T', snippet: 'S', link: 'L' }] }));
    expect((await p.buscar('q')).resultados).toEqual([{ titulo: 'T', snippet: 'S', link: 'L' }]);
    await expect(new GoogleCseProvider('k', 'cx', json(403, {})).buscar('q')).rejects.toMatchObject({ escopo: 'busca' });
  });
});

describe('criarProvider', () => {
  it('padrão é Serper; sem chave cai no simulado', () => {
    expect(criarProvider({ serperKey: 's' }).provider.nome).toBe('serper');
    expect(criarProvider({}).real).toBe(false);
    expect(criarProvider({ provider: 'google_cse', googleApiKey: 'k', googleCx: 'c' }).provider.nome).toBe('google_cse');
    expect(criarProvider({ provider: 'google_cse', googleApiKey: 'k' }).real).toBe(false);
  });
});

describe('importarCsv', () => {
  it('lê CSV com cabeçalho, separador ; e aspas, deduplicando', () => {
    const csv = `Nome;Nicho;Região;Link\n"Corretores SP; VIP";Imobiliário;São Paulo;https://chat.whatsapp.com/${COD}\nDup;Imobiliário;SP;chat.whatsapp.com/${COD}\nSem link;X;Y;-\n`;
    const r = importarCsv(csv);
    expect(r.itens).toHaveLength(1);
    expect(r.itens[0]).toMatchObject({ nome: 'Corretores SP; VIP', nicho: 'Imobiliário', regiao: 'São Paulo' });
    expect(r.duplicados).toBe(1);
    expect(r.semLink).toBe(1);
  });
  it('sem cabeçalho e vazio', () => {
    expect(importarCsv(`https://chat.whatsapp.com/${COD}\n`).itens).toHaveLength(1);
    expect(importarCsv('').itens).toHaveLength(0);
    expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('statusDaBusca', () => {
  const base = { grupos: [], consultasFeitas: 2, chamadasFeitas: 0, linksVistos: 0, custoUsd: 0, interrompidaPor: null, erros: [] as string[] };
  it('todas as consultas com erro = falhou; erro parcial = concluída', () => {
    expect(statusDaBusca({ ...base, erros: ['a', 'b'] })).toBe('falhou');
    expect(statusDaBusca({ ...base, erros: ['a'] })).toBe('concluida');
    expect(statusDaBusca({ ...base })).toBe('concluida');
    expect(statusDaBusca({ ...base, interrompidaPor: 'erro_provider' })).toBe('falhou');
  });
});
