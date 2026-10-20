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
import { TEMAS, REACOES, aplicarVariacao, sortearTema, ENQUETES, MENSAGENS_MENTORIA } from './maturadorDialogos';
import { gerarRoteiro, humanizar, personaDoChip, Roteiro } from './maturadorIA';
import { chancesMidia, midiasHoje, TETO_DIA_CHIP, prepararFoto, gerarAudio, figurinhaAleatoria } from './maturadorMidia';
import { montarStatus, destinatariosStatus, marcarPublicado } from './maturadorStatus';

/** Sprint 8 (v5): valor de `tema_atual` que indica roteiro escrito por IA (maturador_pares.roteiro_ia). */
export const TEMA_IA = -1;
import { bloqueioEnvio, reconectouRecente, podeResponderMaturador, MAX_MENTORIA_DIA_MENTOR, MAX_RECEBIDAS_DIA_RECEPTOR } from './maturadorGlobal';
import { registrarIdMaturador, invalidarNumerosMaturador } from './maturadorFiltro';
import { saudePorInstancia, MAX_ENVIOS_HORA } from './saudeNumero';
import { controlesDe, velocidadeEfetiva, FATOR_VELOCIDADE, dormindo, horaDeStatus } from './maturadorControles';

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

/**
 * 2026-10-17: todos os pares começavam exatamente na hora cheia (8h) — vários números no mesmo IP
 * disparando juntos. Cada par ganha um atraso fixo de 0–55 min na 1ª hora da janela (derivado do
 * id, estável entre dias, diferente entre pares).
 */
export function atrasoInicioMin(parId: string): number {
  return [...String(parId)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 17) % 56;
}

function minutoBrasilia(): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, minute: '2-digit' }).format(new Date()));
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
        // Sprint 7 (v5): o chip dorme 00–07 — nada sai, seja qual for a janela do par.
        if (dormindo(hora)) continue;
        if (!dentroDaJanela(hora, par.hora_inicio ?? 8, par.hora_fim ?? 21)) continue;
        if (hora === (par.hora_inicio ?? 8) && minutoBrasilia() < atrasoInicioMin(par.id)) continue;

        // Reset diário pela data de Brasília (contador do par, exibido na tela).
        const resetadoEm = par.contador_resetado_em ? new Date(par.contador_resetado_em).toISOString().slice(0, 10) : null;
        let contadorDia = par.contador_dia;
        if (resetadoEm !== hoje) {
          contadorDia = 0;
          await pool.query(`UPDATE maturador_pares SET contador_dia = 0, contador_resetado_em = $2::date WHERE id = $1`, [par.id, hoje]);
        }

        let remetente: 'a' | 'b' = par.ultimo_remetente === 'a' ? 'b' : 'a';
        // Sprint 9 (2026-10-06): TRAVA UNIVERSAL — número novo/em proteção/quarentena/revisão não
        // envia NADA (nem no par da própria conta). Se a vez é dele, quem escreve é o outro lado em
        // "modo mentoria" (só ele fala, ritmo de ~2h, sem reação/citação/enquete/status); se os dois
        // estão travados, o par espera. Vínculo global do tipo 'mentoria': sempre a = mentor.
        const soRecebeA = await bloqueioEnvio(pool, par.a_instancia);
        const soRecebeB = await bloqueioEnvio(pool, par.b_instancia);
        // Sprint 7 (v5): controle "Conversas" desligado = o chip não puxa conversa, só responde.
        const ctrlA = await controlesDe(pool, par.agente_a_id);
        const ctrlB = await controlesDe(pool, par.agente_b_id);
        const bloqA = soRecebeA || (!ctrlA.conversas ? 'conversas desligadas pelo usuário' : null);
        const bloqB = soRecebeB || (!ctrlB.conversas ? 'conversas desligadas pelo usuário' : null);
        // Sprint 4 (2026-10-17): lado que "só recebe" mas já está no Aquecimento 2+ pode RESPONDER
        // (nunca iniciar) — vira conversa de mão dupla em vez de mentoria de mão única. Chip com
        // conversas desligadas (e livre de trava) também só responde.
        const saudeFases = await saudePorInstancia(pool);
        const respondeA = !!bloqA && (soRecebeA ? podeResponderMaturador(saudeFases.get(par.a_instancia)) : true);
        const respondeB = !!bloqB && (soRecebeB ? podeResponderMaturador(saudeFases.get(par.b_instancia)) : true);
        let modoMentoria = par.tipo === 'mentoria';
        let respostaDeNovo = false;
        if (modoMentoria) {
          // Vínculo global de mentoria: a = mentor. O receptor responde se já pode e o mentor falou por último.
          remetente = par.ultimo_remetente === 'a' && respondeB ? 'b' : 'a';
          if (remetente === 'b') { modoMentoria = false; respostaDeNovo = true; }
        } else if (bloqA && bloqB) {
          await pool.query(`UPDATE maturador_pares SET proxima_mensagem_em = NOW() + INTERVAL '60 minutes' WHERE id = $1`, [par.id]).catch(() => {});
          continue;
        } else if (bloqA || bloqB) {
          const livre: 'a' | 'b' = bloqA ? 'b' : 'a';
          const travado: 'a' | 'b' = bloqA ? 'a' : 'b';
          const travadoResponde = bloqA ? respondeA : respondeB;
          if (travadoResponde && par.ultimo_remetente === livre) { remetente = travado; respostaDeNovo = true; }
          else { remetente = livre; modoMentoria = !travadoResponde; }
        }
        if ((remetente === 'a' ? bloqA : bloqB) && !respostaDeNovo) continue; // mentor travado (ex.: caiu em quarentena)
        // 2026-10-06: quem acabou de (re)conectar espera 3h antes de enviar qualquer coisa.
        if (await reconectouRecente(pool, remetente === 'a' ? par.a_instancia : par.b_instancia)) {
          await pool.query(`UPDATE maturador_pares SET proxima_mensagem_em = NOW() + INTERVAL '30 minutes' WHERE id = $1`, [par.id]).catch(() => {});
          continue;
        }
        const de = remetente === 'a'
          ? { id: par.agente_a_id, url: par.a_url, key: par.a_key, instancia: par.a_instancia }
          : { id: par.agente_b_id, url: par.b_url, key: par.b_key, instancia: par.b_instancia };
        const para = remetente === 'a'
          ? { id: par.agente_b_id, url: par.b_url, key: par.b_key, instancia: par.b_instancia }
          : { id: par.agente_a_id, url: par.a_url, key: par.a_key, instancia: par.a_instancia };

        if (modoMentoria) {
          // Receptor recebe no máximo 6 mensagens do maturador por dia (somando todos os
          // remetentes); cada remetente manda no máximo 3 mensagens de mentoria por dia.
          const cotas = (await pool.query(
            `SELECT COUNT(*) FILTER (WHERE para_agente_id = $1 AND tipo = 'texto')::int AS recebidas,
                    COUNT(*) FILTER (WHERE de_agente_id = $2 AND mentoria)::int AS mentoria_enviadas
             FROM maturador_mensagens WHERE (created_at AT TIME ZONE '${TZ}')::date = $3::date AND (para_agente_id = $1 OR de_agente_id = $2)`,
            [para.id, de.id, hoje]
          ).catch(() => ({ rows: [{ recebidas: 99, mentoria_enviadas: 99 }] }))).rows[0];
          if (cotas.recebidas >= MAX_RECEBIDAS_DIA_RECEPTOR || cotas.mentoria_enviadas >= MAX_MENTORIA_DIA_MENTOR) {
            await pool.query(`UPDATE maturador_pares SET proxima_mensagem_em = NOW() + INTERVAL '3 hours' WHERE id = $1`, [par.id]).catch(() => {});
            continue;
          }
        }

        if (!de.url || !de.instancia || !para.url || !para.instancia) {
          await registrarFalha(pool, par, 'Uma das instâncias está sem credenciais da Evolution');
          continue;
        }

        // Teto diário pela fase de maturação do par, contando o que a instância REMETENTE já
        // mandou hoje em TODOS os pares dela.
        const diasRemetente = Math.max(0, Math.floor((Date.now() - new Date(par.data_inicio).getTime()) / 86_400_000));
        // Sprint 7 (v5): velocidade do chip remetente (travada em "lenta" no início) ajusta teto e pausas.
        const ctrlDe = remetente === 'a' ? ctrlA : ctrlB;
        const saudeDe = saudeFases.get(remetente === 'a' ? par.a_instancia : par.b_instancia);
        const vel = velocidadeEfetiva(ctrlDe.velocidade, { fase: saudeDe?.fase ?? null, primeira_conexao_em: (saudeDe as any)?.primeira_conexao_em ?? null });
        const fatorVel = FATOR_VELOCIDADE[vel.efetivo];
        const limite = Math.max(1, Math.floor(limiteDiarioPorIdade(diasRemetente) * fatorVel.teto));
        const { rows: [{ total: enviadosHoje }] } = await pool.query(
          `SELECT COUNT(*)::int AS total FROM maturador_mensagens
           WHERE de_agente_id = $1 AND (created_at AT TIME ZONE '${TZ}')::date = $2::date`,
          [de.id, hoje]
        );
        if (enviadosHoje >= limite) continue;

        // Etapa A (2026-10-05): teto de 30 envios/hora por número somando disparo + Maturador, e
        // nada sai de número em quarentena/banido (services/saudeNumero.ts).
        const saudeRemetente = (await saudePorInstancia(pool)).get(de.instancia);
        if (saudeRemetente && (saudeRemetente.envios_ultima_hora >= MAX_ENVIOS_HORA
          || saudeRemetente.fase === 'quarentena' || saudeRemetente.fase === 'banida')) continue;

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
        // (modo mentoria: o remetente não recebeu nada do receptor — não há o que marcar)
        if (par.ultima_msg_id && !modoMentoria) {
          await evolutionFetch(`${baseUrl}/chat/markMessageAsRead/${de.instancia}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: de.key },
            body: JSON.stringify({ readMessages: [{ remoteJid: `${numeroDestino}@s.whatsapp.net`, fromMe: false, id: par.ultima_msg_id }] }),
          }).catch(() => null);
        }

        // De vez em quando (12%) reage com emoji à mensagem recebida antes de responder.
        if (par.ultima_msg_id && !modoMentoria && Math.random() < 0.12) {
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

        // Sprint 8 (Sprint 3 / H10): status de texto neutro em ~40% dos dias (sorteio fixo por
        // número+dia), 1 por dia, visível SÓ para o parceiro do par (statusJidList) — nunca
        // aparece para os contatos reais do cliente.
        // Sprint 7 (v5, rotina ChipFlow): status só das 14h às 20h, no máximo 1 por dia, em ~80% dos dias,
        // e só com o controle "Publicar status" ligado.
        const diaDoStatus = [...`${de.id}${hoje}`].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 10 < 8;
        if (diaDoStatus && horaDeStatus(hora) && ctrlDe.status && !modoMentoria && !respostaDeNovo) {
          const jaPostou = (await pool.query(
            `SELECT 1 FROM maturador_mensagens WHERE de_agente_id = $1 AND tipo = 'status'
               AND (created_at AT TIME ZONE '${TZ}')::date = $2::date LIMIT 1`, [de.id, hoje]
          ).catch(() => ({ rows: [1] }))).rows.length > 0;
          if (!jaPostou) {
            // Sprint 10 (v5): status rico — fila de imagens/textos do chip, ou frase da IA (com foto
            // metade das vezes); visível só para os parceiros do maturador ou para todos os contatos.
            const st = await montarStatus(pool, { userId: par.user_id, agenteId: de.id });
            const destinos = await destinatariosStatus(pool, de.id, ctrlDe.status_visibilidade, numeroDestino);
            const rs = await evolutionFetch(`${baseUrl}/message/sendStatus/${de.instancia}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', apikey: de.key },
              body: JSON.stringify({ ...st.payload, ...destinos }),
            }).catch(() => null);
            if (rs?.ok && st.itemId) await marcarPublicado(pool, st.itemId);
            await pool.query(
              `INSERT INTO maturador_mensagens (par_id, user_id, de_agente_id, para_agente_id, tipo, texto) VALUES ($1, $2, $3, $4, 'status', $5)`,
              [par.id, par.user_id, de.id, para.id, rs?.ok ? st.descricao : `[falhou] ${st.descricao}`]
            ).catch(() => {});
          }
        }

        let novoTema: number | null = par.tema_atual ?? null;
        let novaLinha: number = par.linha_atual ?? 0;
        // Sprint 8 (v5): tema -1 = roteiro escrito por IA para esta sessão (maturador_pares.roteiro_ia).
        let roteiro: Roteiro | null = novoTema === TEMA_IA && Array.isArray(par.roteiro_ia?.linhas) ? par.roteiro_ia : null;
        const linhasDoTema = (t: number | null): string[] | null =>
          t === TEMA_IA ? roteiro?.linhas ?? null : t !== null && t >= 0 && t < TEMAS.length ? TEMAS[t] : null;
        const temaAcabou = !linhasDoTema(novoTema) || novaLinha >= linhasDoTema(novoTema)!.length;
        if (respostaDeNovo && temaAcabou) {
          // Número que só responde não abre tema novo (seria iniciar conversa): passa a vez ao parceiro.
          await pool.query(
            `UPDATE maturador_pares SET ultimo_remetente = $2, proxima_mensagem_em = NOW() + ($3 || ' minutes')::interval WHERE id = $1`,
            [par.id, remetente, rand(40, 150).toFixed(2)]
          ).catch(() => {});
          continue;
        }
        let roteiroNovo = false;
        if (temaAcabou && !modoMentoria) {
          // Sprint 8 (v5): tenta um roteiro inédito por IA; qualquer falha/teto cai no banco fixo.
          roteiro = await gerarRoteiro(pool, {
            userId: par.user_id, agenteQueAbre: de.id, agenteQueResponde: para.id,
            assuntoAnterior: par.roteiro_ia?.assunto ?? null,
          });
          roteiroNovo = !!roteiro;
          novoTema = roteiro ? TEMA_IA : sortearTema(par.tema_atual ?? null);
          novaLinha = 0;
        } else if (temaAcabou) {
          novoTema = sortearTema(par.tema_atual ?? null);
          novaLinha = 0;
        }
        // Sprint 8 (Sprint 3 / H10): de vez em quando (8%) abre um tema novo com uma enquete.
        if (novaLinha === 0 && !modoMentoria && !respostaDeNovo && Math.random() < 0.08) {
          const e = ENQUETES[randInt(0, ENQUETES.length - 1)];
          const rp = await evolutionFetch(`${baseUrl}/message/sendPoll/${de.instancia}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: de.key },
            body: JSON.stringify({ number: numeroDestino, name: e.pergunta, selectableCount: 1, values: e.opcoes }),
          }).catch(() => null);
          if (rp?.ok) {
            await pool.query(
              `INSERT INTO maturador_mensagens (par_id, user_id, de_agente_id, para_agente_id, tipo, texto) VALUES ($1, $2, $3, $4, 'enquete', $5)`,
              [par.id, par.user_id, de.id, para.id, e.pergunta]
            ).catch(() => {});
          }
        }

        // Sprint 9 (v5): áudio, foto e figurinha — fração cresce com a fase do remetente (0% em
        // Perfil/Aq1), só com o controle "Fotos e áudios" ligado e dentro do teto diário do chip.
        const chances = ctrlDe.midia && !modoMentoria ? chancesMidia(saudeDe?.fase) : chancesMidia(null);
        const temMidia = chances.audio + chances.foto + chances.figurinha > 0;
        const jaMandou = temMidia ? await midiasHoje(pool, de.id, hoje) : null;
        const sortearMidia = (tipo: 'audio' | 'foto' | 'figurinha') =>
          !!jaMandou && jaMandou[tipo] < TETO_DIA_CHIP[tipo] && Math.random() < chances[tipo];
        const enviarExtra = async (rota: string, payload: any, tipo: string, texto: string) => {
          const r = await evolutionFetch(`${baseUrl}/message/${rota}/${de.instancia}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: de.key },
            body: JSON.stringify({ number: numeroDestino, ...payload }),
          }).catch(() => null);
          if (!r?.ok) return;
          const id: string | null = ((await r.json().catch(() => null)) as any)?.key?.id || null;
          registrarIdMaturador(id, par.global === true);
          await pool.query(
            `INSERT INTO maturador_mensagens (par_id, user_id, de_agente_id, para_agente_id, message_id, tipo, texto) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [par.id, par.user_id, de.id, para.id, id, tipo, texto]
          ).catch(() => {});
        };
        // Foto só abrindo assunto (quem só responde não abre assunto).
        if (novaLinha === 0 && !respostaDeNovo && sortearMidia('foto')) {
          const f = await prepararFoto();
          if (f) {
            await enviarExtra('sendMedia', {
              mediatype: 'image', mimetype: 'image/jpeg', media: f.url, fileName: `IMG-${hoje.replace(/-/g, '')}-WA${randInt(1000, 9999)}.jpg`,
              caption: f.legenda, delay: randInt(2000, 5000),
            }, 'foto', f.legenda || '[foto]');
          }
        }

        // Modo mentoria: mensagem avulsa que não pede resposta (o receptor nunca responde) — tema e
        // linha da conversa ficam como estavam.
        const texto = modoMentoria
          ? aplicarVariacao(MENSAGENS_MENTORIA[randInt(0, MENSAGENS_MENTORIA.length - 1)])
          : novoTema === TEMA_IA
            ? humanizar(roteiro!.linhas[novaLinha], personaDoChip(de.id))
            : aplicarVariacao(TEMAS[novoTema!][novaLinha]);
        // Sprint 8 (Sprint 3 / H10): ~20% das respostas citam a mensagem anterior (quoted), como
        // gente de verdade faz em conversa.
        let quoted: any = undefined;
        if (par.ultima_msg_id && !modoMentoria && novaLinha > 0 && Math.random() < 0.2) {
          const anterior = (await pool.query(
            `SELECT texto FROM maturador_mensagens WHERE message_id = $1 AND tipo = 'texto' LIMIT 1`, [par.ultima_msg_id]
          ).catch(() => ({ rows: [] as any[] }))).rows[0]?.texto;
          if (anterior) quoted = { key: { id: par.ultima_msg_id, remoteJid: `${numeroDestino}@s.whatsapp.net`, fromMe: false }, message: { conversation: anterior } };
        }
        // Sprint 9 (v5): às vezes a fala vai como mensagem de voz ("gravando…" pelo tempo do áudio).
        // A voz lê a fala SEM os erros de digitação. Falhou o áudio → vai como texto.
        const falaLimpa = !modoMentoria && novoTema === TEMA_IA ? roteiro!.linhas[novaLinha] : texto;
        let tipoEnviado: 'texto' | 'audio' = 'texto';
        let resp: Response | null = null;
        if (sortearMidia('audio')) {
          const a = await gerarAudio(pool, par.user_id, de.id, falaLimpa);
          if (a) {
            const ra = await evolutionFetch(`${baseUrl}/message/sendWhatsAppAudio/${de.instancia}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', apikey: de.key },
              body: JSON.stringify({ number: numeroDestino, audio: a.url, delay: a.segundos * 1000 }),
            }).catch(() => null);
            if (ra?.ok) { resp = ra; tipoEnviado = 'audio'; }
          }
        }
        if (!resp) resp = await evolutionFetch(`${baseUrl}/message/sendText/${de.instancia}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: de.key },
          body: JSON.stringify({ number: numeroDestino, text: texto, delay: delayDigitacaoMs(texto), ...(quoted ? { quoted } : {}) }),
        });
        if (!resp.ok) {
          const errBody = await resp.text().catch(() => '');
          await registrarFalha(pool, par, `Evolution ${resp.status} ao enviar: ${errBody.slice(0, 120)}`);
          continue;
        }
        const body: any = await resp.json().catch(() => null);
        const messageId: string | null = body?.key?.id || null;
        registrarIdMaturador(messageId, par.global === true);
        const eraResposta = novaLinha > 0;
        if (!modoMentoria) novaLinha++;
        else { novoTema = par.tema_atual ?? null; novaLinha = par.linha_atual ?? 0; }

        await pool.query(
          `INSERT INTO maturador_mensagens (par_id, user_id, de_agente_id, para_agente_id, message_id, tipo, texto, mentoria)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [par.id, par.user_id, de.id, para.id, messageId, tipoEnviado, tipoEnviado === 'audio' ? falaLimpa : texto, modoMentoria]
        );
        // Sprint 9 (v5): figurinha de vez em quando logo depois de uma resposta.
        if (eraResposta && sortearMidia('figurinha')) {
          await enviarExtra('sendSticker', { sticker: figurinhaAleatoria(), delay: randInt(1000, 3000) }, 'figurinha', '[figurinha]');
        }

        // Ritmo: sessão de 3–7 trocas com resposta em 1–4 min; acabou a sessão, pausa de 40–150 min.
        // Modo mentoria: ~1 mensagem a cada 2h (100–160 min), sem sessão.
        let restantes = modoMentoria ? 0 : (par.msgs_restantes_sessao > 0 ? par.msgs_restantes_sessao : randInt(3, 7));
        if (!modoMentoria) restantes--;
        const proximaMin = (modoMentoria ? rand(100, 160) : restantes > 0 ? rand(1, 4) : rand(40, 150)) * fatorVel.pausa;

        await pool.query(
          `UPDATE maturador_pares
           SET ultimo_remetente = $1, ultima_mensagem_em = NOW(), tema_atual = $2, linha_atual = $3,
               contador_dia = $4, msgs_restantes_sessao = $5,
               proxima_mensagem_em = NOW() + ($6 || ' minutes')::interval,
               ultima_msg_id = COALESCE($7, ultima_msg_id),
               falhas_consecutivas = 0, pausado_motivo = NULL, updated_at = NOW(),
               roteiro_ia = CASE WHEN $9::boolean THEN $10::jsonb ELSE roteiro_ia END
           WHERE id = $8`,
          [remetente, novoTema, novaLinha, contadorDia + 1, restantes, proximaMin.toFixed(2), messageId, par.id,
           roteiroNovo, roteiroNovo ? JSON.stringify(roteiro) : null]
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
