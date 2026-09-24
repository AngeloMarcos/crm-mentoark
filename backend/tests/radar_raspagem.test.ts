import { describe, it, expect, beforeEach } from 'vitest';
import {
  _resetRaspagem, ehDiretorio, extrairLinksDaPagina, listaDiretorios, rasparPagina, regrasDoRobots, robotsPermite, DIRETORIOS_PADRAO,
} from '../src/radar/raspagem';

const A = 'AAAAAAAAAAAAAAAAAAAAAA';   // 22
const B = 'BBBBBBBBBBBBBBBBBBBBBB';
const C = 'CCCCCCCCCCCCCCCCCCCCCC';

describe('diretórios', () => {
  it('lista vem do ambiente e cai no padrão', () => {
    expect(listaDiretorios(undefined)).toEqual(DIRETORIOS_PADRAO);
    expect(listaDiretorios('https://Site.com/x, outro.com.br')).toEqual(['site.com', 'outro.com.br']);
  });
  it('host e subdomínio contam; parecido não', () => {
    const d = ['gruposwhats.app'];
    expect(ehDiretorio('https://gruposwhats.app/estado/SP', d)).toBe(true);
    expect(ehDiretorio('https://www.gruposwhats.app/x', d)).toBe(true);
    expect(ehDiretorio('https://sp.gruposwhats.app/x', d)).toBe(true);
    expect(ehDiretorio('https://naogruposwhats.app/x', d)).toBe(false);
    expect(ehDiretorio('https://chat.whatsapp.com/' + A, d)).toBe(false);
    expect(ehDiretorio('lixo', d)).toBe(false);
  });
});

describe('extrairLinksDaPagina', () => {
  it('acha convites em href, texto, JSON escapado e entidades; deduplica e ignora telegram', () => {
    const html = `
      <a href="https://chat.whatsapp.com/${A}">Grupo 1</a>
      <a href="https:&#x2F;&#x2F;chat.whatsapp.com&#x2F;${B}">Grupo 2</a>
      <script>var d = {"u":"https:\\/\\/chat.whatsapp.com\\/${C}"}</script>
      <p>repetido chat.whatsapp.com/${A}</p>
      <a href="https://t.me/algumcanal">tg</a>`;
    const l = extrairLinksDaPagina(html);
    expect(l.map(x => x.codigo).sort()).toEqual([A, B, C]);
    expect(l.every(x => x.plataforma === 'whatsapp')).toBe(true);
  });
  it('página sem convite devolve vazio', () => { expect(extrairLinksDaPagina('<html>nada</html>')).toEqual([]); });
});

describe('robots.txt', () => {
  const robots = `
User-agent: *
Disallow: /admin
Disallow: /busca?
Allow: /admin/publico

User-agent: MentoArkRadar
Disallow: /privado/
`;
  it('grupo do nosso agente vence o *', () => {
    const r = regrasDoRobots(robots);
    expect(robotsPermite(r, '/privado/x')).toBe(false);
    expect(robotsPermite(r, '/admin')).toBe(true); // regras do * não valem quando há grupo próprio
  });
  it('usa o * quando não há grupo próprio; mais específico vence; empate favorece Allow', () => {
    const r = regrasDoRobots('User-agent: *\nDisallow: /admin\nAllow: /admin/publico\nDisallow: /x\nAllow: /x');
    expect(robotsPermite(r, '/admin/segredo')).toBe(false);
    expect(robotsPermite(r, '/admin/publico/a')).toBe(true);
    expect(robotsPermite(r, '/x')).toBe(true);
    expect(robotsPermite(r, '/livre')).toBe(true);
  });
  it('curingas e fim de linha', () => {
    const r = regrasDoRobots('User-agent: *\nDisallow: /*.pdf$\nDisallow: /tmp*');
    expect(robotsPermite(r, '/a/b.pdf')).toBe(false);
    expect(robotsPermite(r, '/a/b.pdf.html')).toBe(true);
    expect(robotsPermite(r, '/tmp123')).toBe(false);
  });
  it('Disallow vazio e robots vazio permitem tudo', () => {
    expect(robotsPermite(regrasDoRobots('User-agent: *\nDisallow:'), '/qualquer')).toBe(true);
    expect(robotsPermite(regrasDoRobots(''), '/qualquer')).toBe(true);
  });
});

describe('rasparPagina', () => {
  beforeEach(() => _resetRaspagem());
  const resp = (status: number, body = '') => new Response(body, { status });

  it('respeita robots: página bloqueada nem é baixada', async () => {
    const urls: string[] = [];
    const f = (async (u: any) => { urls.push(String(u)); return String(u).endsWith('/robots.txt') ? resp(200, 'User-agent: *\nDisallow: /grupos/') : resp(200, 'x'); }) as any;
    const r = await rasparPagina('https://d.test/grupos/sp', { fetchImpl: f, delayMs: 0 });
    expect(r.tipo).toBe('bloqueado_robots');
    expect(urls).toEqual(['https://d.test/robots.txt']);
  });
  it('página permitida devolve os links; robots 404 = tudo permitido', async () => {
    const f = (async (u: any) => (String(u).endsWith('/robots.txt') ? resp(404) : resp(200, `<a href="https://chat.whatsapp.com/${A}">x</a>`))) as any;
    const r = await rasparPagina('https://d2.test/estado/sp', { fetchImpl: f, delayMs: 0 });
    expect(r).toMatchObject({ tipo: 'ok' });
    expect((r as any).links.map((l: any) => l.codigo)).toEqual([A]);
  });
  it('robots com erro 5xx ou rede NÃO raspa (na dúvida, não)', async () => {
    const f5 = (async (u: any) => resp(503)) as any;
    expect((await rasparPagina('https://d3.test/x', { fetchImpl: f5, delayMs: 0 })).tipo).toBe('bloqueado_robots');
    _resetRaspagem();
    const fr = (async () => { throw new Error('ECONNRESET'); }) as any;
    expect((await rasparPagina('https://d4.test/x', { fetchImpl: fr, delayMs: 0 })).tipo).toBe('bloqueado_robots');
  });
  it('erro HTTP da página vira erro; URL inválida e protocolo estranho são recusados', async () => {
    const f = (async (u: any) => (String(u).endsWith('/robots.txt') ? resp(404) : resp(500))) as any;
    expect((await rasparPagina('https://d5.test/x', { fetchImpl: f, delayMs: 0 })).tipo).toBe('erro');
    expect((await rasparPagina('nao-e-url', { fetchImpl: f })).tipo).toBe('erro');
    expect((await rasparPagina('ftp://d.test/x', { fetchImpl: f })).tipo).toBe('erro');
  });
  it('espera o intervalo entre duas páginas do mesmo host', async () => {
    const t: number[] = [];
    const f = (async (u: any) => { if (!String(u).endsWith('/robots.txt')) t.push(Date.now()); return String(u).endsWith('/robots.txt') ? resp(404) : resp(200, ''); }) as any;
    await rasparPagina('https://d6.test/a', { fetchImpl: f, delayMs: 60 });
    await rasparPagina('https://d6.test/b', { fetchImpl: f, delayMs: 60 });
    expect(t[1] - t[0]).toBeGreaterThanOrEqual(50);
  });
});
