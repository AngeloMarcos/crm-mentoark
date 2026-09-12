import { Pool } from 'pg';
import { evolutionFetch, sanitizeEvolutionUrl } from '../utils/resilientFetch';
import { log } from '../logger';

interface EvolutionInstanceInfo {
  name: string;
  connectionStatus: string;
  // [AUDITORIA] LÓGICA (achado 2026-08-10 — loop de LOGOUT 401 em produção): campo novo, usado
  // pelo guard-rail de POST /whatsapp/connect (routes/whatsapp.ts) pra detectar quando o número
  // que o tenant está tentando conectar já tem uma sessão genuinamente aberta sob OUTRO nome de
  // instância — sem isso não dava pra comparar "mesmo número" entre instâncias diferentes.
  ownerJid?: string;
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
    return data.map((i: any) => ({ name: i?.name, connectionStatus: i?.connectionStatus, ownerJid: i?.ownerJid }));
  } catch (err: any) {
    log.warn('EVOLUTION_SYNC', 'Falha ao consultar fetchInstances', { url, err: err?.message });
    return null;
  }
}

// [AUDITORIA] LÓGICA: Checagem pontual usada por syncEvolution() (integracoes.ts) antes de
// aceitar status='conectado' vindo do frontend — evita confiar cegamente no cliente (era a
// causa raiz do drift entre integracoes_config/agentes e a Evolution de verdade).
export async function verificarInstanciaAberta(url: string, apiKey: string, instancia: string): Promise<boolean> {
  const instancias = await fetchInstancesFromServer(url, apiKey);
  if (!instancias) return false; // servidor indisponível — não assume conectado
  return instancias.some(i => i.name === instancia && i.connectionStatus === 'open');
}

// [AUDITORIA] LÓGICA: Valida o estado real das instâncias Evolution contra o que o CRM
// tem registrado, corrigindo divergência (drift) que se acumula silenciosamente — ver
// BUG histórico em syncEvolution() (integracoes.ts) que confiava no status enviado pelo
// frontend sem checar a Evolution de verdade. Nunca deleta linhas de integracoes_config,
// só corrige o campo `status`; e só sincroniza credenciais em `agentes` pra uma instância que
// esteja genuinamente `connectionStatus: 'open'`.
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

  // [AUDITORIA] LÓGICA (histórico, pré-Sprint 1): esta rotina existia originalmente pra corrigir
  // `agent_configs.evolution_instancia` — uma ÚNICA linha por tenant que podia ficar "travada"
  // apontando pra uma instância morta quando outra do mesmo tenant abria no lugar dela. Ver
  // AUDITORIA_LOG.md (achado 2026-07-23) pro histórico completo desse bug e do fix por tenant
  // que existia aqui antes.
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

    // [AUDITORIA] LÓGICA (Sprint Grupos Somem com Instância Duplicada, 2026-09-04): grava/atualiza
    // o ledger `instance_name → número real` (migrations.ts) sempre que a Evolution reportar
    // `ownerJid` pra esta instância — em QUALQUER status (não só 'open'): mesmo uma instância
    // travada em 'connecting'/'close' pode ter um `ownerJid` válido de quando esteve aberta, e é
    // exatamente esse histórico que GET /conversas precisa pra não perder grupos quando o número
    // migra pra um `instance_name` novo. Nunca deleta linha nenhuma daqui — o ledger é permanente
    // de propósito, ver comentário completo na migration.
    const ownerJid = encontrada?.ownerJid;
    const numeroReal = ownerJid ? String(ownerJid).split('@')[0].replace(/\D/g, '') : '';
    if (numeroReal) {
      await pool.query(
        `INSERT INTO whatsapp_instance_numeros (instance_name, user_id, numero, atualizado_em)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (instance_name) DO UPDATE SET numero = EXCLUDED.numero, atualizado_em = NOW()
         WHERE whatsapp_instance_numeros.numero IS DISTINCT FROM EXCLUDED.numero`,
        [conector.instancia, conector.user_id, numeroReal]
      ).catch((err: any) => {
        log.warn('EVOLUTION_SYNC', 'Falha ao gravar ledger instance_name→número', { err: err?.message, instancia: conector.instancia });
      });
      await pool.query(
        `UPDATE agentes SET numero_conectado = $1, updated_at = NOW()
         WHERE user_id = $2 AND evolution_instancia = $3 AND numero_conectado IS DISTINCT FROM $1`,
        [numeroReal, conector.user_id, conector.instancia]
      ).catch(() => {});
    }
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

  // [AUDITORIA] LÓGICA (Sprint 1 unificação, 2026-08-07): `agentes` guarda uma linha POR
  // instância (criada por syncEvolution()/saveEvolutionConfig() em integracoes.ts/whatsapp.ts
  // quando o usuário conecta pela tela do CRM) — diferente de `agent_configs`, não existe mais
  // "a" linha única do tenant pra redirecionar quando uma instância fecha e outra abre no lugar.
  // O que resta de valor real nesta rotina de fundo: manter as credenciais
  // (evolution_server_url/api_key) de cada linha `agentes` já existente sincronizadas com o que
  // a Evolution reportou agora, cobrindo o caso de a instância ter reaberto/reconectado sem
  // passar pela tela de Integrações (ex: reconexão automática do lado da Evolution). Não cria
  // linha nova aqui de propósito — criação de linha é ação explícita do usuário (conectar via
  // UI), não algo que um cron de reconciliação deva fazer silenciosamente em segundo plano.
  for (const [userId, lista] of porTenant) {
    const abertas = lista.filter(l => l.aberta);
    if (!abertas.length) continue; // nenhuma instância aberta pra esse tenant — nada pra corrigir

    for (const instAberta of abertas) {
      const upd = await pool.query(
        `UPDATE agentes SET evolution_server_url = $1, evolution_api_key = $2, updated_at = NOW()
         WHERE user_id = $3 AND evolution_instancia = $4
           AND (evolution_server_url IS DISTINCT FROM $1 OR evolution_api_key IS DISTINCT FROM $2)`,
        [instAberta.url, instAberta.api_key, userId, instAberta.instancia]
      );
      if (upd.rowCount) {
        log.info('EVOLUTION_SYNC', 'agentes.evolution_server_url/api_key corrigido (drift)', {
          userId, instancia: instAberta.instancia,
        });
        corrigidos++;
      }
    }
  }

  return { corrigidos };
}
