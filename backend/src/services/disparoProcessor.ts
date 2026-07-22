import { Pool } from 'pg';
import { humanizarMensagem } from './humanizationService';
import { botSentTexts, botMessageIds } from './agentEngine';
import { evolutionFetch, sanitizeEvolutionUrl, withAiFallback } from '../utils/resilientFetch';
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
    // 1. Buscar lote de mensagens pendentes usando a função SQL atômica
    const batch = await pool.query('SELECT * FROM public.get_next_disparo_batch(5)');
    
    if (!batch.rows.length) return;

    log.info('DISPARO', 'Processando lote de mensagens', { tamanhoLote: batch.rows.length });

    let errosConsecutivos = 0;
    let ultimaCampanhaId = '';

    for (let i = 0; i < batch.rows.length; i++) {
      const msg = batch.rows[i];
      const { log_id, disparo_id, user_id, telefone, mensagem, tipo_midia, url_midia, legenda_midia } = msg;

      // Reset do contador de falhas consecutivas ao mudar de campanha dentro do mesmo lote
      if (disparo_id !== ultimaCampanhaId) {
        errosConsecutivos = 0;
        ultimaCampanhaId = disparo_id;
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
        // 2. Buscar config da Evolution API (primeiro em integracoes_config, depois em agentes, depois default)
        let config: { url: string; api_key: string; instancia: string } | null = null;

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
        let endpoint = `${baseUrl}/message/sendText/${instancia}`;
        let body: any = { number: digits, text: textoFinal };

        if (tipo_midia === 'imagem' && url_midia) {
          endpoint = `${baseUrl}/message/sendMedia/${instancia}`;
          body = { 
            number: digits, 
            media: url_midia, 
            mediatype: 'image', 
            caption: legendaFinal 
          };
        } else if (tipo_midia === 'audio' && url_midia) {
          endpoint = `${baseUrl}/message/sendWhatsAppAudio/${instancia}`;
          body = { number: digits, audio: url_midia };
        } else if (tipo_midia === 'documento' && url_midia) {
          endpoint = `${baseUrl}/message/sendMedia/${instancia}`;
          body = { 
            number: digits, 
            media: url_midia, 
            mediatype: 'document', 
            fileName: legendaFinal || 'documento' 
          };
        }

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
        }, 120_000);

        const resp = await evolutionFetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: api_key },
          body: JSON.stringify(body),
        });

        if (!resp.ok) {
          const errBody = await resp.text().catch(() => '');
          throw new Error(`Evolution API ${resp.status}: ${errBody}`);
        }

        const respData = await resp.json().catch(() => ({}));
        const realMsgId = respData?.key?.id || `disparo_${log_id}`;

        if (respData?.key?.id) {
          botMessageIds.add(respData.key.id);
          setTimeout(() => botMessageIds.delete(respData.key.id), 120_000);
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
            tipo_midia !== 'texto' && url_midia ? url_midia : null,
            tipo_midia === 'imagem' ? 'image/jpeg' : tipo_midia === 'audio' ? 'audio/ogg' : tipo_midia === 'documento' ? 'application/pdf' : null
          ]
        )).catch(err => log.error('DISPARO INSERT whatsapp_messages ERROR', 'Falha ao inserir whatsapp_messages', { err: err?.message, stack: err?.stack }));

        // Sucesso no envio: reseta o contador de falhas consecutivas
        errosConsecutivos = 0;

        // 5. Atualizar status para enviado
        await pool.query(
          `UPDATE disparo_logs SET status = 'sent', enviado_at = NOW(), erro = NULL WHERE id = $1`,
          [log_id]
        );
        await pool.query(
          `UPDATE disparos SET enviados = enviados + 1 WHERE id = $1`,
          [disparo_id]
        );

      } catch (err: any) {
        log.error('DISPARO', 'Erro no log', { logId: log_id, err: err?.message, stack: err?.stack });

        // Marcar falha no log
        await pool.query(
          `UPDATE disparo_logs SET status = 'failed', erro = $1 WHERE id = $2`,
          [err.message, log_id]
        );

        // Incrementar falhas na campanha
        await pool.query(
          `UPDATE disparos SET falhas = falhas + 1 WHERE id = $1`,
          [disparo_id]
        );

        // [AUDITORIA] FIX APLICADO (Sprint 5): pausa automática por erros consecutivos (anti-ban).
        // Respeita a flag pausa_erros_consecutivos da campanha; ao atingir o limite, muda o
        // status para 'pausado' e reenfileira o restante do lote (evita perder mensagens que
        // get_next_disparo_batch já havia marcado 'sending').
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

      // [AUDITORIA] FIX APLICADO (Sprint 4): Calcula o delay dinâmico antiban com base no perfil de velocidade
      // configurado por campanha, evitando o padrão mecânico fixo de 1.5s.
      let delayMs = 1500;
      try {
        const campanhaRes = await pool.query(
          `SELECT perfil_velocidade FROM disparos WHERE id = $1 LIMIT 1`,
          [disparo_id]
        );
        if (campanhaRes.rows.length) {
          const perfil = String(campanhaRes.rows[0].perfil_velocidade).toLowerCase();
          if (perfil === 'slow' || perfil === 'seguro' || perfil === 'safe') {
            // Delay ultra seguro: entre 15s e 30s variáveis
            delayMs = Math.floor(Math.random() * (30000 - 15000) + 15000);
          } else if (perfil === 'normal') {
            // Delay normal: entre 5s e 12s variáveis
            delayMs = Math.floor(Math.random() * (12000 - 5000) + 5000);
          } else if (perfil === 'fast' || perfil === 'rapido') {
            // Delay rápido: entre 1.5s e 4s variáveis
            delayMs = Math.floor(Math.random() * (4000 - 1500) + 1500);
          }
        }
      } catch (errDb: any) {
        log.warn('DISPARO', 'Falha ao buscar perfil_velocidade para delay, usando default 1.5s', { err: errDb.message });
      }

      log.info('DISPARO', 'Aguardando delay antiban antes de prosseguir', { disparo_id, delayMs });
      await sleep(delayMs);
    }
  } catch (err: any) {
    log.error('DISPARO', 'Erro crítico no motor de processamento', { err: err?.message, stack: err?.stack });
  }
}
