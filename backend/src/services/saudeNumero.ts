/**
 * saudeNumero.ts — saúde do NÚMERO de WhatsApp: fases de maturação, quarentena/ban, linha do
 * tempo de eventos e limite de disparo por fase+score (Etapa A do relatório "Maturador Global +
 * Saúde de Instâncias", 2026-10-05).
 *
 * [AUDITORIA] BUG (achado do relatório): o Score de Saúde dizia "80 — Saudável" para um número que
 * já tinha tomado 2 bans, e nada impedia um número no dia 1 de disparar em massa. Não existia
 * histórico de queda/ban, nem noção de "fase" do número.
 * [AUDITORIA] FIX APLICADO:
 *   - estado por número em `whatsapp_numeros` (fase, bans_total, ultimo_ban_em, perfil_completo)
 *     e linha do tempo em `whatsapp_eventos_saude`;
 *   - queda 401/402/403/406 NÃO planejada → `ban_suspeito` + quarentena imediata (pausa campanhas
 *     e pares do Maturador da instância); sem reconexão em 24h → ban confirmado (bans_total+1);
 *     reconectou → volta pra `perfil`;
 *   - fases avançam por sinais (`avaliarFases`, cron horário);
 *   - `limiteDisparo()` decide quanto a instância pode disparar hoje (fase × score), usado na
 *     criação da campanha (routes/disparos.ts) e no envio (disparoProcessor.ts).
 * Desconexão iniciada pelo próprio CRM (botão Desconectar, excluir instância, freio de
 * reconexão) é marcada com `marcarLogoutPlanejado()` e NÃO conta como ban.
 */
import { Pool } from 'pg';
import { log } from '../logger';

export type Fase = 'perfil' | 'aquecimento_1' | 'aquecimento_2' | 'aquecimento_3' | 'pre_oficial' | 'madura' | 'quarentena' | 'banida';

export const ROTULO_FASE: Record<Fase, string> = {
  perfil: 'Perfil',
  aquecimento_1: 'Aquecimento 1',
  aquecimento_2: 'Aquecimento 2',
  aquecimento_3: 'Aquecimento 3',
  pre_oficial: 'Pré-oficial',
  madura: 'Madura',
  quarentena: 'Quarentena',
  banida: 'Banida',
};

// Duração mínima (dias) de cada fase antes de poder avançar.
// Sprint 4 (2026-10-17): Aquecimento 2 e 3 passaram de 5 para 7 dias — total ~26 dias até "madura",
// alinhado ao "sinal verde" de 25–30 dias da Green-API (reports/Maturação WhatsApp e proxy 2026.md).
const DIAS_MINIMOS: Partial<Record<Fase, number>> = {
  perfil: 1, aquecimento_1: 4, aquecimento_2: 7, aquecimento_3: 7, pre_oficial: 7,
};
const PROXIMA: Partial<Record<Fase, Fase>> = {
  perfil: 'aquecimento_1', aquecimento_1: 'aquecimento_2', aquecimento_2: 'aquecimento_3',
  aquecimento_3: 'pre_oficial', pre_oficial: 'madura',
};
// Limite diário de disparo para contatos por fase (antes do ajuste por score).
const LIMITE_FASE: Record<Fase, number> = {
  perfil: 0, aquecimento_1: 0, aquecimento_2: 20, aquecimento_3: 50, pre_oficial: 100,
  madura: 200, quarentena: 0, banida: 0,
};
export const CODIGOS_BAN = [401, 402, 403, 406];
export const MAX_ENVIOS_HORA = 30;

export function normalizar(n: string | null | undefined): string {
  return String(n || '').split('@')[0].replace(/\D/g, '');
}

// ── Logout planejado (não é ban) ─────────────────────────────────────────────────────────────
const logoutsPlanejados = new Map<string, number>();
export function marcarLogoutPlanejado(instancia: string): void {
  logoutsPlanejados.set(instancia, Date.now());
}
function foiLogoutPlanejado(instancia: string): boolean {
  const em = logoutsPlanejados.get(instancia);
  return !!em && Date.now() - em < 5 * 60_000;
}

// ── Eventos e fase ───────────────────────────────────────────────────────────────────────────
// A Evolution entrega o mesmo connection.update duas vezes (mesmo milissegundo) — sem isto cada
// queda/conexão virava 2 eventos e o score descontava em dobro. Checagem síncrona em memória
// (o par chega junto, um SELECT antes do INSERT não pegaria).
const eventosRecentes = new Map<string, number>();
const JANELA_DUPLICADO_MS = 10_000;

export async function registrarEvento(
  pool: Pool, numero: string | null, instancia: string | null, tipo: string,
  statusReason: number | null = null, detalhe: Record<string, any> = {}
): Promise<boolean> {
  if (tipo !== 'mudanca_fase') {
    const chave = `${numero || ''}|${instancia || ''}|${tipo}|${statusReason ?? ''}`;
    const agora = Date.now();
    const ultimo = eventosRecentes.get(chave);
    if (ultimo && agora - ultimo < JANELA_DUPLICADO_MS) return false;
    eventosRecentes.set(chave, agora);
    if (eventosRecentes.size > 5000) {
      for (const [k, em] of eventosRecentes) if (agora - em >= JANELA_DUPLICADO_MS) eventosRecentes.delete(k);
    }
  }
  await pool.query(
    `INSERT INTO whatsapp_eventos_saude (numero, instancia, tipo, status_reason, detalhe) VALUES ($1, $2, $3, $4, $5)`,
    [numero || null, instancia || null, tipo, statusReason, JSON.stringify(detalhe)]
  ).catch(err => log.warn('SAUDE_NUMERO', 'Falha ao registrar evento', { tipo, instancia, err: err?.message }));
  return true;
}

export async function mudarFase(pool: Pool, numero: string, nova: Fase, motivo: string, instancia: string | null = null): Promise<void> {
  const r = await pool.query(
    `UPDATE whatsapp_numeros SET fase = $2, fase_desde = NOW() WHERE numero = $1 AND fase IS DISTINCT FROM $2 RETURNING numero`,
    [numero, nova]
  ).catch(() => ({ rowCount: 0 } as any));
  if (r.rowCount) {
    await registrarEvento(pool, numero, instancia, 'mudanca_fase', null, { fase: nova, motivo });
    invalidarCacheSaude();
    // Auditoria Sprint 9: a trava de envio (cache de 60s) passa a valer NA HORA — número que acabou
    // de cair em quarentena não pode mandar mais nada nem no minuto seguinte. Import dinâmico
    // porque maturadorGlobal importa este arquivo.
    void import('./maturadorGlobal').then(m => m.invalidarCacheBloqueio()).catch(() => {});
    log.info('SAUDE_NUMERO', 'Mudança de fase', { numero, fase: nova, motivo });
  }
}

async function numeroDaInstancia(pool: Pool, instancia: string): Promise<string> {
  const r = await pool.query(
    `SELECT numero_conectado FROM agentes WHERE evolution_instancia = $1 AND numero_conectado IS NOT NULL ORDER BY updated_at DESC LIMIT 1`,
    [instancia]
  ).catch(() => ({ rows: [] as any[] }));
  return normalizar(r.rows[0]?.numero_conectado);
}

/** Chamado depois que o número da instância foi registrado (`protecaoNumero.aoConectarInstancia`). */
export async function aoConectarSaude(pool: Pool, instancia: string, numero: string, perfilCompleto: boolean | null): Promise<void> {
  // Conexão repetida (mesmo webhook entregue 2x) não reprocessa — senão desfaria dois bans.
  if (!(await registrarEvento(pool, numero, instancia, 'conectou'))) return;
  // Sprint 8 (Sprint 3 / H10): reconectou → a "conta em revisão" acabou.
  await pool.query(`UPDATE whatsapp_numeros SET em_revisao_desde = NULL WHERE numero = $1 AND em_revisao_desde IS NOT NULL`, [numero]).catch(() => {});
  if (perfilCompleto !== null) {
    await pool.query(`UPDATE whatsapp_numeros SET perfil_completo = $2 WHERE numero = $1`, [numero, perfilCompleto]).catch(() => {});
  }
  const r = await pool.query(`SELECT fase FROM whatsapp_numeros WHERE numero = $1`, [numero]).catch(() => ({ rows: [] as any[] }));
  const fase: Fase | null = r.rows[0]?.fase ?? null;
  if (fase === 'banida') await desfazerUltimoBan(pool, numero, instancia);
  if (!fase) await mudarFase(pool, numero, 'perfil', 'número conectado pela primeira vez', instancia);
  else if (fase === 'quarentena' || fase === 'banida') {
    await mudarFase(pool, numero, 'perfil', 'reconectou depois de queda suspeita de ban — recomeça o aquecimento', instancia);
  }
}

/**
 * Número banido de verdade não volta a conectar. Se o "ban confirmado" (24h sem reconexão) voltou,
 * aquele ban foi falso — tira de bans_total, marca o evento como revertido e recalcula
 * ultimo_ban_em pelos bans que restaram. As quedas suspeitas continuam contando no score (7 dias).
 */
async function desfazerUltimoBan(pool: Pool, numero: string, instancia: string): Promise<void> {
  const ev = await pool.query(
    `UPDATE whatsapp_eventos_saude SET tipo = 'ban_revertido',
            detalhe = detalhe || jsonb_build_object('revertido_em', NOW(), 'motivo_reversao', 'número reconectou')
     WHERE id = (SELECT id FROM whatsapp_eventos_saude WHERE numero = $1 AND tipo = 'ban_confirmado'
                 ORDER BY criado_em DESC LIMIT 1)
     RETURNING id`,
    [numero]
  ).catch(() => ({ rowCount: 0 } as any));
  if (!ev.rowCount) return;
  await pool.query(
    `UPDATE whatsapp_numeros SET bans_total = GREATEST(bans_total - 1, 0),
            ultimo_ban_em = (SELECT MAX(criado_em) FROM whatsapp_eventos_saude WHERE numero = $1 AND tipo = 'ban_confirmado')
     WHERE numero = $1`,
    [numero]
  ).catch(() => {});
  await registrarEvento(pool, numero, instancia, 'ban_desfeito', null, { motivo: 'reconectou depois de ban confirmado' });
  log.warn('SAUDE_NUMERO', 'Ban desfeito — número banido reconectou', { numero, instancia });
}

/**
 * Chamado pelo webhook em `connection.update` = close. Queda 401/402/403/406 não planejada →
 * quarentena imediata: pausa campanhas e pares do Maturador desta instância. Nunca lança.
 */
export async function aoQuedaSaude(pool: Pool, instancia: string, statusReason: number | null): Promise<void> {
  try {
    const numero = await numeroDaInstancia(pool, instancia);
    const planejado = foiLogoutPlanejado(instancia);
    if (planejado) {
      await registrarEvento(pool, numero, instancia, 'logout', statusReason, { motivo: 'desconexão feita pelo CRM/usuário' });
      return;
    }
    if (statusReason === null || !CODIGOS_BAN.includes(statusReason)) {
      // 515 (restartRequired) é normal logo após parear — não é queda.
      if (statusReason !== 515) await registrarEvento(pool, numero, instancia, 'desconectou', statusReason);
      return;
    }

    await registrarEvento(pool, numero, instancia, 'ban_suspeito', statusReason);
    if (numero) await mudarFase(pool, numero, 'quarentena', `queda ${statusReason} não planejada`, instancia);

    // Pausa pares do Maturador que usam esta instância.
    await pool.query(
      `UPDATE maturador_pares mp SET ativo = false, pausado_motivo = $2, updated_at = NOW()
       FROM agentes a
       WHERE a.evolution_instancia = $1 AND (mp.agente_a_id = a.id OR mp.agente_b_id = a.id) AND mp.ativo = true`,
      [instancia, `Queda suspeita de ban (${statusReason}) — número em quarentena`]
    ).catch(() => {});

    // Pausa campanhas em andamento que usam esta instância.
    const camp = await pool.query(
      `UPDATE disparos d SET status = 'pausado', pausado_em = NOW(), pausado_motivo = 'ban_suspeito', updated_at = NOW(),
              aviso = $2
       FROM agentes a
       WHERE a.evolution_instancia = $1 AND a.id = ANY(d.instancias_ids) AND d.status IN ('em_andamento','agendado')
       RETURNING d.id`,
      [instancia, `Pausada automaticamente: a instância ${instancia} caiu com código ${statusReason} (possível ban/restrição). Verifique o número antes de retomar.`]
    ).catch(() => ({ rows: [] as any[] }));
    invalidarCacheSaude();
    log.error('SAUDE_NUMERO', 'Queda suspeita de ban — quarentena aplicada', {
      instancia, numero, statusReason, campanhasPausadas: camp.rows.length,
    });
  } catch (err: any) {
    log.warn('SAUDE_NUMERO', 'Falha ao tratar queda', { instancia, err: err?.message });
  }
}

// ── Métricas por instância (janela de 7 dias) ────────────────────────────────────────────────
interface Metricas7d {
  enviados: number;
  respondidos: number;
  optouts: number;
  falhas: number;
  quedasBan: number;
  quedasComuns: number;
}

export async function metricas7d(pool: Pool, instancia: string, numero: string): Promise<Metricas7d> {
  const [env, fal, ev] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS enviados,
              COUNT(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM contato_respostas r WHERE r.user_id = dl.user_id AND r.contato_id = dl.contato_id
                  AND r.categoria <> 'auto_resposta'
                  AND r.respondido_em > dl.enviado_at AND r.respondido_em < dl.enviado_at + INTERVAL '72 hours'))::int AS respondidos,
              COUNT(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM contato_respostas r WHERE r.user_id = dl.user_id AND r.contato_id = dl.contato_id AND r.categoria = 'opt_out'
                  AND r.respondido_em > dl.enviado_at AND r.respondido_em < dl.enviado_at + INTERVAL '72 hours'))::int AS optouts
       FROM disparo_logs dl
       WHERE dl.instancia = $1 AND dl.status = 'sent' AND dl.enviado_at >= NOW() - INTERVAL '7 days'`,
      [instancia]
    ),
    // Falha de ENVIO de verdade — ignora pulos por regra (opt-out, higienização, trava de saúde).
    // Sprint 4 / H4: instância caída e número inválido não são sinal de risco do número (o
    // primeiro é infraestrutura, o segundo é lista ruim) — só restrição/erro desconhecido contam.
    pool.query(
      `SELECT COUNT(*)::int AS falhas FROM disparo_logs
       WHERE instancia = $1 AND status = 'failed' AND created_at >= NOW() - INTERVAL '7 days'
         AND COALESCE(tipo_falha, 'erro_desconhecido') IN ('restricao', 'erro_desconhecido')
         AND COALESCE(erro, '') NOT ILIKE '%connection closed%'
         AND COALESCE(erro, '') NOT LIKE 'cancelado_pelo_cliente%'
         AND COALESCE(erro, '') NOT LIKE 'excluido_higienizacao%'
         AND COALESCE(erro, '') NOT LIKE 'bloqueado_saude%'`,
      [instancia]
    ),
    // Por segundo distinto: eventos gravados em dobro antes da deduplicação contam uma vez só.
    pool.query(
      `SELECT COUNT(DISTINCT date_trunc('second', criado_em)) FILTER (WHERE tipo = 'ban_suspeito')::int AS ban,
              COUNT(DISTINCT date_trunc('second', criado_em)) FILTER (WHERE tipo = 'desconectou')::int AS comum
       FROM whatsapp_eventos_saude
       -- Pelo NÚMERO quando conhecido: o nome da instância pode ter pertencido a outro chip antes.
       WHERE (CASE WHEN $1 <> '' THEN numero = $1 ELSE instancia = $2 END)
         AND criado_em >= NOW() - INTERVAL '7 days'`,
      [numero, instancia]
    ),
  ]);
  return {
    enviados: env.rows[0]?.enviados ?? 0,
    respondidos: env.rows[0]?.respondidos ?? 0,
    optouts: env.rows[0]?.optouts ?? 0,
    falhas: fal.rows[0]?.falhas ?? 0,
    quedasBan: ev.rows[0]?.ban ?? 0,
    quedasComuns: ev.rows[0]?.comum ?? 0,
  };
}

// ── Score (0–100) ────────────────────────────────────────────────────────────────────────────
export interface ItemScore { fator: string; pontos: number; info: string }
export interface ScoreSaude { total: number; itens: ItemScore[]; rotulo: string }

// Faixas alinhadas ao bloqueio de disparo (< 45) — 2026-10-17.
export function rotuloScore(total: number): string {
  if (total >= 85) return 'Saudável';
  if (total >= 65) return 'Atenção';
  if (total >= SCORE_MINIMO_DISPARO) return 'Risco';
  return 'Crítico';
}

/** Teto do score enquanto o número só recebe: não pode aparecer "Saudável" sem ter provado nada. */
export const TETO_SCORE_AQUECIMENTO = 60;
const FASES_COM_TETO = new Set(['perfil', 'aquecimento_1', 'quarentena']);

/**
 * Score da instância a partir do número conectado. Começa em 100 e desconta cada sinal de risco;
 * `itens` explica cada desconto (tooltip na tela).
 */
export async function calcularScoreSaude(pool: Pool, instancia: string, numeroBruto: string | null): Promise<ScoreSaude> {
  const numero = normalizar(numeroBruto);
  const itens: ItemScore[] = [];
  const add = (fator: string, pontos: number, info: string) => { if (pontos) itens.push({ fator, pontos, info }); };

  const nr = numero
    ? (await pool.query(`SELECT * FROM whatsapp_numeros WHERE numero = $1`, [numero]).catch(() => ({ rows: [] as any[] }))).rows[0]
    : null;
  const bans = nr?.bans_total ?? 0;
  if (bans >= 1) add('Histórico de ban', -35, `${bans} ban(s) registrado(s) neste número`);
  if (bans >= 2) add('Bans repetidos', -25, 'Número com 2 ou mais bans');
  if (nr?.ultimo_ban_em && Date.now() - new Date(nr.ultimo_ban_em).getTime() < 30 * 86_400_000) {
    add('Ban recente', -20, `Último ban em ${new Date(nr.ultimo_ban_em).toLocaleDateString('pt-BR')}`);
  }

  const m = await metricas7d(pool, instancia, numero);
  add('Quedas suspeitas (7d)', -Math.min(20, m.quedasBan * 10), `${m.quedasBan} queda(s) 401/402/403/406`);
  add('Quedas de conexão (7d)', -Math.min(15, m.quedasComuns * 3), `${m.quedasComuns} queda(s) comum(ns)`);
  // Sprint 8 (Sprint 4 / H7): limite de requisições (429) nas últimas 24h, -5 cada, até -15.
  const limites = (await pool.query(
    `SELECT COUNT(DISTINCT date_trunc('second', criado_em))::int AS n FROM whatsapp_eventos_saude
     WHERE (CASE WHEN $1 <> '' THEN numero = $1 ELSE instancia = $2 END)
       AND tipo = 'rate_limit' AND criado_em >= NOW() - INTERVAL '24 hours'`,
    [numero, instancia]
  ).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n;
  add('Limite de requisições (24h)', -Math.min(15, limites * 5), `${limites} vez(es) o WhatsApp limitou as consultas desta instância`);

  if (nr?.primeira_conexao_em) {
    const dias = (Date.now() - new Date(nr.primeira_conexao_em).getTime()) / 86_400_000;
    if (dias < 7) add('Número novo', -20, `Conectado há ${Math.floor(dias)} dia(s)`);
    else if (dias < 21) add('Número recente', -10, `Conectado há ${Math.floor(dias)} dias`);
  }

  if (m.enviados > 0) {
    const taxaOpt = (m.optouts / m.enviados) * 100;
    if (taxaOpt > 1) add('Opt-out/bloqueio (7d)', -Math.round((taxaOpt - 1) * 5), `${taxaOpt.toFixed(1)}% de opt-out nos disparos`);
  }
  // Taxa de resposta só pesa com volume mínimo — poucos envios dão uma taxa sem significado.
  if (m.enviados >= 20) {
    const taxaResp = (m.respondidos / m.enviados) * 100;
    if (taxaResp < 15) add('Resposta baixa (7d)', -15, `${taxaResp.toFixed(0)}% de resposta nos disparos`);
    else if (taxaResp < 30) add('Resposta baixa (7d)', -8, `${taxaResp.toFixed(0)}% de resposta nos disparos`);
  }
  const tentativas = m.enviados + m.falhas;
  if (tentativas > 0 && m.falhas / tentativas > 0.05) {
    add('Falhas de envio (7d)', -10, `${((m.falhas / tentativas) * 100).toFixed(0)}% de falha`);
  }
  // 2026-10-17: queda 401/402/403/406 até 2 min depois de um disparo sair dessa instância é o sinal
  // mais forte que existe de que o WhatsApp não aceitou o envio a frio (os 2 números novos da conta
  // caíram 1–2 s após disparar). -30 cada, até -45, janela de 14 dias.
  const quedaPosDisparo = (await pool.query(
    `SELECT COUNT(DISTINCT date_trunc('second', e.criado_em))::int AS n FROM whatsapp_eventos_saude e
     WHERE (CASE WHEN $1 <> '' THEN e.numero = $1 ELSE e.instancia = $2 END)
       AND e.tipo = 'ban_suspeito' AND e.criado_em >= NOW() - INTERVAL '14 days'
       AND EXISTS (SELECT 1 FROM disparo_logs dl WHERE dl.instancia = e.instancia AND dl.status = 'sent'
                     AND dl.enviado_at BETWEEN e.criado_em - INTERVAL '2 minutes' AND e.criado_em)`,
    [numero, instancia]
  ).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n;
  add('Queda logo após disparar (14d)', -Math.min(45, quedaPosDisparo * 30), `${quedaPosDisparo} vez(es) o número caiu até 2 min depois de enviar campanha`);

  if (nr?.perfil_completo) add('Perfil completo', 5, 'Nome e foto configurados');

  let total = Math.max(0, Math.min(100, 100 + itens.reduce((s, i) => s + i.pontos, 0)));
  if (nr?.fase && FASES_COM_TETO.has(nr.fase) && total > TETO_SCORE_AQUECIMENTO) {
    add('Teto do aquecimento', TETO_SCORE_AQUECIMENTO - total, `Número em ${ROTULO_FASE[nr.fase as Fase] ?? nr.fase}: score máximo ${TETO_SCORE_AQUECIMENTO} até completar o aquecimento`);
    total = TETO_SCORE_AQUECIMENTO;
  }
  return { total, itens, rotulo: rotuloScore(total) };
}

// ── Limite de disparo (fase × score) ─────────────────────────────────────────────────────────
export interface LimiteDisparo {
  limite: number;
  somenteConhecidos: boolean;
  motivo: string | null;
  liberaEm: string | null;
}

// Decisão do usuário (2026-10-15): disparo só bloqueia por SCORE (< 45). A fase de aquecimento e as
// faixas Risco/Atenção deixaram de restringir — o volume fica com o limite da campanha/conta e o
// teto de 30/h. Quarentena/banida continuam travando (número acabou de cair / não conecta).
export const SCORE_MINIMO_DISPARO = 45;

// 2026-10-17 (decisão do usuário): número que "só recebe" (proteção de número novo, Perfil,
// Aquecimento 1, 21 dias após ban — `maturadorGlobal.motivoSoRecebe`) volta a NÃO disparar. Achado:
// os 2 números novos da conta caíram com 401 1–2 s depois de disparar a frio (um com 1 mensagem).
// Sprint 4 (2026-10-17): rampa de disparo pela fase — frio só a partir do Pré-oficial (~dia 19) e
// volume cheio na Madura (~dia 26). Aquecimento 2/3 disparam só para quem já conversou com o número.
// E o freio de "sem resposta": desde out/2025 o WhatsApp testa um teto mensal de mensagens para não
// contatos que não respondem (valor não divulgado); passou de LIMITE_SEM_RESPOSTA_30D envios de
// campanha sem resposta em 30 dias, o número volta a disparar só para conhecidos.
export const LIMITE_SEM_RESPOSTA_30D = 100;

export function limiteDisparo(
  fase: Fase | null, _faseDesde: string | Date | null, score: number | null, soRecebe: string | null = null,
  semResposta30d = 0,
): LimiteDisparo {
  const f: Fase = fase ?? 'madura';
  if (f === 'quarentena') return { limite: 0, somenteConhecidos: false, motivo: 'Número em quarentena após queda suspeita de ban.', liberaEm: null };
  if (f === 'banida') return { limite: 0, somenteConhecidos: false, motivo: 'Número banido.', liberaEm: null };
  if (soRecebe) return { limite: 0, somenteConhecidos: false, motivo: `Número só recebe por enquanto (${soRecebe}): sem disparo até completar o aquecimento sem queda.`, liberaEm: null };
  if (score !== null && score < SCORE_MINIMO_DISPARO) {
    return { limite: 0, somenteConhecidos: false, motivo: `Score ${score}: disparo bloqueado (mínimo ${SCORE_MINIMO_DISPARO}).`, liberaEm: null };
  }
  const limite = LIMITE_FASE[f] || LIMITE_FASE.madura;
  if (f === 'aquecimento_2' || f === 'aquecimento_3') {
    return { limite, somenteConhecidos: true, motivo: `${ROTULO_FASE[f]}: até ${limite}/dia, só para contatos que já conversaram com o número (disparo frio só a partir do Pré-oficial).`, liberaEm: null };
  }
  if (semResposta30d >= LIMITE_SEM_RESPOSTA_30D) {
    return { limite, somenteConhecidos: true, motivo: `${semResposta30d} mensagens de campanha sem resposta em 30 dias: o WhatsApp limita quem escreve para quem não responde — por enquanto, só contatos que já conversaram.`, liberaEm: null };
  }
  return { limite, somenteConhecidos: false, motivo: null, liberaEm: null };
}

// ── Estado de saúde por instância (tela, criação de campanha e processador) ──────────────────
export interface SaudeInstancia {
  agente_id: string;
  user_id: string;
  instancia: string;
  numero: string | null;
  fase: Fase | null;
  fase_rotulo: string;
  fase_desde: string | null;
  bans_total: number;
  ultimo_ban_em: string | null;
  apto_api_oficial: boolean;
  em_revisao_desde: string | null;
  score: number | null;
  score_rotulo: string | null;
  enviados_hoje: number;
  envios_ultima_hora: number;
  sem_resposta_30d: number;
  limite: LimiteDisparo;
}

let cacheSaude: { em: number; porInstancia: Map<string, SaudeInstancia> } | null = null;
export function invalidarCacheSaude(): void { cacheSaude = null; }

async function carregarSaude(pool: Pool, where: string, params: any[]): Promise<SaudeInstancia[]> {
  const r = await pool.query(
    `SELECT a.id AS agente_id, a.user_id, a.evolution_instancia AS instancia, a.numero_conectado,
            a.whatsapp_score, a.score_updated_at,
            w.fase, w.fase_desde, w.bans_total, w.ultimo_ban_em, w.apto_api_oficial, w.em_revisao_desde,
            w.protecao_ate, w.protecao_liberada_em, w.primeira_conexao_em, (w.numero IS NOT NULL) AS tem_registro,
            (SELECT COUNT(*)::int FROM disparo_logs dl WHERE dl.instancia = a.evolution_instancia AND dl.status = 'sent'
               AND dl.enviado_at >= NOW() - INTERVAL '24 hours') AS enviados_hoje,
            (SELECT COUNT(*)::int FROM disparo_logs dl WHERE dl.instancia = a.evolution_instancia AND dl.status = 'sent'
               AND dl.enviado_at >= NOW() - INTERVAL '1 hour')
            + (SELECT COUNT(*)::int FROM maturador_mensagens mm WHERE mm.de_agente_id = a.id AND mm.tipo = 'texto'
               AND mm.created_at >= NOW() - INTERVAL '1 hour') AS envios_ultima_hora,
            -- Sprint 4: envios de campanha nos últimos 30 dias que o contato nunca respondeu.
            (SELECT COUNT(*)::int FROM disparo_logs dl WHERE dl.instancia = a.evolution_instancia AND dl.status = 'sent'
               AND dl.enviado_at >= NOW() - INTERVAL '30 days' AND dl.contato_id IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM contato_respostas r WHERE r.user_id = dl.user_id AND r.contato_id = dl.contato_id
                                 AND r.categoria <> 'auto_resposta' AND r.respondido_em > dl.enviado_at)) AS sem_resposta_30d
     FROM agentes a
     LEFT JOIN whatsapp_numeros w ON w.numero = regexp_replace(a.numero_conectado, '\\D', '', 'g')
     WHERE a.evolution_instancia IS NOT NULL ${where}`,
    params
  );
  // Import dinâmico: maturadorGlobal importa este arquivo (ciclo).
  const { motivoSoRecebe } = await import('./maturadorGlobal');
  return r.rows.map((x: any) => {
    const score = x.score_updated_at ? x.whatsapp_score : null;
    const soRecebe = x.tem_registro ? motivoSoRecebe(x) : null;
    return {
      agente_id: x.agente_id,
      user_id: x.user_id,
      instancia: x.instancia,
      numero: x.numero_conectado ? normalizar(x.numero_conectado) : null,
      fase: x.fase ?? null,
      fase_rotulo: x.fase ? ROTULO_FASE[x.fase as Fase] : 'Sem registro',
      fase_desde: x.fase_desde,
      bans_total: x.bans_total ?? 0,
      ultimo_ban_em: x.ultimo_ban_em,
      apto_api_oficial: !!x.apto_api_oficial,
      em_revisao_desde: x.em_revisao_desde ?? null,
      score,
      score_rotulo: score === null ? null : rotuloScore(score),
      enviados_hoje: x.enviados_hoje,
      envios_ultima_hora: x.envios_ultima_hora,
      sem_resposta_30d: x.sem_resposta_30d ?? 0,
      limite: limiteDisparo(x.fase ?? null, x.fase_desde, score, soRecebe, x.sem_resposta_30d ?? 0),
    };
  });
}

/** Saúde das instâncias de um usuário (tela e validação da campanha). */
export async function saudeDoUsuario(pool: Pool, userId: string): Promise<SaudeInstancia[]> {
  return carregarSaude(pool, 'AND a.user_id = $1', [userId]);
}

/** Saúde por nome de instância, com cache de 30s (processador de disparo roda a cada 2s). */
export async function saudePorInstancia(pool: Pool): Promise<Map<string, SaudeInstancia>> {
  if (cacheSaude && Date.now() - cacheSaude.em < 30_000) return cacheSaude.porInstancia;
  const lista = await carregarSaude(pool, '', []);
  const porInstancia = new Map(lista.map(s => [s.instancia, s]));
  cacheSaude = { em: Date.now(), porInstancia };
  return porInstancia;
}

/** O contato já mandou mensagem para esta instância alguma vez? (regra "só conhecidos") */
export async function contatoJaConversou(pool: Pool, instancia: string, telefone: string): Promise<boolean> {
  const t = normalizar(telefone);
  if (t.length < 8) return false;
  const r = await pool.query(
    `SELECT 1 FROM whatsapp_messages
     WHERE instance_name = $1 AND from_me = false AND remote_jid LIKE $2 LIMIT 1`,
    [instancia, `%${t.slice(-8)}@s.whatsapp.net`]
  ).catch(() => ({ rows: [] as any[] }));
  return r.rows.length > 0;
}

// ── Avaliação periódica das fases (cron horário) ─────────────────────────────────────────────
export async function avaliarFases(pool: Pool): Promise<{ avancos: number; bansConfirmados: number }> {
  let avancos = 0;
  let bansConfirmados = 0;

  // 1) Quarentena sem reconexão há 24h → ban confirmado. Sprint 8 (Sprint 3 / H10): conta que o
  // cliente confirmou estar "em revisão" pelo WhatsApp não vira ban (nem conta em bans_total)
  // enquanto a revisão durar — até 30 dias; depois disso, sem reconexão, vira ban.
  const quarentena = await pool.query(
    `SELECT w.numero, w.fase_desde FROM whatsapp_numeros w
     WHERE w.fase = 'quarentena' AND w.fase_desde <= NOW() - INTERVAL '24 hours'
       AND (w.em_revisao_desde IS NULL OR w.em_revisao_desde < NOW() - INTERVAL '30 days')`
  ).catch(() => ({ rows: [] as any[] }));
  for (const q of quarentena.rows) {
    await pool.query(
      `UPDATE whatsapp_numeros SET bans_total = bans_total + 1, ultimo_ban_em = $2 WHERE numero = $1`,
      [q.numero, q.fase_desde]
    ).catch(() => {});
    await registrarEvento(pool, q.numero, null, 'ban_confirmado', null, { motivo: 'sem reconexão 24h após queda suspeita' });
    await mudarFase(pool, q.numero, 'banida', 'não reconectou em 24h após queda suspeita de ban');
    bansConfirmados++;
  }

  // 2) Fases de aquecimento → próxima, se cumpriu o tempo mínimo e os sinais estão limpos.
  const candidatos = await pool.query(
    `SELECT w.*, a.evolution_instancia AS instancia
     FROM whatsapp_numeros w
     JOIN LATERAL (SELECT evolution_instancia FROM agentes
                   WHERE regexp_replace(numero_conectado, '\\D', '', 'g') = w.numero AND evolution_instancia IS NOT NULL
                   ORDER BY updated_at DESC LIMIT 1) a ON true
     WHERE w.fase IN ('perfil','aquecimento_1','aquecimento_2','aquecimento_3','pre_oficial')`
  ).catch(() => ({ rows: [] as any[] }));

  for (const n of candidatos.rows) {
    const fase = n.fase as Fase;
    const diasNaFase = (Date.now() - new Date(n.fase_desde).getTime()) / 86_400_000;
    if (diasNaFase < (DIAS_MINIMOS[fase] ?? 0)) continue;

    const ev = await pool.query(
      `SELECT COUNT(DISTINCT date_trunc('second', criado_em)) FILTER (WHERE tipo = 'ban_suspeito')::int AS ban,
              COUNT(DISTINCT date_trunc('second', criado_em)) FILTER (WHERE tipo = 'desconectou')::int AS comum
       FROM whatsapp_eventos_saude WHERE numero = $1 AND criado_em >= $2`,
      [n.numero, n.fase_desde]
    ).catch(() => ({ rows: [{ ban: 1, comum: 0 }] }));
    const { ban, comum } = ev.rows[0];
    if (ban > 0) continue;

    let ok = true;
    let motivo = '';
    if (fase === 'perfil') {
      ok = comum === 0;
      motivo = '24h conectado sem queda';
    } else if (fase === 'aquecimento_1') {
      ok = comum <= 2;
      motivo = '4 dias sem queda suspeita';
    } else if (fase === 'aquecimento_2' || fase === 'aquecimento_3') {
      const m = await metricas7d(pool, n.instancia, n.numero);
      if (fase === 'aquecimento_2') {
        ok = m.optouts === 0;
        motivo = 'sem queda e sem opt-out';
      } else {
        const taxaResp = m.enviados ? m.respondidos / m.enviados : 1;
        const taxaOpt = m.enviados ? m.optouts / m.enviados : 0;
        ok = (m.enviados < 20 || taxaResp >= 0.3) && taxaOpt < 0.02;
        motivo = 'resposta ≥ 30% e opt-out < 2%';
      }
    } else if (fase === 'pre_oficial') {
      motivo = '7 dias em pré-oficial sem queda';
    }
    if (!ok) continue;

    let proxima = PROXIMA[fase]!;
    // Número com 2+ bans não chega a pré-oficial (não recomendado para API oficial).
    if (proxima === 'pre_oficial' && (n.bans_total ?? 0) >= 2) proxima = 'madura';
    await mudarFase(pool, n.numero, proxima, motivo, n.instancia);
    avancos++;
  }

  // 3) Aptidão para API oficial: saiu daqui na Sprint 7 (2026-10-06) — o checklist completo, com
  // resposta/opt-out e as confirmações manuais, roda em `recalcularAptidaoOficial`
  // (services/checklistOficial.ts), chamado pelo cron logo depois desta função.

  if (avancos || bansConfirmados) invalidarCacheSaude();
  return { avancos, bansConfirmados };
}
