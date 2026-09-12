/**
 * logoutCircuitBreaker.ts — circuit-breaker contra o loop de reconexão que já derrubou/baniu 2
 * números reais (Serenovlogs067, 10/08/2026, e um segundo usuário no mesmo dia). Módulo
 * compartilhado entre `webhook.ts` (grava cada evento de LOGOUT real, chega via
 * `connection.update`) e `whatsapp.ts` (consulta antes de permitir nova tentativa de
 * conexão/reconexão em `/connect`, cobrindo TANTO `nova_conexao` QUANTO `force_reconnect` — o
 * segundo caminho, "Forçar Reinicialização", era o buraco real do incidente mais recente: deleta
 * a instância de propósito e recria do zero a cada clique, sem limite nenhum).
 *
 * [AUDITORIA] LÓGICA: janela deslizante, não um contador com reset explícito — mais simples e
 * autoconsistente (não existe um "estado de cooldown" separado que possa dessincronizar do dado
 * real). Enquanto existirem `LOGOUT_LOOP_THRESHOLD` ou mais eventos de LOGOUT para a mesma
 * instância dentro dos últimos `LOGOUT_LOOP_WINDOW_MINUTES` minutos, o circuit-breaker considera
 * a instância "em loop" e bloqueia novas tentativas — o bloqueio se dissolve sozinho conforme os
 * eventos mais antigos saem da janela, sem precisar de um job de limpeza.
 */
import { Pool } from 'pg';
import { log } from '../logger';

export const LOGOUT_LOOP_THRESHOLD = 3;
export const LOGOUT_LOOP_WINDOW_MINUTES = 60;

export interface LogoutLoopStatus {
  emLoop: boolean;
  totalRecente: number;
  minutosRestantes: number; // 0 quando emLoop=false
}

/**
 * Registra um evento de LOGOUT/close real (chamado de `webhook.ts` a cada
 * `connection.update` com `state === 'close'`). Nunca lança — falha de gravação não deve
 * derrubar o processamento do webhook (mesmo padrão de tolerância a falha já usado em todo
 * `webhook.ts`/`handleStatusUpdate`).
 */
export async function registrarLogoutEvent(pool: Pool, instancia: string, statusReason: number | null): Promise<void> {
  await pool.query(
    `INSERT INTO whatsapp_logout_events (instancia, status_reason) VALUES ($1, $2)`,
    [instancia, statusReason]
  ).catch(err => log.warn('WHATSAPP_LOGOUT_LOOP', 'Falha ao registrar evento de LOGOUT', { instancia, err: err?.message }));
}

/**
 * Conta quantos LOGOUTs essa instância teve na janela recente — usada tanto pelo circuit-breaker
 * (`whatsapp.ts`, bloqueia nova tentativa) quanto pelo log de visibilidade (`webhook.ts`, alerta
 * no momento em que o padrão é detectado, não só quando alguém tenta reconectar de novo).
 */
export async function verificarLoopDeLogout(pool: Pool, instancia: string): Promise<LogoutLoopStatus> {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS total, MIN(created_at) AS mais_antigo
     FROM whatsapp_logout_events
     WHERE instancia = $1 AND created_at >= NOW() - (INTERVAL '1 minute' * $2)`,
    [instancia, LOGOUT_LOOP_WINDOW_MINUTES]
  );
  const total = r.rows[0]?.total ?? 0;
  const emLoop = total >= LOGOUT_LOOP_THRESHOLD;
  let minutosRestantes = 0;
  if (emLoop && r.rows[0]?.mais_antigo) {
    // [AUDITORIA] LÓGICA: o cooldown termina quando o evento MAIS ANTIGO dos que compõem o
    // gatilho sai da janela — é o próximo instante em que `total` cai abaixo do threshold
    // (assumindo que nenhum evento novo aconteça nesse meio-tempo).
    const maisAntigo = new Date(r.rows[0].mais_antigo).getTime();
    const saiDaJanelaEm = maisAntigo + LOGOUT_LOOP_WINDOW_MINUTES * 60_000;
    minutosRestantes = Math.max(1, Math.ceil((saiDaJanelaEm - Date.now()) / 60_000));
  }
  return { emLoop, totalRecente: total, minutosRestantes };
}

/**
 * [AUDITORIA] BUG GRAVE CORRIGIDO (achado no teste real desta sprint, em homolog — não só
 * teórico): `verificarLoopDeLogout()` sozinha só protege reconectar/forçar reinicialização de
 * uma instância JÁ CONHECIDA com nome fixo — cobre `force_reconnect` e "Reconectar" 100% (mesmo
 * nome sempre, confirmado com teste real: bloqueado corretamente). MAS quando `nova_conexao:true`
 * não acha nenhuma instância `open`/`connecting` pra reaproveitar (`instanciaReaproveitada` null
 * em `whatsapp.ts`), `proximaInstanciaLivre()` sempre minta um nome NUNCA VISTO (`_2`, `_3`...) —
 * um nome sem histórico de LOGOUT nenhum, então `verificarLoopDeLogout(pool, nomeNovo)` sempre
 * daria `emLoop:false`, mesmo que o tenant já tenha 6 nomes diferentes derrubados na última hora
 * (exatamente o padrão real dos 2 incidentes: Serenovlogs067 chegou a `_6`). Confirmado ao vivo
 * nesta sprint: `force_reconnect` bloqueou (429), mas `nova_conexao` sozinho, no mesmo cenário,
 * passou (200) minando `crm_435ee4720fc3` (nome novo, zero histórico próprio).
 *
 * [AUDITORIA] FIX APLICADO: soma os LOGOUTs recentes de TODAS as instâncias JÁ CONHECIDAS do
 * tenant (`conhecidas`, mesmo Set já usado por `proximaInstanciaLivre`) — só entra em jogo
 * especificamente no caminho de MINTAR nome novo (`whatsapp.ts`), nunca no de reconectar uma
 * instância específica já conhecida (essa continua usando `verificarLoopDeLogout` de propósito,
 * ver comentário acima). Continua "por tenant problemático", não "por tenant inteiro sempre" —
 * um tenant com 5 números saudáveis e 1 problemático continua reconectando os 5 normalmente
 * (nome já conhecido, sem LOGOUT recente, passa no outro check); só fica impedido de mintar mais
 * um nome novo enquanto o padrão de LOGOUT recente do que ele já tem persistir.
 */
export async function verificarLoopDeLogoutTenant(pool: Pool, instancias: string[]): Promise<LogoutLoopStatus> {
  if (instancias.length === 0) return { emLoop: false, totalRecente: 0, minutosRestantes: 0 };
  const r = await pool.query(
    `SELECT COUNT(*)::int AS total, MIN(created_at) AS mais_antigo
     FROM whatsapp_logout_events
     WHERE instancia = ANY($1) AND created_at >= NOW() - (INTERVAL '1 minute' * $2)`,
    [instancias, LOGOUT_LOOP_WINDOW_MINUTES]
  );
  const total = r.rows[0]?.total ?? 0;
  const emLoop = total >= LOGOUT_LOOP_THRESHOLD;
  let minutosRestantes = 0;
  if (emLoop && r.rows[0]?.mais_antigo) {
    const maisAntigo = new Date(r.rows[0].mais_antigo).getTime();
    const saiDaJanelaEm = maisAntigo + LOGOUT_LOOP_WINDOW_MINUTES * 60_000;
    minutosRestantes = Math.max(1, Math.ceil((saiDaJanelaEm - Date.now()) / 60_000));
  }
  return { emLoop, totalRecente: total, minutosRestantes };
}
