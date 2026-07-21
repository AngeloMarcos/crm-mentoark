import { Pool } from 'pg';
import { evolutionFetch, sanitizeEvolutionUrl } from '../utils/resilientFetch';
import { log } from '../logger';

interface EvolutionInstanceInfo {
  name: string;
  connectionStatus: string;
}

export async function fetchInstancesFromServer(url: string, apiKey: string): Promise<EvolutionInstanceInfo[] | null> {
  try {
    const baseUrl = sanitizeEvolutionUrl(url);
    const resp = await evolutionFetch(`${baseUrl}/instance/fetchInstances`, {
      headers: { apikey: apiKey },
    });
    if (!resp.ok) return null;
    const data = await resp.json().catch(() => null);
    if (!Array.isArray(data)) return null;
    return data.map((i: any) => ({ name: i?.name, connectionStatus: i?.connectionStatus }));
  } catch (err: any) {
    log.warn('EVOLUTION_SYNC', 'Falha ao consultar fetchInstances', { url, err: err?.message });
    return null;
  }
}

// [AUDITORIA] LÓGICA: Checagem pontual usada por syncEvolution() (integracoes.ts) antes de
// aceitar status='conectado' vindo do frontend — evita confiar cegamente no cliente (era a
// causa raiz do drift entre integracoes_config/agent_configs e a Evolution de verdade).
export async function verificarInstanciaAberta(url: string, apiKey: string, instancia: string): Promise<boolean> {
  const instancias = await fetchInstancesFromServer(url, apiKey);
  if (!instancias) return false; // servidor indisponível — não assume conectado
  return instancias.some(i => i.name === instancia && i.connectionStatus === 'open');
}

// [AUDITORIA] LÓGICA: Valida o estado real das instâncias Evolution contra o que o CRM
// tem registrado, corrigindo divergência (drift) que se acumula silenciosamente — ver
// BUG histórico em syncEvolution() (integracoes.ts) que confiava no status enviado pelo
// frontend sem checar a Evolution de verdade. Nunca deleta linhas de integracoes_config,
// só corrige o campo `status`; e só sincroniza agent_configs com uma instância que esteja
// genuinamente `connectionStatus: 'open'`.
export async function reconciliarInstanciasEvolution(pool: Pool): Promise<{ corrigidos: number }> {
  let corrigidos = 0;

  const { rows: conectores } = await pool.query(
    `SELECT id, user_id, url, api_key, instancia, status
     FROM integracoes_config
     WHERE tipo = 'evolution' AND instancia IS NOT NULL AND instancia <> ''`
  );

  // Agrupa por servidor (url+api_key) para não repetir fetchInstances por usuário à toa
  const cacheServidor = new Map<string, Promise<EvolutionInstanceInfo[] | null>>();
  const chaveServidor = (url: string, apiKey: string) => `${url}::${apiKey}`;

  for (const conector of conectores) {
    const chave = chaveServidor(conector.url, conector.api_key);
    if (!cacheServidor.has(chave)) {
      cacheServidor.set(chave, fetchInstancesFromServer(conector.url, conector.api_key));
    }
    const instancias = await cacheServidor.get(chave);
    if (!instancias) continue; // servidor indisponível — não corrige nada às cegas

    const encontrada = instancias.find(i => i.name === conector.instancia);
    const aberta = encontrada?.connectionStatus === 'open';
    // [AUDITORIA] LÓGICA: 'inativo' é o valor usado pelo resto do arquivo (default do
    // POST /) e o único do CHECK constraint (integracoes_config_status_check) que
    // representa "não conectado" — não existe 'desconectado' no enum permitido.
    const statusReal = aberta ? 'conectado' : 'inativo';

    if (conector.status !== statusReal) {
      await pool.query(
        `UPDATE integracoes_config SET status = $1, updated_at = NOW() WHERE id = $2`,
        [statusReal, conector.id]
      );
      log.info('EVOLUTION_SYNC', 'Status de integracoes_config corrigido', {
        userId: conector.user_id,
        instancia: conector.instancia,
        de: conector.status,
        para: statusReal,
      });
      corrigidos++;
    }

    if (aberta) {
      const { rows: agentConfigRows } = await pool.query(
        `SELECT evolution_instancia FROM agent_configs WHERE user_id = $1`,
        [conector.user_id]
      );
      const atual = agentConfigRows[0]?.evolution_instancia;
      if (atual !== conector.instancia) {
        await pool.query(
          `INSERT INTO agent_configs (user_id, evolution_instancia, evolution_server_url, evolution_api_key, ativo)
           VALUES ($1, $2, $3, $4, true)
           ON CONFLICT (user_id) DO UPDATE SET
             evolution_instancia  = EXCLUDED.evolution_instancia,
             evolution_server_url = EXCLUDED.evolution_server_url,
             evolution_api_key    = EXCLUDED.evolution_api_key,
             updated_at           = NOW()`,
          [conector.user_id, conector.instancia, conector.url, conector.api_key]
        );
        log.info('EVOLUTION_SYNC', 'agent_configs.evolution_instancia corrigido', {
          userId: conector.user_id,
          de: atual,
          para: conector.instancia,
        });
        corrigidos++;
      }
    }
  }

  return { corrigidos };
}
