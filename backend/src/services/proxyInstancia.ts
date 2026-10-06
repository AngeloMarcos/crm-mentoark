/**
 * proxyInstancia.ts — proxy próprio por número (Sprint 9, 2026-10-06), obrigatório para entrar no
 * Maturador Global (decisão do usuário: números no mesmo IP conversando entre si = "fazenda").
 *
 * [AUDITORIA] LÓGICA:
 *   - aplicado na Evolution (`POST /proxy/set/{instância}`) e conferido em seguida
 *     (`GET /proxy/find/{instância}`); só então `agentes.proxy_aplicado_em` é preenchido;
 *   - EXCLUSIVO: o mesmo host:porta em dois números (de qualquer conta) é recusado — dois números
 *     no mesmo proxy saem pelo mesmo IP e voltam a parecer ligados;
 *   - senha criptografada (AES-256, ENCRYPTION_KEY) e nunca devolvida para a tela;
 *   - trocar o IP de um número JÁ conectado também é sinal de risco: a tela avisa para configurar
 *     antes de conectar (número novo) e não ficar trocando.
 */
import { Pool } from 'pg';
import { evolutionFetch, sanitizeEvolutionUrl } from '../utils/resilientFetch';
import { encriptarSegredoMetaOficial, decriptarSegredoMetaOficial } from './metaCloudApi';
import { log } from '../logger';
import { invalidarCacheBloqueio } from './maturadorGlobal';

export interface ProxyEntrada { host: string; port: number; protocolo: 'http' | 'https' | 'socks4' | 'socks5'; usuario?: string; senha?: string }

export function validarProxy(b: any): { erro?: string; proxy?: ProxyEntrada } {
  const host = String(b?.host || '').trim().toLowerCase();
  const port = Number(b?.port);
  const protocolo = String(b?.protocolo || 'http').toLowerCase();
  if (!/^[a-z0-9.-]{3,253}$/.test(host) || host === 'localhost' || /^127\.|^10\.|^192\.168\.|^0\./.test(host)) {
    return { erro: 'Host do proxy inválido (use o endereço que o fornecedor do proxy passou).' };
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { erro: 'Porta do proxy inválida.' };
  if (!['http', 'https', 'socks4', 'socks5'].includes(protocolo)) return { erro: 'Protocolo deve ser http, https, socks4 ou socks5.' };
  const usuario = String(b?.usuario || '').trim() || undefined;
  const senha = String(b?.senha || '') || undefined;
  return { proxy: { host, port, protocolo: protocolo as ProxyEntrada['protocolo'], usuario, senha } };
}

function credenciais(a: any): { base: string; key: string } {
  return {
    base: sanitizeEvolutionUrl(a.evolution_server_url || process.env.EVOLUTION_API_URL || 'https://disparo.mentoark.com.br'),
    key: a.evolution_api_key || process.env.EVOLUTION_API_KEY || '',
  };
}

/** Aplica o proxy na instância e confere. Devolve o erro em português, ou null. */
export async function aplicarProxy(pool: Pool, agenteId: string, userId: string, p: ProxyEntrada): Promise<string | null> {
  const a = (await pool.query(`SELECT * FROM agentes WHERE id = $1 AND user_id = $2`, [agenteId, userId])).rows[0];
  if (!a?.evolution_instancia) return 'Instância não encontrada.';
  const dono = (await pool.query(
    `SELECT id FROM agentes WHERE id <> $1 AND lower(proxy_host) = $2 AND proxy_port = $3 AND proxy_aplicado_em IS NOT NULL LIMIT 1`,
    [agenteId, p.host, p.port]
  )).rows[0];
  if (dono) return 'Este proxy já está em uso por outro número. Cada número precisa de um proxy (IP) só dele.';
  const senha = p.senha ?? (a.proxy_senha_enc && a.proxy_host === p.host ? decriptarSegredoMetaOficial(a.proxy_senha_enc) : undefined);
  const { base, key } = credenciais(a);
  const set = await evolutionFetch(`${base}/proxy/set/${encodeURIComponent(a.evolution_instancia)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: key },
    body: JSON.stringify({ enabled: true, host: p.host, port: String(p.port), protocol: p.protocolo, username: p.usuario || '', password: senha || '' }),
  }).catch((err: any) => ({ ok: false, status: 0, text: async () => String(err?.message) }) as any);
  if (!set.ok) {
    const corpo = await set.text().catch(() => '');
    log.warn('PROXY', 'Evolution recusou o proxy', { instancia: a.evolution_instancia, status: set.status });
    return `A Evolution recusou o proxy (HTTP ${set.status}). ${/proxy/i.test(corpo) ? 'Confira host, porta, usuário e senha.' : ''}`.trim();
  }
  const find = await evolutionFetch(`${base}/proxy/find/${encodeURIComponent(a.evolution_instancia)}`, { headers: { apikey: key } }).catch(() => null);
  const conf: any = find?.ok ? await find.json().catch(() => null) : null;
  const ativo = conf?.enabled === true && String(conf?.host || '').toLowerCase() === p.host;
  if (!ativo) return 'O proxy foi enviado, mas a Evolution não confirmou que ficou ativo. Tente de novo.';
  await pool.query(
    `UPDATE agentes SET proxy_host = $3, proxy_port = $4, proxy_protocolo = $5, proxy_usuario = $6,
            proxy_senha_enc = COALESCE($7, proxy_senha_enc), proxy_aplicado_em = NOW(), proxy_verificado_em = NOW(), updated_at = NOW()
     WHERE id = $1 AND user_id = $2`,
    [agenteId, userId, p.host, p.port, p.protocolo, p.usuario ?? null, p.senha ? encriptarSegredoMetaOficial(p.senha) : null]
  );
  invalidarCacheBloqueio();
  log.info('PROXY', 'Proxy aplicado na instância', { instancia: a.evolution_instancia, host: p.host });
  return null;
}

export async function removerProxy(pool: Pool, agenteId: string, userId: string): Promise<string | null> {
  const a = (await pool.query(`SELECT * FROM agentes WHERE id = $1 AND user_id = $2`, [agenteId, userId])).rows[0];
  if (!a?.evolution_instancia) return 'Instância não encontrada.';
  const { base, key } = credenciais(a);
  await evolutionFetch(`${base}/proxy/set/${encodeURIComponent(a.evolution_instancia)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: key },
    body: JSON.stringify({ enabled: false, host: a.proxy_host || '', port: String(a.proxy_port || ''), protocol: a.proxy_protocolo || 'http', username: '', password: '' }),
  }).catch(() => null);
  await pool.query(
    `UPDATE agentes SET proxy_host = NULL, proxy_port = NULL, proxy_protocolo = NULL, proxy_usuario = NULL,
            proxy_senha_enc = NULL, proxy_aplicado_em = NULL, updated_at = NOW() WHERE id = $1 AND user_id = $2`,
    [agenteId, userId]
  );
  return null;
}

/**
 * Sprint 9 (auditoria 2026-10-06): o proxy era conferido só quando configurado. Se depois ele for
 * desligado/trocado na Evolution, o número seguiria no Aquecimento Global saindo pelo IP da VPS —
 * justamente o risco que o proxy obrigatório evita. Reconfere a cada 6h (cron do Aquecimento
 * Global); sem confirmação de proxy ativo com o mesmo host, o número sai da rede na hora
 * (`proxy_aplicado_em = NULL`) e o evento fica na linha do tempo de saúde. Falha de rede ao
 * consultar NÃO derruba (só não marca como verificado).
 */
export async function reverificarProxies(pool: Pool): Promise<{ conferidos: number; removidos: number }> {
  const r = await pool.query(
    `SELECT id, evolution_instancia, evolution_server_url, evolution_api_key, proxy_host, numero_conectado
     FROM agentes WHERE proxy_aplicado_em IS NOT NULL AND evolution_instancia IS NOT NULL
       AND (proxy_verificado_em IS NULL OR proxy_verificado_em < NOW() - INTERVAL '6 hours')`
  );
  let removidos = 0;
  for (const a of r.rows) {
    const { base, key } = credenciais(a);
    const resp = await evolutionFetch(`${base}/proxy/find/${encodeURIComponent(a.evolution_instancia)}`, { headers: { apikey: key } }).catch(() => null);
    if (!resp?.ok) continue; // Evolution fora do ar: tenta de novo no próximo ciclo
    const conf: any = await resp.json().catch(() => null);
    const ok = conf?.enabled === true && String(conf?.host || '').toLowerCase() === String(a.proxy_host || '').toLowerCase();
    if (ok) {
      await pool.query(`UPDATE agentes SET proxy_verificado_em = NOW() WHERE id = $1`, [a.id]);
    } else {
      removidos++;
      await pool.query(`UPDATE agentes SET proxy_aplicado_em = NULL, proxy_verificado_em = NOW() WHERE id = $1`, [a.id]);
      log.warn('PROXY', 'Proxy não está mais ativo na Evolution — número sai do Aquecimento Global', { instancia: a.evolution_instancia });
      await pool.query(
        `INSERT INTO whatsapp_eventos_saude (numero, instancia, tipo, detalhe) VALUES ($1, $2, 'proxy_perdido', $3)`,
        [String(a.numero_conectado || '').replace(/\D/g, '') || null, a.evolution_instancia, JSON.stringify({ host: a.proxy_host })]
      ).catch(() => {});
    }
  }
  return { conferidos: r.rows.length, removidos };
}
