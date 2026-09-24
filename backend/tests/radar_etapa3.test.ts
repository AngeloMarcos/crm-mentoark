import { describe, it, expect } from 'vitest';
import { decodificarEntidades, interpretarPaginaConvite, buscarPaginaConvite } from '../src/radar/paginaConvite';
import { avaliarAderencia, mesclarPesos, PESOS_PADRAO } from '../src/radar/scoring';
import { termoDaConsulta } from '../src/radar/validacao';
import { lerRetryAfter, SerperProvider } from '../src/radar/providers/serper';

const pagina = (titulo: string | null, imagem = 'https://pps.whatsapp.net/v/t61/x.jpg?a=1&amp;b=2') =>
  `<html><head>${titulo === null ? '' : `<meta property="og:title" content="${titulo}" />`}` +
  `<meta property="og:image" content="${imagem}" /><meta property="og:description" content="Convite para grupo do WhatsApp" /></head></html>`;

describe('interpretarPaginaConvite', () => {
  it('link vivo: devolve o nome decodificado e se tem foto', () => {
    const r = interpretarPaginaConvite(200, pagina('NOT&#xcd;CIAS CRECI-PE 6'));
    expect(r).toEqual({ tipo: 'ok', nome: 'NOTÍCIAS CRECI-PE 6', temFoto: true });
  });
  it('grupo sem foto continua válido', () => {
    const r = interpretarPaginaConvite(200, pagina('Corretores SP', 'https://static.whatsapp.net/rsrc.php/v4/yO/r/x.png'));
    expect(r).toMatchObject({ tipo: 'ok', temFoto: false });
  });
  it('og:title vazio = convite revogado/inexistente', () => {
    expect(interpretarPaginaConvite(200, pagina('')).tipo).toBe('invalido');
  });
  it('sem a tag og:title (captcha/layout novo) NÃO é inválido: é indisponível com bloqueio', () => {
    const r = interpretarPaginaConvite(200, pagina(null));
    expect(r.tipo).toBe('indisponivel');
    expect((r as any).bloqueio).toBe(true);
  });
  it('404/410 inválido; 429/403 bloqueio; 5xx indisponível sem bloqueio', () => {
    expect(interpretarPaginaConvite(404, '').tipo).toBe('invalido');
    expect(interpretarPaginaConvite(410, '').tipo).toBe('invalido');
    expect(interpretarPaginaConvite(429, '')).toMatchObject({ tipo: 'indisponivel', bloqueio: true });
    expect(interpretarPaginaConvite(403, '')).toMatchObject({ tipo: 'indisponivel', bloqueio: true });
    expect(interpretarPaginaConvite(503, '')).toMatchObject({ tipo: 'indisponivel', bloqueio: false });
  });
  it('decodifica entidades numéricas e nomeadas', () => {
    expect(decodificarEntidades('Valen&#xe7;a &amp; Cia &#39;X&#39; &quot;y&quot;')).toBe('Valença & Cia \'X\' "y"');
  });
  it('buscarPaginaConvite: falha de rede é indisponível (não inválido) e usa User-Agent', async () => {
    let init: any;
    const ok = (async (_u: any, i: any) => { init = i; return new Response(pagina('Grupo X'), { status: 200 }); }) as any;
    expect((await buscarPaginaConvite('A'.repeat(22), ok)).tipo).toBe('ok');
    expect(init.headers['User-Agent']).toMatch(/Mozilla/);
    const boom = (async () => { throw new Error('ECONNRESET'); }) as any;
    expect(await buscarPaginaConvite('A'.repeat(22), boom)).toMatchObject({ tipo: 'indisponivel', bloqueio: false });
  });
});

describe('avaliarAderencia', () => {
  const imob = {
    palavras_positivas: ['corretores', 'imóveis', 'imobiliária', 'creci'],
    palavras_negativas: [], regioes: ['São Paulo'], termos_busca: ['corretores de imóveis'],
  };
  it('alta: palavra do nicho no nome e sem negativas', () => {
    expect(avaliarAderencia({ nome: 'Corretores de Imóveis SP', descricao: null }, imob).nivel).toBe('alta');
    expect(avaliarAderencia({ nome: 'NOTÍCIAS CRECI-PE', descricao: null }, imob).nivel).toBe('alta');
  });
  it('baixa: grupo que não tem a ver com o nicho', () => {
    expect(avaliarAderencia({ nome: 'Olimpíada de Matemática das Instituições Federais', descricao: null }, imob).nivel).toBe('baixa');
    expect(avaliarAderencia({ nome: 'Rodada de Negócios ACE', descricao: null }, imob).nivel).toBe('baixa');
  });
  it('media: palavra do nicho no nome junto de negativa; ou só na descrição', () => {
    expect(avaliarAderencia({ nome: 'Corretores - Vagas de emprego', descricao: null }, imob).nivel).toBe('media');
    expect(avaliarAderencia({ nome: 'Grupo VIP', descricao: 'Somente para corretores' }, imob).nivel).toBe('media');
  });
  it('baixa também quando há negativa e nenhuma palavra do nicho', () => {
    expect(avaliarAderencia({ nome: 'Achadinhos e cupom', descricao: null }, imob).nivel).toBe('baixa');
  });
  it('sem nome ou sem nicho = sem_dados; termo da busca customizada conta como alvo', () => {
    expect(avaliarAderencia({ nome: null, descricao: null }, imob).nivel).toBe('sem_dados');
    expect(avaliarAderencia({ nome: 'Dentistas SP', descricao: null }, null).nivel).toBe('sem_dados');
    expect(avaliarAderencia({ nome: 'Dentistas SP', descricao: null }, null, ['dentistas']).nivel).toBe('alta');
    // termo customizado que NÃO é do vocabulário do nicho não derruba o grupo por engano
    expect(avaliarAderencia({ nome: 'Clínica Odontológica Elite', descricao: null }, imob, ['odontológica']).nivel).toBe('alta');
  });
  it('casa por raiz: imobiliária/imobiliário, corretores/corretora', () => {
    expect(avaliarAderencia({ nome: 'Notícias do Mercado Imobiliário 6', descricao: null }, imob).nivel).toBe('alta');
    expect(avaliarAderencia({ nome: 'Corretora Elite', descricao: null }, imob).nivel).toBe('alta');
    expect(avaliarAderencia({ nome: 'Imobiliárias Unidas', descricao: null }, imob).nivel).toBe('alta');
  });
  it('não casa pedaço de palavra', () => {
    expect(avaliarAderencia({ nome: 'Escolar Anticreci', descricao: null }, imob).nivel).toBe('baixa');
  });
});

describe('termoDaConsulta / pesos', () => {
  it('extrai o termo antes do domínio', () => {
    expect(termoDaConsulta('corretores de imóveis "chat.whatsapp.com" São Paulo')).toEqual(['corretores de imóveis']);
    expect(termoDaConsulta('dentistas "t.me"')).toEqual(['dentistas']);
    expect(termoDaConsulta(null)).toEqual([]);
    expect(termoDaConsulta('diretorio:https://gruposdezap.com/grupos-whats/olx-sao-paulo/')).toEqual([]);
  });
  it('auto_rejeitar_baixa_aderencia vem ligado e pode ser desligado', () => {
    expect(PESOS_PADRAO.auto_rejeitar_baixa_aderencia).toBe(1);
    expect(mesclarPesos({ auto_rejeitar_baixa_aderencia: 0 }).auto_rejeitar_baixa_aderencia).toBe(0);
  });
});

describe('Serper: cadência e Retry-After', () => {
  it('lerRetryAfter: segundos e limite de 60s', () => {
    expect(lerRetryAfter('3')).toBe(3000);
    expect(lerRetryAfter('9999')).toBe(60000);
    expect(lerRetryAfter(null)).toBeNull();
    expect(lerRetryAfter('abc')).toBeNull();
  });

  it('respeita o intervalo mínimo entre chamadas seguidas', async () => {
    const tempos: number[] = [];
    const f = (async () => { tempos.push(Date.now()); return new Response(JSON.stringify({ organic: [{ title: 't', snippet: '', link: 'https://a.com' }] }), { status: 200 }); }) as any;
    const p = new SerperProvider('k', { fetchImpl: f, maxPaginas: 3, intervaloMs: 60, jitterMs: 0, backoffMs: 0 });
    await p.buscar('q', 3);
    expect(tempos).toHaveLength(3);
    expect(tempos[1] - tempos[0]).toBeGreaterThanOrEqual(40);
    expect(tempos[2] - tempos[1]).toBeGreaterThanOrEqual(40);
  });

  it('429 com Retry-After: espera o indicado e tenta de novo; erro final carrega status 429', async () => {
    let n = 0;
    const f = (async () => { n++; return new Response('', { status: 429, headers: { 'retry-after': '0.05' } }); }) as any;
    const p = new SerperProvider('k', { fetchImpl: f, intervaloMs: 1, jitterMs: 0, backoffMs: 0 });
    await expect(p.buscar('q', 1)).rejects.toMatchObject({ escopo: 'busca', status: 429 });
    expect(n).toBe(3);
  });
});

import { pontuarGrupo as pg } from '../src/radar/scoring';
import { gerarConsultas as gc } from '../src/radar/consultas';
import { coletarLinks as cl, SimulatedProvider as SP } from '../src/radar/searchProvider';

describe('score: telefone visível', () => {
  const g = (pct: number | null | undefined) => pg({ nome: 'Corretores', descricao: null, participantes: null, pctComTelefone: pct }, { palavras_positivas: ['corretores'], palavras_negativas: [], regioes: [] });
  it('muito telefone soma, pouco desconta, meio termo e desconhecido não mexem', () => {
    expect(g(80).motivos.find(m => m.regra === 'telefone_alto')?.pontos).toBe(10);
    expect(g(5).motivos.find(m => m.regra === 'telefone_baixo')?.pontos).toBe(-15);
    expect(g(40).motivos.some(m => m.regra.startsWith('telefone'))).toBe(false);
    expect(g(null).motivos.some(m => m.regra.startsWith('telefone'))).toBe(false);
    expect(g(undefined).score).toBe(12);
    expect(g(5).score).toBe(0);
  });
});

describe('consultas com diretórios e DDD', () => {
  const n = { nome: 'x', termos_busca: ['corretores'], regioes: ['São Paulo'] };
  it('gera site:diretorio com e sem região, depois as diretas ficam primeiro', () => {
    const q = gc(n, { diretorios: ['gruposwhats.app'] });
    expect(q[0]).toBe('corretores "chat.whatsapp.com"');
    expect(q).toContain('site:gruposwhats.app corretores');
    expect(q).toContain('site:gruposwhats.app corretores São Paulo');
  });
  it('DDD só aceita 2 dígitos', () => {
    const q = gc(n, { ddds: ['11', 'abc', '1', '21'] });
    expect(q).toContain('corretores "chat.whatsapp.com" DDD 11');
    expect(q).toContain('corretores "chat.whatsapp.com" DDD 21');
    expect(q.some(x => x.includes('DDD abc') || x.includes('DDD 1 '))).toBe(false);
  });
});

describe('coletarLinks: páginas de diretório', () => {
  it('separa páginas de diretório (sem repetir) e ainda extrai convites soltos', async () => {
    const C1 = 'ABCDEFGHIJKLMNOPQRSTUV';
    const p = new SP({ q: [
      { titulo: 'Lista SP', snippet: '', link: 'https://gruposwhats.app/sp' },
      { titulo: 'Lista SP de novo', snippet: '', link: 'https://gruposwhats.app/sp' },
      { titulo: 'Grupo', snippet: '', link: 'https://chat.whatsapp.com/' + C1 },
    ] });
    const r = await cl(p, ['q'], { maxChamadas: 1, ehDiretorio: u => u.includes('gruposwhats.app') });
    expect(r.paginasDiretorio).toEqual([{ url: 'https://gruposwhats.app/sp', titulo: 'Lista SP' }]);
    expect(r.grupos.map(x => x.link.codigo)).toEqual([C1]);
  });
});

describe('consultas: páginas que listam grupos', () => {
  it('gera "lista de links de grupos de whatsapp <termo>" com e sem região', () => {
    const q = gc({ nome: 'x', termos_busca: ['corretores'], regioes: ['São Paulo'] }, { listas: true });
    expect(q).toContain('lista de links de grupos de whatsapp corretores');
    expect(q).toContain('grupos de whatsapp corretores São Paulo links');
    expect(gc({ nome: 'x', termos_busca: ['corretores'], regioes: [] }).some(x => x.startsWith('lista de links'))).toBe(false);
  });
});
