/**
 * Verificação de link de convite pela PÁGINA PÚBLICA https://chat.whatsapp.com/<código> — a mesma que
 * qualquer navegador abre. Não usa instância, não entra no grupo, não interage com ninguém.
 *
 * Achado empírico (2026-09-24): link vivo devolve o nome do grupo em <meta property="og:title">;
 * link revogado/falso devolve a MESMA página com og:title vazio e a imagem genérica do WhatsApp.
 * Participantes e descrição não aparecem (a og:description é fixa: "Convite para grupo do WhatsApp").
 */
export type ResultadoPagina =
  | { tipo: 'ok'; nome: string; temFoto: boolean }
  | { tipo: 'invalido'; motivo: string }
  | { tipo: 'indisponivel'; motivo: string; bloqueio: boolean };   // bloqueio=true → pausar a fila por um tempo

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodificarEntidades(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTIDADES[n.toLowerCase()] ?? m);
}

function meta(html: string, propriedade: string): string | null {
  const re = new RegExp(`<meta[^>]+property=["']${propriedade}["'][^>]*>`, 'i');
  const tag = re.exec(html)?.[0];
  if (!tag) return null;
  const c = /content=(["'])(.*?)\1/is.exec(tag);
  return c ? decodificarEntidades(c[2]).trim() : '';
}

/** Interpreta a resposta HTTP da página pública. Na dúvida NÃO marca o link como inválido. */
export function interpretarPaginaConvite(status: number, html: string): ResultadoPagina {
  if (status === 429 || status === 403) return { tipo: 'indisponivel', motivo: `WhatsApp limitou as consultas (HTTP ${status})`, bloqueio: true };
  if (status === 404 || status === 410) return { tipo: 'invalido', motivo: `Página do convite não existe (HTTP ${status})` };
  if (status >= 500) return { tipo: 'indisponivel', motivo: `WhatsApp indisponível (HTTP ${status})`, bloqueio: false };
  if (status !== 200) return { tipo: 'indisponivel', motivo: `Resposta inesperada (HTTP ${status})`, bloqueio: false };

  const titulo = meta(html, 'og:title');
  // Sem a tag og:title a página não é a de convite (captcha, bloqueio, mudança de layout): não decide nada.
  if (titulo === null) return { tipo: 'indisponivel', motivo: 'Página sem os dados de convite (possível bloqueio ou mudança de layout)', bloqueio: true };
  if (!titulo) return { tipo: 'invalido', motivo: 'Convite revogado ou inexistente (página sem nome de grupo)' };

  const imagem = meta(html, 'og:image') ?? '';
  return { tipo: 'ok', nome: titulo.slice(0, 200), temFoto: /pps\.whatsapp\.net/.test(imagem) };
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export async function buscarPaginaConvite(codigo: string, fetchImpl: typeof fetch = fetch): Promise<ResultadoPagina> {
  try {
    const res = await fetchImpl(`https://chat.whatsapp.com/${encodeURIComponent(codigo)}`, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9', Accept: 'text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
    });
    return interpretarPaginaConvite(res.status, await res.text());
  } catch (err: any) {
    return { tipo: 'indisponivel', motivo: `Falha de rede: ${err?.message ?? 'desconhecida'}`, bloqueio: false };
  }
}
