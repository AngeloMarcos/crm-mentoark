import { Pool } from 'pg';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { log } from '../logger';
import { executarBusca } from './busca';
import { pausaAtiva, validarGrupo, verificarLinkPublico, ValidacaoIndisponivel } from './validacao';

const FILA_BUSCA = 'radar-busca';
const FILA_VALIDAR = 'radar-validar';
const FILA_LINK = 'radar-link';
// Homolog e produção dividem o mesmo Redis: sem prefixo próprio um ambiente consumiria os jobs do outro.
const PREFIXO = () => process.env.RADAR_QUEUE_PREFIX || 'crm';
let filaBusca: Queue | null = null;
let filaValidar: Queue | null = null;
let filaLink: Queue | null = null;
const workers: Worker[] = [];
let poolRef: Pool | null = null;
let infoClient: IORedis | null = null;

function conexao() {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port) || 6379,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    maxRetriesPerRequest: null as null, // exigido pelo BullMQ Worker
  };
}

export function redisConfigurado(): boolean { return !!process.env.REDIS_URL; }

/**
 * Sobe as filas e os workers. Sem REDIS_URL (ou se falhar) o módulo continua funcionando: a busca
 * roda inline, sem fila, com aviso no log — o Radar nunca derruba a API.
 */
export function iniciarFilaRadar(pool: Pool): void {
  poolRef = pool;
  try { iniciarInterno(pool); } catch (err: any) {
    filaBusca = null; filaValidar = null; filaLink = null;
    log.error('RADAR', 'fila indisponível — buscas rodarão inline', { err: err?.message });
  }
}

function iniciarInterno(pool: Pool): void {
  const c = conexao();
  if (!c) { log.warn('RADAR', 'REDIS_URL ausente — buscas rodarão inline, sem fila'); return; }
  const limpeza = { removeOnComplete: { age: 24 * 3600, count: 200 }, removeOnFail: { age: 7 * 24 * 3600, count: 500 } };

  filaBusca = new Queue(FILA_BUSCA, {
    prefix: PREFIXO(), connection: c,
    defaultJobOptions: { attempts: 1, ...limpeza }, // busca pode ser POST pago: nunca repetir automaticamente
  });
  workers.push(new Worker(FILA_BUSCA, async job => { await executarBusca(pool, job.data.buscaId, enfileirarLinkPublico); }, {
    connection: c, prefix: PREFIXO(), concurrency: 1, limiter: { max: 1, duration: 1000 },
  }));

  // Leitura de convites: só GET, então pode repetir com backoff. Ritmo baixo para poupar o número.
  const intervalo = Number(process.env.RADAR_VALIDAR_INTERVALO_MS) || 8000;
  filaValidar = new Queue(FILA_VALIDAR, {
    prefix: PREFIXO(), connection: c,
    defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 30_000 }, ...limpeza },
  });
  workers.push(new Worker(FILA_VALIDAR, async job => {
    try { await validarGrupo(pool, job.data.grupoId); }
    catch (err) { if (err instanceof ValidacaoIndisponivel) throw new Error(err.message); throw err; }
  }, { connection: c, prefix: PREFIXO(), concurrency: 1, limiter: { max: 1, duration: intervalo } }));

  // Verificação de link pela página pública do WhatsApp: ritmo lento (1 a cada ~6s + jitter no job) e, se o
  // WhatsApp sinalizar limite, a fila INTEIRA espera (rateLimit nativo do BullMQ) em vez de insistir.
  const intervaloLink = Number(process.env.RADAR_LINK_INTERVALO_MS) || 6000;
  filaLink = new Queue(FILA_LINK, {
    prefix: PREFIXO(), connection: c,
    defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 60_000 }, ...limpeza },
  });
  const wLink: Worker = new Worker(FILA_LINK, async job => {
    try { await verificarLinkPublico(pool, job.data.grupoId); }
    catch (err) {
      if (err instanceof ValidacaoIndisponivel) {
        const p = await pausaAtiva(pool, 'link_publico');
        if (p) { await wLink.rateLimit(Math.max(1000, p.ate.getTime() - Date.now())); throw Worker.RateLimitError(); }
        throw new Error(err.message);
      }
      throw err;
    }
  }, { connection: c, prefix: PREFIXO(), concurrency: 1, limiter: { max: 1, duration: intervaloLink } });
  workers.push(wLink);

  for (const w of workers) w.on('failed', (job, err) => log.warn('RADAR', 'job falhou', { fila: w.name, jobId: job?.id, tentativa: job?.attemptsMade, err: err.message }));
  for (const q of [filaBusca, filaValidar, filaLink]) q.on('error', err => log.error('RADAR', 'erro na fila', { err: err.message }));
  log.info('RADAR', 'filas radar-busca, radar-validar e radar-link iniciadas');
}

/** Enfileira a busca. jobId = id da busca (que já é único por request_id): BullMQ ignora duplicatas. */
export async function enfileirarBusca(pool: Pool, buscaId: string): Promise<'fila' | 'inline'> {
  if (filaBusca) { await filaBusca.add('buscar', { buscaId }, { jobId: buscaId }); return 'fila'; }
  setImmediate(() => { executarBusca(pool, buscaId, enfileirarLinkPublico).catch(() => {}); });
  return 'inline';
}

/** Enfileira a verificação de link (página pública) de cada grupo. Sem Redis, roda em sequência inline. */
export async function enfileirarLinkPublico(grupoIds: string[]): Promise<'fila' | 'inline'> {
  if (!grupoIds.length) return 'fila';
  if (filaLink) {
    const dia = new Date().toISOString().slice(0, 10);
    await filaLink.addBulk(grupoIds.map(id => ({ name: 'link', data: { grupoId: id }, opts: { jobId: `lnk-${id}-${dia}` } })));
    return 'fila';
  }
  const pool = poolRef;
  if (pool) {
    const intervalo = Number(process.env.RADAR_LINK_INTERVALO_MS) || 6000;
    (async () => {
      for (const id of grupoIds) {
        try { await verificarLinkPublico(pool, id); }
        catch (err: any) { log.warn('RADAR', 'verificação inline falhou', { id, err: err?.message }); if (err instanceof ValidacaoIndisponivel) break; }
        await new Promise(r => setTimeout(r, intervalo));
      }
    })().catch(() => {});
  }
  return 'inline';
}

/** Enfileira a leitura do convite de cada grupo. Sem Redis, roda em sequência inline com o mesmo intervalo. */
export async function enfileirarValidacao(grupoIds: string[]): Promise<'fila' | 'inline'> {
  if (filaValidar) {
    // jobId por grupo+hora: repetir o clique não empilha leituras duplicadas.
    const hora = new Date().toISOString().slice(0, 13);
    await filaValidar.addBulk(grupoIds.map(id => ({ name: 'validar', data: { grupoId: id }, opts: { jobId: `val-${id}-${hora}` } })));
    return 'fila';
  }
  const pool = poolRef;
  if (pool) {
    const intervalo = Number(process.env.RADAR_VALIDAR_INTERVALO_MS) || 8000;
    (async () => {
      for (const id of grupoIds) {
        try { await validarGrupo(pool, id); } catch (err: any) { log.warn('RADAR', 'validação inline falhou', { id, err: err?.message }); }
        await new Promise(r => setTimeout(r, intervalo));
      }
    })().catch(() => {});
  }
  return 'inline';
}

/** Uso de memória do Redis para alerta (com noeviction, encher = escritas falham). */
export async function memoriaRedis(): Promise<{ usadoMb: number; maxMb: number; alerta: boolean } | null> {
  if (!filaBusca) return null;
  try {
    // Cliente próprio e leve só para INFO (o `queue.client` do BullMQ 6 não expõe o cliente de forma estável).
    const c = conexao();
    if (!c) return null;
    infoClient ??= new IORedis({ ...c, maxRetriesPerRequest: 1, lazyConnect: false });
    const info: string = await infoClient.info('memory');
    const usado = Number(/^used_memory:(\d+)/m.exec(info)?.[1] ?? 0);
    const max = Number(/^maxmemory:(\d+)/m.exec(info)?.[1] ?? 0);
    const alerta = max > 0 && usado / max > 0.8;
    if (alerta) log.warn('RADAR', 'memória do Redis acima de 80% (noeviction: escritas vão falhar ao encher)', { usado, max });
    return { usadoMb: Math.round(usado / 1048576), maxMb: Math.round(max / 1048576), alerta };
  } catch (err: any) {
    log.warn('RADAR', 'não foi possível ler a memória do Redis', { err: err?.message });
    return null;
  }
}
