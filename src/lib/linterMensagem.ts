// [AUDITORIA] LÓGICA (Sprint 8 = Sprint 4 / H6, 2026-10-06): linter da mensagem de disparo — nota de
// 0 a 100 e dicas, sem IA (zero custo). Usado na criação da campanha (Disparos → Mensagem) e no
// editor de templates. Formato único de variáveis e spintax é o do motor (`motorTexto.ts`):
// `{{primeiro_nome}}`, `{{empresa}}`, `{{cidade}}`… e `{opção 1|opção 2}`. Não havia template no
// banco com formato antigo (`{nome}`, `[nome]`, `%nome%`) em 2026-10-06 — nada a converter; o linter
// barra esses formatos na hora de salvar (`erros`).
//
// Pesos (somam 100): tamanho 15, emojis 10, listas 5, link 10, termos sensíveis 15, opção de saída
// 10, personalização 15, variação real 20. Cada item devolve a dica do que mudar.
import { VARIAVEIS_MENSAGEM_CONTATO } from "./modeloImportacao";
import { resolverSpintax, textoTemSpintax, substituirPlaceholders, aplicarVariacaoAutomatica } from "./motorTexto";

// Mesma lista dos botões "Inserir variável" (colunas da planilha + nome/telefone/data).
export const VARIAVEIS_CONHECIDAS: string[] = VARIAVEIS_MENSAGEM_CONTATO.map(v => v.replace(/[{}]/g, ""));

export interface ItemLinter { item: string; ok: boolean; pontos: number; max: number; dica: string | null }
export interface ResultadoLinter {
  nota: number;
  itens: ItemLinter[];
  erros: string[];          // impedem salvar (formato de variável/spintax quebrado)
  avisos: string[];         // não impedem
  previas: string[];        // 5 variações renderizadas com um contato de exemplo
  similaridadeMedia: number | null; // 0..1 entre as prévias
}

const TERMOS_SENSIVEIS = [
  "grátis", "gratis", "100% garantido", "garantido", "ganhe dinheiro", "renda extra", "clique aqui", "imperdível",
  "últimas vagas", "empréstimo", "emprestimo", "crédito aprovado", "aposta", "bet", "cassino", "pix agora",
  "urgente", "promoção relâmpago", "você foi selecionado", "parabéns, você ganhou",
];
const REGEX_EMOJI = /\p{Extended_Pictographic}/gu;
const REGEX_LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|com\.br|net|io|link|ly|me)\b)/i;
const REGEX_SAIDA = /\b(sair|parar|pare|n[aã]o quero|descadastr|remover)\b/i;

const CONTATO_EXEMPLO = {
  nome: "Mariana Costa", primeiro_nome: "Mariana", nome_confiavel: true, telefone: "5511987654321",
  empresa: "Costa Arquitetura", cidade: "Campinas", estado: "SP", interesse: "reforma",
};

/** Similaridade de Jaccard entre conjuntos de palavras (0 = nada em comum, 1 = iguais). */
function similaridade(a: string, b: string): number {
  const pa = new Set(a.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  const pb = new Set(b.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  if (!pa.size && !pb.size) return 1;
  let inter = 0;
  for (const p of pa) if (pb.has(p)) inter++;
  return inter / (pa.size + pb.size - inter);
}

/** Blocos de spintax com 2+ opções de verdade (opções diferentes entre si). */
function blocosComVariacao(texto: string): number {
  let n = 0;
  for (const m of texto.matchAll(/\{([^{}]*\|[^{}]*)\}/g)) {
    const opcoes = new Set(m[1].split("|").map(o => o.trim().toLowerCase()).filter(Boolean));
    if (opcoes.size >= 2) n++;
  }
  return n;
}

export function validarFormato(texto: string): string[] {
  const erros: string[] = [];
  for (const m of texto.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)) {
    if (!VARIAVEIS_CONHECIDAS.includes(m[1])) {
      erros.push(`Variável desconhecida {{${m[1]}}}. Use: ${VARIAVEIS_CONHECIDAS.map(v => `{{${v}}}`).join(", ")}.`);
    }
  }
  // Formatos antigos/errados: {nome} (chave simples sem |), [nome], %nome%.
  const semDupla = texto.replace(/\{\{[^{}]*\}\}/g, "");
  for (const m of semDupla.matchAll(/\{([a-z_]+)\}/gi)) erros.push(`"{${m[1]}}" não é variável — use {{${m[1]}}} (chaves duplas).`);
  for (const m of texto.matchAll(/\[(nome|primeiro_nome|empresa|cidade|estado)\]|%(nome|primeiro_nome|empresa|cidade|estado)%/gi)) {
    erros.push(`"${m[0]}" não é variável — use {{${(m[1] || m[2]).toLowerCase()}}}.`);
  }
  const abre = (semDupla.match(/\{/g) || []).length, fecha = (semDupla.match(/\}/g) || []).length;
  if (abre !== fecha) erros.push("Chaves { } desbalanceadas no spintax — confira se cada { tem o seu }.");
  return [...new Set(erros)];
}

/**
 * @param texto mensagem (com variáveis/spintax)
 * @param opts.variantes outras mensagens-base da campanha (mensagens_variantes), se houver
 * @param opts.primeiraMensagem true quando é a abertura de conversa com contato frio (padrão true)
 * @param opts.canalBaileys true quando a campanha sai por número conectado por QR Code
 */
export function analisarMensagem(
  texto: string,
  opts: { variantes?: string[]; primeiraMensagem?: boolean; canalBaileys?: boolean; variacaoAutomatica?: boolean } = {},
): ResultadoLinter {
  const t = String(texto || "");
  const primeira = opts.primeiraMensagem !== false;
  const itens: ItemLinter[] = [];
  const add = (item: string, max: number, pontos: number, dica: string | null) =>
    itens.push({ item, max, pontos: Math.max(0, Math.min(max, Math.round(pontos))), ok: pontos >= max, dica: pontos >= max ? null : dica });

  // Tamanho medido no texto renderizado (spintax resolvido).
  const renderizado = resolverSpintax(substituirPlaceholders(t, CONTATO_EXEMPLO));
  const tam = renderizado.length;
  add("Tamanho", 15, tam <= 350 ? 15 : tam <= 600 ? 8 : 0,
    `Mensagem com ${tam} caracteres. Na primeira mensagem, até 350 caracteres funciona melhor — deixe detalhes para a resposta.`);

  const emojis = (renderizado.match(REGEX_EMOJI) || []).length;
  add("Emojis", 10, emojis <= 3 ? 10 : emojis <= 6 ? 5 : 0, `${emojis} emojis — use no máximo 3 para não parecer propaganda.`);

  const linhasLista = renderizado.split("\n").filter(l => /^\s*([-•*✅▪️➡️]|\d+[.)])\s+/u.test(l)).length;
  add("Listas", 5, linhasLista < 3 ? 5 : 0, `${linhasLista} itens em lista — listas na abertura parecem panfleto. Converse primeiro.`);

  const temLink = REGEX_LINK.test(t);
  add("Link", 10, primeira && temLink ? 0 : 10, "Link na primeira mensagem aumenta denúncia e bloqueio. Mande o link depois que a pessoa responder.");

  const achados = TERMOS_SENSIVEIS.filter(s => new RegExp(`(?<![\\p{L}])${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}])`, "iu").test(t));
  add("Termos sensíveis", 15, achados.length === 0 ? 15 : achados.length === 1 ? 7 : 0,
    `Termos que costumam gerar denúncia: ${achados.join(", ")}. Troque por uma frase mais natural.`);

  add("Opção de saída", 10, REGEX_SAIDA.test(t) ? 10 : 0, 'Inclua uma saída, ex.: "Se não quiser receber, responda SAIR."');

  const temPersonalizacao = /\{\{\s*(nome|primeiro_nome|empresa|cidade|estado|interesse)\s*\}\}/.test(t);
  add("Personalização", 15, temPersonalizacao ? 15 : 0, "Use {{primeiro_nome}} ou {{empresa}} — mensagem idêntica para todos é sinal de spam.");

  // Variação real: 2+ blocos de spintax com opções diferentes, ou 2+ variantes; e similaridade
  // média entre 5 prévias < 80%.
  const variantes = [t, ...(opts.variantes || []).filter(v => v && v.trim())];
  const previas: string[] = [];
  for (let i = 0; i < 5; i++) {
    const base = variantes[i % variantes.length];
    let r = resolverSpintax(substituirPlaceholders(base, CONTATO_EXEMPLO));
    if (!textoTemSpintax(base) && opts.variacaoAutomatica !== false) r = aplicarVariacaoAutomatica(r);
    previas.push(r);
  }
  let soma = 0, pares = 0;
  for (let i = 0; i < previas.length; i++) for (let j = i + 1; j < previas.length; j++) { soma += similaridade(previas[i], previas[j]); pares++; }
  const simMedia = pares ? soma / pares : null;
  const blocos = blocosComVariacao(t);
  const fontesDeVariacao = blocos + (variantes.length - 1);
  let pVar = 0;
  if (fontesDeVariacao >= 2) pVar += 10; else if (fontesDeVariacao === 1) pVar += 5;
  if (simMedia !== null && simMedia < 0.8) pVar += 10; else if (simMedia !== null && simMedia < 0.9) pVar += 5;
  add("Variação real do texto", 20, pVar,
    `${blocos} bloco(s) de variação {a|b}${variantes.length > 1 ? ` e ${variantes.length} variantes` : ""}; prévias ${simMedia === null ? "" : `${Math.round(simMedia * 100)}%`} parecidas entre si. ` +
    "Varie pelo menos 2 trechos do corpo (saudação e chamada) para ficar abaixo de 80% de semelhança.");

  const avisos: string[] = [];
  if (opts.canalBaileys !== false && /api\s*oficial/i.test(t)) {
    avisos.push('O texto diz "API Oficial", mas esta campanha sai por número conectado por QR Code. Não prometa o que o canal não é.');
  }
  const erros = validarFormato(t);
  const nota = itens.reduce((s, i) => s + i.pontos, 0);
  return { nota, itens, erros, avisos, previas, similaridadeMedia: simMedia };
}
