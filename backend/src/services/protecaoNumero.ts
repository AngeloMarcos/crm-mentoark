/**
 * protecaoNumero.ts — proteções contra banimento ligadas à CONEXÃO do número (2026-10-04).
 *
 * [AUDITORIA] BUG GRAVE (achado real: 2 números perdidos "só logando no sistema"): os dados
 * mostram o MESMO número conectado em 2+ instâncias ao mesmo tempo (produção + homologação +
 * outra conta). Cada sessão derruba a outra (`connection.update` close 440 = connectionReplaced),
 * a Evolution reconecta sozinha (ela só desiste em 401/402/403/406), e em 25/09 a instância de
 * produção registrou 229 quedas numa hora — seguido de 403 (restrição do WhatsApp) dias depois.
 * O circuit-breaker existente (`logoutCircuitBreaker.ts`) só barra tentativas de conexão feitas
 * PELO CRM; não parava a reconexão automática da própria Evolution.
 * [AUDITORIA] FIX APLICADO — 3 camadas, todas aqui:
 *   1. Número duplicado: ao conectar (`connection.update` open, e antes de gerar QR quando o
 *      telefone é informado), procura o número em TODOS os servidores Evolution conhecidos
 *      (os das instâncias do banco + `EVOLUTION_SERVIDORES_EXTRAS`, pra enxergar o outro
 *      ambiente). Achou aberto em outro lugar → desconecta a instância NOVA na hora.
 *   2. Freio de reconexão: 440 (outra sessão assumiu) → desconecta na hora; 403 → desconecta
 *      (número restrito, não insistir); 4+ quedas "reconectáveis" em 10 min → desconecta.
 *   3. Modo Número Novo: nos primeiros 14 dias do número (`whatsapp_numeros.primeira_conexao_em`)
 *      a instância não fica "sempre online", não marca tudo como lido na hora, não entra em
 *      campanha (`disparoProcessor.ts`) e não faz consulta em massa de foto de perfil
 *      (`webhook.ts`). O usuário pode liberar campanhas antes, assumindo o risco.
 */
import { Pool } from 'pg';
import { evolutionFetch, sanitizeEvolutionUrl } from '../utils/resilientFetch';
import { log } from '../logger';

export const DIAS_PROTECAO = 14;

/** Só dígitos. */
export function normalizarNumero(n: string | null | undefined): string {
  return String(n || '').split('@')[0].replace(/\D/g, '');
}

/** Mesmo número? Tolera o 9º dígito brasileiro presente/ausente (DDI+DDD e 8 finais). */
export function mesmoNumero(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  return a.length >= 12 && b.length >= 12 && a.slice(0, 4) === b.slice(0, 4) && a.slice(-8) === b.slice(-8);
}

interface Servidor { url: string; apiKey: string }
interface InstanciaRemota { servidor: string; nome: string; status: string; numero: string }

/** Servidores Evolution conhecidos: os usados pelas instâncias do banco + extras do ambiente. */
async function servidoresConhecidos(pool: Pool): Promise<Servidor[]> {
  const r = await pool.query(
    `SELECT DISTINCT evolution_server_url AS url, evolution_api_key AS api_key FROM agentes
     WHERE evolution_server_url IS NOT NULL AND evolution_api_key IS NOT NULL AND evolution_instancia IS NOT NULL`
  ).catch(() => ({ rows: [] as any[] }));
  const lista: Servidor[] = r.rows.map((x: any) => ({ url: sanitizeEvolutionUrl(x.url), apiKey: x.api_key }));
  // Formato: "https://url1|chave1,https://url2|chave2" — usado pra enxergar o OUTRO ambiente
  // (homologação ↔ produção usam servidores Evolution diferentes).
  for (const item of String(process.env.EVOLUTION_SERVIDORES_EXTRAS || '').split(',')) {
    const [url, apiKey] = item.split('|').map(s => s?.trim());
    if (url && apiKey) lista.push({ url: sanitizeEvolutionUrl(url), apiKey });
  }
  const vistos = new Set<string>();
  return lista.filter(s => {
    const k = `${s.url}|${s.apiKey}`;
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
}

const cacheServidor = new Map<string, { em: number; instancias: InstanciaRemota[] }>();
async function instanciasDoServidor(s: Servidor): Promise<InstanciaRemota[]> {
  const k = `${s.url}|${s.apiKey}`;
  const c = cacheServidor.get(k);
  if (c && Date.now() - c.em < 20_000) return c.instancias;
  let instancias: InstanciaRemota[] = [];
  try {
    const r = await evolutionFetch(`${s.url}/instance/fetchInstances`, { headers: { apikey: s.apiKey }, maxRetries: 0, timeoutMs: 8000 });
    if (r.ok) {
      const data: any = await r.json().catch(() => null);
      if (Array.isArray(data)) {
        instancias = data.map((i: any) => ({
          servidor: s.url,
          nome: String(i?.name || i?.instanceName || ''),
          status: String(i?.connectionStatus || ''),
          numero: normalizarNumero(i?.ownerJid || i?.number),
        }));
      }
    }
  } catch { /* servidor fora do ar não pode travar a conexão — segue sem ele */ }
  cacheServidor.set(k, { em: Date.now(), instancias });
  return instancias;
}

/** Onde mais este número está CONECTADO agora (fora a própria instância). */
export async function buscarConexoesDuplicadas(
  pool: Pool, numero: string, instanciaAtual: { servidor: string; nome: string } | null
): Promise<InstanciaRemota[]> {
  const n = normalizarNumero(numero);
  if (n.length < 10) return [];
  const servidores = await servidoresConhecidos(pool);
  const todas = (await Promise.all(servidores.map(instanciasDoServidor))).flat();
  const atualServidor = instanciaAtual ? sanitizeEvolutionUrl(instanciaAtual.servidor) : '';
  return todas.filter(i =>
    i.status === 'open' && mesmoNumero(i.numero, n) &&
    !(instanciaAtual && i.servidor === atualServidor && i.nome === instanciaAtual.nome)
  );
}

function descreverOnde(d: InstanciaRemota[]): string {
  return d.map(i => `"${i.nome}" (${i.servidor.replace(/^https?:\/\//, '')})`).join(', ');
}

async function desconectarInstancia(url: string, apiKey: string, instancia: string): Promise<boolean> {
  try {
    const r = await evolutionFetch(`${sanitizeEvolutionUrl(url)}/instance/logout/${encodeURIComponent(instancia)}`, {
      method: 'DELETE', headers: { apikey: apiKey }, maxRetries: 0,
    });
    return r.ok;
  } catch {
    return false;
  }
}

async function gravarAlerta(pool: Pool, instancia: string, texto: string | null): Promise<void> {
  await pool.query(
    `UPDATE agentes SET protecao_alerta = $1, protecao_alerta_em = CASE WHEN $1 IS NULL THEN NULL ELSE NOW() END
     WHERE evolution_instancia = $2`,
    [texto, instancia]
  ).catch(() => {});
}

/** Instância → credenciais (a linha mais recente com esse nome). */
async function credenciaisInstancia(pool: Pool, instancia: string): Promise<{ url: string; apiKey: string; userId: string; autoRead: boolean | null; rejectCalls: boolean | null } | null> {
  const r = await pool.query(
    `SELECT evolution_server_url AS url, evolution_api_key AS api_key, user_id, auto_read, reject_calls
     FROM agentes WHERE evolution_instancia = $1 AND evolution_server_url IS NOT NULL AND evolution_api_key IS NOT NULL
     ORDER BY updated_at DESC LIMIT 1`,
    [instancia]
  ).catch(() => ({ rows: [] as any[] }));
  const x = r.rows[0];
  return x ? { url: x.url, apiKey: x.api_key, userId: x.user_id, autoRead: x.auto_read, rejectCalls: x.reject_calls } : null;
}

async function numeroDaInstancia(url: string, apiKey: string, instancia: string): Promise<string> {
  try {
    const r = await evolutionFetch(`${sanitizeEvolutionUrl(url)}/instance/fetchInstances?instanceName=${encodeURIComponent(instancia)}`, {
      headers: { apikey: apiKey },
    });
    if (!r.ok) return '';
    const data: any = await r.json().catch(() => null);
    const info = Array.isArray(data) ? data[0] : null;
    return normalizarNumero(info?.ownerJid);
  } catch {
    return '';
  }
}

/**
 * Configurações da instância na Evolution. Número em proteção: nunca "sempre online" (presença
 * 24h é padrão de robô — e ainda silencia as notificações do celular) e sem leitura automática.
 * Fora da proteção: respeita os toggles da tela (`agentes.auto_read`/`reject_calls`), que até
 * aqui eram salvos no banco mas nunca enviados à Evolution.
 */
async function aplicarConfiguracoes(url: string, apiKey: string, instancia: string, emProtecao: boolean, autoRead: boolean | null, rejectCalls: boolean | null): Promise<void> {
  try {
    const r = await evolutionFetch(`${sanitizeEvolutionUrl(url)}/settings/set/${encodeURIComponent(instancia)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: apiKey },
      body: JSON.stringify({
        rejectCall: !!rejectCalls,
        msgCall: '',
        // Grupos continuam entregues ao webhook (ver comentário em routes/whatsapp.ts /instance/create).
        groupsIgnore: false,
        alwaysOnline: false,
        readMessages: emProtecao ? false : (autoRead ?? true),
        readStatus: false,
        syncFullHistory: false,
      }),
    });
    if (!r.ok) log.warn('PROTECAO_NUMERO', 'Evolution recusou settings/set', { instancia, status: r.status });
  } catch (err: any) {
    log.warn('PROTECAO_NUMERO', 'Falha ao aplicar configurações da instância', { instancia, err: err?.message });
  }
}

/** Registra a conexão do número e devolve se ele está em proteção. */
async function registrarNumero(pool: Pool, numero: string): Promise<{ emProtecao: boolean; protecaoAte: Date | null }> {
  const r = await pool.query(
    `INSERT INTO whatsapp_numeros (numero, protecao_ate) VALUES ($1, NOW() + ($2 || ' days')::interval)
     ON CONFLICT (numero) DO UPDATE SET ultima_conexao_em = NOW(), conexoes = whatsapp_numeros.conexoes + 1
     RETURNING protecao_ate, protecao_liberada_em`,
    [numero, String(DIAS_PROTECAO)]
  );
  const row = r.rows[0] || {};
  const protecaoAte = row.protecao_ate ? new Date(row.protecao_ate) : null;
  return { emProtecao: !!protecaoAte && protecaoAte > new Date() && !row.protecao_liberada_em, protecaoAte };
}

/**
 * Chamado pelo webhook em `connection.update` = open. Nunca lança.
 */
export async function aoConectarInstancia(pool: Pool, instancia: string): Promise<void> {
  try {
    const cred = await credenciaisInstancia(pool, instancia);
    if (!cred) return;
    const numero = await numeroDaInstancia(cred.url, cred.apiKey, instancia);
    if (!numero) return;

    await pool.query(
      `UPDATE agentes SET numero_conectado = $1 WHERE evolution_instancia = $2 AND numero_conectado IS DISTINCT FROM $1`,
      [numero, instancia]
    ).catch(() => {});

    const duplicadas = await buscarConexoesDuplicadas(pool, numero, { servidor: cred.url, nome: instancia });
    if (duplicadas.length) {
      const ok = await desconectarInstancia(cred.url, cred.apiKey, instancia);
      const texto = `O número +${numero} já está conectado em ${descreverOnde(duplicadas)}. Desconectamos esta instância para proteger o número: o mesmo número operado em 2 instâncias ao mesmo tempo gera conflito de sessão e reconexões em série, um dos principais gatilhos de banimento. Desconecte o outro lugar antes de reconectar aqui.`;
      await gravarAlerta(pool, instancia, texto);
      log.error('PROTECAO_NUMERO', 'Número duplicado detectado na conexão — instância nova desconectada', {
        instancia, numero, outras: duplicadas.map(d => `${d.servidor}/${d.nome}`), desconectada: ok,
      });
      return;
    }

    const { emProtecao } = await registrarNumero(pool, numero);
    await aplicarConfiguracoes(cred.url, cred.apiKey, instancia, emProtecao, cred.autoRead, cred.rejectCalls);
    await gravarAlerta(pool, instancia, null);
    invalidarCacheProtecao();
    log.info('PROTECAO_NUMERO', 'Conexão registrada', { instancia, numero, emProtecao });
  } catch (err: any) {
    log.warn('PROTECAO_NUMERO', 'Falha no pós-conexão', { instancia, err: err?.message });
  }
}

// Códigos em que a Evolution reconecta sozinha (ela só desiste em 401/402/403/406). 515
// (restartRequired) é normal logo após parear e não conta.
const RECONECTAVEIS = new Set([408, 411, 428, 500, 503]);
const LIMITE_QUEDAS = 4;
const JANELA_MIN = 10;

/**
 * Chamado pelo webhook em `connection.update` = close (depois de registrar o evento). Nunca lança.
 */
export async function aoDesconectarInstancia(pool: Pool, instancia: string, statusReason: number | null): Promise<void> {
  try {
    let motivo: string | null = null;
    if (statusReason === 440) {
      motivo = 'Outra sessão assumiu este número (ele foi conectado em outro lugar). Paramos a reconexão automática para as duas sessões não ficarem se derrubando — isso leva a banimento. Use o número em um lugar só.';
    } else if (statusReason === 403) {
      motivo = 'O WhatsApp recusou a conexão deste número (403 — possível restrição). Não reconecte agora: abra o WhatsApp no celular e veja se há aviso de banimento ou restrição.';
    } else if (statusReason !== null && RECONECTAVEIS.has(statusReason)) {
      const r = await pool.query(
        `SELECT COUNT(*)::int AS total FROM whatsapp_logout_events
         WHERE instancia = $1 AND created_at >= NOW() - ($2 || ' minutes')::interval
           AND status_reason = ANY($3::int[])`,
        [instancia, String(JANELA_MIN), [...RECONECTAVEIS]]
      ).catch(() => ({ rows: [{ total: 0 }] }));
      if ((r.rows[0]?.total ?? 0) >= LIMITE_QUEDAS) {
        motivo = `A conexão caiu ${r.rows[0].total} vezes em ${JANELA_MIN} minutos. Paramos a reconexão automática — reconectar sem parar é um dos principais motivos de banimento. Verifique a internet do celular e reconecte com calma.`;
      }
    }
    if (!motivo) return;

    const cred = await credenciaisInstancia(pool, instancia);
    const ok = cred ? await desconectarInstancia(cred.url, cred.apiKey, instancia) : false;
    await gravarAlerta(pool, instancia, motivo);
    log.error('PROTECAO_NUMERO', 'Freio de reconexão acionado — instância desconectada', { instancia, statusReason, desconectada: ok });
  } catch (err: any) {
    log.warn('PROTECAO_NUMERO', 'Falha no freio de reconexão', { instancia, err: err?.message });
  }
}

// ── Consulta de proteção (disparo/webhook) ───────────────────────────────────────────────────
let cacheProtegidas: { em: number; instancias: Set<string> } | null = null;
export function invalidarCacheProtecao(): void { cacheProtegidas = null; }

/** Nomes de instância cujo número está em Modo Número Novo agora (cache de 60s). */
export async function instanciasEmProtecao(pool: Pool): Promise<Set<string>> {
  if (cacheProtegidas && Date.now() - cacheProtegidas.em < 60_000) return cacheProtegidas.instancias;
  const r = await pool.query(
    `SELECT DISTINCT a.evolution_instancia FROM agentes a
     JOIN whatsapp_numeros w ON w.numero = regexp_replace(a.numero_conectado, '\\D', '', 'g')
     WHERE a.evolution_instancia IS NOT NULL
       AND w.protecao_ate > NOW() AND w.protecao_liberada_em IS NULL`
  ).catch(() => ({ rows: [] as any[] }));
  const instancias = new Set<string>(r.rows.map((x: any) => x.evolution_instancia));
  cacheProtegidas = { em: Date.now(), instancias };
  return instancias;
}
