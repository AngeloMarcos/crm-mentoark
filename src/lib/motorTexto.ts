// [AUDITORIA] LÓGICA (Sprint Motor Nativo v2, 2026-08-08): motor nativo de texto do CRM — ponto
// único de referência pra qualquer feature que precise variar/personalizar mensagem de WhatsApp
// sem custo de IA (zero chamada de rede, zero token). Extraído de `src/pages/Disparos.tsx`, onde
// vivia inline desde a Sprint "Variação sem IA" (2026-08-06) e a Sprint "Motor Nativo de Disparo"
// (2026-08-07) — até aqui, `RespostasRapidas.tsx`/`WhatsAppInterface.tsx` não tinham acesso a nada
// disso. `Disparos.tsx` importa tudo daqui, sem duplicar lógica.
//
// Próxima feature que precisar variar/personalizar texto sem IA importa DESTE arquivo — não
// reimplementa. Módulos que já usam: Disparos (campanhas em massa), Respostas Rápidas (composer
// do chat). Candidatos óbvios pra reuso futuro: mensagens de tarefas/notificações automáticas,
// qualquer outro composer que precise variar texto repetitivo.
//
// Camadas, da mais "estrutural" pra mais "fina" (nesta ordem de composição, sempre):
//   1. `escolherVariante`         — mensagem-base COMPLETA por contato (2+ variantes configuradas)
//   2. `substituirPlaceholders`   — {{nome}}/{{primeiro_nome}}/{{telefone}}/{{data}}/{{empresa}}
//   3. `resolverSpintax`          — spintax MANUAL, sintaxe `{opção 1|opção 2}` escrita pelo operador
//   4. `aplicarVariacaoAutomatica`— sinônimos/expressões equivalentes, automática, dicionário fixo
//
// A camada 4 é a única que roda "sozinha" (sem o operador precisar escrever nada) — ver seção
// "Variação automática" abaixo pra regra de quando ela liga/desliga.

// ─────────────────────────────────────────────────────────────────────────────
// Placeholders — {{nome}}, {{primeiro_nome}}, {{telefone}}, {{data}}, {{empresa}}
// ─────────────────────────────────────────────────────────────────────────────

// [AUDITORIA] LÓGICA (Sprint Fix Nome/Telefone na Saudação, 2026-08-05): remove um placeholder
// vazio (sem valor real pra usar) sem deixar pontuação solta ao redor — "Oi {{primeiro_nome}},
// tudo bem?" vira "Oi, tudo bem?" (vírgula preservada, colada na saudação), não "Oi , tudo
// bem?" (vírgula solta) nem "Oi tudo bem?" (perde a pausa da vírgula). Ordem das regras importa:
// mais específica primeiro (espaço+vírgula) até a mais genérica (placeholder bare, sem espaço/
// vírgula ao redor) — cada `replaceAll` só bate no que sobrou depois da regra anterior.
function removerPlaceholderVazio(texto: string, placeholder: string): string {
  return texto
    .replaceAll(` ${placeholder},`, ",")  // "Oi {{p}}, tudo bem?" -> "Oi, tudo bem?"
    .replaceAll(`${placeholder}, `, "")   // "{{p}}, tudo bem?" (placeholder no início) -> "tudo bem?"
    .replaceAll(` ${placeholder}`, "")    // "Oi {{p}}!" / "seu pedido {{p}} chegou" -> "Oi!" / "seu pedido chegou"
    .replaceAll(`${placeholder} `, "")    // "{{p}} chegou" (placeholder no início, sem vírgula) -> "chegou"
    .replaceAll(placeholder, "");         // sobra bare, sem espaço/vírgula ao redor
}

/**
 * Substitui os 5 placeholders `{{nome}}`/`{{primeiro_nome}}`/`{{telefone}}`/`{{data}}`/`{{empresa}}`
 * pelo dado real do contato. Usada tanto na prévia (Disparos → StepMessage) quanto no envio real
 * (StepReview.handleStart) — a mesma função garante que a prévia nunca promete uma substituição
 * que o envio real não cumpre.
 *
 * [AUDITORIA] FIX APLICADO (achado real — campanha "Importação cnpj_biz" já enviada em produção,
 * 2026-08-05): contato importado sem coluna de nome de pessoa (só CNPJ/razão social) pode ter
 * `nome` igual ao próprio `telefone` (fallback de importação em `Disparos.tsx`) — sem proteção
 * aqui, `{{primeiro_nome}}`/`{{nome}}` substituiriam pelo telefone cru: "Oi 5511984849872, tudo
 * tranquilo?". `nome === telefone` é tratado como "sem nome real": NÃO cai no fallback "cliente"
 * (esse continua só pra quando `nome` está genuinamente vazio) nem usa o telefone como saudação —
 * o placeholder é removido com limpeza de pontuação (`removerPlaceholderVazio`) em vez de virar
 * texto vazio no meio da frase.
 */
export function substituirPlaceholders(mensagem: string, contato: {
  nome?: string; telefone?: string; empresa?: string; email?: string; cargo?: string;
  cidade?: string; estado?: string; interesse?: string; data_nascimento?: string;
}): string {
  const semNomeReal = !!contato.telefone && contato.nome === contato.telefone;
  const nome = semNomeReal ? "" : (contato.nome || "cliente");
  const primeiroNome = semNomeReal ? "" : nome.split(" ")[0];
  const dataHoje = new Date().toLocaleDateString("pt-BR");

  let resultado = mensagem;
  if (semNomeReal) {
    resultado = removerPlaceholderVazio(resultado, "{{nome}}");
    resultado = removerPlaceholderVazio(resultado, "{{primeiro_nome}}");
  } else {
    resultado = resultado.replaceAll("{{nome}}", nome).replaceAll("{{primeiro_nome}}", primeiroNome);
  }
  // [AUDITORIA] LÓGICA (Sprint Padronizar Planilhas — Variáveis, 2026-09-11 — pedido do usuário:
  // "todas as colunas da planilha tem que ser uma variável do sistema"): uma entrada aqui por
  // COLUNA de `CAMPOS_CONTATO` (src/lib/modeloImportacao.ts) que não seja nome/telefone (tratados
  // à parte acima/abaixo, com regra própria de "sem nome real") — mesmo nome de coluna/variável de
  // propósito. `empresa` estava fora deste loop antes desta revisão (replace direto, sem limpeza)
  // — trazida pra cá também, mesmo tratamento que os campos novos: campo vazio some com limpeza de
  // pontuação ao redor (`removerPlaceholderVazio`) em vez de deixar `{{empresa}}` literal ou um
  // buraco no meio da frase — a maioria dos contatos importados não vai ter todo campo opcional
  // preenchido, e a mensagem não pode ficar visivelmente quebrada por isso.
  for (const [placeholder, valor] of [
    ["{{email}}", contato.email],
    ["{{cidade}}", contato.cidade],
    ["{{estado}}", contato.estado],
    ["{{interesse}}", contato.interesse],
    ["{{data_nascimento}}", contato.data_nascimento],
    ["{{empresa}}", contato.empresa],
    ["{{cargo}}", contato.cargo],
  ] as const) {
    resultado = valor ? resultado.replaceAll(placeholder, valor) : removerPlaceholderVazio(resultado, placeholder);
  }
  return resultado
    .replaceAll("{{telefone}}", contato.telefone || "")
    .replaceAll("{{data}}", dataHoje);
}

// ─────────────────────────────────────────────────────────────────────────────
// Spintax manual — sintaxe {opção 1|opção 2|opção 3}
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve blocos de spintax MANUAL — sintaxe `{opção 1|opção 2|opção 3}` (chave SIMPLES + pelo
 * menos um `|` dentro). Nunca confundir com `{{placeholder}}` (chave DUPLA, nunca tem `|`): a
 * regex casa qualquer bloco `{...sem chaves aninhadas...}`, inclusive — por construção de regex,
 * não checagem explícita de posição — o miolo de um `{{placeholder}}` (ex: `{primeiro_nome}`
 * dentro de `{{primeiro_nome}}`). Isso é inofensivo de propósito: como esse miolo nunca tem `|`,
 * a regra "sem pipe = texto literal, devolve o próprio trecho casado sem mudar nada" reconstrói o
 * placeholder duplo exatamente como era. Escolha independente por chamada (`Math.random()`) —
 * chamar uma vez por contato pra cada destinatário sortear sua própria combinação.
 */
export function resolverSpintax(texto: string): string {
  return texto.replace(/\{([^{}]+)\}/g, (match, conteudo: string) => {
    if (!conteudo.includes("|")) return match; // sem pipe — não é spintax, mantém literal (cobre {{placeholder}} e chave simples usada por outro motivo)
    const opcoes = conteudo.split("|").map(o => o.trim());
    return opcoes[Math.floor(Math.random() * opcoes.length)];
  });
}

/** `true` se `texto` tem pelo menos um bloco de spintax MANUAL de verdade (bloco `{...}` com `|` dentro). */
export function textoTemSpintax(texto: string): boolean {
  return /\{([^{}]*\|[^{}]*)\}/.test(texto);
}

// ─────────────────────────────────────────────────────────────────────────────
// Variação automática — dicionário fixo de sinônimos/expressões equivalentes (item 2, Sprint v2)
// ─────────────────────────────────────────────────────────────────────────────
//
// Camada determinística, zero IA, zero chamada de rede — aplicada AUTOMATICAMENTE em cima de
// qualquer texto que não tenha spintax MANUAL (`textoTemSpintax` = false). Resolve o gap real
// encontrado no print do usuário: a maioria dos templates salvos em produção (`SDR CRM 2`,
// `SDR CRM`, `CRM`, `Mentoark Prospeção`, `Teste 1`) não tem `{{nome}}` nem `{a|b}` — saem 100%
// idênticos pra todo mundo, e variar só o nome não resolve porque muitos leads vindos de grupo de
// WhatsApp não têm nome real cadastrado. Essa camada varia PALAVRAS/EXPRESSÕES equivalentes já
// mapeadas no dicionário abaixo — nunca reescreve livremente, nunca muda o sentido da mensagem
// (essa é a diferença de fundo pra "Humanizar com IA": determinístico e limitado, não criativo).

interface EntradaVariacao {
  /** Palavra/expressão original, em minúsculas, como aparece no texto (chave de busca). */
  chave: string;
  /** Alternativas equivalentes (minúsculas) — inclui a própria chave, pra às vezes não trocar nada. */
  opcoes: string[];
}

// [AUDITORIA] LÓGICA: dicionário curado em PT-BR, cobrindo o vocabulário comum de mensagem
// comercial de WhatsApp — 5 categorias (contagem exata reportada no relatório da sprint, ver
// `diagnosticos/AUDITORIA_LOG.md`). Cada entrada é uma equivalência genuína (troca só de
// palavras/expressões já mapeadas, nunca reescrita livre) — a ordem das entradas não importa pra
// correção (ver `REGEX_VARIACAO_COMBINADA` abaixo, que ordena por tamanho de chave antes de montar
// a regex), só pra legibilidade/organização por categoria.
const DICIONARIO_VARIACAO: EntradaVariacao[] = [
  // Saudações
  { chave: "olá", opcoes: ["olá", "oi", "e aí"] },
  { chave: "oi", opcoes: ["oi", "olá", "e aí"] },
  { chave: "tudo bem", opcoes: ["tudo bem", "tudo certo", "tudo tranquilo", "tudo joia"] },
  { chave: "como vai", opcoes: ["como vai", "como está", "como você está"] },
  { chave: "bom dia", opcoes: ["bom dia", "muito bom dia"] },
  { chave: "boa tarde", opcoes: ["boa tarde", "muito boa tarde"] },
  { chave: "boa noite", opcoes: ["boa noite", "muito boa noite"] },

  // Confirmações / concordância
  { chave: "certo", opcoes: ["certo", "combinado", "fechado"] },
  { chave: "combinado", opcoes: ["combinado", "fechado", "certo"] },
  { chave: "perfeito", opcoes: ["perfeito", "show", "ótimo"] },
  { chave: "ótimo", opcoes: ["ótimo", "excelente", "show"] },
  { chave: "excelente", opcoes: ["excelente", "ótimo", "perfeito"] },
  { chave: "interessante", opcoes: ["interessante", "bacana", "legal"] },
  { chave: "sem compromisso", opcoes: ["sem compromisso", "sem nenhum compromisso"] },

  // Conectivos / pessoa
  { chave: "você", opcoes: ["você", "vc"] },
  { chave: "vc", opcoes: ["vc", "você"] },
  { chave: "por favor", opcoes: ["por favor", "por gentileza"] },
  { chave: "aproveitando", opcoes: ["aproveitando", "já que estou aqui", "de passagem"] },
  { chave: "rapidinho", opcoes: ["rapidinho", "rapidamente", "num instante"] },
  { chave: "gostaria", opcoes: ["gostaria", "queria"] },
  { chave: "vamos conversar", opcoes: ["vamos conversar", "bora bater um papo", "podemos conversar"] },
  { chave: "entre em contato", opcoes: ["entre em contato", "fale com a gente", "nos chame"] },
  { chave: "confira", opcoes: ["confira", "dá uma olhada", "veja"] },
  { chave: "clique aqui", opcoes: ["clique aqui", "toque aqui", "acesse aqui"] },

  // Fechamento / CTA
  { chave: "me avisa", opcoes: ["me avisa", "me chama", "me fala"] },
  { chave: "me chama", opcoes: ["me chama", "me avisa", "me procura"] },
  { chave: "qualquer dúvida", opcoes: ["qualquer dúvida", "qualquer coisa", "se tiver dúvida"] },
  { chave: "fico à disposição", opcoes: ["fico à disposição", "estou à disposição", "tô por aqui"] },
  { chave: "aguardo retorno", opcoes: ["aguardo retorno", "fico no aguardo", "aguardo seu retorno"] },
  { chave: "fico no aguardo", opcoes: ["fico no aguardo", "aguardo retorno", "fico à espera"] },

  // Agradecimento / despedida
  { chave: "obrigado", opcoes: ["obrigado", "valeu", "muito obrigado"] },
  { chave: "obrigada", opcoes: ["obrigada", "valeu", "muito obrigada"] },
  { chave: "abraço", opcoes: ["abraço", "um abraço", "abs"] },
  { chave: "grande abraço", opcoes: ["grande abraço", "um forte abraço", "abraço"] },
  { chave: "até mais", opcoes: ["até mais", "até logo", "nos falamos"] },
  { chave: "até logo", opcoes: ["até logo", "até mais", "falamos em breve"] },
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// [AUDITORIA] LÓGICA: uma ÚNICA regex combinada (alternação de todas as chaves, ordenadas da mais
// longa pra mais curta — garante que "tudo bem" seja tentado antes de qualquer chave mais curta
// que por acaso fosse substring dela) em vez de percorrer o dicionário entrada por entrada. Isso
// evita substituição em cascata (ex: "olá" virar "oi" pela 1ª entrada e depois ser pego de novo
// pela entrada "oi" mais adiante) — cada trecho do texto original é examinado exatamente uma vez.
// `\p{L}`/`\p{N}` (flag `u`) em vez de `\b`/`\w` porque `\w` não reconhece letra acentuada como
// caractere de palavra — sem isso, o "boundary" ficaria errado ao redor de "á"/"é"/etc.
const CHAVES_ORDENADAS = [...DICIONARIO_VARIACAO].sort((a, b) => b.chave.length - a.chave.length);
const MAPA_CHAVE_PARA_ENTRADA = new Map(CHAVES_ORDENADAS.map(e => [e.chave.toLowerCase(), e]));
const REGEX_VARIACAO_FONTE = `(?<![\\p{L}\\p{N}])(${CHAVES_ORDENADAS.map(e => escapeRegExp(e.chave)).join("|")})(?![\\p{L}\\p{N}])`;

function capitalizarComo(original: string, novo: string): string {
  if (!original || !novo) return novo;
  const primeira = original[0];
  if (primeira !== primeira.toLowerCase() && primeira === primeira.toUpperCase()) {
    return novo.charAt(0).toUpperCase() + novo.slice(1);
  }
  return novo;
}

/**
 * `true` se `texto` contém pelo menos um termo do dicionário de variação automática — usado por
 * `mensagemSemPersonalizacao` pra saber se a camada automática vai de fato mudar algo neste texto
 * específico (mensagem sem NENHUM termo reconhecido continua saindo idêntica, mesmo com a camada
 * ligada — nesse caso o aviso de "sem personalização" continua fazendo sentido).
 */
export function temTermoVariavel(texto: string): boolean {
  if (!texto) return false;
  return new RegExp(REGEX_VARIACAO_FONTE, "iu").test(texto);
}

/**
 * Aplica a camada de variação automática (item 2, Sprint v2) — troca cada termo reconhecido do
 * dicionário por uma alternativa equivalente sorteada, preservando capitalização da primeira
 * letra do termo original. Chamada uma vez por contato (mesmo padrão de `resolverSpintax`), então
 * cada destinatário sorteia sua própria combinação, mesmo pra mensagem-base idêntica.
 *
 * NÃO chamar em texto que já tem spintax manual (`textoTemSpintax` = true) — quem escreveu
 * `{a|b}` à mão já está controlando a variação daquele trecho; o chamador (`Disparos.tsx`,
 * `aplicarRespostaRapida`) decide isso ANTES de chamar, não esta função.
 */
export function aplicarVariacaoAutomatica(texto: string): string {
  if (!texto) return texto;
  return texto.replace(new RegExp(REGEX_VARIACAO_FONTE, "giu"), (match) => {
    const entrada = MAPA_CHAVE_PARA_ENTRADA.get(match.toLowerCase());
    if (!entrada) return match;
    const escolhida = entrada.opcoes[Math.floor(Math.random() * entrada.opcoes.length)];
    return capitalizarComo(match, escolhida);
  });
}

/** Tamanho do dicionário de variação automática — usado só pra referência/relatório. */
export const TAMANHO_DICIONARIO_VARIACAO = DICIONARIO_VARIACAO.length;

// ─────────────────────────────────────────────────────────────────────────────
// Aviso de "mensagem sem personalização"
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `true` se a mensagem sai byte-idêntica pra todo mundo — sem placeholder, sem spintax manual, e
 * (a partir da Sprint v2) sem nenhum termo que a variação automática reconheça. O sinal de risco
 * de spam mais citado na pesquisa da sessão original (política WhatsApp Business Platform 2026 +
 * guias de anti-ban pra API não-oficial), mais forte que "ausência de IA".
 *
 * [AUDITORIA] LÓGICA (Sprint Motor Nativo v2, 2026-08-08, item 3): antes desta sprint, uma
 * mensagem sem `{{nome}}`/spintax manual sempre disparava este aviso — mesmo que a variação
 * automática (item 2, ligada por padrão) já fosse variar o texto de verdade por trás dos panos.
 * Agora, com `variacaoAutomaticaAtiva=true` (default), o aviso só dispara se NENHUMA das 3 camadas
 * (placeholder / spintax manual / variação automática) vai produzir variação real — cobre o caso
 * de contato de grupo sem nome real: a variação automática continua rodando por outra via, então
 * o aviso deixa de aparecer à toa pra esse caso. Se o operador desligar a variação automática
 * manualmente (`variacaoAutomaticaAtiva=false`) e a mensagem não tiver placeholder/spintax, o
 * aviso volta a aparecer — comportamento correto, a mensagem realmente vai sair idêntica.
 */
export function mensagemSemPersonalizacao(texto: string, variacaoAutomaticaAtiva: boolean = true): boolean {
  if (!texto) return false; // mensagem vazia não é "sem personalização", é só vazia — quem chama já valida isso separado
  const temPlaceholder = /\{\{\s*(nome|primeiro_nome|telefone|data|empresa)\s*\}\}/.test(texto);
  if (temPlaceholder || textoTemSpintax(texto)) return false;
  if (variacaoAutomaticaAtiva && temTermoVariavel(texto)) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Composição — aplica as 4 camadas na ordem certa, de uma vez
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Aplica placeholders + spintax manual + variação automática numa única chamada, na ordem certa
 * (placeholders → spintax manual → variação automática) — a variação automática só roda quando o
 * texto ORIGINAL (antes de qualquer substituição) não tinha spintax manual, pra nunca "pisar" em
 * cima do que o operador já configurou à mão. Ponto de entrada único recomendado pra quem só quer
 * o resultado final por contato (Disparos.handleStart, aplicarRespostaRapida) — quem precisa de
 * controle fino sobre as camadas (ex: prévia que quer mostrar avisos por camada) continua podendo
 * chamar `substituirPlaceholders`/`resolverSpintax`/`aplicarVariacaoAutomatica` direto.
 */
export function personalizarMensagem(
  mensagem: string,
  contato: { nome?: string; telefone?: string; empresa?: string },
  variacaoAutomaticaAtiva: boolean = true,
): string {
  const temSpintaxManual = textoTemSpintax(mensagem);
  let resultado = resolverSpintax(substituirPlaceholders(mensagem, contato));
  if (!temSpintaxManual && variacaoAutomaticaAtiva) {
    resultado = aplicarVariacaoAutomatica(resultado);
  }
  return resultado;
}

// ─────────────────────────────────────────────────────────────────────────────
// Biblioteca curada de blocos de variação prontos (item 1, Sprint Motor Nativo de Disparo, 2026-08-07)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Blocos de spintax MANUAL prontos por intenção comum — zero IA, dicionário fixo em PT-BR. Resolve
 * o achado de que a maioria dos operadores não vai escrever `{a|b|c}` manualmente do zero; o botão
 * (Disparos → StepMessage) insere o bloco pronto no fim do texto, mesmo padrão de append já usado
 * pelos botões de placeholder (`{{nome}}` etc).
 */
export const BIBLIOTECA_VARIACOES: { label: string; spintax: string }[] = [
  { label: "Saudação", spintax: "{Olá|Oi|E aí|Tudo bem?}" },
  { label: "Transição", spintax: "{Aproveitando|Já que estou aqui|Passando rápido}" },
  { label: "Fechamento/CTA", spintax: "{Me chama|Qualquer dúvida me avisa|Fico à disposição|Combinamos assim?}" },
  { label: "Despedida", spintax: "{Abraço|Até mais|Fico no aguardo|Um abraço}" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Mensagens-base completas por contato (item 2/3, Sprint Motor Nativo de Disparo, 2026-08-07)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Escolhe a mensagem-base COMPLETA pra este contato — chamada uma vez por contato, ANTES de
 * `substituirPlaceholders`/`resolverSpintax`/`aplicarVariacaoAutomatica` rodarem em cima do
 * resultado (mesma ordem de composição de sempre: variante completa primeiro, resto depois).
 * `variantes` vazio preserva 100% do comportamento de campanha sem variante (chamador decide não
 * chamar, ver `Disparos.tsx`). Modo 'regra': percorre as tags do contato na ordem em que vêm
 * gravadas e usa a primeira que bater no mapa — sem tag configurada bater, cai pro round-robin
 * (nunca deixa o contato sem mensagem por falta de regra).
 */
export function escolherVariante(
  variantes: string[],
  distribuicao: "round_robin" | "regra",
  regraPorTag: Record<string, number>,
  contato: { tags?: string[] | null },
  indice: number,
): string {
  if (!variantes.length) return "";
  if (distribuicao === "regra" && Array.isArray(contato.tags)) {
    for (const tag of contato.tags) {
      if (Object.prototype.hasOwnProperty.call(regraPorTag, tag)) {
        const idx = regraPorTag[tag];
        if (idx >= 0 && idx < variantes.length) return variantes[idx];
      }
    }
  }
  return variantes[indice % variantes.length];
}
