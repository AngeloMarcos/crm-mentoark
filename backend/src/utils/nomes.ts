// Limpeza de nomes de contato (funções puras, cobertas por tests/nomes.test.ts).
// Objetivo: nunca usar telefone, emoji ou lixo de formatação como "nome" numa saudação.

export interface NomeLimpo {
  /** Nome completo limpo e capitalizado; null quando não há nome real. */
  nome: string | null;
  /** Primeiro nome para {{primeiro_nome}}; null quando não há nome real. */
  primeiroNome: string | null;
  /** true só quando existe um nome de pessoa/empresa aproveitável. */
  confiavel: boolean;
}

const MINUSCULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'di', 'du']);
const TITULOS = new Set(['dr', 'dra', 'sr', 'sra', 'prof', 'profa', 'eng', 'doutor', 'doutora']);
// Nomes genéricos que não identificam ninguém.
const GENERICOS = new Set([
  'contato', 'cliente', 'whatsapp', 'grupo', 'usuario', 'usuário', 'user', 'unknown',
  'desconhecido', 'sem nome', 'nome', 'lead', 'null', 'undefined', 'n/a', 'na',
]);

function removerDecoracao(s: string): string {
  return s
    // emojis, pictogramas, símbolos, marcas de formatação invisíveis e bullets
    .replace(/[\p{Extended_Pictographic}\p{S}\p{So}​-‏‪-‮⁠︎️•·]/gu, ' ')
    // pontuação decorativa que sobra (mantém apóstrofo, hífen e ponto de abreviação)
    .replace(/[|~_*#@!?<>[\]{}()/\\=+^"“”‘’`´¨:;,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[-.\s]+|[-.\s]+$/g, '');
}

function titulo(nome: string): string {
  const semMaiusculaMista = nome === nome.toUpperCase() || nome === nome.toLowerCase();
  if (!semMaiusculaMista) return nome; // já tem capitalização humana ("Gomes Cell Vip", "McDonald")
  return nome
    .toLowerCase()
    .split(' ')
    .map((p, i) => (i > 0 && MINUSCULAS.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ');
}

/** Devolve o nome limpo, ou null se o texto não é um nome aproveitável. */
export function limparNome(raw: string | null | undefined, telefone?: string | null): string | null {
  if (!raw) return null;
  const limpo = removerDecoracao(String(raw));
  if (!limpo) return null;

  const digitos = limpo.replace(/\D/g, '');
  // parece telefone / id (6+ dígitos) ou é igual ao telefone do contato
  if (digitos.length >= 6) return null;
  if (telefone && digitos && digitos === telefone.replace(/\D/g, '')) return null;

  // precisa ter ao menos 2 letras
  const letras = limpo.replace(/[^\p{L}]/gu, '');
  if (letras.length < 2) return null;
  if (GENERICOS.has(limpo.toLowerCase())) return null;

  return titulo(limpo);
}

/** Primeiro nome para saudação (ignora títulos como "Dr."). */
export function primeiroNomeDe(nomeLimpo: string | null): string | null {
  if (!nomeLimpo) return null;
  for (const token of nomeLimpo.split(' ')) {
    const t = token.replace(/\.$/, '');
    if (!t || TITULOS.has(t.toLowerCase())) continue;
    if (t.replace(/[^\p{L}]/gu, '').length >= 2) return t;
  }
  return null;
}

/** Escolhe o melhor nome entre `nome` (cadastro) e `pushName` (perfil do WhatsApp). */
export function resolverNome(
  nome: string | null | undefined,
  pushName: string | null | undefined,
  telefone?: string | null,
): NomeLimpo {
  const escolhido = limparNome(nome, telefone) ?? limparNome(pushName, telefone);
  const primeiro = primeiroNomeDe(escolhido);
  if (!escolhido || !primeiro) return { nome: null, primeiroNome: null, confiavel: false };
  return { nome: escolhido, primeiroNome: primeiro, confiavel: true };
}
