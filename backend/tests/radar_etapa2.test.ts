import { describe, it, expect } from 'vitest';
import { contemPalavra, mesclarPesos, normalizar, pontuarGrupo, PESOS_PADRAO } from '../src/radar/scoring';
import { classificarErroConvite, consultarConvite, instanciaConectada, normalizarInviteInfo } from '../src/radar/evolutionGrupos';

const nichoImob = {
  palavras_positivas: ['corretores', 'imóveis', 'imobiliária', 'creci'],
  palavras_negativas: ['loteamento'],
  regioes: ['São Paulo', 'Campinas'],
};

describe('normalizar / contemPalavra', () => {
  it('remove acento e caixa', () => { expect(normalizar('  IMÓVEIS  São   Paulo ')).toBe('imoveis sao paulo'); });
  it('casa palavra inteira, não pedaço', () => {
    expect(contemPalavra(normalizar('empresária top'), 'ia')).toBe(false);
    expect(contemPalavra(normalizar('automação com IA'), 'ia')).toBe(true);
    expect(contemPalavra(normalizar('Ganhe Dinheiro agora'), 'ganhe dinheiro')).toBe(true);
  });
});

describe('pontuarGrupo', () => {
  it('grupo bom: palavras no nome, região, tamanho ideal e restrição a profissionais', () => {
    const r = pontuarGrupo(
      { nome: 'Corretores de Imóveis São Paulo', descricao: 'Somente corretores com CRECI ativo', participantes: 300 },
      nichoImob,
    );
    const regras = r.motivos.map(m => m.regra);
    expect(regras).toEqual(expect.arrayContaining(['palavras_positivas', 'regiao', 'tamanho_ideal', 'restrito_profissionais']));
    // corretores(12)+imóveis(12) no nome, creci(5) na descrição, região 15, tamanho 20, restrição 15
    expect(r.score).toBe(79);
  });

  it('nome pesa mais que descrição e cada palavra conta uma vez', () => {
    const noNome = pontuarGrupo({ nome: 'Corretores', descricao: null, participantes: null }, nichoImob);
    const naDesc = pontuarGrupo({ nome: 'Grupo', descricao: 'corretores corretores corretores', participantes: null }, nichoImob);
    expect(noNome.score).toBe(PESOS_PADRAO.positiva_nome);
    expect(naDesc.score).toBe(PESOS_PADRAO.positiva_descricao);
  });

  it('negativas derrubam o score e são explicadas', () => {
    const r = pontuarGrupo(
      { nome: 'Achadinhos e Cupom de Imóveis', descricao: 'promoção todo dia, sorteio de PIX', participantes: 500 },
      nichoImob,
    );
    const neg = r.motivos.find(m => m.regra === 'palavras_negativas')!;
    expect(neg.pontos).toBe(-PESOS_PADRAO.teto_negativas);
    expect(neg.detalhe).toContain('achadinhos');
    expect(r.score).toBeLessThan(20);
  });

  it('usa as negativas do nicho além das padrão', () => {
    const r = pontuarGrupo({ nome: 'Loteamento Alto Padrão', descricao: null, participantes: null }, nichoImob);
    expect(r.motivos.some(m => m.regra === 'palavras_negativas')).toBe(true);
    expect(r.score).toBe(0);
  });

  it('tamanho: ideal, pequeno e fora da faixa', () => {
    const f = (n: number) => pontuarGrupo({ nome: 'x', descricao: null, participantes: n }, null).motivos[0];
    expect(f(50).regra).toBe('tamanho_ideal');
    expect(f(1024).regra).toBe('tamanho_ideal');
    expect(f(30).regra).toBe('tamanho_pequeno');
    expect(f(5).regra).toBe('tamanho_fora');
    expect(f(1500).pontos).toBe(0);
  });

  it('sem nicho só aplica regras genéricas; score sempre entre 0 e 100', () => {
    const r = pontuarGrupo({ nome: 'Somente corretores', descricao: null, participantes: 200 }, null);
    expect(r.score).toBe(PESOS_PADRAO.tamanho_ideal + PESOS_PADRAO.restrito_profissionais);
    const cheio = pontuarGrupo(
      { nome: 'corretores imoveis imobiliaria creci São Paulo', descricao: 'somente corretores', participantes: 200 },
      nichoImob, { ...PESOS_PADRAO, teto_positivas: 500, tamanho_ideal: 500 },
    );
    expect(cheio.score).toBe(100);
  });

  it('pesos editáveis mudam o resultado', () => {
    const base = { nome: 'Corretores SP', descricao: null, participantes: null };
    const a = pontuarGrupo(base, nichoImob);
    const b = pontuarGrupo(base, nichoImob, { ...PESOS_PADRAO, positiva_nome: 30 });
    expect(b.score).toBeGreaterThan(a.score);
  });

  it('mesclarPesos ignora lixo e mantém o padrão', () => {
    const p = mesclarPesos({ regiao: 40, negativa: -5, tamanho_min: 'x', foo: 1 });
    expect(p.regiao).toBe(40);
    expect(p.negativa).toBe(PESOS_PADRAO.negativa);
    expect(p.tamanho_min).toBe(PESOS_PADRAO.tamanho_min);
    expect(mesclarPesos(null)).toEqual(PESOS_PADRAO);
  });
});

describe('normalizarInviteInfo', () => {
  it('lê o GroupMetadata do Baileys', () => {
    const i = normalizarInviteInfo({
      id: '120363000000000000@g.us', subject: ' Corretores SP ', desc: 'Só corretores', size: 312,
      creation: 1700000000, announce: false, joinApprovalMode: true,
      participants: [{ id: 'a' }],
    })!;
    expect(i).toMatchObject({ jid: '120363000000000000@g.us', nome: 'Corretores SP', descricao: 'Só corretores', participantes: 312, somenteAdmins: false, aprovacaoAdmin: true });
    expect(i.criadoEm?.toISOString()).toBe('2023-11-14T22:13:20.000Z');
  });
  it('usa participants.length quando size falta e rejeita corpo vazio', () => {
    expect(normalizarInviteInfo({ subject: 'x', participants: [1, 2, 3] })!.participantes).toBe(3);
    expect(normalizarInviteInfo({})).toBeNull();
    expect(normalizarInviteInfo(null)).toBeNull();
  });
});

describe('classificarErroConvite', () => {
  it('link morto vira inválido', () => {
    expect(classificarErroConvite(404, 'item-not-found').tipo).toBe('invalido');
    expect(classificarErroConvite(410, 'gone').tipo).toBe('invalido');
    expect(classificarErroConvite(400, '{"response":{"message":"Bad Request: invite link revoked"}}').tipo).toBe('invalido');
  });
  it('problema de instância/limite/servidor NUNCA vira inválido', () => {
    expect(classificarErroConvite(400, 'Connection Closed').tipo).toBe('indisponivel');
    expect(classificarErroConvite(500, 'boom').tipo).toBe('indisponivel');
    expect(classificarErroConvite(429, '').tipo).toBe('indisponivel');
    expect(classificarErroConvite(401, '').tipo).toBe('indisponivel');
    expect(classificarErroConvite(400, 'algo inesperado').tipo).toBe('indisponivel');
  });
});

describe('consultarConvite', () => {
  const resp = (status: number, body: any) => (async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })) as any;
  const c = (fetchImpl: any) => ({ base: 'https://evo.test/', apiKey: 'k', fetchImpl });

  it('chama GET /group/inviteInfo/{instância}?inviteCode= com a apikey e devolve os dados', async () => {
    let visto: { url: string; init: any } | null = null;
    const f = (async (url: any, init: any) => { visto = { url: String(url), init }; return new Response(JSON.stringify({ id: 'g@g.us', subject: 'G', size: 80 }), { status: 200 }); }) as any;
    const r = await consultarConvite(c(f), 'minha inst', 'ABCDEFGHIJKLMNOPQRSTUV', 0);
    expect(r.tipo).toBe('ok');
    expect(visto!.url).toBe('https://evo.test/group/inviteInfo/minha%20inst?inviteCode=ABCDEFGHIJKLMNOPQRSTUV');
    expect(visto!.init.headers.apikey).toBe('k');
    expect(visto!.init.method).toBeUndefined(); // GET
  });

  it('classifica link revogado como inválido sem repetir', async () => {
    let n = 0;
    const f = (async () => { n++; return new Response('item-not-found', { status: 404 }); }) as any;
    expect((await consultarConvite(c(f), 'i', 'X'.repeat(22), 0)).tipo).toBe('invalido');
    expect(n).toBe(1);
  });

  it('repete UMA vez em 5xx (leitura idempotente) e depois desiste como indisponível', async () => {
    let n = 0;
    const f = (async () => { n++; return new Response('x', { status: 503 }); }) as any;
    expect((await consultarConvite(c(f), 'i', 'X'.repeat(22), 0)).tipo).toBe('indisponivel');
    expect(n).toBe(2);
  });

  it('falha de rede é indisponível, não inválido', async () => {
    const f = (async () => { throw new Error('ECONNRESET'); }) as any;
    const r = await consultarConvite(c(f), 'i', 'X'.repeat(22), 0);
    expect(r.tipo).toBe('indisponivel');
  });

  it('resposta 200 sem dados do grupo é indisponível', async () => {
    expect((await consultarConvite(c(resp(200, {})), 'i', 'X'.repeat(22), 0)).tipo).toBe('indisponivel');
  });

  it('instanciaConectada só aceita state=open', async () => {
    expect(await instanciaConectada(c(resp(200, { instance: { state: 'open' } })), 'i')).toBe(true);
    expect(await instanciaConectada(c(resp(200, { instance: { state: 'close' } })), 'i')).toBe(false);
    expect(await instanciaConectada(c(resp(500, {})), 'i')).toBe(false);
  });
});
