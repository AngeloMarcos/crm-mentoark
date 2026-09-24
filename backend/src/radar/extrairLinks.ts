/**
 * Extração de links de convite de grupo em texto livre (resultado de busca, planilha, HTML).
 * Deduplica pelo código de convite. Links t.me são só catalogados (sem entrar/extrair).
 */
export interface LinkWhatsApp { plataforma: 'whatsapp'; codigo: string; url: string }
export interface LinkTelegram { plataforma: 'telegram'; codigo: string; url: string }
export type LinkGrupo = LinkWhatsApp | LinkTelegram;

const RE_WHATSAPP = /chat\.whatsapp\.com\/(?:invite\/)?([A-Za-z0-9]{20,24})(?![A-Za-z0-9])/gi;
// t.me/<nome> | t.me/joinchat/<hash> | t.me/+<hash>. Ignora rotas que não são grupo/canal.
const RE_TELEGRAM = /(?:^|[^A-Za-z0-9.])t\.me\/(?:joinchat\/|\+)?([A-Za-z0-9_-]{5,64})/gi;
const TELEGRAM_IGNORAR = new Set(['share', 'addstickers', 'proxy', 'socks', 'login', 'setlanguage', 'iv', 'c', 's']);

export function extrairLinks(texto: string | null | undefined): LinkGrupo[] {
  if (!texto) return [];
  const vistos = new Set<string>();
  const out: LinkGrupo[] = [];

  for (const m of texto.matchAll(RE_WHATSAPP)) {
    const codigo = m[1];
    const chave = `w:${codigo}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    out.push({ plataforma: 'whatsapp', codigo, url: `https://chat.whatsapp.com/${codigo}` });
  }
  for (const m of texto.matchAll(RE_TELEGRAM)) {
    const codigo = m[1];
    if (TELEGRAM_IGNORAR.has(codigo.toLowerCase())) continue;
    const chave = `t:${codigo.toLowerCase()}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    out.push({ plataforma: 'telegram', codigo, url: `https://t.me/${codigo}` });
  }
  return out;
}
