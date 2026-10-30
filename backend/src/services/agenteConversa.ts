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

/** Mensagem a mandar ao contato quando a IA falha por erro transitório (vazio = não manda nada). */
export function mensagemDeErro(cfg: ConfigConversa | null | undefined): string | null {
  const m = String(cfg?.mensagem_erro || '').trim();
  return m || null;
}
