// Guard utilities: single-flight dedupe + exponential cooldown + friendly errors.
// Use to prevent error loops on flaky endpoints (auth refresh, AI chat).

export class CooldownError extends Error {
  retryInMs: number;
  constructor(retryInMs: number) {
    super(`Em cooldown por mais ${Math.ceil(retryInMs / 1000)}s`);
    this.name = "CooldownError";
    this.retryInMs = retryInMs;
  }
}

const inflight = new Map<string, Promise<any>>();

export function singleflight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const p = (async () => {
    try {
      return await fn();
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

interface CooldownState {
  failures: number;
  nextAllowedAt: number;
}
const cooldowns = new Map<string, CooldownState>();

interface CooldownOpts {
  baseMs?: number;
  maxMs?: number;
  maxRetries?: number;
}

export function getCooldownRemaining(key: string): number {
  const s = cooldowns.get(key);
  if (!s) return 0;
  return Math.max(0, s.nextAllowedAt - Date.now());
}

export function resetCooldown(key: string) {
  cooldowns.delete(key);
}

export function hasExceededRetries(key: string, maxRetries: number): boolean {
  const s = cooldowns.get(key);
  return !!s && s.failures >= maxRetries;
}

export async function withCooldown<T>(
  key: string,
  fn: () => Promise<T>,
  opts: CooldownOpts = {}
): Promise<T> {
  const baseMs = opts.baseMs ?? 1000;
  const maxMs = opts.maxMs ?? 60_000;
  const remaining = getCooldownRemaining(key);
  if (remaining > 0) throw new CooldownError(remaining);

  return singleflight(key, async () => {
    try {
      const result = await fn();
      resetCooldown(key);
      return result;
    } catch (err) {
      const prev = cooldowns.get(key) ?? { failures: 0, nextAllowedAt: 0 };
      const failures = prev.failures + 1;
      const delay = Math.min(maxMs, baseMs * Math.pow(2, failures - 1));
      cooldowns.set(key, { failures, nextAllowedAt: Date.now() + delay });
      throw err;
    }
  });
}

export function friendlyError(status: number | undefined, raw?: string): string {
  const text = (raw || "").toLowerCase();
  if (text.includes("rate limit") || text.includes("tpm") || status === 429) {
    return "⏳ Muitas requisições. Aguarde alguns segundos e tente novamente.";
  }
  if (status === 401) return "Sessão expirada. Faça login novamente.";
  if (status === 402) return "Plano sem créditos suficientes para essa ação.";
  if (status === 403) return "Você não tem permissão para essa ação.";
  if (status === 404) return "Recurso não encontrado.";
  if (status === 408 || text.includes("abort")) {
    return "A resposta demorou demais. Tente um comando mais simples.";
  }
  if (status && status >= 500) {
    return "Serviço temporariamente indisponível. Tentaremos novamente em instantes.";
  }
  if (text.includes("failed to fetch") || text.includes("networkerror")) {
    return "Sem conexão com o servidor. Verifique sua internet.";
  }
  return raw || "Algo deu errado. Tente novamente em instantes.";
}
