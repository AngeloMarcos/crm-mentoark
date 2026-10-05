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
 * `TEMAS`: conversas curtas por assunto (ver comentário logo acima de `TEMAS` abaixo). O motor
 * avança linha a linha dentro do tema do par (`maturador_pares.tema_atual`/`linha_atual`),
 * alternando remetente, e sorteia outro tema ao terminar.
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

// [AUDITORIA] BUG CORRIGIDO (Maturador v2, 2026-10-04): a v1 tinha UM diálogo linear de 20
// linhas, ciclado em ordem. A 100 msg/dia o par repetia a MESMA conversa 5x por dia, na mesma
// sequência — padrão trivial de detectar (e o oposto de "parecer orgânico").
// [AUDITORIA] FIX APLICADO: banco por TEMA. Cada tema é uma conversa curta e completa (abre,
// desenvolve, fecha); o motor sorteia um tema novo ao terminar o anterior (nunca o mesmo duas
// vezes seguidas) e cada linha ainda passa por spintax + sinônimos. Tom casual/neutro de
// propósito: não cita empresa, produto nem nada do negócio do usuário, e nunca usa
// `{{placeholder}}` (não há "contato" aqui, são as duas instâncias do próprio usuário).
export const TEMAS: string[][] = [
  [ // saudação / como foi o dia
    "Oi! {Tudo bem|Tudo certo|Tudo joia}?",
    "Tudo certo sim, {e você|e aí, tudo bem}?",
    "Tudo bem também! {Rolou|Aconteceu} alguma coisa {hoje|de novo}?",
    "Nada de mais, {dia corrido|dia tranquilo} por aqui. E aí, {como tão|como andam} as coisas?",
    "Também {corrido|tranquilo}, mas {tá tudo certo|tá tudo bem} 🙏",
    "{Que bom|Boa}! {Bom resto de dia|Bom trabalho aí} pra você",
    "{Valeu|Obrigado}, {pra você também|igualmente}!",
  ],
  [ // almoço
    "{Já almoçou|Almoçou já}?",
    "{Ainda não|Não ainda}, {tô terminando umas coisas|daqui a pouco vou}. E você?",
    "{Acabei de almoçar|Já fui}, {comi muito|tô cheio} {kkk|haha}",
    "{Kkk|Haha} {o que você comeu|comeu o quê}?",
    "{Arroz, feijão e frango|Um PF caprichado|Uma marmita}, {nada de especial|o básico}",
    "O básico {nunca falha|é o melhor} {kkkk|rs}",
    "{Verdade|Pois é}! {Bom almoço aí|Vai lá comer} 😄",
  ],
  [ // fim de semana
    "{E o fim de semana|E aí, o fds}, {como foi|foi bom}?",
    "{Foi tranquilo|Foi bom}, {fiquei em casa descansando|saí um pouco com a família}. E o seu?",
    "{Também foi tranquilo|O meu foi corrido}, {mas deu pra descansar|mas valeu a pena}",
    "{Que bom|Boa}, {às vezes é bom|faz falta} {dar uma pausa|desligar um pouco} né",
    "{Com certeza|Demais}, {a semana vai ser puxada|essa semana promete} {kkk|haha}",
    "{Força|Vamos que vamos} 💪",
  ],
  [ // tempo / clima
    "{Que calor hoje|Que frio hoje|Que tempo doido hoje}, {hein|né}?",
    "{Nem fala|Demais}! {Aqui tá assim desde cedo|Aqui também tá assim}",
    "{Disseram que|Vi que} {vai chover mais tarde|vai mudar amanhã}",
    "{Tomara|Seria bom}, {pelo menos refresca|aí melhora um pouco}",
    "{Verdade|Pois é}. {Vou fechar as janelas aqui|Vou pegar um casaco} {kkk|rs}",
    "{Kkk|Haha} {faz bem|bem pensado}",
  ],
  [ // combinar ligação
    "{Oi|Opa}, {consegue falar mais tarde|tem um tempinho mais tarde}?",
    "{Consigo sim|Consigo}, {depois das 17h|no fim da tarde} {fica bom|pode ser}?",
    "{Fica ótimo|Perfeito}, {te ligo|te chamo} {então|aí}",
    "{Combinado|Fechado}! {Qualquer coisa me avisa|Se mudar algo me fala}",
    "{Pode deixar|Beleza} 👍",
  ],
  [ // resolver pendência
    "{E aí|Oi}, {conseguiu resolver aquilo|deu tudo certo com aquele assunto}?",
    "{Consegui sim|Deu certo sim}, {obrigado por perguntar|valeu por lembrar}",
    "{Que ótimo|Fico feliz}! {Sabia que ia dar certo|Tava na torcida}",
    "{Deu um trabalhinho|Demorou um pouco} mas {foi|resolveu}",
    "{O importante é que resolveu|Faz parte} {kkk|haha}",
    "{Verdade|Exatamente}! {Valeu mesmo|Obrigado pela força}",
    "{Imagina|Tamo junto} 🤝",
  ],
  [ // série / filme
    "{Começou a ver alguma série nova|Tá assistindo alguma coisa boa}?",
    "{Comecei uma ontem|Tô vendo uma}, {mas ainda tô no começo|tô gostando até agora}",
    "{Me indica depois|Depois me fala se vale a pena}, {tô sem nada pra ver|acabei a que eu via}",
    "{Indico sim|Pode deixar}, {se continuar boa|quando terminar} te {falo|aviso}",
    "{Fechado|Beleza}! {Valeu|Obrigado}",
  ],
  [ // café / manhã
    "Bom dia! {Já tomou café|Café tomado}? ☕",
    "Bom dia! {Já sim|Tô tomando agora}, {sem café não funciono|preciso disso pra acordar} {kkk|haha}",
    "{Igual eu|Somos dois} {kkkk|rs}",
    "{Bora|Vamos} {começar o dia|pra luta} então",
    "{Bora|Vamos}! {Bom dia de trabalho|Ótimo dia} pra você",
  ],
  [ // academia / saúde
    "{Foi na academia hoje|Conseguiu treinar hoje}?",
    "{Fui sim|Ainda não}, {cedinho|vou mais tarde}. {E você|Você foi}?",
    "{Fui ontem|Hoje não deu}, {tô todo dolorido|amanhã eu vou} {kkk|haha}",
    "{Faz parte|Normal} {kkk|rs}, {o importante é não parar|constância é tudo}",
    "{Verdade|Total}! {Bora manter|Vamos que vamos} 💪",
  ],
  [ // recado rápido
    "{Oi|Opa}, {passando só pra|só pra} {dar um oi|saber se tá tudo bem}",
    "{Oi|Opa}! {Tudo certo sim|Tudo bem por aqui}, {e com você|e aí}?",
    "{Tudo ótimo|Tudo tranquilo}, {graças a Deus|na correria de sempre}",
    "{Que bom|Bom saber}! {Qualquer coisa me chama|Tô por aqui}",
    "{Valeu|Combinado}, {você também|igualmente} 😉",
  ],
  [ // compras / mercado
    "{Vou passar no mercado|Tô indo no mercado} {mais tarde|daqui a pouco}, {precisa de algo|quer alguma coisa}?",
    "{Não precisa não|Tô de boa}, {obrigado|valeu}! {Comprei ontem|Fui ontem}",
    "{Beleza|Ok}! {Só confirmando|Só pra saber} mesmo",
    "{Obrigado por lembrar|Valeu pela lembrança} 😊",
  ],
  [ // trânsito
    "{Que trânsito hoje|O trânsito tá parado}, {nossa|meu Deus}",
    "{Nem me fala|Sério}? {Aqui tá tranquilo|Peguei um pouco também}",
    "{Uma hora pra fazer 10 minutos|Tá tudo travado} {kkk|haha}",
    "{Paciência|Calma} {kkk|rs}, {coloca uma música|aproveita pra ouvir um podcast}",
    "{Boa ideia|É o jeito} {kkk|haha}",
  ],
];

/** Reações usadas de vez em quando (em vez de texto) — sinal orgânico de engajamento. */
export const REACOES = ['👍', '❤️', '😂', '🙏', '😄', '👏'];

/** Sorteia um tema diferente do atual (nunca repete o mesmo duas vezes seguidas). */
export function sortearTema(temaAtual: number | null): number {
  if (TEMAS.length <= 1) return 0;
  let t = Math.floor(Math.random() * TEMAS.length);
  if (t === temaAtual) t = (t + 1 + Math.floor(Math.random() * (TEMAS.length - 1))) % TEMAS.length;
  return t;
}
