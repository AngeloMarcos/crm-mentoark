/**
 * linkPreview.ts — busca metadados Open Graph (título/descrição/imagem) de uma URL comum
 * compartilhada numa conversa, pro chat mostrar um card com preview em vez de texto cru.
 *
 * [AUDITORIA] LÓGICA (Sprint Grupos — melhorias WhatsApp, 2026-09-06, pedido explícito do
 * usuário: "links de outros grupos também virem preview/card, não só convite"): antes disso só
 * existia um caso especial pra link de convite de grupo (`chat.whatsapp.com/XXX`, regex client-side
 * em WhatsAppInterface.tsx, sem nenhuma chamada de rede) — esta função cobre QUALQUER URL http(s),
 * o que exige buscar a página de verdade (server-side, porque a maioria dos sites não libera CORS
 * pro navegador buscar direto) e por isso precisa de cuidado real com SSRF: uma URL colada numa
 * mensagem de WhatsApp é dado de terceiro, não confiável — sem validação, um link malicioso
 * apontando pra rede interna da VPS (ex: `http://169.254.169.254/`, metadata de nuvem, ou um IP
 * privado tipo `http://10.0.0.5:5432`) faria o BACKEND fazer essa requisição em nome do atacante.
 * `validarHostSeguro()` resolve o DNS e bloqueia qualquer IP privado/loopback/link-local antes de
 * buscar. Limitação conhecida, documentada aqui de propósito: isso reduz o risco real mas não é
 * hermético contra "DNS rebinding" (hostname resolveria pra IP público nesta checagem e mudaria
 * pra um IP privado bem no instante da conexão real) — mitigação completa exigiria um resolver
 * customizado no nível do socket (ex: `dns.lookup` custom passado pro dispatcher do fetch),
 * fora de escopo da "versão simples primeiro" desta sprint; cobre o caso real que motivou o
 * pedido (link comum tipo YouTube/notícia/Instagram colado numa conversa).
 */
import dns from 'dns';
import { isIP } from 'net';
import { Pool } from 'pg';
import { log } from '../logger';

const TIMEOUT_MS = 5000;
const MAX_BYTES = 2 * 1024 * 1024; // 2MB — og:tags sempre ficam no <head>, nunca precisa da página inteira
const CACHE_DIAS = 7;
const USER_AGENT = 'Mozilla/5.0 (compatible; MentoArkBot/1.0; +https://mentoark.com.br)';

export interface LinkPreview {
  url: string;
  titulo: string | null;
  descricao: string | null;
  imagemUrl: string | null;
  siteNome: string | null;
  erro: string | null;
}

// Ranges privados/reservados (RFC 1918, loopback, link-local — inclui 169.254.169.254, endpoint
// de metadata comum em nuvens, um alvo clássico de SSRF) — qualquer IP resolvido nessas faixas
// bloqueia a busca.
function ehIpPrivado(ip: string): boolean {
  const versao = isIP(ip);
  if (versao === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }
  if (versao === 6) {
    const low = ip.toLowerCase();
    if (low === '::1' || low === '::') return true;
    if (low.startsWith('fc') || low.startsWith('fd')) return true; // fc00::/7 (unique local)
    if (low.startsWith('fe80')) return true; // link-local
    return false;
  }
  return true; // não reconhecido como IP válido — trata como suspeito, bloqueia
}

async function validarHostSeguro(hostname: string): Promise<boolean> {
  if (hostname === 'localhost') return false;
  if (isIP(hostname)) return !ehIpPrivado(hostname);
  try {
    const enderecos = await dns.promises.lookup(hostname, { all: true });
    if (!enderecos.length) return false;
    return enderecos.every(e => !ehIpPrivado(e.address));
  } catch {
    return false;
  }
}

function extrairMeta(html: string, propriedade: string): string | null {
  const re1 = new RegExp(`<meta[^>]+property=["']${propriedade}["'][^>]+content=["']([^"']*)["']`, 'i');
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${propriedade}["']`, 'i');
  const m = html.match(re1) || html.match(re2);
  return m ? (m[1].trim() || null) : null;
}

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

async function salvarCache(pool: Pool, r: LinkPreview): Promise<void> {
  await pool.query(
    `INSERT INTO link_previews_cache (url, titulo, descricao, imagem_url, site_nome, erro, buscado_em)
     VALUES ($1,$2,$3,$4,$5,$6,NOW())
     ON CONFLICT (url) DO UPDATE SET titulo=$2, descricao=$3, imagem_url=$4, site_nome=$5, erro=$6, buscado_em=NOW()`,
    [r.url, r.titulo, r.descricao, r.imagemUrl, r.siteNome, r.erro]
  ).catch(err => log.warn('LINK_PREVIEW', 'Falha ao gravar cache', { err: err?.message }));
}

export async function buscarPreviewLink(pool: Pool, urlBruta: string): Promise<LinkPreview> {
  let url: URL;
  try {
    url = new URL(urlBruta);
  } catch {
    return { url: urlBruta, titulo: null, descricao: null, imagemUrl: null, siteNome: null, erro: 'url_invalida' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { url: urlBruta, titulo: null, descricao: null, imagemUrl: null, siteNome: null, erro: 'protocolo_nao_suportado' };
  }

  const cache = await pool.query(
    `SELECT titulo, descricao, imagem_url, site_nome, erro, buscado_em FROM link_previews_cache WHERE url = $1`,
    [url.toString()]
  ).catch(() => ({ rows: [] as any[] }));
  const linha = cache.rows[0];
  if (linha && (Date.now() - new Date(linha.buscado_em).getTime()) < CACHE_DIAS * 24 * 60 * 60 * 1000) {
    return { url: url.toString(), titulo: linha.titulo, descricao: linha.descricao, imagemUrl: linha.imagem_url, siteNome: linha.site_nome, erro: linha.erro };
  }

  if (!(await validarHostSeguro(url.hostname))) {
    const resultado: LinkPreview = { url: url.toString(), titulo: null, descricao: null, imagemUrl: null, siteNome: null, erro: 'host_bloqueado' };
    await salvarCache(pool, resultado);
    return resultado;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let resp: Response;
    try {
      resp = await fetch(url.toString(), {
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      });
    } finally {
      clearTimeout(timer);
    }
    if (!resp.ok) throw new Error(`status ${resp.status}`);
    const contentType = resp.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) throw new Error('conteúdo não é HTML');

    let html = '';
    const reader = resp.body?.getReader();
    if (reader) {
      let recebido = 0;
      const decoder = new TextDecoder();
      while (recebido < MAX_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        recebido += value.byteLength;
        html += decoder.decode(value, { stream: true });
        if (/<\/head>/i.test(html)) break;
      }
      reader.cancel().catch(() => {});
    }

    const titulo = extrairMeta(html, 'og:title') || (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? null);
    const descricao = extrairMeta(html, 'og:description');
    let imagemUrl = extrairMeta(html, 'og:image');
    if (imagemUrl && !/^https?:\/\//i.test(imagemUrl)) {
      try { imagemUrl = new URL(imagemUrl, url.toString()).toString(); } catch { imagemUrl = null; }
    }
    const siteNome = extrairMeta(html, 'og:site_name') || url.hostname;

    const resultado: LinkPreview = {
      url: url.toString(),
      titulo: titulo ? decodeEntities(titulo).slice(0, 200) : null,
      descricao: descricao ? decodeEntities(descricao).slice(0, 300) : null,
      imagemUrl,
      siteNome,
      erro: null,
    };
    await salvarCache(pool, resultado);
    return resultado;
  } catch (err: any) {
    log.warn('LINK_PREVIEW', 'Falha ao buscar preview de link', { url: url.toString(), err: err?.message });
    const resultado: LinkPreview = { url: url.toString(), titulo: null, descricao: null, imagemUrl: null, siteNome: null, erro: 'falha_busca' };
    await salvarCache(pool, resultado);
    return resultado;
  }
}
