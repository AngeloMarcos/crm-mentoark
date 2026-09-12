import { Pool } from 'pg';
import { resilientFetch } from '../utils/resilientFetch';
import { log } from '../logger';

// [AUDITORIA] LÓGICA: ponto único que efetivamente chama a API do sistema de corridas do
// cliente — usado tanto pelo envio automático da ferramenta de IA (mcp/tools.ts, quando a
// extração vem com confiança alta) quanto pelo botão "Confirmar e enviar" da fila manual
// (routes/corridas.ts). Mantém payload/erro/status sempre gravados em `corridas` pra
// auditoria, reforçando o requisito do usuário de que toda corrida fica registrada.

export interface CorridaParaEnvio {
  id: string;
  telefone: string;
  nome_passageiro: string | null;
  origem: string | null;
  destino: string | null;
  horario_solicitado: string | null;
  observacoes: string | null;
  created_at: string;
}

export interface ResultadoEnvioCorrida {
  enviado: boolean;
  motivo?: string;
}

/**
 * Busca a integração configurada em `integracoes_config` (tipo 'corridas_cliente') e envia
 * a corrida via POST. Sempre grava o resultado (sucesso ou falha) em `corridas` — a única
 * situação em que NADA é gravado é quando a integração ainda não está configurada, porque
 * nesse caso não houve tentativa real de envio.
 */
export async function enviarCorridaParaSistemaCliente(
  pool: Pool,
  userId: string,
  corrida: CorridaParaEnvio,
): Promise<ResultadoEnvioCorrida> {
  const cfg = await pool.query(
    `SELECT url, api_key, token FROM integracoes_config
     WHERE user_id = $1 AND tipo = 'corridas_cliente' AND status = 'conectado'
     ORDER BY updated_at DESC LIMIT 1`,
    [userId]
  );
  const integ = cfg.rows[0];
  if (!integ?.url) {
    return {
      enviado: false,
      motivo: 'Integração com o sistema do cliente ainda não configurada (Conectores → tipo "Corridas — Sistema do Cliente").',
    };
  }

  const payload = {
    origem_sistema: 'mentoark_crm',
    id_externo: corrida.id,
    passageiro: { nome: corrida.nome_passageiro || null, telefone: corrida.telefone },
    origem: corrida.origem,
    destino: corrida.destino,
    horario_solicitado: corrida.horario_solicitado,
    observacoes: corrida.observacoes,
    criado_em: corrida.created_at,
  };

  const token: string | null = integ.api_key || integ.token || null;

  try {
    const resp = await resilientFetch(integ.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
      timeoutMs: 15_000,
      maxRetries: 2,
      sanitizeUrl: false, // URL do cliente, não é a Evolution — não forçar https/trailing-slash rules dela
    });

    const respostaTexto = await resp.text().catch(() => '');
    let respostaJson: any = null;
    try { respostaJson = respostaTexto ? JSON.parse(respostaTexto) : null; } catch { /* resposta não-JSON, guarda como texto abaixo */ }

    await pool.query(
      `UPDATE corridas SET
         status = $1,
         payload_enviado = $2,
         resposta_api = $3,
         enviado_at = CASE WHEN $1 = 'enviada' THEN NOW() ELSE enviado_at END,
         updated_at = NOW()
       WHERE id = $4 AND user_id = $5`,
      [
        resp.ok ? 'enviada' : 'falha_envio',
        JSON.stringify(payload),
        JSON.stringify(respostaJson ?? { status_http: resp.status, body: respostaTexto.slice(0, 2000) }),
        corrida.id,
        userId,
      ]
    );

    if (!resp.ok) {
      log.warn('CORRIDAS', 'API do cliente retornou erro', { status: resp.status, corridaId: corrida.id });
      return { enviado: false, motivo: `API do cliente retornou HTTP ${resp.status}` };
    }
    return { enviado: true };

  } catch (err: any) {
    await pool.query(
      `UPDATE corridas SET
         status = 'falha_envio',
         payload_enviado = $1,
         resposta_api = $2,
         updated_at = NOW()
       WHERE id = $3 AND user_id = $4`,
      [JSON.stringify(payload), JSON.stringify({ erro: err.message }), corrida.id, userId]
    ).catch(() => {});
    log.error('CORRIDAS', 'Falha ao enviar corrida para o sistema do cliente', { err: err.message, corridaId: corrida.id });
    return { enviado: false, motivo: err.message };
  }
}
