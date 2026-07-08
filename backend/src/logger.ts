import { AsyncLocalStorage } from 'async_hooks';
import pino from 'pino';

interface RequestContext {
  requestId?: string;
  ip?: string;
  method?: string;
  path?: string;
  userId?: string;
}

const als = new AsyncLocalStorage<RequestContext>();

const base = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

function context(): RequestContext {
  return als.getStore() || {};
}

export const log = {
  info: (tag: string, msg: string, extra?: Record<string, any>) =>
    base.info({ ...context(), tag, ...extra }, msg),
  warn: (tag: string, msg: string, extra?: Record<string, any>) =>
    base.warn({ ...context(), tag, ...extra }, msg),
  error: (tag: string, msg: string, extra?: Record<string, any>) =>
    base.error({ ...context(), tag, ...extra }, msg),
};

export function runWithRequestContext(ctx: RequestContext, fn: () => void): void {
  als.run(ctx, fn);
}

export function setRequestUserId(userId: string): void {
  const store = als.getStore();
  if (store) store.userId = userId;
}
