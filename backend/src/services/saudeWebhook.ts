/**
 * saudeWebhook.ts — webhook da Evolution parado (Sprint 5 / H6, entregue na Sprint 7 em 2026-10-06).
 *
 * [AUDITORIA] LÓGICA: todo POST autenticado em /webhook/evolution marca `agentes.ultimo_webhook_em`
 * da instância (no máximo 1 escrita a cada 30s por instância). "Parado" NÃO é só silêncio — número
 * ocioso fica horas sem evento e isso é normal. O alerta é: a instância ENVIOU mensagem há mais de
 * 5 minutos e, desde esse envio, não chegou nenhum evento dela (nem o ACK de entrega). Isso pega
 * webhook desconfigurado, fila de retentativa da Evolution travada e rede entre Evolution e CRM,
 * que fazem a campanha "sumir" com entregues/lidos parados em zero.
 */
import { Pool } from 'pg';
import { log } from '../logger';

const ultimaEscrita = new Map<string, number>();

/** Chamado a cada evento da Evolution. Nunca lança nem atrasa o webhook. */
export function registrarEventoWebhook(pool: Pool, instancia: string | null | undefined): void {
  if (!instancia) return;
  const agora = Date.now();
  if (agora - (ultimaEscrita.get(instancia) ?? 0) < 30_000) return;
  ultimaEscrita.set(instancia, agora);
  pool.query(`UPDATE agentes SET ultimo_webhook_em = NOW() WHERE evolution_instancia = $1`, [instancia]).catch(() => {});
}

export interface WebhookParado {
  agente_id: string; user_id: string; instancia: string; numero: string | null;
  ultimo_webhook_em: string | null; envio_sem_evento_desde: string; envios_sem_evento: number; minutos_parado: number;
}

/** Instâncias que enviaram há 5+ min (até 2h atrás) sem nenhum evento da Evolution depois disso. */
export async function webhooksParados(pool: Pool, userId?: string): Promise<WebhookParado[]> {
  const r = await pool.query(
    `SELECT a.id AS agente_id, a.user_id, a.evolution_instancia AS instancia, a.numero_conectado AS numero,
            a.ultimo_webhook_em, MIN(dl.enviado_at) AS envio_sem_evento_desde, COUNT(*)::int AS envios_sem_evento
     FROM agentes a
     JOIN disparo_logs dl ON dl.instancia = a.evolution_instancia AND dl.status = 'sent'
      AND dl.enviado_at BETWEEN NOW() - INTERVAL '2 hours' AND NOW() - INTERVAL '5 minutes'
      AND dl.enviado_at > COALESCE(a.ultimo_webhook_em, '-infinity'::timestamptz)
     WHERE a.evolution_instancia IS NOT NULL AND a.numero_conectado IS NOT NULL
       ${userId ? 'AND a.user_id = $1' : ''}
     GROUP BY a.id`,
    userId ? [userId] : []
  );
  return r.rows.map((x: any) => ({
    ...x,
    minutos_parado: Math.floor((Date.now() - new Date(x.envio_sem_evento_desde).getTime()) / 60_000),
  }));
}

/** Cron de 5 min: registra no log (Grafana/Loki) cada instância com webhook parado. */
export async function verificarWebhooksParados(pool: Pool): Promise<number> {
  const lista = await webhooksParados(pool);
  for (const p of lista) {
    log.warn('WEBHOOK_PARADO', 'Instância enviou e não recebeu nenhum evento da Evolution desde então', {
      instancia: p.instancia, userId: p.user_id, minutosParado: p.minutos_parado, enviosSemEvento: p.envios_sem_evento,
    });
  }
  return lista.length;
}
