import { Pool } from 'pg';
import { humanizarMensagem } from './humanizationService';
import { registrarUsoIA, estimarCustoUsd } from '../utils/aiCusto';
import { botSentTexts, botMessageIds, BOT_ECHO_TTL_MS } from './agentEngine';
import { evolutionFetch, sanitizeEvolutionUrl, withAiFallback } from '../utils/resilientFetch';
import { garantirMidiaEstavel, gerarVariacaoImagem } from '../utils/whatsappMediaStorage';
import { withTenantContext } from '../db';
import { log } from '../logger';

// [AUDITORIA] BUG GRAVÍSSIMO CORRIGIDO (achado real do usuário, 2026-09-11 — conta
// cotinedeborah@gmail.com com 2 campanhas em 0/2661 enviados, 0% por mais de 1h; usuário: "cada
// usuario deve ter sua propria fila problema gravissimo"): a versão antiga deste arquivo buscava
// UM lote global de 5 mensagens (`get_next_disparo_batch(5)`, sem filtro por conta/campanha) e
// processava CADA mensagem do lote em SEQUÊNCIA, com `await sleep(delayMs)` — o delay antiban
// configurado POR CAMPANHA — entre uma mensagem e a PRÓXIMA DO LOTE, mesmo que a próxima fosse de
// uma campanha (ou conta) completamente diferente. Uma única campanha com delay customizado alto
// (achado ao vivo: 7,5-15 min, "Comercial" da conta mentoark@gmail.com) monopolizava o motor
// inteiro — nenhuma mensagem de NENHUMA outra conta saía enquanto essa campanha estivesse "dormindo"
// entre mensagens, porque o loop inteiro (e a flag `disparosRunning`, index.ts) ficava preso num
// único `await sleep()` de até 15 minutos, repetido a cada mensagem do lote. Resultado real
// observado: a campanha "campanha atendimento" da cotinedeborah ficou 100% parada (2661/2661
// `disparo_logs` ainda 'pending', nenhuma tentativa sequer) só porque outra campanha, de outra
// conta, tinha entrado na fila global antes dela.
//
// [AUDITORIA] FIX APLICADO: delay antiban vira um ESTADO POR CAMPANHA (`proximoEnvioPermitidoPor
// Campanha`, abaixo) em vez de um `sleep()` bloqueante compartilhado — cada tick busca um lote
// maior, agrupa por campanha, processa NO MÁXIMO 1 mensagem por campanha por tick, e todas as
// campanhas elegíveis do tick rodam CONCORRENTEMENTE (`Promise.allSettled`, dentro de
// `processarDisparos`). Uma campanha com delay de 15 min só atrasa ELA MESMA — outras campanhas
// (mesma conta ou conta diferente) continuam avançando no próprio ritmo, a cada tick de 2s.
// Circuit breaker de erros consecutivos (`errosConsecutivosPorCampanha`) também vira por-campanha
// e persistente entre ticks (antes resetava a cada novo lote, então só detectava erro consecutivo
// DENTRO de um único lote de 5 — bug menor na mesma família, corrigido de graça aqui).
const proximoEnvioPermitidoPorCampanha = new Map<string, number>(); // disparo_id -> epoch ms
const errosConsecutivosPorCampanha = new Map<string, number>(); // disparo_id -> contagem

// Cache flag humanizar_ia por disparo_id (evita query por mensagem)
const humanizarCache = new Map<string, boolean>();

async function deveHumanizar(pool: Pool, disparoId: string): Promise<boolean> {
  if (humanizarCache.has(disparoId)) return humanizarCache.get(disparoId)!;
  const r = await pool.query(
    `SELECT COALESCE(humanizar_ia, false) AS h FROM disparos WHERE id = $1`,
    [disparoId]
  ).catch(() => ({ rows: [] as any[] }));
  const flag = r.rows[0]?.h === true;
  humanizarCache.set(disparoId, flag);
  return flag;
}

// Cache cooldown_horas por disparo_id (evita query por mensagem) — mesmo padrão de humanizarCache.
const cooldownHorasCache = new Map<string, number>();

async function obterCooldownHoras(pool: Pool, disparoId: string): Promise<number> {
  if (cooldownHorasCache.has(disparoId)) return cooldownHorasCache.get(disparoId)!;
  const r = await pool.query(
    `SELECT COALESCE(cooldown_horas, 24) AS h FROM disparos WHERE id = $1`,
    [disparoId]
  ).catch(() => ({ rows: [] as any[] }));
  // [AUDITORIA] BUG (achado na Sprint Intervalo em Minutos, 2026-07-31, testando o intervalo
  // customizado): `Number(h) || 24` trata `cooldown_horas=0` (valor legítimo, significa "sem
  // cooldown pra esta campanha") como se fosse ausente — `0 || 24` avalia pra `24` em JS (zero é
  // falsy). Confirmado ao vivo: campanha com `cooldown_horas=0` teve a 2ª/3ª mensagem bloqueadas
  // pela camada defensiva com `cooldownHoras:24` no log, mesmo tendo sido criada com 0 explícito.
  // [AUDITORIA] FIX APLICADO: só cai no default quando a linha realmente não veio (`disparo_id`
  // não encontrado) — `0` é um valor válido e é respeitado.
  const horas = r.rows.length ? Number(r.rows[0].h) : 24;
  cooldownHorasCache.set(disparoId, horas);
  return horas;
}

// [AUDITORIA] BUG (Sprint Disparos/Multi-instância, 2026-07-25): `disparos.instancias_ids` é
// preenchido pela tela (StepAntiBan) mas nunca era lido aqui — a resolução de config abaixo
// sempre pegava UMA linha arbitrária de `integracoes_config`/`agentes` (sem ORDER BY
// determinístico por instância selecionada), então marcar 1 ou 5 instâncias na tela dava o
// mesmo resultado: tudo saindo por um único número. Isso anulava o propósito anti-ban da tela
// (distribuir volume entre chips). [AUDITORIA] FIX APLICADO: cache por campanha (mesmo padrão
// de `humanizarCache`/`urlMidiaEstavelPorCampanha`) resolve `instancias_ids` -> linhas de
// `agentes` uma vez. A partir de 2026-07-29, o round-robin em si roda sobre
// `instanciasDisponiveisHojeCache`/`proximaInstanciaDisponivel` (abaixo) em vez de rodar direto
// sobre esta lista — a lista aqui é só "quais instâncias a campanha pode usar", filtrada de novo
// pelo teto diário por instância antes de rotacionar. Campanhas sem `instancias_ids` (vazias, ou
// criadas antes deste fix) caem no fallback original (`integracoes_config` -> `agentes` ativo ->
// defaults de env, ver `resolverInstanciaFallback`), sem quebrar nada existente.
interface InstanciaElegivel {
  url: string;
  api_key: string;
  instancia: string;
}
const instanciasCampanhaCache = new Map<string, { instancias: InstanciaElegivel[] }>();

async function resolverInstanciasCampanha(pool: Pool, disparoId: string, userId: string): Promise<InstanciaElegivel[]> {
  const cache = instanciasCampanhaCache.get(disparoId);
  if (cache) return cache.instancias;

  const disparoRes = await pool.query(
    `SELECT instancias_ids FROM disparos WHERE id = $1`,
    [disparoId]
  ).catch(() => ({ rows: [] as any[] }));
  const ids: string[] = disparoRes.rows[0]?.instancias_ids || [];

  let instancias: InstanciaElegivel[] = [];
  if (ids.length) {
    const agentesRes = await pool.query(
      `SELECT evolution_server_url AS url, evolution_api_key AS api_key, evolution_instancia AS instancia
       FROM agentes WHERE id = ANY($1::uuid[]) AND user_id = $2 AND evolution_instancia IS NOT NULL`,
      [ids, userId]
    ).catch(() => ({ rows: [] as any[] }));
    instancias = agentesRes.rows.filter((r: any) => r.url && r.instancia);
  }

  instanciasCampanhaCache.set(disparoId, { instancias });
  return instancias;
}

// [AUDITORIA] LÓGICA (2026-07-29): mesmo fallback que antes vivia inline na resolução de
// `config` (integracoes_config -> agentes ativo) — extraído pra função porque agora é usado em
// dois pontos: no bloco de transição de campanha (checagem de teto diário POR instância, que
// precisa saber o nome da instância candidata ANTES de decidir se pode enviar por ela) e na
// resolução final de `config`, pra campanhas sem `instancias_ids` selecionado na tela.
async function resolverInstanciaFallback(pool: Pool, userId: string): Promise<InstanciaElegivel | null> {
  const integracaoRes = await pool.query(
    `SELECT url, api_key, instancia FROM integracoes_config
     WHERE user_id = $1 AND tipo = 'evolution' AND status IN ('ativo','conectado')
     LIMIT 1`,
    [userId]
  ).catch(() => ({ rows: [] as any[] }));
  if (integracaoRes.rows.length) return integracaoRes.rows[0];

  const agenteRes = await pool.query(
    `SELECT evolution_server_url AS url, evolution_api_key AS api_key, evolution_instancia AS instancia
     FROM agentes
     WHERE user_id = $1 AND ativo = true
     ORDER BY updated_at DESC LIMIT 1`,
    [userId]
  ).catch(() => ({ rows: [] as any[] }));
  if (agenteRes.rows.length && agenteRes.rows[0].url) return agenteRes.rows[0];

  return null;
}

// [AUDITORIA] FIX APLICADO (2026-07-29 — teto diário passa a ser POR INSTÂNCIA, não mais por
// conta inteira): antes, o teto diário somava TODAS as mensagens enviadas pelo `user_id`, não
// importa qual número Evolution as mandou — uma campanha multi-instância (round-robin entre
// vários chips, ver `resolverInstanciasCampanha` acima) esgotava o mesmo teto mesmo tendo vários
// números saudáveis disponíveis, e o inverso também era possível: um chip sobrecarregado não
// pausava sozinho se outros chips da mesma conta ainda estivessem com folga. Esta cache guarda,
// por campanha, quais das instâncias candidatas (seleção manual da tela, ou o único fallback
// pra campanhas sem seleção) ainda estão ABAIXO do teto diário — recalculada a cada transição de
// campanha dentro do lote (ver bloco abaixo), mesma cadência que o teto antigo já usava.
// Round-robin passa a rodar só sobre essa lista já filtrada, substituindo
// `proximaInstanciaRoundRobin` (removida — nenhum caller restante).
const instanciasDisponiveisHojeCache = new Map<string, { disponiveis: InstanciaElegivel[]; proximoIndex: number }>();

function proximaInstanciaDisponivel(disparoId: string): InstanciaElegivel | null {
  const cache = instanciasDisponiveisHojeCache.get(disparoId);
  if (!cache || !cache.disponiveis.length) return null;
  const escolhida = cache.disponiveis[cache.proximoIndex % cache.disponiveis.length];
  cache.proximoIndex++;
  return escolhida;
}

// [AUDITORIA] LÓGICA: get_next_disparo_batch marca as linhas como 'sending' atomicamente ao
// dequeueá-las. Se o motor abortar o lote (pausa de horário/fim de semana ou limite de erros
// consecutivos) sem processar todas as linhas já dequeueadas, elas ficariam presas em 'sending'
// para sempre — get_next_disparo_batch só busca 'pending'. Esta função devolve essas linhas à fila.
async function requeuePendentes(pool: Pool, rows: { log_id: string }[]) {
  const ids = rows.map(r => r.log_id);
  if (!ids.length) return;
  await pool.query(
    `UPDATE disparo_logs SET status = 'pending' WHERE id = ANY($1::uuid[])`,
    [ids]
  ).catch(err => log.error('DISPARO', 'Falha ao reenfileirar mensagens pendentes', { err: err?.message }));
}

// [AUDITORIA] FIX APLICADO (2026-07-23): a tela (src/pages/Disparos.tsx) manda literalmente
// "safe"/"moderate"/"fast" e promete 30-60s/15-30s/5-15s. Faixas alinhadas com a tela;
// 'normal'/'seguro'/'slow'/'rapido' mantidos como aliases legados (campanha antiga pode ter
// gravado esse valor). Perfil desconhecido cai no perfil mais seguro (nunca um valor fixo sem
// jitter), por precaução. [AUDITORIA] LÓGICA (revisão 2026-09-11): hoisted pra nível de módulo —
// antes vivia dentro do loop sequencial de `processarDisparos`; agora `calcularDelayMs` (usada
// concorrentemente por campanha, ver nota grande no topo do arquivo) precisa delas fora de
// qualquer escopo de função.
const FAIXAS_DELAY_MS: Record<string, [number, number]> = {
  safe: [30000, 60000],
  moderate: [15000, 30000],
  fast: [5000, 15000],
  // Atalho da tela (StepAntiBan) pro caso de uso "pelo menos 8-10 minutos de diferença" — só
  // entra em jogo se as colunas de intervalo customizado vierem nulas mesmo com
  // `perfil_velocidade='ultra_safe'` gravado (campanha nova sempre preenche
  // `delay_min_segundos`/`delay_max_segundos` explicitamente).
  ultra_safe: [480000, 720000],
};
const ALIAS_PERFIL: Record<string, string> = {
  seguro: 'safe', slow: 'safe',
  normal: 'moderate',
  rapido: 'fast',
};
const DELAY_MINIMO_ABSOLUTO_MS = 5000;

/**
 * Calcula o delay antiban (ms) até a PRÓXIMA mensagem desta campanha — intervalo customizado
 * (`delay_min_segundos`/`delay_max_segundos`) tem prioridade sobre `perfil_velocidade`. Usada
 * pra popular `proximoEnvioPermitidoPorCampanha` depois de cada mensagem (nunca mais como um
 * `sleep()` bloqueante — ver nota grande no topo do arquivo).
 */
async function calcularDelayMs(pool: Pool, disparoId: string): Promise<number> {
  try {
    const campanhaRes = await pool.query(
      `SELECT perfil_velocidade, delay_min_segundos, delay_max_segundos FROM disparos WHERE id = $1 LIMIT 1`,
      [disparoId]
    );
    const row = campanhaRes.rows[0];
    const customMin = row?.delay_min_segundos;
    const customMax = row?.delay_max_segundos;
    if (customMin != null && customMax != null) {
      let minMs = Math.max(Number(customMin) * 1000, DELAY_MINIMO_ABSOLUTO_MS);
      let maxMs = Math.max(Number(customMax) * 1000, DELAY_MINIMO_ABSOLUTO_MS);
      if (minMs > maxMs) [minMs, maxMs] = [maxMs, minMs];
      return Math.floor(Math.random() * (maxMs - minMs) + minMs);
    }
    const perfilBruto = String(row?.perfil_velocidade || '').toLowerCase();
    const perfil = FAIXAS_DELAY_MS[perfilBruto] ? perfilBruto : (ALIAS_PERFIL[perfilBruto] || 'safe');
    const [min, max] = FAIXAS_DELAY_MS[perfil];
    return Math.floor(Math.random() * (max - min) + min);
  } catch (errDb: any) {
    log.warn('DISPARO', 'Falha ao buscar configuração de delay, usando faixa segura', { err: errDb.message });
    const [min, max] = FAIXAS_DELAY_MS.safe;
    return Math.floor(Math.random() * (max - min) + min);
  }
}

// Cache de URL de mídia estabilizada por campanha (Sprint 6, item 1 — mídia expirada em campanhas
// de múltiplos dias). [AUDITORIA] LÓGICA (revisão 2026-09-11): promovida de cache-por-lote pra
// cache-por-módulo (mesmo padrão de `humanizarCache`/`cooldownHorasCache`) — o novo motor
// concorrente não tem mais um "lote" sequencial único cujo tempo de vida fazia sentido pra esse
// cache; ele já era, na prática, "resolve uma vez por campanha e reaproveita", então vive tão bem
// (ou melhor: sobrevive entre ticks, não só dentro de um lote) como cache de módulo.
const urlMidiaEstavelPorCampanha = new Map<string, string>();

export async function processarDisparos(pool: Pool) {
  try {
    // [AUDITORIA] FIX APLICADO (Sprint Disparos/Agendamento, 2026-07-25): promove campanhas
    // agendadas ('rascunho' + agendado_para no passado) para 'em_andamento' antes de buscar o
    // lote — sem isso elas nunca eram pegas por get_next_disparo_batch (ver
    // promover_disparos_agendados() em migrations.ts para o achado completo). Roda a cada tick
    // de 2s deste motor, não no cron de 5min, para respeitar o horário agendado com precisão.
    await pool.query('SELECT promover_disparos_agendados()')
      .catch(err => log.warn('DISPARO', 'Falha ao promover campanhas agendadas', { err: err?.message }));

    // 1. Buscar lote de mensagens pendentes usando a função SQL atômica.
    // [AUDITORIA] FIX APLICADO (Sprint Fila Por Campanha, 2026-09-11 — ver nota grande no topo do
    // arquivo): tamanho do lote subiu de 5 pra 40 — não pra processar 40 mensagens em sequência
    // (o motor novo processa no máximo 1 mensagem POR CAMPANHA por tick, concorrentemente), mas
    // pra ter uma amostra grande o suficiente de conter mensagens de VÁRIAS campanhas/contas
    // diferentes num único tick, mesmo quando uma campanha grande (milhares de linhas 'pending'
    // criadas juntas) domina a ordenação por `created_at` da fila.
    // [AUDITORIA] BUG CORRIGIDO (achado no próprio deploy deste fix, 2026-09-11): `$1` parametrizado
    // chega ao Postgres como tipo `unknown` — com mais de uma versão de `get_next_disparo_batch`
    // no banco (histórico de `CREATE OR REPLACE`/`DROP FUNCTION` de sprints anteriores), a função
    // deixou de ser resolvível de forma única ("function ... is not unique"), e o motor inteiro
    // passou a lançar erro em TODO tick, sem processar nenhuma campanha. `TAMANHO_LOTE` é uma
    // constante fixa do código (nunca input de usuário) — interpolar direto no texto do SQL é
    // seguro aqui (mesmo padrão da chamada original, `get_next_disparo_batch(5)`, que nunca teve
    // esse problema por passar um literal inteiro, não um parâmetro `$1`) e resolve a ambiguidade
    // de overload sem precisar de `::integer` (Postgres já vê um literal inteiro no texto do SQL).
    const TAMANHO_LOTE = 40;
    const batch = await pool.query(`SELECT * FROM public.get_next_disparo_batch(${TAMANHO_LOTE})`);

    if (!batch.rows.length) return;

    // [AUDITORIA] LÓGICA (Sprint Fila Por Campanha, 2026-09-11): agrupa o lote por `disparo_id` —
    // só a mensagem MAIS ANTIGA (lote já vem ordenado por `created_at ASC`) de cada campanha é
    // processada neste tick; qualquer mensagem extra da MESMA campanha volta pra fila na hora
    // (será a próxima candidata dela no tick seguinte em que ela estiver liberada). Isso é o que
    // transforma "5 mensagens em sequência, não importa de quem" em "até 1 mensagem por campanha,
    // todas as campanhas elegíveis em paralelo".
    const primeiraPorCampanha = new Map<string, any>();
    const paraReenfileirarJa: { log_id: string }[] = [];
    for (const msg of batch.rows) {
      if (primeiraPorCampanha.has(msg.disparo_id)) {
        paraReenfileirarJa.push({ log_id: msg.log_id });
        continue;
      }
      primeiraPorCampanha.set(msg.disparo_id, msg);
    }

    // [AUDITORIA] LÓGICA (Sprint Fila Por Campanha, 2026-09-11): campanha ainda dentro do próprio
    // delay antiban (última mensagem dela saiu há menos tempo que `calcularDelayMs` decidiu) não
    // está pronta pra outra mensagem AINDA — reenfileira sem tentar. Substitui o antigo
    // `await sleep(delayMs)` bloqueante: aqui é só uma checagem de timestamp, nunca segura o tick.
    const agora = Date.now();
    const selecionadas: any[] = [];
    for (const msg of primeiraPorCampanha.values()) {
      const proximoPermitido = proximoEnvioPermitidoPorCampanha.get(msg.disparo_id) || 0;
      if (agora < proximoPermitido) {
        paraReenfileirarJa.push({ log_id: msg.log_id });
      } else {
        selecionadas.push(msg);
      }
    }

    if (paraReenfileirarJa.length) await requeuePendentes(pool, paraReenfileirarJa);
    if (!selecionadas.length) return;

    log.info('DISPARO', 'Processando lote de mensagens', {
      tamanhoLoteBruto: batch.rows.length, campanhasSelecionadasNesteTick: selecionadas.length,
    });

    // [AUDITORIA] LÓGICA (Sprint Fila Por Campanha, 2026-09-11): cada campanha selecionada roda em
    // paralelo (`Promise.allSettled` — uma campanha lançando exceção nunca derruba as outras).
    // Nenhum `await sleep()` bloqueante mais neste arquivo: o pacing antiban de cada campanha vive
    // só em `proximoEnvioPermitidoPorCampanha`, escrito ao final de `processarUmaMensagem`.
    await Promise.allSettled(selecionadas.map(msg => processarUmaMensagem(pool, msg)));
  } catch (err: any) {
    log.error('DISPARO', 'Erro crítico no motor de processamento', { err: err?.message, stack: err?.stack });
  }
}

/**
 * Processa UMA mensagem (a mais antiga pendente de UMA campanha, já selecionada por
 * `processarDisparos`) — janela de horário/fim de semana, teto diário por instância, opt-out,
 * cooldown entre campanhas, humanização, envio de verdade, classificação de erro e circuit
 * breaker por campanha. Chamada concorrentemente, uma vez por campanha elegível, a cada tick de
 * 2s — nunca faz `await sleep()` bloqueante; ao final, grava em `proximoEnvioPermitidoPorCampanha`
 * quando esta campanha pode mandar a PRÓXIMA mensagem, sem travar o motor até lá.
 */
async function processarUmaMensagem(pool: Pool, msg: any): Promise<void> {
  const { log_id, disparo_id, user_id, telefone, mensagem, tipo_midia, url_midia, legenda_midia, variar_imagem } = msg;
  try {
    // [AUDITORIA] FIX APLICADO (Sprint 5, 2026-07-23 — teto diário; revisado 2026-07-29 pra
    // ser POR INSTÂNCIA): antes de processar a mensagem desta campanha, resolve as
    // instâncias candidatas (seleção manual da tela via `resolverInstanciasCampanha`, ou o
    // único fallback pra campanhas sem seleção) e conta, pra CADA uma delas separadamente,
    // quantas mensagens já foram efetivamente ENVIADAS (status='sent') nas últimas 24h
    // corridas — não mais uma soma única por `user_id` (ver `disparo_logs.instancia`,
    // preenchida no UPDATE de envio abaixo). Instâncias que já bateram o teto saem da lista
    // de disponíveis; a campanha só pausa de vez quando TODAS as candidatas estiverem no
    // teto. Teto configurável por campanha (`disparos.limite_diario_mensagens`), com teto
    // ABSOLUTO de 50/dia por instância.
    // [AUDITORIA] FIX APLICADO (Sprint Limite Diário Seguro, 2026-09-11 — pedido explícito do
    // usuário: "limite os usuarios a disparar menos de 50 por dia para não travar ou banir a
    // conta deles"): default caiu de 500 pra 50 (COALESCE e fallback `|| 500` abaixo), e um
    // `Math.min(50, ...)` reforça isso mesmo se a coluna, por algum caminho fora de
    // `routes/disparos.ts` (que já clampa no POST/PUT), guardar um valor maior — este é o
    // ponto que decide de verdade quantas mensagens saem, então é o lugar certo pro teto valer
    // sempre, não só confiar que todo caminho de escrita passou pelo clamp.
    {
      try {
        const capMetaRes = await pool.query(
            `SELECT user_id, COALESCE(limite_diario_mensagens, 50) AS limite_diario_mensagens
             FROM disparos WHERE id = $1 LIMIT 1`,
            [disparo_id]
          );
          if (capMetaRes.rows.length) {
            const donoCampanha = capMetaRes.rows[0].user_id;
            const limiteDiario = Math.min(50, Number(capMetaRes.rows[0].limite_diario_mensagens) || 50);

            const instanciasSelecionadas = await resolverInstanciasCampanha(pool, disparo_id, donoCampanha);
            let candidatos: InstanciaElegivel[] = instanciasSelecionadas;
            if (!candidatos.length) {
              const fallback = await resolverInstanciaFallback(pool, donoCampanha);
              candidatos = fallback ? [fallback] : [{
                url: process.env.EVOLUTION_API_URL || 'https://disparo.mentoark.com.br',
                api_key: process.env.EVOLUTION_API_KEY || 'mentoark2025evolutionkey',
                instancia: `crm_${String(donoCampanha).slice(0, 8)}`,
              }];
            }

            const nomesInstancias = candidatos.map(c => c.instancia);
            const contagemRes = await pool.query(
              `SELECT instancia, COUNT(*) AS total FROM disparo_logs
               WHERE user_id = $1 AND instancia = ANY($2::text[]) AND status = 'sent'
                 AND enviado_at >= NOW() - INTERVAL '24 hours'
               GROUP BY instancia`,
              [donoCampanha, nomesInstancias]
            );
            const contagemPorInstancia = new Map<string, number>(
              contagemRes.rows.map((r: any) => [r.instancia, Number(r.total)])
            );
            const disponiveisHoje = candidatos.filter(c => (contagemPorInstancia.get(c.instancia) || 0) < limiteDiario);
            instanciasDisponiveisHojeCache.set(disparo_id, { disponiveis: disponiveisHoje, proximoIndex: 0 });

            if (!disponiveisHoje.length) {
              log.warn('DISPARO', 'Teto diário de segurança atingido em todas as instâncias elegíveis — pausando campanha automaticamente', {
                disparo_id, donoCampanha, limiteDiario, instancias: nomesInstancias,
              });
              const aviso = 'Limite diário de segurança atingido em todas as instâncias disponíveis. Retomando automaticamente amanhã.';
              await pool.query(
                `UPDATE disparos
                 SET status = 'pausado', aviso = $2, pausado_em = NOW(), pausado_motivo = 'limite_diario', updated_at = NOW()
                 WHERE id = $1`,
                [disparo_id, aviso]
              );
              await requeuePendentes(pool, [{ log_id }]);
              return;
            }
          }
        } catch (errCap: any) {
          log.warn('DISPARO', 'Erro ao verificar teto diário de segurança por instância, continuando por precaução', { disparo_id, err: errCap.message });
        }

        // [AUDITORIA] FIX APLICADO (Sprint 6, item 1): ver comentário completo na declaração de
        // `urlMidiaEstavelPorCampanha` acima. Só roda pra mídia (`tipo_midia !== 'texto'`) e só
        // uma vez por campanha por execução deste lote.
        if (tipo_midia && tipo_midia !== 'texto' && url_midia && !urlMidiaEstavelPorCampanha.has(disparo_id)) {
          try {
            const urlEstavel = await garantirMidiaEstavel(url_midia);
            if (urlEstavel) {
              urlMidiaEstavelPorCampanha.set(disparo_id, urlEstavel);
              if (urlEstavel !== url_midia) {
                await pool.query(`UPDATE disparos SET url_midia = $1 WHERE id = $2`, [urlEstavel, disparo_id])
                  .catch(errUpd => log.warn('DISPARO', 'Falha ao persistir url_midia estável na campanha', { disparo_id, err: errUpd?.message }));
                log.info('DISPARO', 'Mídia da campanha migrada para URL estável', { disparo_id, urlEstavel });
              }
            }
          } catch (errMidia: any) {
            log.warn('DISPARO', 'Falha ao estabilizar mídia da campanha, usando URL original', { disparo_id, err: errMidia.message });
          }
        }
      }

      // [AUDITORIA] FIX APLICADO (Sprint 5): valida janela de horário e pausa de fim de semana
      // (fuso America/Sao_Paulo) antes de processar a mensagem. Se estiver fora da janela,
      // reenfileira esta e as demais mensagens do lote e aborta o processamento.
      try {
        const sp = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
        const horaSP = sp.getHours();
        const diaSemana = sp.getDay(); // 0 = domingo, 6 = sábado

        const metaRes = await pool.query(
          `SELECT horario_inicio, horario_fim, pausa_fins_semana FROM disparos WHERE id = $1 LIMIT 1`,
          [disparo_id]
        );

        if (metaRes.rows.length) {
          const { horario_inicio, horario_fim, pausa_fins_semana } = metaRes.rows[0];

          if (pausa_fins_semana && (diaSemana === 0 || diaSemana === 6)) {
            log.info('DISPARO', 'Campanha suspensa: pausa de fim de semana ativa', { disparo_id });
            await requeuePendentes(pool, [{ log_id }]);
            return;
          }

          const inicio = horario_inicio ? Number(String(horario_inicio).split(':')[0]) : 8;
          const fim = horario_fim ? Number(String(horario_fim).split(':')[0]) : 21;

          if (horaSP < inicio || horaSP >= fim) {
            log.info('DISPARO', 'Campanha suspensa: fora da janela de horário comercial permitida', { disparo_id, horaSP, inicio, fim });
            await requeuePendentes(pool, [{ log_id }]);
            return;
          }
        }
      } catch (errMeta: any) {
        log.warn('DISPARO', 'Erro ao validar janela/fim de semana da campanha, continuando por precaução', { err: errMeta.message });
      }

      try {
        // [AUDITORIA] FIX APLICADO (2026-07-23): checagem defensiva contra disparo_optouts,
        // além do filtro por contatos.opt_out já aplicado na própria query de fila
        // (get_next_disparo_batch, ver migrations.ts) — as duas tabelas podem divergir (ex:
        // número sem linha em `contatos`, opt-out registrado só em `disparo_optouts`), e como
        // isso é uma checagem de segurança (não reabrir contato que pediu remoção), melhor
        // conferir nos dois lugares do que confiar só num. RIGHT(...,11) pelo mesmo motivo já
        // documentado na query SQL — telefone não é normalizado pro mesmo formato em todo lugar.
        const optOutRes = await pool.query(
          `SELECT 1 FROM disparo_optouts WHERE user_id = $1 AND RIGHT(telefone, 11) = RIGHT($2, 11) LIMIT 1`,
          [user_id, telefone]
        ).catch(() => ({ rows: [] as any[] }));
        if (optOutRes.rows.length) {
          await pool.query(
            `UPDATE disparo_logs SET status = 'failed', erro = 'cancelado_pelo_cliente' WHERE id = $1`,
            [log_id]
          ).catch(err => log.error('DISPARO', 'Falha ao marcar log como cancelado_pelo_cliente', { err: err?.message }));
          log.info('DISPARO', 'Mensagem pulada — contato em opt-out', { disparo_id, telefone });
          return;
        }

        // [AUDITORIA] FIX APLICADO (Sprint Cooldown de Disparos, 2026-07-30): checagem defensiva
        // (camada 2) contra reenvio pro mesmo número em campanhas diferentes — `get_next_disparo_batch`
        // já bloqueia proativamente (camada 1, SQL, ver migrations.ts), mas duas mensagens pro
        // mesmo telefone em campanhas diferentes podem cair no MESMO lote antes de
        // `ultimo_disparo_em` ser atualizado (só acontece depois do envio real ter concluído,
        // abaixo) — mesma filosofia de dupla camada já usada pro opt-out acima.
        const cooldownHoras = await obterCooldownHoras(pool, disparo_id);
        if (cooldownHoras > 0) {
          const cooldownRes = await pool.query(
            `SELECT ultimo_disparo_em FROM contatos WHERE user_id = $1 AND RIGHT(telefone, 11) = RIGHT($2, 11) LIMIT 1`,
            [user_id, telefone]
          ).catch(() => ({ rows: [] as any[] }));
          const ultimoDisparo = cooldownRes.rows[0]?.ultimo_disparo_em;
          if (ultimoDisparo && Date.now() - new Date(ultimoDisparo).getTime() < cooldownHoras * 60 * 60 * 1000) {
            await pool.query(
              `UPDATE disparo_logs SET status = 'cooldown', erro = 'Bloqueado por cooldown: contato já recebeu mensagem de campanha dentro da janela configurada' WHERE id = $1`,
              [log_id]
            ).catch(err => log.error('DISPARO', 'Falha ao marcar log como cooldown', { err: err?.message }));
            log.info('DISPARO', 'Mensagem pulada — contato em cooldown (camada defensiva)', { disparo_id, telefone, cooldownHoras });
            return;
          }
        }

        // 2. Buscar config da Evolution API para esta mensagem. `instanciasDisponiveisHojeCache`
        //    já foi calculada no bloco de transição de campanha acima — candidatos elegíveis
        //    (seleção manual da tela, ou fallback integracoes_config/agentes/env) MENOS os que já
        //    estouraram o próprio teto diário. Round-robin roda só sobre essa lista filtrada.
        const config: InstanciaElegivel | null = proximaInstanciaDisponivel(disparo_id);

        // [AUDITORIA] FIX PENDENTE (motivo: decisão de produto sobre robustez vs. simplicidade
        // — Sprint Disparos/Multi-instância, 2026-07-25): se a instância escolhida pelo
        // round-robin estiver desconectada, a mensagem cai no fluxo de erro/retry normal
        // (`catch` abaixo, com `errosConsecutivos` compartilhado por CAMPANHA, não por
        // instância) em vez de pular pra próxima instância elegível — uma instância caída no
        // meio de uma campanha distribuída pode pausar a campanha inteira por erros
        // consecutivos mesmo tendo outras instâncias saudáveis disponíveis. Não implementado
        // agora porque exigiria isolar o contador de erros consecutivos por instância (não só
        // por campanha) e decidir se uma instância "removida" do round-robin no meio do envio
        // deve voltar sozinha depois de reconectar — comportamento não trivial o suficiente pra
        // decidir sem confirmação do usuário.

        // Fallback para defaults do sistema
        const url = config?.url || process.env.EVOLUTION_API_URL || 'https://disparo.mentoark.com.br';
        const api_key = config?.api_key || process.env.EVOLUTION_API_KEY || 'mentoark2025evolutionkey';
        const instancia = config?.instancia || `crm_${String(user_id).slice(0, 8)}`;
        
        const baseUrl = sanitizeEvolutionUrl(url);


        // 3. Normalizar telefone
        const digits = telefone.replace(/\D/g, '');

        // [AUDITORIA] BUG (achado real, Sprint Continuidade — Vistoria de Problemas, 2026-08-25,
        // investigando `SPRINT_GRUPOS_DIAGNOSTICO_COMPLETO.md`): nada em `contatos` distingue a
        // linha sintética de um GRUPO (criada por `webhook.ts` pro backfill de nome/foto — mesmo
        // `origem = 'WhatsApp'` de um contato pessoa real, sem coluna `is_group`) de um contato de
        // verdade — confirmado em produção: a conta `mentoark@gmail.com` já tem 4 grupos reais
        // como linha em `contatos` hoje. Nada em `StepContacts`/`disparoProcessor` os excluía —
        // um grupo podia ser selecionado numa campanha de Disparo e `number: digits` (sem `@g.us`)
        // ia direto pro `/message/sendText` da Evolution, com risco real da Evolution/Baileys
        // resolver por tamanho e mandar a mensagem de campanha (com dado de outro contato via
        // `{{nome}}`) pra DENTRO do grupo, visível pra todo mundo lá. [AUDITORIA] FIX APLICADO:
        // JID de grupo do WhatsApp é sempre um ID longo (`120363...`, 18+ dígitos) ou o formato
        // antigo com hífen (`5511952927886-1398018374`, 24+ dígitos após stripar não-dígito) —
        // nenhum telefone real (nem com DDI de outro país, E.164 tem no máximo 15 dígitos) chega
        // nem perto disso. `> 15` é uma barreira segura: bloqueia os 2 formatos de grupo
        // conhecidos sem risco de rejeitar número de cliente real.
        if (digits.length > 15) {
          await pool.query(
            `UPDATE disparo_logs SET status = 'failed', erro = 'destino_parece_grupo_nao_contato' WHERE id = $1`,
            [log_id]
          ).catch(err => log.error('DISPARO', 'Falha ao marcar log como destino_parece_grupo_nao_contato', { err: err?.message }));
          // [AUDITORIA] BUG CORRIGIDO (achado 2026-09-04, revisão pós-Sprint Grupos/Template):
          // este `continue` pula por cima do bloco de contabilidade que todo outro caminho de
          // falha passa (`catch` mais abaixo, `falhas = falhas + 1`) — campanha com N contatos
          // que na verdade são grupo tinha N linhas marcadas 'failed' em `disparo_logs` mas
          // `disparos.falhas` (o contador agregado que `MonitoringDashboard.tsx` mostra e usa
          // pra calcular taxa de falha) nunca via esse número. Resultado real: barra de progresso
          // (`enviados`/`total_leads`) nunca fecha 100%, sem nenhuma "falha" visível que explique
          // a diferença. [AUDITORIA] FIX APLICADO: incrementa `falhas` aqui também — mas
          // deliberadamente NÃO mexe em `errosConsecutivos` (o freio de pausa automática por erro
          // consecutivo, ver comentário logo acima): isso aqui é validação de dado de entrada, não
          // falha operacional de envio/API, incluir no circuit-breaker pausaria campanhas
          // legítimas só por terem alguns contatos de grupo misturados.
          await pool.query(
            `UPDATE disparos SET falhas = falhas + 1 WHERE id = $1`,
            [disparo_id]
          ).catch(err => log.error('DISPARO', 'Falha ao incrementar contador de falhas (destino_parece_grupo_nao_contato)', { err: err?.message }));
          log.warn('DISPARO_GRUPO_BLOQUEADO', 'Disparo bloqueado — destino parece ser grupo do WhatsApp, não contato individual', { disparo_id, telefone, digitos: digits.length });
          return;
        }

        // 3.1. Humanizar mensagem via IA — withAiFallback garante que erros 401/429
        //      não travam o disparo; a mensagem original é usada como contingência.
        let textoFinal: string = mensagem;
        // [AUDITORIA] FIX APLICADO (Sprint Fix Legenda de Mídia, 2026-08-02): prioridade invertida
        // — `mensagem` (disparo_logs.mensagem_enviada) é a legenda JÁ PERSONALIZADA por contato
        // (substituirPlaceholders rodou no frontend, StepReview.handleStart, ao criar cada log);
        // `legenda_midia` (disparos.legenda_midia) é o texto CRU da campanha inteira, compartilhado
        // por todos os destinatários, sem substituição de placeholder nenhuma — não existe coluna
        // de "legenda por contato" em disparo_logs, então usar `legenda_midia` como preferência (como
        // antes) mandava `{{nome}}`/`{{primeiro_nome}}`/etc. literais pra campanhas de mídia com
        // placeholder na legenda, sempre que essa coluna viesse preenchida (ex: campanha criada a
        // partir de um template, ou qualquer campanha após o fix de
        // "Textarea sempre escreve em form.mensagem" em Disparos.tsx, que agora preenche
        // `legenda_midia` de verdade). `legenda_midia` void o fallback só quando `mensagem` vier
        // vazio (ex: campanha antiga, criada antes deste fix, sem log personalizado equivalente).
        let legendaFinal: string = mensagem || legenda_midia;
        // [AUDITORIA] BUG (achado 2026-09-02, revisão de gastos de IA pedida pelo usuário: "preciso
        // que não ocorra mais os gastos absurdos"): `humanizarMensagem` paga OpenAI de verdade a
        // cada variação nova (cache reaproveita ~70% depois das 5 primeiras, mas o resto é chamada
        // real) e isso nunca era registrado em `ai_uso_diario` — invisível no dashboard de custo,
        // mesmo padrão que deixou o gasto de mídia de grupo passar batido até o saldo zerar em
        // 14/08. [AUDITORIA] FIX APLICADO: `humanizarMensagem` agora devolve os tokens usados;
        // registrado aqui com `registrarUsoIA` sempre que a chamada realmente aconteceu (tokens > 0
        // — cache hit ou fallback por erro não contam, porque não pagaram nada de verdade).
        const registrarCustoHumanizacao = (r: { tokensEntrada: number; tokensSaida: number; modelo: string }) => {
          if (!r.tokensEntrada && !r.tokensSaida) return;
          registrarUsoIA(pool, {
            userId: user_id, providerSlug: 'openai', modelo: r.modelo,
            tokensEntrada: r.tokensEntrada, tokensSaida: r.tokensSaida,
            custoUsd: estimarCustoUsd(r.modelo, r.tokensEntrada, r.tokensSaida),
          }).catch(() => {});
        };
        if (await deveHumanizar(pool, disparo_id)) {
          if (tipo_midia === 'texto' || !tipo_midia) {
            const r = await withAiFallback(
              () => humanizarMensagem(mensagem, pool, user_id),
              { texto: mensagem, tokensEntrada: 0, tokensSaida: 0, modelo: '' },
              'humanizarMensagem(texto)',
            );
            textoFinal = r.texto;
            registrarCustoHumanizacao(r);
          } else if (legendaFinal) {
            // [AUDITORIA] FIX APLICADO (Sprint Fix Legenda de Mídia, 2026-08-02): humaniza
            // `legendaFinal` (já resolvido acima, prioritariamente a versão PERSONALIZADA por
            // contato) em vez do `legenda_midia` cru — humanizar o texto cru reescreveria a
            // mensagem inteira sem nunca substituir `{{placeholders}}` (a humanização roda antes
            // de qualquer substituição, e não existe um segundo passo de substituição depois dela).
            const r = await withAiFallback(
              () => humanizarMensagem(legendaFinal, pool, user_id),
              { texto: legendaFinal, tokensEntrada: 0, tokensSaida: 0, modelo: '' },
              'humanizarMensagem(legenda)',
            );
            legendaFinal = r.texto;
            registrarCustoHumanizacao(r);
          }
        }

        // 4. Enviar mensagem
        // Usa a URL estável já cacheada pra esta campanha (ver bloco de transição de campanha
        // acima), com fallback pra `url_midia` crua se a estabilização falhou/não rodou.
        let urlMidiaFinal = urlMidiaEstavelPorCampanha.get(disparo_id) || url_midia;
        // [AUDITORIA] FIX APLICADO (Sprint Variação de Imagem, 2026-08-25, pedido do usuário —
        // anti-fingerprint): campanha com `variar_imagem=true` gera uma variação de hash único
        // POR MENSAGEM aqui (nunca cacheada — diferente da URL estável acima, que É cacheada de
        // propósito por campanha) — cada destinatário recebe um arquivo com hash diferente,
        // visualmente idêntico. Opt-in, default false — nenhuma campanha existente muda de
        // comportamento sem o operador ligar o toggle explicitamente. Só faz sentido pra imagem
        // (documento/áudio corromperiam com reencode de imagem); qualquer falha do sharp
        // (formato não suportado, arquivo não encontrado) devolve a URL original inalterada —
        // nunca bloqueia o envio por conta desta variação.
        if (variar_imagem && tipo_midia === 'imagem' && urlMidiaFinal) {
          urlMidiaFinal = await gerarVariacaoImagem(urlMidiaFinal);
        }
        let endpoint = `${baseUrl}/message/sendText/${instancia}`;
        let body: any = { number: digits, text: textoFinal };

        if (tipo_midia === 'imagem' && urlMidiaFinal) {
          endpoint = `${baseUrl}/message/sendMedia/${instancia}`;
          body = {
            number: digits,
            media: urlMidiaFinal,
            mediatype: 'image',
            caption: legendaFinal
          };
        } else if (tipo_midia === 'audio' && urlMidiaFinal) {
          endpoint = `${baseUrl}/message/sendWhatsAppAudio/${instancia}`;
          body = { number: digits, audio: urlMidiaFinal };
        } else if (tipo_midia === 'documento' && urlMidiaFinal) {
          endpoint = `${baseUrl}/message/sendMedia/${instancia}`;
          body = {
            number: digits,
            media: urlMidiaFinal,
            mediatype: 'document',
            fileName: legendaFinal || 'documento'
          };
        }

        // [AUDITORIA] LÓGICA (Sprint 7): TTL compartilhado com agentEngine.ts (BOT_ECHO_TTL_MS,
        // ver comentário completo lá) — mesmo mecanismo de antiloop, mesma janela de expiração.
        // Registrar em botSentTexts antes de enviar para evitar a condição de corrida do webhook (antiloop)
        const keyText = textoFinal || '';
        const keyLegenda = legendaFinal || '';
        if (keyText) {
          botSentTexts.add(`${digits}:${keyText}`);
          botSentTexts.add(`${digits}:${keyText.trim()}`);
        }
        if (keyLegenda && keyLegenda !== keyText) {
          botSentTexts.add(`${digits}:${keyLegenda}`);
          botSentTexts.add(`${digits}:${keyLegenda.trim()}`);
        }
        // Configurar tempo limite para limpeza das chaves de antiloop
        setTimeout(() => {
          if (keyText) {
            botSentTexts.delete(`${digits}:${keyText}`);
            botSentTexts.delete(`${digits}:${keyText.trim()}`);
          }
          if (keyLegenda && keyLegenda !== keyText) {
            botSentTexts.delete(`${digits}:${keyLegenda}`);
            botSentTexts.delete(`${digits}:${keyLegenda.trim()}`);
          }
        }, BOT_ECHO_TTL_MS);

        const resp = await evolutionFetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: api_key },
          body: JSON.stringify(body),
        });

        if (!resp.ok) {
          const errBody = await resp.text().catch(() => '');
          // [AUDITORIA] LÓGICA (Sprint 5): status HTTP anexado ao erro (não só na mensagem de
          // texto) para o catch abaixo conseguir classificar erro temporário (502/503/504) vs.
          // permanente sem precisar fazer parsing de string.
          const httpErr: any = new Error(`Evolution API ${resp.status}: ${errBody}`);
          httpErr.status = resp.status;
          throw httpErr;
        }

        // [AUDITORIA] BUG CORRIGIDO (achado 2026-09-04, typecheck escopado): sem anotação, TS
        // infere `respData` como `{}` (não `any`) — `resp.json()` resolve pra `Promise<unknown>`
        // nos tipos reais instalados (`undici-types`), e o `.catch(() => ({}))` acaba virando o
        // tipo do resultado. Mesmo padrão já usado em outros pontos do projeto pra JSON de
        // resposta de formato variável (ex: `whatsappMediaStorage.ts`, `buscarInfoGrupo`).
        const respData: any = await resp.json().catch(() => ({}));
        const realMsgId = respData?.key?.id || `disparo_${log_id}`;

        if (respData?.key?.id) {
          botMessageIds.add(respData.key.id);
          setTimeout(() => botMessageIds.delete(respData.key.id), BOT_ECHO_TTL_MS);
        }

        // 5. Salvar na tabela whatsapp_messages para aparecer no painel de chat
        const msgType = tipo_midia === 'texto' || !tipo_midia ? 'text' : tipo_midia === 'imagem' ? 'image' : tipo_midia === 'audio' ? 'audio' : 'document';
        const msgContent = tipo_midia === 'texto' || !tipo_midia ? textoFinal : (legendaFinal || null);

        // [AUDITORIA] FIX APLICADO (2026-07-21): INSERT roda dentro de withTenantContext
        // (db.ts) — propaga app.user_id pro Postgres, necessário pro piloto de RLS em
        // whatsapp_messages (só homologação, ver diagnosticos/AUDITORIA_LOG.md).
        await withTenantContext({ userId: user_id, isAdmin: false }, client => client.query(
          `INSERT INTO whatsapp_messages
             (user_id, instance_name, remote_jid, message_id, from_me, message_type,
              content, media_url, media_mimetype, status, timestamp_wa)
           VALUES ($1, $2, $3, $4, true, $5, $6, $7, $8, 'sent', NOW())
           ON CONFLICT (message_id, instance_name) DO NOTHING`,
          [
            user_id,
            instancia,
            `${digits}@s.whatsapp.net`,
            realMsgId,
            msgType,
            msgContent,
            tipo_midia !== 'texto' && urlMidiaFinal ? urlMidiaFinal : null,
            tipo_midia === 'imagem' ? 'image/jpeg' : tipo_midia === 'audio' ? 'audio/ogg' : tipo_midia === 'documento' ? 'application/pdf' : null
          ]
        )).catch(err => log.error('DISPARO INSERT whatsapp_messages ERROR', 'Falha ao inserir whatsapp_messages', { err: err?.message, stack: err?.stack }));

        // Sucesso no envio: reseta o contador de falhas consecutivas DESTA campanha.
        errosConsecutivosPorCampanha.set(disparo_id, 0);

        // 5. Atualizar status para enviado
        await pool.query(
          `UPDATE disparo_logs SET status = 'sent', enviado_at = NOW(), erro = NULL, instancia = $2 WHERE id = $1`,
          [log_id, instancia]
        );
        await pool.query(
          `UPDATE disparos SET enviados = enviados + 1 WHERE id = $1`,
          [disparo_id]
        );

        // [AUDITORIA] FIX APLICADO (Sprint Cooldown de Disparos, 2026-07-30): marca o momento do
        // envio real em `contatos.ultimo_disparo_em` — é essa coluna que `get_next_disparo_batch`
        // (camada 1) e a checagem defensiva acima (camada 2) usam pra bloquear reenvio pro mesmo
        // número em campanhas diferentes dentro da janela de cooldown. RIGHT(...,11) mesmo padrão
        // de comparação por sufixo já usado pro resto do arquivo (telefone não normalizado).
        await pool.query(
          `UPDATE contatos SET ultimo_disparo_em = NOW() WHERE user_id = $1 AND RIGHT(telefone, 11) = RIGHT($2, 11)`,
          [user_id, telefone]
        ).catch(err => log.warn('DISPARO', 'Falha ao atualizar ultimo_disparo_em (não bloqueia o envio já concluído)', { err: err?.message }));

      } catch (err: any) {
        log.error('DISPARO', 'Erro no log', { logId: log_id, err: err?.message, stack: err?.stack });

        // [AUDITORIA] FIX APLICADO (Sprint 5 — retries com backoff para quedas temporárias de
        // rede da Evolution, 2026-07-23): antes, QUALQUER erro (502 passageiro do proxy,
        // timeout de rede, número inválido, instância desconectada) marcava o log direto como
        // 'failed' — mesmo o `tentativas` que a tabela já tinha (default 0) nunca era lido nem
        // incrementado. Diferencia agora erro temporário (rede/infra — vale tentar de novo) de
        // erro permanente (payload inválido, 4xx, etc. — retry não resolveria). Erro
        // temporário: incrementa `tentativas`; abaixo de 3, volta pra 'pending' (o próprio
        // cron de 2s do motor de disparo, gated pelo delay antiban entre mensagens, já dá o
        // espaçamento entre tentativas — não precisa de um timer de backoff separado); a partir
        // da 3ª tentativa falha, vira 'failed' definitivo, igual ao comportamento anterior.
        const statusHttp: number | undefined = err?.status ?? err?.response?.status ?? err?.statusCode;
        const codigoRede: string | undefined = (err as NodeJS.ErrnoException)?.code;
        const isErroTemporario =
          err?.name === 'AbortError' ||
          ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'UND_ERR_CONNECT_TIMEOUT'].includes(codigoRede || '') ||
          [502, 503, 504].includes(statusHttp as number);

        const MAX_TENTATIVAS = 3;
        let statusFinalLog: string = 'failed';

        if (isErroTemporario) {
          const updRetry = await pool.query(
            `UPDATE disparo_logs
             SET tentativas = tentativas + 1,
                 status = CASE WHEN tentativas + 1 >= $2 THEN 'failed' ELSE 'pending' END,
                 erro = $1
             WHERE id = $3
             RETURNING tentativas, status`,
            [err.message, MAX_TENTATIVAS, log_id]
          ).catch((errUpd: any) => {
            log.error('DISPARO', 'Falha ao registrar retry do log', { logId: log_id, err: errUpd?.message });
            return { rows: [] as any[] };
          });
          const tentativasFinal = updRetry.rows[0]?.tentativas ?? MAX_TENTATIVAS;
          statusFinalLog = updRetry.rows[0]?.status || 'failed';
          if (statusFinalLog === 'pending') {
            log.warn('DISPARO', 'Erro temporário da Evolution — reenfileirado para nova tentativa', {
              logId: log_id, tentativas: tentativasFinal, statusHttp, err: err.message,
            });
          } else {
            log.error('DISPARO', 'Erro temporário esgotou as 3 tentativas — marcado como falha definitiva', {
              logId: log_id, tentativas: tentativasFinal, statusHttp,
            });
          }
        } else {
          // Erro permanente (4xx, payload inválido, etc.) — falha direta, sem retry.
          await pool.query(
            `UPDATE disparo_logs SET status = 'failed', erro = $1 WHERE id = $2`,
            [err.message, log_id]
          );
        }

        // Incrementar falhas na campanha e no contador de erros consecutivos só quando é falha
        // DEFINITIVA — uma instabilidade passageira de rede que ainda vai ser reprocessada não é
        // um sinal real de problema (ban, número inválido) e não deveria contar pro circuit
        // breaker anti-ban nem inflar o contador de falhas visível na campanha antes da hora.
        if (statusFinalLog !== 'pending') {
          await pool.query(
            `UPDATE disparos SET falhas = falhas + 1 WHERE id = $1`,
            [disparo_id]
          );
        }

        // [AUDITORIA] FIX APLICADO (Sprint 5): pausa automática por erros consecutivos (anti-ban).
        // Respeita a flag pausa_erros_consecutivos da campanha; ao atingir o limite, muda o
        // status para 'pausado' e reenfileira o restante do lote (evita perder mensagens que
        // get_next_disparo_batch já havia marcado 'sending'). Pulado quando o resultado foi um
        // retry agendado (statusFinalLog === 'pending') — não conta pro circuit breaker, mas
        // ainda cai no delay antiban compartilhado abaixo (não usa `continue` aqui de propósito:
        // pular o delay logo depois de um erro de rede/infra bateria a Evolution mais rápido
        // bem no momento em que ela está instável).
        if (statusFinalLog !== 'pending') {
          // [AUDITORIA] LÓGICA (revisão Sprint Fila Por Campanha, 2026-09-11): contador por
          // campanha, persistente entre ticks (`errosConsecutivosPorCampanha`, módulo) — antes
          // vivia como `let errosConsecutivos` local a um único lote sequencial e resetava a cada
          // novo lote, então só detectava erro consecutivo DENTRO de um mesmo lote de 5. Agora
          // detecta de verdade "N erros seguidos desta campanha", mesmo em ticks diferentes.
          const errosConsecutivos = (errosConsecutivosPorCampanha.get(disparo_id) || 0) + 1;
          errosConsecutivosPorCampanha.set(disparo_id, errosConsecutivos);
          try {
            const limitRes = await pool.query(
              `SELECT limite_erros_consecutivos, pausa_erros_consecutivos FROM disparos WHERE id = $1 LIMIT 1`,
              [disparo_id]
            );
            const maxErros = limitRes.rows[0]?.limite_erros_consecutivos || 5;
            const pausaAtiva = limitRes.rows[0]?.pausa_erros_consecutivos !== false;

            if (pausaAtiva && errosConsecutivos >= maxErros) {
              log.error('DISPARO', 'Limite de erros consecutivos atingido! Pausando campanha automaticamente.', { disparo_id, errosConsecutivos });
              await pool.query(
                `UPDATE disparos SET status = 'pausado', updated_at = NOW() WHERE id = $1`,
                [disparo_id]
              );
              return;
            }
          } catch (errDb: any) {
            log.warn('DISPARO', 'Erro ao processar limite de erros consecutivos', { err: errDb.message });
          }
        }
      }

    // [AUDITORIA] FIX APLICADO (Sprint Fila Por Campanha, 2026-09-11 — ver nota grande no topo do
    // arquivo): fim do processamento desta mensagem (sucesso ou falha, os dois caminhos acima já
    // trataram cada um o que precisavam) — grava quando ESTA campanha pode mandar a PRÓXIMA
    // mensagem. Substitui `log.info(...); await sleep(delayMs);`: antes isso travava o motor
    // inteiro até o delay passar; agora é só uma escrita de timestamp, o tick de 2s segue livre
    // pra atender qualquer OUTRA campanha imediatamente.
    const delayMs = await calcularDelayMs(pool, disparo_id);
    proximoEnvioPermitidoPorCampanha.set(disparo_id, Date.now() + delayMs);
    log.info('DISPARO', 'Próxima mensagem desta campanha liberada após o delay antiban', { disparo_id, delayMs });
  } catch (err: any) {
    log.error('DISPARO', 'Erro crítico ao processar mensagem', { disparo_id, logId: log_id, err: err?.message, stack: err?.stack });
  }
}
