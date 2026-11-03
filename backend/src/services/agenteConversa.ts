/**
 * agenteConversa.ts — Sprint IA-1 (2026-10-29): regras de conversa configuráveis por agente, no
 * modelo do Cubo (ver diagnosticos/engenharia_reversa_suite/RELATORIO_IA_E_META_CUBO.md, Parte B).
 * Funções puras — sem banco nem rede — usadas por agentEngine.ts (atendimento real) e pelo
 * playground. Toda coluna NULL reproduz o comportamento de antes desta sprint.
 */
import type { AIMessage } from './providers/index';

export interface ConfigConversa {
  tempo_espera_mensagem?: number | null;
  historico_mensagens?: number | null;
  historico_max_tokens?: number | null;
  divisao_ativa?: boolean | null;
  divisao_modo?: string | null;
  divisao_tamanho?: number | null;
  divisao_intervalo_ms?: number | null;
  emoji_politica?: string | null;
  assinatura_ativa?: boolean | null;
  assinatura_texto?: string | null;
  idioma_forcado?: string | null;
  mensagem_erro?: string | null;
  // 2026-10-31: comportamento humano / anti-banimento (NULL = ligado, velocidade normal)
  digitacao_ativa?: boolean | null;
  digitacao_velocidade?: string | null;
  marcar_lida?: boolean | null;
}

const limitar = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

/** Espera para agrupar mensagens picotadas do contato. Campo em segundos na tela; padrão 3 s. */
export function esperaAgruparMs(cfg: ConfigConversa | null | undefined): number {
  const seg = Number(cfg?.tempo_espera_mensagem);
  if (!Number.isFinite(seg) || seg <= 0) return 3000;
  return limitar(Math.round(seg * 1000), 1000, 60_000);
}

/** Quantas mensagens anteriores buscar no banco (padrão 20, de 1 a 100). */
export function limiteHistorico(cfg: ConfigConversa | null | undefined): number {
  const n = Number(cfg?.historico_mensagens);
  return Number.isFinite(n) && n > 0 ? limitar(Math.round(n), 1, 100) : 20;
}

/** Estimativa barata (~4 caracteres por token) — só pra cortar histórico, não pra cobrança. */
export const estimarTokens = (texto: string) => Math.ceil(texto.length / 4);

/**
 * Corta as mensagens MAIS ANTIGAS até o histórico caber em `historico_max_tokens`. Recebe o
 * histórico já em ordem cronológica (mais antiga primeiro). Sem teto configurado, devolve igual.
 */
export function cortarHistoricoPorTokens(historico: AIMessage[], cfg: ConfigConversa | null | undefined): AIMessage[] {
  const teto = Number(cfg?.historico_max_tokens);
  if (!Number.isFinite(teto) || teto <= 0) return historico;
  const saida: AIMessage[] = [];
  let total = 0;
  for (let i = historico.length - 1; i >= 0; i--) {
    const c = historico[i].content;
    const t = estimarTokens(typeof c === 'string' ? c : JSON.stringify(c));
    if (total + t > teto) break;
    total += t;
    saida.unshift(historico[i]);
  }
  return saida;
}

const SEPARADOR = '[QUEBRA]';

function porCaracteres(texto: string, tamanho: number): string[] {
  const partes: string[] = [];
  let atual = '';
  for (const palavra of texto.split(/(\s+)/)) {
    if (atual && (atual + palavra).trim().length > tamanho && palavra.trim()) {
      partes.push(atual.trim());
      atual = palavra.trimStart();
    } else {
      atual += palavra;
    }
  }
  if (atual.trim()) partes.push(atual.trim());
  return partes;
}

/**
 * Divide a resposta em mensagens de WhatsApp.
 * - `divisao_ativa` NULL: regra antiga — no máximo 2 partes ([QUEBRA] ou último parágrafo
 *   separado). Antes a 3ª parte em diante de um [QUEBRA] era DESCARTADA; agora é anexada à 2ª.
 * - `false`: uma mensagem só.
 * - `true`: [QUEBRA] sempre separa; dentro de cada bloco, agrupa `divisao_tamanho` parágrafos por
 *   mensagem (modo `paragrafos`, padrão 1) ou corta a cada ~N caracteres sem partir palavra
 *   (modo `caracteres`, padrão 300).
 */
export function dividirResposta(texto: string, cfg: ConfigConversa | null | undefined): string[] {
  const limpo = texto.trim();
  if (!limpo) return [];
  const blocos = limpo.split(SEPARADOR).map(p => p.trim()).filter(Boolean);

  if (cfg?.divisao_ativa == null) {
    if (blocos.length >= 2) return [blocos[0], blocos.slice(1).join('\n\n')];
    const paragrafos = limpo.split(/\n\n+/).filter(p => p.trim());
    if (paragrafos.length >= 2) return [paragrafos.slice(0, -1).join('\n\n'), paragrafos[paragrafos.length - 1]];
    return [limpo];
  }

  if (cfg.divisao_ativa === false) return [blocos.join('\n\n')];

  const modo = cfg.divisao_modo === 'caracteres' ? 'caracteres' : 'paragrafos';
  const saida: string[] = [];
  for (const bloco of blocos) {
    if (modo === 'caracteres') {
      saida.push(...porCaracteres(bloco, limitar(Number(cfg.divisao_tamanho) || 300, 50, 4000)));
    } else {
      const porMsg = limitar(Number(cfg.divisao_tamanho) || 1, 1, 20);
      const paragrafos = bloco.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
      for (let i = 0; i < paragrafos.length; i += porMsg) saida.push(paragrafos.slice(i, i + porMsg).join('\n\n'));
    }
  }
  return saida;
}

/** Pausa entre as partes enviadas (padrão 3 s, como antes). */
export function intervaloEntrePartesMs(cfg: ConfigConversa | null | undefined): number {
  const ms = Number(cfg?.divisao_intervalo_ms);
  return Number.isFinite(ms) && ms >= 0 ? limitar(Math.round(ms), 0, 15_000) : 3000;
}

// ── Comportamento humano / anti-banimento (2026-10-31) ─────────────────────────────────────
// Ritmo fixo é assinatura de robô: o motor mostrava "digitando…" por 1,2 s em TODA resposta e
// nunca marcava a mensagem do cliente como lida. Aqui o tempo varia com o tamanho do texto e com
// um ruído aleatório, como uma pessoa digitando no celular.

/** Caracteres por segundo de cada velocidade (pessoa digitando no celular: ~4–8 cps). */
const CPS: Record<string, number> = { lenta: 4.5, normal: 6.5, rapida: 9 };

/** Variação aleatória de ±fração (padrão ±25%). `aleatorio` é injetável para teste. */
export function comVariacao(ms: number, fracao = 0.25, aleatorio: () => number = Math.random): number {
  return Math.round(ms * (1 - fracao + aleatorio() * 2 * fracao));
}

/** A IA mostra "digitando…" antes de cada parte? (NULL = sim) */
export const digitacaoAtiva = (cfg: ConfigConversa | null | undefined) => cfg?.digitacao_ativa !== false;
/** Marca a mensagem do cliente como lida antes de responder? (NULL = sim) */
export const marcarLidaAtivo = (cfg: ConfigConversa | null | undefined) => cfg?.marcar_lida !== false;

/**
 * Quanto tempo mostrar "digitando…" para esta parte: proporcional ao tamanho, com variação,
 * entre 1,5 s e 12 s (a Evolution mantém o indicador pelo tempo do `delay`). Desligado = 1,2 s,
 * o valor fixo de antes.
 */
export function tempoDigitacaoMs(texto: string, cfg: ConfigConversa | null | undefined, aleatorio: () => number = Math.random): number {
  if (!digitacaoAtiva(cfg)) return 1200;
  const cps = CPS[String(cfg?.digitacao_velocidade || 'normal')] ?? CPS.normal;
  const base = (texto.trim().length / cps) * 1000;
  return limitar(comVariacao(base, 0.25, aleatorio), 1500, 12_000);
}

/** Atraso entre "ler" a mensagem do cliente e começar a digitar (0,8–3 s). */
export function tempoLeituraMs(aleatorio: () => number = Math.random): number {
  return Math.round(800 + aleatorio() * 2200);
}

/** Intervalo entre partes com variação (sem ela, o espaçamento idêntico também denuncia robô). */
export function intervaloComVariacaoMs(cfg: ConfigConversa | null | undefined, aleatorio: () => number = Math.random): number {
  const base = intervaloEntrePartesMs(cfg);
  return base === 0 ? 0 : comVariacao(base, 0.3, aleatorio);
}

/** Normaliza para comparar mensagens repetidas (caixa, espaços e pontuação final). */
export const normalizarParaRepeticao = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').replace(/[.!?…\s]+$/, '').trim();

const EMOJI: Record<string, string> = {
  off: 'Não use emojis em nenhuma resposta.',
  low: 'Use emojis raramente: no máximo 1 por mensagem, e só quando ajudar o tom.',
  normal: 'Use emojis com moderação: cerca de 2 a 3 por mensagem.',
  high: 'Pode usar emojis com frequência para deixar a conversa leve.',
};

/** Instruções de comportamento acrescentadas ao prompt do sistema (vazio quando nada configurado). */
export function instrucoesComportamento(cfg: ConfigConversa | null | undefined): string {
  const linhas: string[] = [];
  const emoji = EMOJI[String(cfg?.emoji_politica || '')];
  if (emoji) linhas.push(emoji);
  const idioma = String(cfg?.idioma_forcado || '').trim();
  if (idioma) linhas.push(`Responda sempre em ${idioma}, mesmo que o cliente escreva em outro idioma.`);
  return linhas.length ? `\n\nREGRAS DE ESTILO:\n- ${linhas.join('\n- ')}` : '';
}

/**
 * Cabeçalho/rodapé de cada parte enviada. NULL em `assinatura_ativa` = regra antiga (nome de
 * exibição em negrito no topo). `true` = texto da assinatura no FIM de cada parte. `false` = nada.
 */
export function formatarParte(parte: string, cfg: ConfigConversa | null | undefined, nomeExibicao: string): string {
  if (cfg?.assinatura_ativa == null) return nomeExibicao ? `*${nomeExibicao}*\n${parte}` : parte;
  if (cfg.assinatura_ativa === false) return parte;
  const assinatura = String(cfg.assinatura_texto || '').trim();
  return assinatura ? `${parte}\n\n${assinatura}` : parte;
}

/**
 * RAG do agente (aba Conhecimento): ligado, quantos trechos e limiar de semelhança.
 * NULL nos campos = ligado, 5 trechos, sem limiar.
 */
export function ragDoAgente(a: { rag_ativo?: boolean | null; rag_resultados?: number | null; rag_threshold?: number | string | null }) {
  const resultados = Number(a.rag_resultados);
  const limiar = Number(a.rag_threshold);
  return {
    ativo: a.rag_ativo !== false,
    resultados: Number.isFinite(resultados) && resultados > 0 ? limitar(Math.round(resultados), 1, 10) : 5,
    limiar: Number.isFinite(limiar) && limiar > 0 ? limitar(limiar, 0, 1) : 0,
  };
}

/**
 * Campos que a aba Teste pode sobrescrever com o que está na tela (sem salvar). Lista fechada:
 * só comportamento da IA — nada de dono, número, credencial ou status.
 */
export const CAMPOS_TESTAVEIS = [
  'prompt_sistema', 'modelo', 'provider_id', 'temperatura', 'max_tokens', 'esforco_raciocinio', 'tier_servico',
  'limite_passos', 'mcp_tools', 'escopo_ia', 'nome_exibicao', 'empresa_nome', 'sinal_pausa',
  'rag_ativo', 'rag_resultados', 'rag_threshold', 'modalidade_imagem',
  'historico_mensagens', 'historico_max_tokens', 'divisao_ativa', 'divisao_modo', 'divisao_tamanho',
  'divisao_intervalo_ms', 'emoji_politica', 'assinatura_ativa', 'assinatura_texto', 'idioma_forcado',
  'digitacao_ativa', 'digitacao_velocidade', 'acoes_funil',
] as const;

/** Agente do banco + os campos testáveis vindos da tela (ignora qualquer outra chave). */
export function aplicarConfigDeTeste<T extends Record<string, any>>(agente: T, sobrescrever?: Record<string, unknown> | null): T {
  if (!sobrescrever || typeof sobrescrever !== 'object') return agente;
  const resultado: Record<string, any> = { ...agente };
  for (const campo of CAMPOS_TESTAVEIS) {
    if (Object.prototype.hasOwnProperty.call(sobrescrever, campo)) resultado[campo] = sobrescrever[campo];
  }
  return resultado as T;
}

/** Mensagem a mandar ao contato quando a IA falha por erro transitório (vazio = não manda nada). */
export function mensagemDeErro(cfg: ConfigConversa | null | undefined): string | null {
  const m = String(cfg?.mensagem_erro || '').trim();
  return m || null;
}
