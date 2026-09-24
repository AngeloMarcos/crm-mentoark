import { Pool } from 'pg';
import { Queue, Worker } from 'bullmq';
import { log } from '../logger';
import { executarBusca } from './busca';

const NOME_FILA = 'radar-busca';
// Homolog e produção dividem o mesmo Redis: sem prefixo próprio um ambiente consumiria os jobs do outro.
const PREFIXO = () => process.env.RADAR_QUEUE_PREFIX || 'crm';
let fila: Queue | null = null;
let worker: Worker | null = null;

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
 * Sobe a fila e o worker (concorrência 1 + limite de 1 job/s). Sem REDIS_URL o módulo continua
 * funcionando: a busca roda inline (útil em dev/homolog sem Redis), com aviso no log.
 */
export function iniciarFilaRadar(pool: Pool): void {
  try { iniciarFilaRadarInterno(pool); } catch (err: any) { fila = null; worker = null; log.error('RADAR', 'fila indisponível — buscas rodarão inline', { err: err?.message }); }
}

function iniciarFilaRadarInterno(pool: Pool): void {
  const c = conexao();
  if (!c) { log.warn('RADAR', 'REDIS_URL ausente — buscas rodarão inline, sem fila'); return; }
  fila = new Queue(NOME_FILA, {
    prefix: PREFIXO(),
    connection: c,
    defaultJobOptions: {
      attempts: 1, // busca pode ser POST pago: nunca repetir automaticamente
      removeOnComplete: { age: 24 * 3600, count: 200 },
      removeOnFail: { age: 7 * 24 * 3600, count: 500 },
    },
  });
  worker = new Worker(NOME_FILA, async job => { await executarBusca(pool, job.data.buscaId); }, {
    connection: c, prefix: PREFIXO(), concurrency: 1, limiter: { max: 1, duration: 1000 },
  });
  worker.on('failed', (job, err) => log.error('RADAR', 'job falhou', { jobId: job?.id, err: err.message }));
  fila.on('error', err => log.error('RADAR', 'erro na fila', { err: err.message }));
  log.info('RADAR', 'fila radar-busca iniciada');
}

/** Enfileira a busca. jobId = id da busca (que já é único por request_id): BullMQ ignora duplicatas. */
export async function enfileirarBusca(pool: Pool, buscaId: string): Promise<'fila' | 'inline'> {
  if (fila) { await fila.add('buscar', { buscaId }, { jobId: buscaId }); return 'fila'; }
  setImmediate(() => { executarBusca(pool, buscaId).catch(() => {}); });
  return 'inline';
}

/** Uso de memória do Redis para alerta (com noeviction, encher = escritas falham). */
export async function memoriaRedis(): Promise<{ usadoMb: number; maxMb: number } | null> {
  if (!fila) return null;
  try {
    const client: any = await fila.client;
    const info: string = await client.info('memory');
    const usado = Number(/used_memory:(\d+)/.exec(info)?.[1] ?? 0);
    const max = Number(/maxmemory:(\d+)/.exec(info)?.[1] ?? 0);
    return { usadoMb: Math.round(usado / 1048576), maxMb: Math.round(max / 1048576) };
  } catch { return null; }
}
