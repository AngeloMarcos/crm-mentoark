import { Pool } from 'pg';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function processarDisparos(pool: Pool) {
  try {
    // 1. Buscar lote de mensagens pendentes usando a função SQL atômica
    const batch = await pool.query('SELECT * FROM public.get_next_disparo_batch(5)');
    
    if (!batch.rows.length) return;

    console.log(`[DISPARO] Processando lote de ${batch.rows.length} mensagens`);

    for (const msg of batch.rows) {
      const { log_id, disparo_id, user_id, telefone, mensagem, tipo_midia, url_midia, legenda_midia } = msg;

      try {
        // 2. Buscar config da Evolution API do usuário
        const evoRes = await pool.query(
          `SELECT url, api_key, instancia FROM integracoes_config 
           WHERE user_id = $1 AND tipo = 'evolution' AND status IN ('ativo','conectado') 
           LIMIT 1`,
          [user_id]
        );

        if (!evoRes.rows.length) {
          throw new Error('Evolution API não configurada ou desconectada');
        }

        const { url, api_key, instancia } = evoRes.rows[0];
        const baseUrl = url.replace(/\/$/, '');

        // 3. Normalizar telefone
        const digits = telefone.replace(/\D/g, '');
        
        // 4. Enviar mensagem
        let endpoint = `${baseUrl}/message/sendText/${instancia}`;
        let body: any = { number: digits, text: mensagem };

        if (tipo_midia === 'imagem' && url_midia) {
          endpoint = `${baseUrl}/message/sendMedia/${instancia}`;
          body = { 
            number: digits, 
            media: url_midia, 
            mediatype: 'image', 
            caption: legenda_midia || mensagem 
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
            fileName: legenda_midia || 'documento' 
          };
        }

        const resp = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: api_key },
          body: JSON.stringify(body),
        });

        if (!resp.ok) {
          const errBody = await resp.text().catch(() => '');
          throw new Error(`Evolution API ${resp.status}: ${errBody}`);
        }

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
