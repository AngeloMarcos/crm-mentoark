import { Pool } from 'pg';
import { humanizarMensagem } from './humanizationService';
import { botSentTexts, botMessageIds, BOT_ECHO_TTL_MS } from './agentEngine';
import { evolutionFetch, sanitizeEvolutionUrl, withAiFallback } from '../utils/resilientFetch';
import { garantirMidiaEstavel } from '../utils/whatsappMediaStorage';
import { withTenantContext } from '../db';
import { log } from '../logger';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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

// [AUDITORIA] BUG (Sprint Disparos/Multi-instância, 2026-07-25): `disparos.instancias_ids` é
// preenchido pela tela (StepAntiBan) mas nunca era lido aqui — a resolução de config abaixo
// sempre pegava UMA linha arbitrária de `integracoes_config`/`agentes` (sem ORDER BY
// determinístico por instância selecionada), então marcar 1 ou 5 instâncias na tela dava o
// mesmo resultado: tudo saindo por um único número. Isso anulava o propósito anti-ban da tela
// (distribuir volume entre chips). [AUDITORIA] FIX APLICADO: cache por campanha (mesmo padrão
// de `humanizarCache`/`urlMidiaEstavelPorCampanha`) resolve `instancias_ids` -> linhas de
// `agentes` uma vez, e `proximaInstanciaRoundRobin` alterna entre elas a cada mensagem enviada
// da campanha. Campanhas sem `instancias_ids` (vazias, ou criadas antes deste fix) caem no
// fallback original (`integracoes_config` -> `agentes` ativo -> defaults de env), sem quebrar
// nada existente.
interface InstanciaElegivel {
  url: string;
  api_key: string;
  instancia: string;
}
const instanciasCampanhaCache = new Map<string, { instancias: InstanciaElegivel[]; proximoIndex: number }>();

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

  instanciasCampanhaCache.set(disparoId, { instancias, proximoIndex: 0 });
  return instancias;
}

function proximaInstanciaRoundRobin(disparoId: string): InstanciaElegivel | null {
  const cache = instanciasCampanhaCache.get(disparoId);
  if (!cache || !cache.instancias.length) return null;
  const escolhida = cache.instancias[cache.proximoIndex % cache.instancias.length];
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

export async function processarDisparos(pool: Pool) {
  try {
    // [AUDITORIA] FIX APLICADO (Sprint Disparos/Agendamento, 2026-07-25): promove campanhas
    // agendadas ('rascunho' + agendado_para no passado) para 'em_andamento' antes de buscar o
    // lote — sem isso elas nunca eram pegas por get_next_disparo_batch (ver
    // promover_disparos_agendados() em migrations.ts para o achado completo). Roda a cada tick
    // de 2s deste motor, não no cron de 5min, para respeitar o horário agendado com precisão.
    await pool.query('SELECT promover_disparos_agendados()')
      .catch(err => log.warn('DISPARO', 'Falha ao promover campanhas agendadas', { err: err?.message }));

    // 1. Buscar lote de mensagens pendentes usando a função SQL atômica
    const batch = await pool.query('SELECT * FROM public.get_next_disparo_batch(5)');
    
    if (!batch.rows.length) return;

    log.info('DISPARO', 'Processando lote de mensagens', { tamanhoLote: batch.rows.length });

    let errosConsecutivos = 0;
    let ultimaCampanhaId = '';
    // [AUDITORIA] LÓGICA (Sprint 5 — salvaguarda antiban de teto diário): um único lote pode
    // conter mensagens de campanhas diferentes (get_next_disparo_batch não filtra por
    // campanha). Se a checagem de teto pausar a campanha A no meio do lote, as mensagens
    // seguintes da campanha A que já vieram claimadas ('sending') neste mesmo lote precisam
    // ser puladas e reenfileiradas também — sem isso, a campanha ficaria com status
    // 'pausado' mas o loop continuaria enviando as mensagens restantes dela normalmente.
    const campanhasPausadasNesteLote = new Set<string>();
    // [AUDITORIA] FIX APLICADO (Sprint 6, item 1 — mídia expirada em campanhas de múltiplos
    // dias, 2026-07-23): `disparos.url_midia` é compartilhado por TODOS os destinatários da
    // campanha — sem cache, o mesmo link externo instável seria re-testado (e continuaria
    // quebrado) em cada uma das centenas/milhares de mensagens. Estabiliza uma vez por
    // campanha por execução deste lote (ver bloco de transição de campanha abaixo) e persiste
    // de volta em `disparos.url_midia`, então a partir da PRÓXIMA leitura (mesmo lote ou dias
    // depois) `get_next_disparo_batch()` já devolve a URL estável direto, sem precisar
    // recachear.
    const urlMidiaEstavelPorCampanha = new Map<string, string>();

    for (let i = 0; i < batch.rows.length; i++) {
      const msg = batch.rows[i];
      const { log_id, disparo_id, user_id, telefone, mensagem, tipo_midia, url_midia, legenda_midia } = msg;

      if (campanhasPausadasNesteLote.has(disparo_id)) {
        await requeuePendentes(pool, [{ log_id }]);
        continue;
      }

      // Reset do contador de falhas consecutivas ao mudar de campanha dentro do mesmo lote
      if (disparo_id !== ultimaCampanhaId) {
        errosConsecutivos = 0;
        ultimaCampanhaId = disparo_id;

        // [AUDITORIA] FIX APLICADO (Sprint 5 — salvaguarda antiban de teto diário, 2026-07-23):
        // antes de processar a primeira mensagem de uma campanha neste lote, conta quantas
        // mensagens já foram efetivamente ENVIADAS (status='sent') pelo dono da campanha nas
        // últimas 24h corridas, em TODAS as campanhas dele — não só nesta. Escopo é por
        // user_id (não por instância/chip individual): disparo_logs não guarda qual instância
        // Evolution enviou cada mensagem, só o dono da campanha, então não dá pra somar por
        // instância sem antes adicionar essa coluna. [AUDITORIA] FIX PENDENTE (motivo: exige
        // migração de schema — adicionar `instancia` em disparo_logs, preenchida no INSERT do
        // log e no envio real — pra permitir teto por número/chip em vez de por conta inteira,
        // relevante agora que multi-instância existe). Teto configurável por campanha
        // (`disparos.limite_diario_mensagens`, default 500) — mesmo padrão já usado por
        // `limite_erros_consecutivos`.
        try {
          const capMetaRes = await pool.query(
            `SELECT user_id, COALESCE(limite_diario_mensagens, 500) AS limite_diario_mensagens
             FROM disparos WHERE id = $1 LIMIT 1`,
            [disparo_id]
          );
          if (capMetaRes.rows.length) {
            const donoCampanha = capMetaRes.rows[0].user_id;
            const limiteDiario = Number(capMetaRes.rows[0].limite_diario_mensagens) || 500;
            const contagemRes = await pool.query(
              `SELECT COUNT(*) AS total FROM disparo_logs
               WHERE user_id = $1 AND status = 'sent' AND enviado_at >= NOW() - INTERVAL '24 hours'`,
              [donoCampanha]
            );
            const enviados24h = Number(contagemRes.rows[0]?.total || 0);

            if (enviados24h >= limiteDiario) {
              log.warn('DISPARO', 'Teto diário de segurança atingido — pausando campanha automaticamente', {
                disparo_id, donoCampanha, enviados24h, limiteDiario,
              });
              const aviso = 'Limite diário de segurança atingido. Retomando automaticamente amanhã.';
              await pool.query(
                `UPDATE disparos
                 SET status = 'pausado', aviso = $2, pausado_em = NOW(), pausado_motivo = 'limite_diario', updated_at = NOW()
                 WHERE id = $1`,
                [disparo_id, aviso]
              );
              campanhasPausadasNesteLote.add(disparo_id);
              await requeuePendentes(pool, [{ log_id }]);
              continue;
            }
          }
        } catch (errCap: any) {
          log.warn('DISPARO', 'Erro ao verificar teto diário de segurança, continuando por precaução', { disparo_id, err: errCap.message });
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
            await requeuePendentes(pool, batch.rows.slice(i));
            break;
          }

          const inicio = horario_inicio ? Number(String(horario_inicio).split(':')[0]) : 8;
          const fim = horario_fim ? Number(String(horario_fim).split(':')[0]) : 21;

          if (horaSP < inicio || horaSP >= fim) {
            log.info('DISPARO', 'Campanha suspensa: fora da janela de horário comercial permitida', { disparo_id, horaSP, inicio, fim });
            await requeuePendentes(pool, batch.rows.slice(i));
            break;
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
          continue;
        }

        // 2. Buscar config da Evolution API. Prioridade: instâncias selecionadas na campanha
        //    (round-robin, ver resolverInstanciasCampanha/proximaInstanciaRoundRobin acima) ->
        //    integracoes_config -> agentes ativo -> defaults de env.
        let config: { url: string; api_key: string; instancia: string } | null = null;

        const instanciasElegiveis = await resolverInstanciasCampanha(pool, disparo_id, user_id);
        if (instanciasElegiveis.length) {
          config = proximaInstanciaRoundRobin(disparo_id);
        }

        if (!config) {
          const integracaoRes = await pool.query(
            `SELECT url, api_key, instancia FROM integracoes_config
             WHERE user_id = $1 AND tipo = 'evolution' AND status IN ('ativo','conectado')
             LIMIT 1`,
            [user_id]
          );

          if (integracaoRes.rows.length) {
            config = integracaoRes.rows[0];
          } else {
            const agenteRes = await pool.query(
              `SELECT evolution_server_url AS url, evolution_api_key AS api_key, evolution_instancia AS instancia
               FROM agentes
               WHERE user_id = $1 AND ativo = true
               ORDER BY updated_at DESC LIMIT 1`,
              [user_id]
            );
            if (agenteRes.rows.length && agenteRes.rows[0].url) {
              config = agenteRes.rows[0];
            }
          }
        }

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

        // 3.1. Humanizar mensagem via IA — withAiFallback garante que erros 401/429
        //      não travam o disparo; a mensagem original é usada como contingência.
        let textoFinal: string = mensagem;
        let legendaFinal: string = legenda_midia || mensagem;
        if (await deveHumanizar(pool, disparo_id)) {
          if (tipo_midia === 'texto' || !tipo_midia) {
            textoFinal = await withAiFallback(
              () => humanizarMensagem(mensagem),
              mensagem,
              'humanizarMensagem(texto)',
            );
          } else if (legenda_midia) {
            legendaFinal = await withAiFallback(
              () => humanizarMensagem(legenda_midia),
              legenda_midia,
              'humanizarMensagem(legenda)',
            );
          }
        }

        // 4. Enviar mensagem
        // Usa a URL estável já cacheada pra esta campanha (ver bloco de transição de campanha
        // acima), com fallback pra `url_midia` crua se a estabilização falhou/não rodou.
        const urlMidiaFinal = urlMidiaEstavelPorCampanha.get(disparo_id) || url_midia;
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

        const respData = await resp.json().catch(() => ({}));
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

        // Sucesso no envio: reseta o contador de falhas consecutivas
        errosConsecutivos = 0;

        // 5. Atualizar status para enviado
        await pool.query(
          `UPDATE disparo_logs SET status = 'sent', enviado_at = NOW(), erro = NULL, instancia = $2 WHERE id = $1`,
          [log_id, instancia]
        );
        await pool.query(
          `UPDATE disparos SET enviados = enviados + 1 WHERE id = $1`,
          [disparo_id]
        );

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
          errosConsecutivos++;
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
              await requeuePendentes(pool, batch.rows.slice(i + 1));
              break;
            }
          } catch (errDb: any) {
            log.warn('DISPARO', 'Erro ao processar limite de erros consecutivos', { err: errDb.message });
          }
        }
      }

      // [AUDITORIA] FIX APLICADO (2026-07-23): a tela (src/pages/Disparos.tsx) manda literalmente
      // "safe"/"moderate"/"fast" e promete 30-60s/15-30s/5-15s — mas esse switch só reconhecia
      // 'slow'/'seguro'/'safe', 'normal', 'fast'/'rapido', com faixas que NÃO batiam com o que a
      // tela promete. "moderate" (a opção recomendada) não batia com nenhum branch e caía no
      // default `delayMs = 1500` FIXO, sem aleatoriedade nenhuma — mais rápido e mais mecânico
      // que o próprio "RÁPIDO" (que pelo menos tinha jitter). Faixas agora alinhadas com a tela;
      // 'normal'/'seguro'/'slow'/'rapido' mantidos como aliases legados (campanha antiga pode ter
      // gravado esse valor). Perfil desconhecido cai no perfil mais seguro (nunca mais um valor
      // fixo sem jitter), por precaução.
      const FAIXAS_DELAY_MS: Record<string, [number, number]> = {
        safe: [30000, 60000],
        moderate: [15000, 30000],
        fast: [5000, 15000],
      };
      const ALIAS_PERFIL: Record<string, string> = {
        seguro: 'safe', slow: 'safe',
        normal: 'moderate',
        rapido: 'fast',
      };

      let delayMs: number;
      try {
        const campanhaRes = await pool.query(
          `SELECT perfil_velocidade FROM disparos WHERE id = $1 LIMIT 1`,
          [disparo_id]
        );
        const perfilBruto = String(campanhaRes.rows[0]?.perfil_velocidade || '').toLowerCase();
        const perfil = FAIXAS_DELAY_MS[perfilBruto] ? perfilBruto : (ALIAS_PERFIL[perfilBruto] || 'safe');
        const [min, max] = FAIXAS_DELAY_MS[perfil];
        delayMs = Math.floor(Math.random() * (max - min) + min);
      } catch (errDb: any) {
        log.warn('DISPARO', 'Falha ao buscar perfil_velocidade para delay, usando faixa segura', { err: errDb.message });
        const [min, max] = FAIXAS_DELAY_MS.safe;
        delayMs = Math.floor(Math.random() * (max - min) + min);
      }

      log.info('DISPARO', 'Aguardando delay antiban antes de prosseguir', { disparo_id, delayMs });
      await sleep(delayMs);
    }
  } catch (err: any) {
    log.error('DISPARO', 'Erro crítico no motor de processamento', { err: err?.message, stack: err?.stack });
  }
}
