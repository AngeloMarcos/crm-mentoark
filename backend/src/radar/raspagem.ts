/**
 * Raspagem de páginas de DIRETÓRIO de grupos: uma página lista dezenas de convites, então 1 leitura
 * rende muito mais que 1 resultado de busca. Só lê HTML público, respeita `robots.txt`, espera entre
 * requisições e tem teto por busca e por dia. O uso depende dos termos de cada site.
 */
import { extrairLinks, LinkGrupo } from './extrairLinks';

/** Hosts tratados como diretório quando não há configuração (RADAR_DIRETORIOS). */
export const DIRETORIOS_PADRAO = [
  'gruposwhats.app', 'gruposdewhats.com.br', 'gruposdezap.com', 'linkdegrupo.com.br', 'gruposbrasil.com.br',
];

export const USER_AGENT_RASPAGEM = 'MentoArkRadar/1.0 (+https://crm.mentoark.com.br)';

export function listaDiretorios(env: string | undefined): string[] {
  const l = (env ?? '').split(',').map(s => s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean);
  return l.length ? l : DIRETORIOS_PADRAO;
}

export function hostDe(url: string): string | null {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
}

/** O link é uma página de um diretório configurado (o host bate ou é subdomínio dele)? */
export function ehDiretorio(url: string, diretorios: string[]): boolean {
  const h = hostDe(url);
  if (!h) return false;
  return diretorios.some(d => h === d || h.endsWith(`.${d}`));
}

/** Links de convite numa página HTML (também dentro de href, data-attributes e texto). Deduplica pelo código. */
export function extrairLinksDaPagina(html: string): LinkGrupo[] {
  // Decodifica só o essencial para que "chat.whatsapp.com&#x2F;CODE" e "\/" de JSON também sejam vistos.
  const limpo = html
    .replace(/&#x2F;|&#47;/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&');
  return extrairLinks(limpo).filter(l => l.plataforma === 'whatsapp');
}

// ── robots.txt ────────────────────────────────────────────────────────────────────────────────────
interface Regra { permitir: boolean; caminho: string }

/** Regras que valem para o nosso agente (grupo mais específico; senão `*`). */
export function regrasDoRobots(robots: string, agente = 'mentoarkradar'): Regra[] {
  const grupos: { agentes: string[]; regras: Regra[] }[] = [];
  let atual: { agentes: string[]; regras: Regra[] } | null = null;
  let leuRegra = false;
  for (const bruta of robots.split(/\r?\n/)) {
    const linha = bruta.replace(/#.*$/, '').trim();
    if (!linha) continue;
    const i = linha.indexOf(':');
    if (i < 0) continue;
    const chave = linha.slice(0, i).trim().toLowerCase();
    const valor = linha.slice(i + 1).trim();
    if (chave === 'user-agent') {
      if (!atual || leuRegra) { atual = { agentes: [], regras: [] }; grupos.push(atual); leuRegra = false; }
      atual.agentes.push(valor.toLowerCase());
    } else if ((chave === 'allow' || chave === 'disallow') && atual) {
      leuRegra = true;
      if (valor) atual.regras.push({ permitir: chave === 'allow', caminho: valor });
      else if (chave === 'disallow') { /* "Disallow:" vazio = permite tudo */ }
    }
  }
  const proprio = grupos.filter(g => g.agentes.some(a => a !== '*' && agente.includes(a)));
  const alvo = proprio.length ? proprio : grupos.filter(g => g.agentes.includes('*'));
  return alvo.flatMap(g => g.regras);
}

function casaCaminho(padrao: string, caminho: string): boolean {
  const fim = padrao.endsWith('$');
  const corpo = (fim ? padrao.slice(0, -1) : padrao).split('*').map(p => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${corpo}${fim ? '$' : ''}`).test(caminho);
}

/** Regra mais específica (caminho mais longo) vence; empate favorece `Allow`. Sem regra = permitido. */
export function robotsPermite(regras: Regra[], caminho: string): boolean {
  let melhor: Regra | null = null;
  for (const r of regras) {
    if (!casaCaminho(r.caminho, caminho)) continue;
    if (!melhor || r.caminho.length > melhor.caminho.length || (r.caminho.length === melhor.caminho.length && r.permitir)) melhor = r;
  }
  return melhor ? melhor.permitir : true;
}

// ── Coleta ────────────────────────────────────────────────────────────────────────────────────────
export type ResultadoPagina =
  | { tipo: 'ok'; links: LinkGrupo[]; bytes: number }
  | { tipo: 'bloqueado_robots' }
  | { tipo: 'erro'; motivo: string };

export interface OpcoesRaspagem { fetchImpl?: typeof fetch; maxBytes?: number; delayMs?: number }

const espera = (ms: number) => new Promise(r => setTimeout(r, ms));
const cacheRobots = new Map<string, { em: number; regras: Regra[] }>();
const ultimoAcesso = new Map<string, number>();

async function regrasDoHost(origem: string, f: typeof fetch): Promise<Regra[]> {
  const c = cacheRobots.get(origem);
  if (c && Date.now() - c.em < 6 * 3600_000) return c.regras;
  let regras: Regra[] = [];
  try {
    const res = await f(`${origem}/robots.txt`, { headers: { 'User-Agent': USER_AGENT_RASPAGEM }, signal: AbortSignal.timeout(10000) });
    // 4xx = sem robots (tudo permitido). 5xx/rede = na dúvida, NÃO raspa (regras "bloqueia tudo").
    if (res.ok) regras = regrasDoRobots(await res.text());
    else if (res.status >= 500) regras = [{ permitir: false, caminho: '/' }];
  } catch { regras = [{ permitir: false, caminho: '/' }]; }
  cacheRobots.set(origem, { em: Date.now(), regras });
  return regras;
}

/** Baixa uma página de diretório respeitando robots.txt e um intervalo mínimo por host. */
export async function rasparPagina(url: string, opts: OpcoesRaspagem = {}): Promise<ResultadoPagina> {
  const f = opts.fetchImpl ?? fetch;
  let u: URL;
  try { u = new URL(url); } catch { return { tipo: 'erro', motivo: 'URL inválida' }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { tipo: 'erro', motivo: 'protocolo não suportado' };

  const regras = await regrasDoHost(u.origin, f);
  if (!robotsPermite(regras, u.pathname + u.search)) return { tipo: 'bloqueado_robots' };

  const delay = opts.delayMs ?? (Number(process.env.RADAR_RASPAGEM_DELAY_MS) || 4000);
  const ult = ultimoAcesso.get(u.hostname) ?? 0;
  const falta = ult + delay - Date.now();
  if (falta > 0) await espera(falta);
  ultimoAcesso.set(u.hostname, Date.now());

  try {
    const res = await f(url, {
      headers: { 'User-Agent': USER_AGENT_RASPAGEM, Accept: 'text/html', 'Accept-Language': 'pt-BR,pt;q=0.9' },
      redirect: 'follow', signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return { tipo: 'erro', motivo: `HTTP ${res.status}` };
    const max = opts.maxBytes ?? 2_000_000;
    const html = (await res.text()).slice(0, max);
    return { tipo: 'ok', links: extrairLinksDaPagina(html), bytes: html.length };
  } catch (err: any) {
    return { tipo: 'erro', motivo: `Falha de rede: ${err?.message ?? 'desconhecida'}` };
  }
}

/** Só para testes: limpa caches entre casos. */
export function _resetRaspagem() { cacheRobots.clear(); ultimoAcesso.clear(); }
