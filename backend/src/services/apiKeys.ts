/**
 * apiKeys.ts — Chaves da API pública `/v1` (2026-11-02, modelo Cubo `X-API-Key`).
 *
 * A chave é mostrada uma única vez (`sk_live_...`); no banco fica só o SHA-256 e os 12 primeiros
 * caracteres (prefixo) para a tela identificar qual é qual. Escopos no formato do Cubo:
 * `{ "peoples": ["read","create"], "messages": ["create"] }`, ou `full_access` para tudo.
 */
import crypto from 'crypto';
import { normalizarTelefone } from '../utils/telefone';

export const ACOES = ['read', 'create', 'update', 'delete'] as const;
export type Acao = typeof ACOES[number];

/** Recursos que a API pública expõe hoje, com as ações que fazem sentido em cada um. */
export const RECURSOS: Record<string, { nome: string; acoes: Acao[] }> = {
  peoples:       { nome: 'Contatos', acoes: ['read', 'create', 'update', 'delete'] },
  tags:          { nome: 'Etiquetas', acoes: ['read', 'create', 'update'] },
  channels:      { nome: 'Canais', acoes: ['read'] },
  conversations: { nome: 'Conversas', acoes: ['read'] },
  messages:      { nome: 'Envio de mensagens', acoes: ['create'] },
  agents:        { nome: 'Agentes de IA', acoes: ['read'] },
  funnel:        { nome: 'Funil', acoes: ['read', 'update'] },
};

export type Escopos = Record<string, Acao[]>;

const PREFIXO = 'sk_live_';

export function gerarChave(): { chave: string; prefixo: string; hash: string } {
  const chave = PREFIXO + crypto.randomBytes(24).toString('base64url');
  return { chave, prefixo: chave.slice(0, 12), hash: hashChave(chave) };
}

export function hashChave(chave: string): string {
  return crypto.createHash('sha256').update(chave).digest('hex');
}

export function pareceChave(valor: unknown): valor is string {
  return typeof valor === 'string' && valor.startsWith(PREFIXO) && valor.length >= 30 && valor.length <= 80;
}

/** Mantém só recursos e ações conhecidos (o que vier a mais do cliente é descartado). */
export function normalizarEscopos(bruto: unknown): Escopos {
  const saida: Escopos = {};
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return saida;
  for (const [recurso, acoes] of Object.entries(bruto as Record<string, unknown>)) {
    const def = RECURSOS[recurso];
    if (!def || !Array.isArray(acoes)) continue;
    const validas = def.acoes.filter(a => acoes.includes(a));
    if (validas.length) saida[recurso] = validas;
  }
  return saida;
}

export function temEscopo(chave: { full_access?: boolean; scopes?: Escopos | null }, recurso: string, acao: Acao): boolean {
  if (chave.full_access) return true;
  return !!chave.scopes?.[recurso]?.includes(acao);
}

/**
 * Limite por chave numa janela de 1 minuto, em memória (um processo só na VPS). Devolve quanto
 * resta e quando a janela zera, para os headers `x-ratelimit-*`.
 */
export function criarLimitador(porMinuto: number, agora: () => number = Date.now) {
  const janelas = new Map<string, { inicio: number; usados: number }>();
  return (id: string): { ok: boolean; limite: number; restante: number; resetEmSeg: number } => {
    const t = agora();
    let j = janelas.get(id);
    if (!j || t - j.inicio >= 60_000) {
      j = { inicio: t, usados: 0 };
      janelas.set(id, j);
    }
    j.usados++;
    const resetEmSeg = Math.ceil((j.inicio + 60_000 - t) / 1000);
    return { ok: j.usados <= porMinuto, limite: porMinuto, restante: Math.max(0, porMinuto - j.usados), resetEmSeg };
  };
}

/**
 * Formas em que o mesmo celular brasileiro aparece gravado (com/sem 55, com/sem o 9º dígito),
 * para a busca por telefone achar o contato como o Cubo faz. Vazio se o número é inválido.
 */
export function variantesTelefone(bruto: unknown): string[] {
  const n = normalizarTelefone(typeof bruto === 'string' || typeof bruto === 'number' ? String(bruto) : '');
  if (!n.normalizado) return [];
  const v = new Set<string>([n.normalizado]);
  if (n.normalizado.startsWith('55') && n.tipo !== 'internacional') {
    const nacional = n.normalizado.slice(2);
    v.add(nacional);
    if (n.tipo === 'celular') {
      const sem9 = nacional.slice(0, 2) + nacional.slice(3);
      v.add(sem9);
      v.add('55' + sem9);
    }
  }
  return [...v];
}

/** Paginação no formato do Cubo: `page`/`perPage` (padrão 10, máximo 100). */
export function lerPaginacao(query: Record<string, unknown>): { page: number; perPage: number; offset: number } {
  const page = Math.max(1, parseInt(String(query.page ?? '1'), 10) || 1);
  const perPage = Math.min(100, Math.max(1, parseInt(String(query.perPage ?? '10'), 10) || 10));
  return { page, perPage, offset: (page - 1) * perPage };
}

export function metadataDaPagina(total: number, page: number, perPage: number) {
  const lastPage = Math.max(1, Math.ceil(total / perPage));
  return { total, perPage, currentPage: page, lastPage, firstPage: 1 };
}

/**
 * Datas no formato do Cubo: `dd/MM/yyyy` ou intervalo `dd/MM/yyyy,dd/MM/yyyy`. Devolve ISO
 * (início do primeiro dia, fim do último) ou null se o texto não bate o formato.
 */
export function lerIntervaloDatas(valor: unknown): { de: string; ate: string } | null {
  if (typeof valor !== 'string' || !valor.trim()) return null;
  const partes = valor.split(',').map(s => s.trim());
  if (partes.length > 2) return null;
  const iso = (s: string): string | null => {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
    if (!m) return null;
    const d = new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00-03:00`);
    return isNaN(d.getTime()) ? null : d.toISOString();
  };
  const de = iso(partes[0]);
  const fimBase = iso(partes[1] ?? partes[0]);
  if (!de || !fimBase) return null;
  const ate = new Date(new Date(fimBase).getTime() + 86_400_000 - 1).toISOString();
  return { de, ate };
}
