/**
 * mediaRetry.ts — retenta decriptografar/salvar mídia do WhatsApp que falhou na primeira
 * tentativa (Evolution fora do ar, timeout, etc — ver utils/whatsappMediaStorage.ts).
 *
 * [AUDITORIA] LÓGICA: só reconcilia o que JÁ FALHOU (media_url ainda aponta pra URL crua da
 * Evolution, nunca migrou pra `local://...`) — não é polling de mensagens novas nem varredura
 * de todos os contatos, então não reabre o risco de banimento por consulta ativa em massa
 * discutido nesta sessão (ver diagnosticos/AUDITORIA_LOG.md, decisão sobre sincronização
 * recorrente). Janela de 7 dias: a URL crua da Evolution tem prazo de expiração (parâmetro
 * `oe=` na própria URL) — tentar recuperar mídia mais antiga que isso quase certamente falha
 * de novo à toa.
 */
import { Pool } from 'pg';
import { log } from '../logger';
import { salvarMidiaWhatsapp } from '../utils/whatsappMediaStorage';

const JANELA_DIAS = 7;
const LIMITE_POR_EXECUCAO = 200; // teto por rodada — não deixa o job crescer sem controle
const PAUSA_ENTRE_CHAMADAS_MS = 400;

export async function retentarMidiaPendente(pool: Pool): Promise<{ tentadas: number; recuperadas: number }> {
  // [AUDITORIA] FIX APLICADO (2026-07-23): mensagens de instância desconectada/excluída de
  // propósito (ex: crm_435ee4720fc3, ver diagnosticos/AUDITORIA_LOG.md) sempre falham com
  // "Message not found" — a Evolution não tem mais registro nenhum dela, não é falha
  // temporária. Retentar isso todo dia até sair da janela de 7 dias era trabalho certo de dar
  // errado; excluído via NOT EXISTS contra as 3 tabelas que sabem quais instâncias existem
  // hoje (mesma checagem que webhook.ts usa pra resolver dono de instância).
  const pendentes = await pool.query(
    `SELECT message_id, instance_name, remote_jid, from_me, message_type, user_id, media_mimetype
     FROM whatsapp_messages m
     WHERE message_type IN ('image','audio','video','document','sticker')
       AND media_url IS NOT NULL
       AND media_url NOT LIKE 'local://%'
       AND created_at > NOW() - INTERVAL '${JANELA_DIAS} days'
       AND deleted_at IS NULL
       AND (
         EXISTS (SELECT 1 FROM agent_configs a WHERE LOWER(a.evolution_instancia) = LOWER(m.instance_name) AND a.ativo = true)
         OR EXISTS (SELECT 1 FROM agentes a WHERE LOWER(a.evolution_instancia) = LOWER(m.instance_name) AND a.ativo = true)
         OR EXISTS (SELECT 1 FROM integracoes_config i WHERE LOWER(i.instancia) = LOWER(m.instance_name) AND i.tipo = 'evolution')
       )
     ORDER BY created_at DESC
     LIMIT ${LIMITE_POR_EXECUCAO}`
  );

  if (!pendentes.rows.length) return { tentadas: 0, recuperadas: 0 };

  // Evolution config por user_id — mesmo padrão usado em webhook.ts, evita repetir a query
  // pra cada mensagem do mesmo tenant.
  const cfgCache = new Map<string, { url: string; apiKey: string }>();
  async function getCfg(userId: string) {
    if (cfgCache.has(userId)) return cfgCache.get(userId)!;
    const r = await pool.query(
      `SELECT evolution_server_url AS url, evolution_api_key AS api_key
       FROM agent_configs WHERE user_id = $1 AND ativo = true LIMIT 1`,
      [userId]
    ).catch(() => ({ rows: [] as any[] }));
    const cfg = {
      url: r.rows[0]?.url || process.env.EVOLUTION_API_URL || 'https://disparo.mentoark.com.br',
      apiKey: r.rows[0]?.api_key || process.env.EVOLUTION_API_KEY || '',
    };
    cfgCache.set(userId, cfg);
    return cfg;
  }

  let recuperadas = 0;
  for (const row of pendentes.rows) {
    try {
      const cfg = await getCfg(row.user_id);
      const localUrl = await salvarMidiaWhatsapp({
        evoUrl: cfg.url, apiKey: cfg.apiKey,
        instancia: row.instance_name, messageId: row.message_id,
        remoteJid: row.remote_jid, fromMe: row.from_me,
        userId: row.user_id, tipo: row.message_type,
        mimetypeHint: row.media_mimetype,
      });
      if (localUrl) {
        await pool.query(
          `UPDATE whatsapp_messages SET media_url = $1 WHERE message_id = $2 AND instance_name = $3`,
          [localUrl, row.message_id, row.instance_name]
        );
        recuperadas++;
      }
    } catch (err: any) {
      log.warn('MEDIA_RETRY', 'Falha ao retentar mídia', { messageId: row.message_id, err: err?.message });
    }
    await new Promise(r => setTimeout(r, PAUSA_ENTRE_CHAMADAS_MS));
  }

  log.info('MEDIA_RETRY', 'Rodada de retry concluída', { tentadas: pendentes.rows.length, recuperadas });
  return { tentadas: pendentes.rows.length, recuperadas };
}
