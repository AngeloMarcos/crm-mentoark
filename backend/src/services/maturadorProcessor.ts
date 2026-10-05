/**
 * maturadorProcessor.ts — motor do Maturador de Números (Sprint Score Real + Maturador,
 * 2026-08-09; reescrito na v2 em 2026-10-04). Chamado a cada 1min pelo cron (`cron.ts`). Troca
 * mensagem PRÉ-ESCRITA (banco por tema em `maturadorDialogos.ts`, zero IA/token) entre 2
 * instâncias da MESMA conta, pra simular tráfego orgânico em número novo/recém-conectado.
 *
 * Só age sobre pares com `ativo=true` (nasce sempre `false`, ver migrations.ts).
 *
 * [AUDITORIA] LÓGICA (v2): o que mudou em relação à v1 e por quê —
 *   - Janela de horário (`hora_inicio`–`hora_fim`, horário de Brasília): a v1 mandava 24h/dia,
 *     inclusive de madrugada, o que não parece gente.
 *   - Reset diário pela data de Brasília: a v1 usava a data UTC (`toISOString`), zerando o
 *     contador às 21h.
 *   - Sessões: conversa em rajadas de 3–7 trocas com 1–4 min entre elas, depois pausa de
 *     40–150 min. A v1 re-sorteava "5–15 min" a CADA tick, o que na prática viciava o intervalo
 *     pra perto de 5 min, num ritmo constante o dia todo. Agora `proxima_mensagem_em` é gravado.
 *   - "Digitando…" (`delay` do sendText proporcional ao tamanho do texto), marcar como LIDA a
 *     mensagem recebida antes de responder, e reação com emoji de vez em quando.
 *   - Teto diário POR INSTÂNCIA (soma de todos os pares dela, via `maturador_mensagens`), não só
 *     por par.
 *   - Checa conexão das 2 pontas antes de enviar; após 5 falhas seguidas o par se auto-pausa
 *     (`pausado_motivo`), em vez de logar erro a cada minuto pra sempre.
 *   - Cada mensagem enviada vai pra `maturador_mensagens` com o `message_id` — é isso que o
 *     webhook usa pra NUNCA entregar mensagem do maturador pra IA/contatos/leads.
 */
import { Pool } from 'pg';
import { evolutionFetch, sanitizeEvolutionUrl } from '../utils/resilientFetch';
import { log } from '../logger';
import { TEMAS, REACOES, aplicarVariacao, sortearTema } from './maturadorDialogos';
import { registrarIdMaturador, invalidarNumerosMaturador } from './maturadorFiltro';

const TZ = 'America/Sao_Paulo';
const MAX_FALHAS = 5;

// Ritmo de aquecimento por INSTÂNCIA — mesma progressão de `ScoreInstancia.tsx` ("Semana 1:
// max 20 msg/dia, Semana 2: max 50, Semana 3: max 100"). Estabiliza em 100/dia.
export function limiteDiarioPorIdade(diasAtivo: number): number {
  if (diasAtivo < 7) return 20;
  if (diasAtivo < 14) return 50;
  return 100;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
function randInt(min: number, max: number): number {
  return Math.floor(rand(min, max + 1));
}

/** Hora (0-23) e data (YYYY-MM-DD) atuais em Brasília. */
function agoraBrasilia(): { hora: number; data: string } {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = (t: string) => partes.find(p => p.type === t)?.value || '';
  return { hora: Number(get('hour')), data: `${get('year')}-${get('month')}-${get('day')}` };
}

function dentroDaJanela(hora: number, inicio: number, fim: number): boolean {
  return inicio <= fim ? hora >= inicio && hora < fim : hora >= inicio || hora < fim;
}

/** Tempo de "digitando…" proporcional ao texto — ~40 caracteres/s + tempo de pensar. */
function delayDigitacaoMs(texto: string): number {
  return Math.min(8000, Math.round(1200 + texto.length * rand(25, 45)));
}

// Cache de número por instância com TTL — a v1 cacheava pra sempre, então uma instância
// reconectada com outro número ficava com o número antigo até o restart do backend.
const NUMERO_TTL_MS = 60 * 60 * 1000;
const numeroCache = new Map<string, { numero: string | null; em: number }>();

// [AUDITORIA] LÓGICA: cópia mínima de `buscarPhoneNumberInstancia()` (`routes/whatsapp.ts`,
// função local não exportada) — número real via Evolution `fetchInstances` (ownerJid).
async function resolverNumeroInstancia(url: string, apiKey: string, instancia: string): Promise<string | null> {
  const c = numeroCache.get(instancia);
  if (c && Date.now() - c.em < NUMERO_TTL_MS) return c.numero;
  let numero: string | null = null;
  try {
    const r = await evolutionFetch(`${sanitizeEvolutionUrl(url)}/instance/fetchInstances?instanceName=${encodeURIComponent(instancia)}`, {
      headers: { apikey: apiKey },
    });
    if (r.ok) {
      const data: any = await r.json().catch(() => null);
      const info = Array.isArray(data) ? data[0] : null;
      numero = info?.ownerJid ? String(info.ownerJid).split('@')[0] : null;
    }
  } catch { /* numero continua null */ }
  numeroCache.set(instancia, { numero, em: Date.now() });
  return numero;
}

export async function instanciaConectada(url: string, apiKey: string, instancia: string): Promise<boolean> {
  try {
    const r = await evolutionFetch(`${sanitizeEvolutionUrl(url)}/instance/connectionState/${encodeURIComponent(instancia)}`, {
      headers: { apikey: apiKey },
    });
    if (!r.ok) return false;
    const d: any = await r.json().catch(() => null);
    return (d?.instance?.state || d?.state) === 'open';
  } catch {
    return false;
  }
}

/** Resolve (e persiste no par) o número das 2 pontas. Exportado pra rota de ativação. */
export async function resolverNumerosPar(pool: Pool, par: any): Promise<{ numeroA: string | null; numeroB: string | null }> {
  const [numeroA, numeroB] = await Promise.all([
    par.a_url && par.a_instancia ? resolverNumeroInstancia(par.a_url, par.a_key, par.a_instancia) : Promise.resolve(null),
    par.b_url && par.b_instancia ? resolverNumeroInstancia(par.b_url, par.b_key, par.b_instancia) : Promise.resolve(null),
  ]);
  if ((numeroA && numeroA !== par.numero_a) || (numeroB && numeroB !== par.numero_b)) {
    await pool.query(
      `UPDATE maturador_pares SET numero_a = COALESCE($1, numero_a), numero_b = COALESCE($2, numero_b) WHERE id = $3`,
      [numeroA, numeroB, par.id]
    ).catch(() => {});
    invalidarNumerosMaturador(par.user_id);
  }
  return { numeroA: numeroA || par.numero_a || null, numeroB: numeroB || par.numero_b || null };
}

export const SELECT_PARES_COM_CREDENCIAIS = `
  SELECT mp.*,
         a.evolution_server_url AS a_url, a.evolution_api_key AS a_key, a.evolution_instancia AS a_instancia,
         b.evolution_server_url AS b_url, b.evolution_api_key AS b_key, b.evolution_instancia AS b_instancia
  FROM maturador_pares mp
  JOIN agentes a ON a.id = mp.agente_a_id
  JOIN agentes b ON b.id = mp.agente_b_id`;

async function registrarFalha(pool: Pool, par: any, motivo: string): Promise<void> {
  const falhas = (par.falhas_consecutivas || 0) + 1;
  if (falhas >= MAX_FALHAS) {
    await pool.query(
      `UPDATE maturador_pares SET ativo = false, falhas_consecutivas = $1, pausado_motivo = $2, updated_at = NOW() WHERE id = $3`,
      [falhas, motivo, par.id]
    );
    log.warn('MATURADOR', 'Par auto-pausado após falhas seguidas', { parId: par.id, motivo });
  } else {
    // Recua 10 min antes de tentar de novo — não martela a Evolution a cada tick.
    await pool.query(
      `UPDATE maturador_pares SET falhas_consecutivas = $1, proxima_mensagem_em = NOW() + INTERVAL '10 minutes' WHERE id = $2`,
      [falhas, par.id]
    );
  }
}

// Evita ticks sobrepostos: com "digitando…" um tick pode passar de 1 min se houver muitos pares.
let rodando = false;

/**
 * Processa UM tick — no máximo 1 mensagem por par que esteja "devido". Erros por par são
 * isolados (uma falha de envio/instância desconectada não derruba os outros pares).
 */
export async function processarMaturador(pool: Pool): Promise<{ processados: number; enviados: number }> {
  if (rodando) return { processados: 0, enviados: 0 };
  rodando = true;
  let processados = 0;
  let enviados = 0;
  try {
    const { rows: pares } = await pool.query(
      `${SELECT_PARES_COM_CREDENCIAIS}
       WHERE mp.ativo = true AND mp.banido_em IS NULL
         AND (mp.proxima_mensagem_em IS NULL OR mp.proxima_mensagem_em <= NOW())`
    );
    const { hora, data: hoje } = agoraBrasilia();

    for (const par of pares) {
      processados++;
      try {
        if (!dentroDaJanela(hora, par.hora_inicio ?? 8, par.hora_fim ?? 21)) continue;

        // Reset diário pela data de Brasília (contador do par, exibido na tela).
        const resetadoEm = par.contador_resetado_em ? new Date(par.contador_resetado_em).toISOString().slice(0, 10) : null;
        let contadorDia = par.contador_dia;
        if (resetadoEm !== hoje) {
          contadorDia = 0;
          await pool.query(`UPDATE maturador_pares SET contador_dia = 0, contador_resetado_em = $2::date WHERE id = $1`, [par.id, hoje]);
        }

        const remetente: 'a' | 'b' = par.ultimo_remetente === 'a' ? 'b' : 'a';
        const de = remetente === 'a'
          ? { id: par.agente_a_id, url: par.a_url, key: par.a_key, instancia: par.a_instancia }
          : { id: par.agente_b_id, url: par.b_url, key: par.b_key, instancia: par.b_instancia };
        const para = remetente === 'a'
          ? { id: par.agente_b_id, url: par.b_url, key: par.b_key, instancia: par.b_instancia }
          : { id: par.agente_a_id, url: par.a_url, key: par.a_key, instancia: par.a_instancia };

        if (!de.url || !de.instancia || !para.url || !para.instancia) {
          await registrarFalha(pool, par, 'Uma das instâncias está sem credenciais da Evolution');
          continue;
        }

        // Teto diário pela fase de maturação do par, contando o que a instância REMETENTE já
        // mandou hoje em TODOS os pares dela.
        const diasRemetente = Math.max(0, Math.floor((Date.now() - new Date(par.data_inicio).getTime()) / 86_400_000));
        const limite = limiteDiarioPorIdade(diasRemetente);
        const { rows: [{ total: enviadosHoje }] } = await pool.query(
          `SELECT COUNT(*)::int AS total FROM maturador_mensagens
           WHERE de_agente_id = $1 AND (created_at AT TIME ZONE '${TZ}')::date = $2::date`,
          [de.id, hoje]
        );
        if (enviadosHoje >= limite) continue;

        const [deOk, paraOk] = await Promise.all([
          instanciaConectada(de.url, de.key, de.instancia),
          instanciaConectada(para.url, para.key, para.instancia),
        ]);
        if (!deOk || !paraOk) {
          await registrarFalha(pool, par, `Instância desconectada: ${!deOk ? de.instancia : para.instancia}`);
          continue;
        }

        const { numeroA, numeroB } = await resolverNumerosPar(pool, par);
        const numeroDestino = remetente === 'a' ? numeroB : numeroA;
        const numeroRemetente = remetente === 'a' ? numeroA : numeroB;
        if (!numeroDestino || !numeroRemetente) {
          await registrarFalha(pool, par, 'Não foi possível descobrir o número de uma das instâncias');
          continue;
        }

        const baseUrl = sanitizeEvolutionUrl(de.url);

        // Marca como lida a última mensagem que esta ponta recebeu, antes de "responder".
        if (par.ultima_msg_id) {
          await evolutionFetch(`${baseUrl}/chat/markMessageAsRead/${de.instancia}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: de.key },
            body: JSON.stringify({ readMessages: [{ remoteJid: `${numeroDestino}@s.whatsapp.net`, fromMe: false, id: par.ultima_msg_id }] }),
          }).catch(() => null);
        }

        // De vez em quando (12%) reage com emoji à mensagem recebida antes de responder.
        if (par.ultima_msg_id && Math.random() < 0.12) {
          const reacao = REACOES[randInt(0, REACOES.length - 1)];
          const r = await evolutionFetch(`${baseUrl}/message/sendReaction/${de.instancia}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: de.key },
            body: JSON.stringify({ key: { remoteJid: `${numeroDestino}@s.whatsapp.net`, fromMe: false, id: par.ultima_msg_id }, reaction: reacao }),
          }).catch(() => null);
          if (r?.ok) {
            await pool.query(
              `INSERT INTO maturador_mensagens (par_id, user_id, de_agente_id, para_agente_id, tipo, texto) VALUES ($1, $2, $3, $4, 'reacao', $5)`,
              [par.id, par.user_id, de.id, para.id, reacao]
            ).catch(() => {});
          }
        }

        let novoTema: number | null = par.tema_atual ?? null;
        let novaLinha: number = par.linha_atual ?? 0;
        if (novoTema === null || novoTema >= TEMAS.length || novaLinha >= TEMAS[novoTema].length) {
          novoTema = sortearTema(par.tema_atual ?? null);
          novaLinha = 0;
        }
        const texto = aplicarVariacao(TEMAS[novoTema][novaLinha]);
        const resp = await evolutionFetch(`${baseUrl}/message/sendText/${de.instancia}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: de.key },
          body: JSON.stringify({ number: numeroDestino, text: texto, delay: delayDigitacaoMs(texto) }),
        });
        if (!resp.ok) {
          const errBody = await resp.text().catch(() => '');
          await registrarFalha(pool, par, `Evolution ${resp.status} ao enviar: ${errBody.slice(0, 120)}`);
          continue;
        }
        const body: any = await resp.json().catch(() => null);
        const messageId: string | null = body?.key?.id || null;
        registrarIdMaturador(messageId);
        novaLinha++;

        await pool.query(
          `INSERT INTO maturador_mensagens (par_id, user_id, de_agente_id, para_agente_id, message_id, tipo, texto)
           VALUES ($1, $2, $3, $4, $5, 'texto', $6)`,
          [par.id, par.user_id, de.id, para.id, messageId, texto]
        );

        // Ritmo: sessão de 3–7 trocas com resposta em 1–4 min; acabou a sessão, pausa de 40–150 min.
        let restantes = par.msgs_restantes_sessao > 0 ? par.msgs_restantes_sessao : randInt(3, 7);
        restantes--;
        const proximaMin = restantes > 0 ? rand(1, 4) : rand(40, 150);

        await pool.query(
          `UPDATE maturador_pares
           SET ultimo_remetente = $1, ultima_mensagem_em = NOW(), tema_atual = $2, linha_atual = $3,
               contador_dia = $4, msgs_restantes_sessao = $5,
               proxima_mensagem_em = NOW() + ($6 || ' minutes')::interval,
               ultima_msg_id = COALESCE($7, ultima_msg_id),
               falhas_consecutivas = 0, pausado_motivo = NULL, updated_at = NOW()
           WHERE id = $8`,
          [remetente, novoTema, novaLinha, contadorDia + 1, restantes, proximaMin.toFixed(2), messageId, par.id]
        );
        enviados++;
        log.info('MATURADOR', 'Mensagem de maturação enviada', { parId: par.id, de: de.instancia, para: para.instancia });
      } catch (err: any) {
        log.warn('MATURADOR', 'Falha ao processar par', { parId: par.id, err: err?.message });
        await registrarFalha(pool, par, `Erro inesperado: ${String(err?.message || err).slice(0, 120)}`).catch(() => {});
      }
    }
  } finally {
    rodando = false;
  }
  return { processados, enviados };
}
