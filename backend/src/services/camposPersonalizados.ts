/**
 * camposPersonalizados.ts — campos personalizados do contato (2026-11-11, lacuna P3 do Cubo,
 * diagnosticos/SPRINT_CAMPOS_PERSONALIZADOS.md).
 *
 * A conta (users.owner_id) cadastra campos (nome, tipo, opções); o valor de cada contato fica em
 * `contatos.campos` (jsonb), indexado pela CHAVE do campo — gerada do nome na criação e imutável,
 * para renomear o campo não perder os valores nem quebrar integrações da API /v1.
 * Excluir = desativar: o valor continua no contato e volta se o campo for reativado.
 */
import { Pool, PoolClient } from 'pg';
import type { MCPTool } from './mcp/tools';
import { resolverOwnerId } from './subscription';

export const TIPOS_CAMPO = ['texto', 'numero', 'moeda', 'data', 'selecao', 'multipla', 'sim_nao'] as const;
export type TipoCampo = typeof TIPOS_CAMPO[number];

export interface CampoPersonalizado {
  id: string;
  nome: string;
  chave: string;
  tipo: TipoCampo;
  opcoes: string[];
  descricao?: string | null;
  ia_preenche?: boolean;
  ativo?: boolean;
  ordem?: number;
}

export type ValorCampo = string | number | boolean | string[];
export type ResultadoValor = { ok: true; valor: ValorCampo | null } | { ok: false; erro: string };

const MAX_OPCOES = 50;
const MAX_TEXTO = 1000;

// ── Definição ────────────────────────────────────────────────────────────────

/** "Orçamento mensal (R$)" → "orcamento_mensal_r". Vazio vira "campo". */
export function gerarChave(nome: string): string {
  const base = String(nome || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    .slice(0, 40).replace(/_+$/g, '');
  return /^[a-z]/.test(base) ? base : `campo${base ? '_' + base : ''}`;
}

/** Chave livre: "cidade", "cidade_2", "cidade_3"... */
export function chaveLivre(desejada: string, usadas: Iterable<string>): string {
  const set = new Set(usadas);
  if (!set.has(desejada)) return desejada;
  for (let i = 2; ; i++) if (!set.has(`${desejada}_${i}`)) return `${desejada}_${i}`;
}

export function ehTipoCampo(v: unknown): v is TipoCampo {
  return TIPOS_CAMPO.includes(v as TipoCampo);
}

/** Opções de seleção: aparadas, sem vazias nem repetidas (ignorando maiúsculas). */
export function normalizarOpcoes(v: unknown): string[] {
  const lista = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/\n|,/) : [];
  const vistas = new Set<string>();
  const saida: string[] = [];
  for (const item of lista) {
    const o = String(item ?? '').trim().slice(0, 80);
    if (!o || vistas.has(o.toLowerCase())) continue;
    vistas.add(o.toLowerCase());
    saida.push(o);
    if (saida.length >= MAX_OPCOES) break;
  }
  return saida;
}

/** Valida o corpo de criação/edição. `parcial` = edição (só valida o que veio). */
export function validarDefinicao(body: any, parcial: boolean):
  { ok: true; dados: Partial<Pick<CampoPersonalizado, 'nome' | 'tipo' | 'opcoes' | 'descricao' | 'ia_preenche' | 'ativo'>> } | { ok: false; erro: string } {
  const dados: Record<string, any> = {};
  if (body?.nome !== undefined || !parcial) {
    const nome = typeof body?.nome === 'string' ? body.nome.trim() : '';
    if (!nome || nome.length > 60) return { ok: false, erro: 'Informe o nome do campo (até 60 caracteres).' };
    dados.nome = nome;
  }
  if (body?.tipo !== undefined || !parcial) {
    if (!ehTipoCampo(body?.tipo)) return { ok: false, erro: `Tipo inválido. Use: ${TIPOS_CAMPO.join(', ')}.` };
    dados.tipo = body.tipo;
  }
  if (body?.opcoes !== undefined) dados.opcoes = normalizarOpcoes(body.opcoes);
  if ((dados.tipo === 'selecao' || dados.tipo === 'multipla') && !(dados.opcoes?.length)) {
    return { ok: false, erro: 'Campo de seleção precisa de pelo menos uma opção.' };
  }
  if (body?.descricao !== undefined) {
    if (body.descricao !== null && typeof body.descricao !== 'string') return { ok: false, erro: 'Descrição deve ser texto.' };
    dados.descricao = body.descricao ? body.descricao.trim().slice(0, 300) : null;
  }
  if (body?.ia_preenche !== undefined) dados.ia_preenche = body.ia_preenche === true;
  if (body?.ativo !== undefined) dados.ativo = body.ativo === true;
  return { ok: true, dados };
}

// ── Valor ────────────────────────────────────────────────────────────────────

/**
 * "1.234,56", "1234.56", "R$ 5 mil", "5k", 5000 → número. Ponto e vírgula juntos: o último é o
 * decimal. Só ponto: "1.234" (grupo de 3) é milhar, "12.5" é decimal.
 */
export function lerNumero(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  let s = v.trim().toLowerCase().replace(/r\$|\s/g, '');
  let mult = 1;
  const sufixo = s.match(/(mil|k|mi|milh[oõ]es|milh[aã]o)$/);
  if (sufixo) {
    mult = sufixo[1] === 'mil' || sufixo[1] === 'k' ? 1e3 : 1e6;
    s = s.slice(0, -sufixo[1].length);
  }
  if (!/^-?[\d.,]+$/.test(s)) return null;
  const ultVirg = s.lastIndexOf(','), ultPonto = s.lastIndexOf('.');
  if (ultVirg >= 0 && ultPonto >= 0) {
    const dec = ultVirg > ultPonto ? ',' : '.';
    s = s.split(dec === ',' ? '.' : ',').join('').replace(dec, '.');
  } else if (ultVirg >= 0) {
    s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (ultPonto >= 0 && /^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * mult * 100) / 100 : null;
}

/** "2026-11-11", "11/11/2026", "11/11/26" → "2026-11-11" (data válida no calendário). */
export function lerData(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  let a: number, m: number, d: number;
  let r = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (r) { a = +r[1]; m = +r[2]; d = +r[3]; }
  else if ((r = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/))) {
    d = +r[1]; m = +r[2]; a = r[3].length === 2 ? 2000 + +r[3] : +r[3];
  } else return null;
  const dt = new Date(Date.UTC(a, m - 1, d));
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(a).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const vazio = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length);

/** Converte o valor bruto (tela, API ou IA) para o formato guardado. `null` = apagar o valor. */
export function normalizarValor(campo: Pick<CampoPersonalizado, 'nome' | 'tipo' | 'opcoes'>, bruto: unknown): ResultadoValor {
  if (vazio(bruto)) return { ok: true, valor: null };
  const nome = `"${campo.nome}"`;
  const acharOpcao = (s: string) => campo.opcoes.find(o => o.toLowerCase() === s.trim().toLowerCase());
  switch (campo.tipo) {
    case 'texto':
      if (typeof bruto !== 'string' && typeof bruto !== 'number') return { ok: false, erro: `${nome} deve ser texto.` };
      return { ok: true, valor: String(bruto).trim().slice(0, MAX_TEXTO) };
    case 'numero':
    case 'moeda': {
      const n = lerNumero(bruto);
      return n === null ? { ok: false, erro: `${nome} deve ser um número.` } : { ok: true, valor: n };
    }
    case 'data': {
      const d = lerData(bruto);
      return d ? { ok: true, valor: d } : { ok: false, erro: `${nome} deve ser uma data (dd/mm/aaaa).` };
    }
    case 'sim_nao': {
      if (typeof bruto === 'boolean') return { ok: true, valor: bruto };
      const s = String(bruto).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      if (['sim', 's', 'true', '1', 'yes'].includes(s)) return { ok: true, valor: true };
      if (['nao', 'n', 'false', '0', 'no'].includes(s)) return { ok: true, valor: false };
      return { ok: false, erro: `${nome} deve ser sim ou não.` };
    }
    case 'selecao': {
      const o = typeof bruto === 'string' ? acharOpcao(bruto) : undefined;
      return o ? { ok: true, valor: o } : { ok: false, erro: `${nome} aceita só: ${campo.opcoes.join(', ')}.` };
    }
    case 'multipla': {
      const itens = Array.isArray(bruto) ? bruto : typeof bruto === 'string' ? bruto.split(',') : null;
      if (!itens) return { ok: false, erro: `${nome} deve ser uma lista de opções.` };
      const escolhidas: string[] = [];
      for (const item of itens) {
        if (vazio(item)) continue;
        const o = typeof item === 'string' ? acharOpcao(item) : undefined;
        if (!o) return { ok: false, erro: `${nome} aceita só: ${campo.opcoes.join(', ')}.` };
        if (!escolhidas.includes(o)) escolhidas.push(o);
      }
      return { ok: true, valor: escolhidas.length ? escolhidas : null };
    }
  }
}

/**
 * Valida um lote `{ chave: valor }` contra os campos da conta. Chave desconhecida ou valor
 * inválido → erro (nada é gravado). Resultado: o que gravar e o que apagar.
 */
export function prepararValores(campos: CampoPersonalizado[], novos: Record<string, unknown>):
  { ok: true; gravar: Record<string, ValorCampo>; apagar: string[] } | { ok: false; erro: string; chave?: string; code: 'unknown_custom_field' | 'invalid_value' } {
  const porChave = new Map(campos.map(c => [c.chave, c]));
  const gravar: Record<string, ValorCampo> = {};
  const apagar: string[] = [];
  for (const [chave, bruto] of Object.entries(novos || {})) {
    const campo = porChave.get(chave);
    if (!campo) return { ok: false, erro: `Campo personalizado desconhecido: ${chave}.`, chave, code: 'unknown_custom_field' };
    const r = normalizarValor(campo, bruto);
    if (!r.ok) return { ok: false, erro: r.erro, chave, code: 'invalid_value' };
    if (r.valor === null) apagar.push(chave); else gravar[chave] = r.valor;
  }
  return { ok: true, gravar, apagar };
}

/** Valor guardado → texto para pessoas e para a IA. */
export function formatarValor(campo: Pick<CampoPersonalizado, 'tipo'>, valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  switch (campo.tipo) {
    case 'moeda': return typeof valor === 'number' ? valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : String(valor);
    case 'numero': return typeof valor === 'number' ? valor.toLocaleString('pt-BR') : String(valor);
    case 'data': { const d = lerData(String(valor)); return d ? d.split('-').reverse().join('/') : String(valor); }
    case 'sim_nao': return valor === true ? 'Sim' : valor === false ? 'Não' : String(valor);
    case 'multipla': return Array.isArray(valor) ? valor.join(', ') : String(valor);
    default: return String(valor);
  }
}

// ── IA ───────────────────────────────────────────────────────────────────────

const DICA_TIPO: Record<TipoCampo, string> = {
  texto: 'texto', numero: 'número', moeda: 'valor em reais', data: 'data dd/mm/aaaa',
  selecao: 'uma opção', multipla: 'uma ou mais opções separadas por vírgula', sim_nao: 'sim ou não',
};

/**
 * Ferramenta "registrar_campo" + instrução do prompt, só com os campos ativos que a conta liberou
 * para a IA (`ia_preenche`). Sem nenhum → null (a IA nem fica sabendo que existem).
 */
export function montarCamposIA(campos: CampoPersonalizado[], valores: Record<string, unknown>):
  { ferramenta: MCPTool; instrucao: string; liberados: CampoPersonalizado[] } | null {
  const liberados = campos.filter(c => c.ativo !== false && c.ia_preenche);
  if (!liberados.length) return null;
  const linha = (c: CampoPersonalizado) => {
    const v = valores?.[c.chave];
    const atual = v === undefined || v === null ? 'ainda não informado' : `já registrado: ${formatarValor(c, v)}`;
    const opcoes = c.opcoes?.length && (c.tipo === 'selecao' || c.tipo === 'multipla') ? ` Opções: ${c.opcoes.join(', ')}.` : '';
    return `- ${c.nome} (${DICA_TIPO[c.tipo]}) — ${atual}.${c.descricao ? ` ${c.descricao}` : ''}${opcoes}`;
  };
  const instrucao =
    `\n\nFICHA DO CLIENTE — informações que a equipe quer registrar:\n${liberados.map(linha).join('\n')}\n` +
    `Quando o cliente disser uma dessas informações, chame registrar_campo. Só registre o que ele disse de forma clara; ` +
    `não invente, não deduza e não transforme a conversa num questionário. Não avise o cliente que registrou.`;
  return {
    liberados,
    instrucao,
    ferramenta: {
      name: 'registrar_campo',
      description: 'Registra na ficha do cliente uma informação que ele disse na conversa (um campo por chamada).',
      input_schema: {
        type: 'object',
        properties: {
          campo: { type: 'string', description: 'Nome exato do campo', enum: liberados.map(c => c.nome) },
          valor: { type: 'string', description: 'O valor dito pelo cliente' },
        },
        required: ['campo', 'valor'],
      },
    },
  };
}

/** Pedido da IA → campo e valor normalizado, ou o motivo da recusa (texto devolvido a ela). */
export function decidirRegistroIA(liberados: CampoPersonalizado[], nomeCampo: unknown, valor: unknown):
  { ok: true; campo: CampoPersonalizado; valor: ValorCampo } | { ok: false; erro: string } {
  const campo = liberados.find(c => c.nome.toLowerCase() === String(nomeCampo ?? '').trim().toLowerCase());
  if (!campo) return { ok: false, erro: 'campo não liberado para a IA.' };
  const r = normalizarValor(campo, valor);
  if (!r.ok) return { ok: false, erro: r.erro };
  if (r.valor === null) return { ok: false, erro: 'valor vazio; nada registrado.' };
  return { ok: true, campo, valor: r.valor };
}

// ── Banco ────────────────────────────────────────────────────────────────────

type Db = Pool | PoolClient;

/** Para o motor: ferramenta + instrução com a ficha atual do contato (null = conta sem campos para a IA). */
export async function prepararCamposIA(pool: Pool, userId: string, contatoId: string | null) {
  const ownerId = await resolverOwnerId(pool, userId);
  const campos = await listarCampos(pool, ownerId);
  if (!campos.some(c => c.ia_preenche)) return null;
  const valores = contatoId
    ? (await pool.query(`SELECT campos FROM contatos WHERE id = $1`, [contatoId])).rows[0]?.campos || {}
    : {};
  const montado = montarCamposIA(campos, valores);
  return montado ? { ...montado, ownerId } : null;
}

export async function listarCampos(db: Db, ownerId: string, opts: { todos?: boolean } = {}): Promise<CampoPersonalizado[]> {
  const r = await db.query(
    `SELECT id, nome, chave, tipo, COALESCE(opcoes, '{}') AS opcoes, descricao, ia_preenche, ativo, ordem
       FROM campos_personalizados
      WHERE user_id = $1 AND ($2::boolean OR ativo)
      ORDER BY ordem, created_at`, [ownerId, !!opts.todos]);
  return r.rows;
}

/**
 * Grava `{ chave: valor }` no contato (mescla com o que já existe). Só campos ATIVOS da conta.
 * `contatoUserId` = dono da linha em `contatos` (a conta ou o membro que a criou).
 */
export async function gravarValoresDoContato(db: Db, ownerId: string, contatoId: string, contatoUserIds: string[], novos: Record<string, unknown>) {
  const campos = await listarCampos(db, ownerId);
  const prep = prepararValores(campos, novos);
  if (!prep.ok) return prep;
  const r = await db.query(
    `UPDATE contatos
        SET campos = (COALESCE(campos, '{}'::jsonb) || $3::jsonb) - $4::text[], updated_at = NOW()
      WHERE id::text = $1 AND user_id = ANY($2::uuid[])
      RETURNING campos`,
    [contatoId, contatoUserIds, JSON.stringify(prep.gravar), prep.apagar]);
  if (!r.rowCount) return { ok: false as const, erro: 'Contato não encontrado.', code: 'not_found' as const };
  return { ok: true as const, campos: r.rows[0].campos || {} };
}
