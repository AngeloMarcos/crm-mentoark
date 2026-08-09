/**
 * maturadorDialogos.ts — banco de diálogo pré-escrito do Maturador de Números (Sprint Score Real
 * + Maturador, 2026-08-09, item 2). Trocas curtas e naturais em PT-BR, tipo bate-papo real entre
 * duas pessoas, usadas pelo motor (`maturadorProcessor.ts`) pra simular tráfego orgânico entre
 * duas instâncias da MESMA conta. Zero IA/token externo — cada linha é texto fixo, variado na
 * hora do envio (sinônimo + spintax, ver `aplicarVariacao` abaixo).
 *
 * [AUDITORIA] LÓGICA: `aplicarVariacao`/`resolverSpintax` são uma cópia REDUZIDA e adaptada das
 * funções equivalentes em `src/lib/motorTexto.ts` (frontend) — não dá pra importar direto: são
 * dois projetos TypeScript separados (`src/` compilado pelo Vite, `backend/src/` compilado pelo
 * swc, sem workspace/pacote compartilhado configurado neste repo). Duplicar as ~30 linhas
 * necessárias aqui foi a escolha pragmática (mesma decisão já documentada nesta sessão em outras
 * duplicações pontuais do projeto) — se um dia isso crescer a ponto de valer a pena, a extração
 * pra um pacote compartilhado é candidata a sprint própria, não algo pra fazer de passagem aqui.
 *
 * `DIALOGO`: array de trocas curtas — cada item é UMA mensagem (não um par pergunta/resposta
 * rígido), na ORDEM em que soam naturais em sequência. O motor avança por este array por par de
 * instâncias (`maturador_pares.linha_atual`), alternando remetente a cada linha, e cicla de volta
 * ao início ao chegar no fim — parece uma conversa contínua real ao longo dos dias, não mensagens
 * soltas repetidas sempre na mesma ordem.
 */

interface EntradaVariacao {
  chave: string;
  opcoes: string[];
}

const DICIONARIO_VARIACAO: EntradaVariacao[] = [
  { chave: "oi", opcoes: ["oi", "olá", "e aí"] },
  { chave: "olá", opcoes: ["olá", "oi", "e aí"] },
  { chave: "tudo bem", opcoes: ["tudo bem", "tudo certo", "tudo tranquilo", "tudo joia"] },
  { chave: "tudo certo", opcoes: ["tudo certo", "tudo bem", "tudo joia"] },
  { chave: "beleza", opcoes: ["beleza", "show", "de boa"] },
  { chave: "você", opcoes: ["você", "vc"] },
  { chave: "vc", opcoes: ["vc", "você"] },
  { chave: "hoje", opcoes: ["hoje", "hoje em dia"] },
  { chave: "bastante", opcoes: ["bastante", "bastante coisa", "um monte de coisa"] },
  { chave: "com certeza", opcoes: ["com certeza", "certeza", "sem dúvida"] },
  { chave: "legal", opcoes: ["legal", "bacana", "massa"] },
  { chave: "obrigado", opcoes: ["obrigado", "valeu"] },
  { chave: "obrigada", opcoes: ["obrigada", "valeu"] },
  { chave: "até mais", opcoes: ["até mais", "até logo", "falou"] },
  { chave: "combinado", opcoes: ["combinado", "fechado", "certo então"] },
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
const CHAVES_ORDENADAS = [...DICIONARIO_VARIACAO].sort((a, b) => b.chave.length - a.chave.length);
const MAPA_CHAVE = new Map(CHAVES_ORDENADAS.map(e => [e.chave.toLowerCase(), e]));
const REGEX_FONTE = `(?<![\\p{L}\\p{N}])(${CHAVES_ORDENADAS.map(e => escapeRegExp(e.chave)).join("|")})(?![\\p{L}\\p{N}])`;

function capitalizarComo(original: string, novo: string): string {
  if (!original || !novo) return novo;
  const p = original[0];
  if (p !== p.toLowerCase() && p === p.toUpperCase()) return novo.charAt(0).toUpperCase() + novo.slice(1);
  return novo;
}

/** Resolve spintax manual `{a|b|c}` — mesma sintaxe/regra de `motorTexto.ts` (chave simples + `|`). */
function resolverSpintax(texto: string): string {
  return texto.replace(/\{([^{}]+)\}/g, (match, conteudo: string) => {
    if (!conteudo.includes("|")) return match;
    const opcoes = conteudo.split("|").map(o => o.trim());
    return opcoes[Math.floor(Math.random() * opcoes.length)];
  });
}

/** Troca palavras/expressões do dicionário por sinônimos equivalentes — mesmo mecanismo (regex
 *  combinada, ordenada por tamanho) de `aplicarVariacaoAutomatica` em `motorTexto.ts`. */
function aplicarVariacaoDicionario(texto: string): string {
  return texto.replace(new RegExp(REGEX_FONTE, "giu"), (m) => {
    const e = MAPA_CHAVE.get(m.toLowerCase());
    if (!e) return m;
    return capitalizarComo(m, e.opcoes[Math.floor(Math.random() * e.opcoes.length)]);
  });
}

/** Ponto de entrada único usado pelo motor — resolve spintax da linha e varia por sinônimo. */
export function aplicarVariacao(linha: string): string {
  return aplicarVariacaoDicionario(resolverSpintax(linha));
}

// [AUDITORIA] LÓGICA: 20 linhas, tom casual/neutro de propósito (não menciona nome de empresa,
// produto ou qualquer coisa específica do negócio do usuário — é só "parecer duas pessoas
// conversando"), com pelo menos 1 bloco de spintax manual em boa parte das linhas pra somar mais
// variação em cima do dicionário de sinônimos. Nunca usa `{{placeholder}}` (não faz sentido aqui,
// não há "contato" — são as duas próprias instâncias conversando).
export const DIALOGO: string[] = [
  "Oi! {Tudo bem|Tudo certo|Tudo joia}?",
  "Tudo certo sim, {e você|e aí, tudo bem}?",
  "Tudo bem também! {Que bom|Ótimo}, {rolou|aconteceu} alguma coisa {hoje|nova}?",
  "Nada de mais não, {dia corrido|dia tranquilo} por aqui. E aí, {como tá|como anda} as coisas?",
  "Também {corrido|tranquilo} por aqui, mas {tá tudo certo|tá tudo bem}.",
  "{Que bom|Boa}! Vi que {você|vc} {tava|estava} meio sumido esses dias.",
  "{Verdade|Pois é}, andei {ocupado|meio enrolado} com umas coisas, mas {já voltei|tô de volta}.",
  "{Entendo|Saquei}. Qualquer coisa {me chama|me avisa} viu.",
  "{Combinado|Pode deixar}! {Obrigado|Valeu} por lembrar de mim.",
  "{Imagina|De nada}, {sempre por aqui|tamo junto}.",
  "{E aí|Oi}, {conseguiu resolver aquilo|deu tudo certo com aquele assunto}?",
  "{Consegui sim|Deu certo sim}, {obrigado por perguntar|valeu por lembrar}.",
  "{Que ótimo|Fico feliz em saber}! {Sabia que ia dar certo|Tinha fé que ia resolver}.",
  "{Haha|Rs}, {também achei que ia dar|também tava na torcida}.",
  "{Bom|Então}, vou {indo|nessa} por agora, {falo com você|te chamo} {depois|mais tarde}.",
  "{Beleza|Fechado}, {até mais|até logo}!",
  "{Oi de novo|E aí de novo}! {Lembrei de você agora|Passando aqui rapidinho}.",
  "{Oi|Opa}! {Que bom|Legal} {te ver|receber mensagem sua} de novo.",
  "{É|Pois é}, {sempre bom|sempre gostoso} dar um oi de vez em quando, né?",
  "{Com certeza|Concordo}! {Um abraço|Fica bem}, {até mais|falo contigo em breve}.",
];

/** Só pra referência/relatório — tamanho real do banco de diálogo. */
export const TAMANHO_DIALOGO = DIALOGO.length;
