/**
 * resilientFetch.ts — Fetch com timeout, retry e sanitização de URL
 *
 * Resolve a raiz dos erros 502 Bad Gateway causados por:
 *   - Chamadas fetch sem timeout travando o Traefik
 *   - Servidor Evolution temporariamente indisponível (503/504)
 *   - URLs com trailing slash quebrando roteamento
 *
 * Exports:
 *   resilientFetch(url, options?)  — wrapper genérico
 *   evolutionFetch(url, options?)  — convenência para Evolution API
 *   sanitizeEvolutionUrl(url)       — normaliza URL base da Evolution
 *   withAiFallback(fn, fallback)    — contingência para erros 401/429 da OpenAI
 */

import { log } from '../logger';

// ── Configuração via variáveis de ambiente ────────────────────────────────────

const TIMEOUT_MS    = Number(process.env.EVOLUTION_FETCH_TIMEOUT_MS) || 20_000;
const MAX_RETRIES   = 3;
const RETRY_DELAYS  = [1_000, 2_000, 4_000]; // ms para tentativa 1, 2, 3
const RETRYABLE     = new Set([503, 504]);     // status HTTP que disparam retry

// ── Sanitização de URL ────────────────────────────────────────────────────────

/**
 * Normaliza a URL base da Evolution API:
 *   1. Remove espaços.
 *   2. Garante schema https:// (promove http:// automaticamente).
 *   3. Remove trailing slashes para evitar rotas com double-slash.
 */
export function sanitizeEvolutionUrl(url: string): string {
  let u = url.trim();
  if (!u) return u;

  // Promove http → https
  if (/^http:\/\//i.test(u)) u = 'https://' + u.slice(7);
  // Injeta schema se completamente ausente
  else if (!/^https?:\/\//i.test(u)) u = 'https://' + u;

  // Remove trailing slashes (exceto raiz "https://host/")
  u = u.replace(/\/+$/, '');

  return u;
}

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface ResilientFetchOptions extends RequestInit {
  /** Timeout em ms. Default: EVOLUTION_FETCH_TIMEOUT_MS env var ou 20000. */
  timeoutMs?: number;
  /** Número máximo de retentativas após falha. Default: 3. */
  maxRetries?: number;
  /** Delays customizados em ms para cada retentativa. Default: [1000, 2000, 4000]. */
  retryDelays?: number[];
  /** Status HTTP que disparam retry. Default: [503, 504]. */
  retryOn?: number[];
  /** Se true, aplica sanitizeEvolutionUrl na URL. Default: true. */
  sanitizeUrl?: boolean;
}

// ── Utilitário interno ────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function isRetryableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const name = err.name;
  const code = (err as NodeJS.ErrnoException).code ?? '';
  return (
    name === 'AbortError'      ||   // timeout via AbortController
    code === 'ECONNREFUSED'    ||   // servidor não está ouvindo
    code === 'ECONNRESET'      ||   // conexão resetada pelo peer
    code === 'ETIMEDOUT'       ||   // timeout de nível TCP
    code === 'ENOTFOUND'       ||   // DNS falhou
    code === 'UND_ERR_CONNECT_TIMEOUT'  // undici timeout (Node 18+)
  );
}

// ── resilientFetch ─────────────────────────────────────────────────────────────

/**
 * Fetch com timeout via AbortController + retry automático com backoff.
 *
 * Não retenta em erros 4xx (exceto os definidos em retryOn) para evitar
 * múltiplas inserções ou chamadas desnecessárias quando a requisição é
 * definitivamente inválida.
 */
export async function resilientFetch(
  url: string,
  options: ResilientFetchOptions = {},
): Promise<Response> {
  const {
    timeoutMs   = TIMEOUT_MS,
    maxRetries  = MAX_RETRIES,
    retryDelays = RETRY_DELAYS,
    retryOn     = [...RETRYABLE],
    sanitizeUrl = true,
    ...fetchOptions
  } = options;

  const finalUrl = sanitizeUrl ? sanitizeEvolutionUrl(url) : url;
  const retrySet = new Set(retryOn);

  let lastErr: Error = new Error('resilientFetch: sem tentativas realizadas');

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = retryDelays[attempt - 1] ?? retryDelays[retryDelays.length - 1];
      log.warn('resilientFetch', 'nova tentativa agendada', {
        attempt,
        maxRetries,
        delayMs: delay,
        url: finalUrl,
      });
      await sleep(delay);
    }

    // Novo AbortController por tentativa (não é reutilizável após abort)
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(finalUrl, {
        ...fetchOptions,
        signal: controller.signal,
      });
      clearTimeout(timer);

      // [AUDITORIA] BUG (Cenário E desta auditoria — revisão do comentário anterior deste
      // trecho, 2026-07-23): o comentário original aqui afirmava que não consumir o body de
      // uma resposta 503/504 descartada não vazava socket. Isso não é preciso para o fetch
      // nativo do Node (undici): a conexão TCP só volta pro pool de keep-alive quando o body
      // é integralmente consumido OU explicitamente cancelado — enquanto o body fica
      // pendurado sem leitor, o socket subjacente só é liberado quando o objeto Response é
      // coletado pelo GC (via FinalizationRegistry do undici), o que é não-determinístico e
      // pode demorar sob pressão de memória. Sob uma sequência de retries rápidos em 503/504
      // (o cenário que esta função existe pra tratar), cada tentativa abre uma conexão NOVA
      // em vez de reaproveitar uma do pool, e as antigas ficam penduradas até o GC alcançar —
      // não é um vazamento permanente (undici acaba fechando), mas é desperdício real de
      // handshakes/fds sob retry sustentado.
      // [AUDITORIA] FIX APLICADO: cancela explicitamente o body antes de descartar a resposta
      // retentável — libera o socket de volta ao pool imediatamente, sem esperar o GC.
      if (retrySet.has(response.status) && attempt < maxRetries) {
        await response.body?.cancel().catch(() => {});
        lastErr = new Error(
          `[resilientFetch] HTTP ${response.status} — agendando retry`,
        );
        log.warn('resilientFetch', 'HTTP status retentável — agendando retry', {
          status: response.status,
          url: finalUrl,
        });
        continue; // vai para o próximo loop (com sleep acima)
      }

      return response; // sucesso (pode ser 4xx — quem chama decide)

    } catch (err: unknown) {
      clearTimeout(timer);
      const e = err instanceof Error ? err : new Error(String(err));
      lastErr = e;

      if (isRetryableError(e) && attempt < maxRetries) {
        log.warn('resilientFetch', 'erro retentável', {
          name: e.name,
          code: (e as any).code,
          message: e.message,
        });
        continue;
      }

      // Erro definitivo (não retentável) ou esgotou retentativas
      throw e;
    }
  }

  throw lastErr;
}

// ── evolutionFetch ─────────────────────────────────────────────────────────────

/**
 * Convenência: fetch para a Evolution API.
 * Sempre sanitiza a URL, usa EVOLUTION_FETCH_TIMEOUT_MS e retenta em 503/504.
 * Throw em qualquer resposta não-ok (para quem chama tratar o status).
 */
export async function evolutionFetch(
  url: string,
  options: ResilientFetchOptions = {},
): Promise<Response> {
  return resilientFetch(url, {
    timeoutMs:   TIMEOUT_MS,
    maxRetries:  MAX_RETRIES,
    retryDelays: RETRY_DELAYS,
    retryOn:     [503, 504],
    sanitizeUrl: true,
    ...options,
  });
}

// ── withAiFallback ─────────────────────────────────────────────────────────────

/**
 * Envolve uma chamada à API de IA (OpenAI, Anthropic) com tratamento
 * de falhas não-críticas:
 *
 *   - 401 Unauthorized  → chave inválida/expirada → retorna fallback
 *   - 429 Too Many Req  → sem saldo/rate limit    → retorna fallback
 *
 * Outros erros são re-lançados normalmente para que o caller decida.
 *
 * @param fn       Função assíncrona que faz a chamada à IA.
 * @param fallback Valor de contingência retornado quando a IA não está disponível.
 * @param context  Label para o log (ex: "humanizarMensagem", "copiloto").
 */
export async function withAiFallback<T>(
  fn: () => Promise<T>,
  fallback: T,
  context = 'AI call',
): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    const status: number | undefined =
      err?.status ?? err?.response?.status ?? err?.statusCode;

    if (status === 401) {
      log.error('withAiFallback', 'chave inválida (401) — usando fallback. Atualize OPENAI_API_KEY no servidor.', {
        context,
      });
      return fallback;
    }

    if (status === 429) {
      log.warn('withAiFallback', 'rate limit / sem saldo (429) — usando fallback por contingência', {
        context,
      });
      return fallback;
    }

    // Erro não tratado — propaga para o caller
    throw err;
  }
}
