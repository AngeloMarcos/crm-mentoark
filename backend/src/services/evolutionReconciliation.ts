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

  // [AUDITORIA] FIX APLICADO (2026-07-23, multi-instância): antes, o loop só sabia AVANÇAR
  // agent_configs.evolution_instancia pra uma instância que acabou de abrir — não tinha
  // nenhum caminho pra REVERTER quando a instância que agent_configs aponta hoje deixa de
  // existir/abrir (achado real em homolog: uma instância `_2` criada e nunca finalizada de
  // conexão chegou a reportar `open` uma vez, agent_configs foi atualizado pra ela, depois ela
  // sumiu da Evolution e agent_configs ficou travado apontando pra uma instância morta —
  // webhook.ts ainda resolvia certo via fallback nível 2 (agentes), mas a config de IA ficava
  // baseada numa instância inexistente). Agora agrupa por tenant e decide DEPOIS de saber o
  // estado de TODAS as instâncias do tenant: se a que agent_configs aponta não está aberta e
  // existe outra do mesmo tenant que está, redireciona pra ela; sem nenhuma aberta, deixa como
  // está (não tem pra onde reverter com segurança).
  const porTenant = new Map<string, { instancia: string; aberta: boolean; url: string; api_key: string }[]>();

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

    const lista = porTenant.get(conector.user_id) || [];
    lista.push({ instancia: conector.instancia, aberta, url: conector.url, api_key: conector.api_key });
    porTenant.set(conector.user_id, lista);
  }

  for (const [userId, lista] of porTenant) {
    const abertas = lista.filter(l => l.aberta);
    if (!abertas.length) continue; // nenhuma instância aberta pra esse tenant — nada pra redirecionar

    const { rows: agentConfigRows } = await pool.query(
      `SELECT evolution_instancia FROM agent_configs WHERE user_id = $1`,
      [userId]
    );
    const atual = agentConfigRows[0]?.evolution_instancia;

    // Se a instância atual do agent_configs já está entre as abertas, não mexe — evita
    // trocar de instância à toa quando o tenant tem mais de uma aberta simultaneamente.
    if (atual && abertas.some(a => a.instancia === atual)) continue;

    const alvo = abertas[0];
    // [AUDITORIA] BUG (achado 2026-07-28 — "IA não pode vir ativada sem antes estar
    // configurada"): este INSERT ligava `ativo=true` na hora em que a instância era
    // reconciliada, mesmo sem prompt/persona configurados ainda — cliente novo passava a
    // responder mensagens reais com um prompt genérico (ou, em outro achado da mesma sessão,
    // um prompt de outro tenant, via bug separado em `agent-config.ts`/ConfigAgenteIA.tsx).
    // [AUDITORIA] FIX APLICADO: nasce `false`; ON CONFLICT não toca `ativo` (só nos campos de
    // conexão), então isso só afeta a criação inicial da linha — nunca desliga um agente que o
    // usuário já ativou de propósito.
    await pool.query(
      `INSERT INTO agent_configs (user_id, evolution_instancia, evolution_server_url, evolution_api_key, ativo)
       VALUES ($1, $2, $3, $4, false)
       ON CONFLICT (user_id) DO UPDATE SET
         evolution_instancia  = EXCLUDED.evolution_instancia,
         evolution_server_url = EXCLUDED.evolution_server_url,
         evolution_api_key    = EXCLUDED.evolution_api_key,
         updated_at           = NOW()`,
      [userId, alvo.instancia, alvo.url, alvo.api_key]
    );
    log.info('EVOLUTION_SYNC', 'agent_configs.evolution_instancia corrigido', {
      userId, de: atual, para: alvo.instancia,
    });
    corrigidos++;
  }

  return { corrigidos };
}
