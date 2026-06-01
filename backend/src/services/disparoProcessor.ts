import { humanizarMensagem } from './humanizationService';
import { botSentTexts, botMessageIds } from './agentEngine';

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

export async function processarDisparos(pool: Pool) {
  try {
    // 1. Buscar lote de mensagens pendentes usando a função SQL atômica
    const batch = await pool.query('SELECT * FROM public.get_next_disparo_batch(5)');
    
    if (!batch.rows.length) return;

    console.log(`[DISPARO] Processando lote de ${batch.rows.length} mensagens`);

    for (const msg of batch.rows) {
      const { log_id, disparo_id, user_id, telefone, mensagem, tipo_midia, url_midia, legenda_midia } = msg;

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
        
        const baseUrl = url.replace(/\/$/, '');


        // 3. Normalizar telefone
        const digits = telefone.replace(/\D/g, '');

        // 3.1. Humanizar mensagem via Claude se a campanha tiver a flag ligada
        let textoFinal: string = mensagem;
        let legendaFinal: string = legenda_midia || mensagem;
        if (await deveHumanizar(pool, disparo_id)) {
          if (tipo_midia === 'texto' || !tipo_midia) {
            textoFinal = await humanizarMensagem(mensagem);
          } else if (legenda_midia) {
            legendaFinal = await humanizarMensagem(legenda_midia);
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

        const resp = await fetch(endpoint, {
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

        await pool.query(
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
        ).catch(err => console.error('[DISPARO INSERT whatsapp_messages ERROR]:', err.message));

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
        console.error(`[DISPARO] Erro no log ${log_id}:`, err.message);
        
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
      }
      // Delay entre mensagens do lote para não sobrecarregar
      await sleep(1500);
    }
  } catch (err: any) {
    console.error('[DISPARO] Erro crítico no motor de processamento:', err.message);
  }
}
