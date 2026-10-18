/**
 * proxyInstancia.ts — proxy próprio por número (Sprint 9, 2026-10-06), obrigatório para entrar no
 * Maturador Global (decisão do usuário: números no mesmo IP conversando entre si = "fazenda").
 *
 * [AUDITORIA] LÓGICA (Sprint 2 do maturador sem ban, 2026-10-17 — ver
 * reports/Maturação WhatsApp e proxy 2026.md). Achados lendo o código da Evolution v2.3.7:
 *   - `/proxy/set` SÓ grava no banco da Evolution. O agente de proxy é montado em
 *     `connectToWhatsapp` → `loadProxy` → `createClient`; as reconexões automáticas
 *     (`reloadConnection`, ex.: 428) reaproveitam o proxy antigo. E `/proxy/find` lê o banco, então
 *     "confirmado" não significava "em uso". Agora, número conectado → `POST /instance/restart`
 *     depois de aplicar (restart chama connectToWhatsapp, que recarrega o proxy).
 *   - Número ainda não pareado → o proxy vai junto no `/instance/create` (campos proxyHost…),
 *     ou via `/proxy/set` antes do `/instance/connect` (ver routes/whatsapp.ts). Proxy antes do QR.
 *   - A Evolution só entende `http` e `socks5` (https/socks4 caem em "Unsupported proxy protocol"),
 *     e monta `protocolo://usuario:senha@host:porta` sem encode — credenciais vão com
 *     encodeURIComponent (os agentes de proxy decodificam).
 *   - Antes de aplicar, o backend mede o IP de SAÍDA pelo próprio proxy (ip-api.com): país BR
 *     obrigatório, IP de datacenter/hospedagem recusado (é o mesmo problema da VPS, que é
 *     Hostinger com hosting=true). A exclusividade é pelo IP de saída — vários fornecedores
 *     expõem um gateway único (mesmo host:porta) e diferenciam o IP pelo usuário.
 *   - Checagem de hora em hora (`reverificarProxies`): IP de saída mudou, proxy caiu ou a Evolution
 *     perdeu a configuração → evento na linha do tempo de saúde.
 *   - senha criptografada (AES-256, ENCRYPTION_KEY) e nunca devolvida para a tela.
 */
import { Pool } from 'pg';
import http from 'http';
import net from 'net';
import { evolutionFetch, sanitizeEvolutionUrl } from '../utils/resilientFetch';
import { encriptarSegredoMetaOficial, decriptarSegredoMetaOficial } from './metaCloudApi';
import { log } from '../logger';
import { invalidarCacheBloqueio } from './maturadorGlobal';
import { marcarLogoutPlanejado } from './saudeNumero';

export type ProtocoloProxy = 'http' | 'socks5';
export interface ProxyEntrada { host: string; port: number; protocolo: ProtocoloProxy; usuario?: string; senha?: string }

export function validarProxy(b: any): { erro?: string; proxy?: ProxyEntrada } {
  const host = String(b?.host || '').trim().toLowerCase();
  const port = Number(b?.port);
  let protocolo = String(b?.protocolo || 'http').toLowerCase();
  if (protocolo === 'socks') protocolo = 'socks5';
  if (!/^[a-z0-9.-]{3,253}$/.test(host) || host === 'localhost' || /^127\.|^10\.|^192\.168\.|^0\.|^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
    return { erro: 'Host do proxy inválido (use o endereço que o fornecedor do proxy passou).' };
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { erro: 'Porta do proxy inválida.' };
  if (!['http', 'socks5'].includes(protocolo)) {
    return { erro: 'Use protocolo http ou socks5 — a Evolution não aceita https nem socks4 (o fornecedor costuma oferecer http na mesma conta).' };
  }
  const usuario = String(b?.usuario || '').trim() || undefined;
  const senha = String(b?.senha || '') || undefined;
  return { proxy: { host, port, protocolo: protocolo as ProtocoloProxy, usuario, senha } };
}

// ── Teste do IP de saída pelo próprio proxy (sem dependência: http/net nativos) ──────────────
export interface SaidaProxy {
  ip: string; pais: string; regiao: string | null; cidade: string | null;
  asn: string | null; org: string | null; hospedagem: boolean; movel: boolean;
}

const IPAPI_HOST = 'ip-api.com';
const IPAPI_PATH = '/json/?fields=status,message,countryCode,regionName,city,isp,org,as,mobile,hosting,query';
const TIMEOUT_TESTE_MS = 15_000;

function lerRespostaHttp(bruto: string): any {
  const corpo = bruto.slice(bruto.indexOf('\r\n\r\n') + 4);
  return JSON.parse(corpo.slice(corpo.indexOf('{'), corpo.lastIndexOf('}') + 1));
}

function viaHttp(p: ProxyEntrada): Promise<any> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { Host: IPAPI_HOST, Connection: 'close' };
    if (p.usuario) headers['Proxy-Authorization'] = 'Basic ' + Buffer.from(`${p.usuario}:${p.senha ?? ''}`).toString('base64');
    // Requisição em forma absoluta (http://host/path) direto ao proxy HTTP.
    const req = http.request({ host: p.host, port: p.port, method: 'GET', path: `http://${IPAPI_HOST}${IPAPI_PATH}`, headers, timeout: TIMEOUT_TESTE_MS }, res => {
      let dados = '';
      res.on('data', c => { dados += c; });
      res.on('end', () => {
        if (res.statusCode === 407) return reject(new Error('o proxy recusou usuário/senha (407)'));
        if ((res.statusCode ?? 0) >= 400) return reject(new Error(`o proxy respondeu HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(dados)); } catch { reject(new Error('resposta inválida do teste de IP')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('o proxy não respondeu em 15 s')));
    req.on('error', reject);
    req.end();
  });
}

function viaSocks5(p: ProxyEntrada): Promise<any> {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host: p.host, port: p.port });
    s.setTimeout(TIMEOUT_TESTE_MS, () => s.destroy(new Error('o proxy não respondeu em 15 s')));
    let etapa = 0;
    let buf = Buffer.alloc(0);
    let resposta = '';
    const falhar = (m: string) => { s.destroy(); reject(new Error(m)); };
    const pedirConexao = () => {
      const h = Buffer.from(IPAPI_HOST);
      s.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, h.length]), h, Buffer.from([0x00, 0x50])]));
      etapa = 3;
    };
    s.on('connect', () => s.write(Buffer.from(p.usuario ? [0x05, 0x02, 0x00, 0x02] : [0x05, 0x01, 0x00])));
    s.on('data', chunk => {
      if (etapa === 4) { resposta += chunk.toString('utf8'); return; }
      buf = Buffer.concat([buf, chunk]);
      if (etapa === 0) {
        if (buf.length < 2) return;
        const metodo = buf[1]; buf = buf.subarray(2);
        if (metodo === 0x02 && p.usuario) {
          const u = Buffer.from(p.usuario), w = Buffer.from(p.senha ?? '');
          s.write(Buffer.concat([Buffer.from([0x01, u.length]), u, Buffer.from([w.length]), w]));
          etapa = 2;
        } else if (metodo === 0x00) pedirConexao();
        else return falhar('o proxy SOCKS5 não aceitou o método de autenticação');
      } else if (etapa === 2) {
        if (buf.length < 2) return;
        if (buf[1] !== 0x00) return falhar('o proxy recusou usuário/senha (SOCKS5)');
        buf = buf.subarray(2); pedirConexao();
      } else if (etapa === 3) {
        if (buf.length < 10) return;
        if (buf[1] !== 0x00) return falhar(`o proxy SOCKS5 recusou a conexão (código ${buf[1]})`);
        etapa = 4;
        s.write(`GET ${IPAPI_PATH} HTTP/1.1\r\nHost: ${IPAPI_HOST}\r\nConnection: close\r\n\r\n`);
      }
    });
    s.on('end', () => { try { resolve(lerRespostaHttp(resposta)); } catch { reject(new Error('resposta inválida do teste de IP')); } });
    s.on('error', e => reject(e));
  });
}

/** Mede o IP de saída do proxy. Lança erro em português se não conseguir. */
export async function testarSaidaProxy(p: ProxyEntrada): Promise<SaidaProxy> {
  const j: any = await (p.protocolo === 'socks5' ? viaSocks5(p) : viaHttp(p)).catch((e: any) => {
    throw new Error(`Não foi possível sair pelo proxy: ${e?.message || e}`);
  });
  if (j?.status !== 'success' || !j?.query) throw new Error(`Teste de IP falhou: ${j?.message || 'sem resposta'}`);
  return {
    ip: String(j.query), pais: String(j.countryCode || ''), regiao: j.regionName || null, cidade: j.city || null,
    asn: j.as || null, org: j.org || j.isp || null, hospedagem: j.hosting === true, movel: j.mobile === true,
  };
}

/** Regras de aceite do IP de saída. null = aceito. */
export function motivoRecusaSaida(s: SaidaProxy): string | null {
  if (s.pais !== 'BR') return `O IP de saída do proxy (${s.ip}) é de ${s.pais || 'país desconhecido'}, não do Brasil. O número é +55: use um proxy com IP brasileiro.`;
  if (s.hospedagem) return `O IP de saída (${s.ip}, ${s.org || s.asn || 'provedor desconhecido'}) é de datacenter/hospedagem — o mesmo problema do IP da VPS. Use proxy residencial/ISP ou 4G.`;
  return null;
}

// ── Evolution ────────────────────────────────────────────────────────────────────────────────
function credenciais(a: any): { base: string; key: string } {
  return {
    base: sanitizeEvolutionUrl(a.evolution_server_url || process.env.EVOLUTION_API_URL || 'https://disparo.mentoark.com.br'),
    key: a.evolution_api_key || process.env.EVOLUTION_API_KEY || '',
  };
}

/** Campos do proxy no formato da Evolution (credenciais com encode — ver cabeçalho). */
export function camposEvolution(p: ProxyEntrada): { host: string; port: string; protocol: string; username: string; password: string } {
  return {
    host: p.host, port: String(p.port), protocol: p.protocolo,
    username: p.usuario ? encodeURIComponent(p.usuario) : '',
    password: p.senha ? encodeURIComponent(p.senha) : '',
  };
}

async function estadoEvolution(base: string, key: string, instancia: string): Promise<string | null> {
  const r = await evolutionFetch(`${base}/instance/connectionState/${encodeURIComponent(instancia)}`, { headers: { apikey: key } }).catch(() => null);
  if (!r || r.status === 404) return null; // instância não existe na Evolution ainda
  if (!r.ok) return 'desconhecido';
  const j: any = await r.json().catch(() => null);
  return j?.instance?.state || j?.state || 'desconhecido';
}

/** Proxy salvo do agente (para usar no /instance/create ou antes do /instance/connect). */
export async function proxyDoAgente(pool: Pool, agenteId: string): Promise<ProxyEntrada | null> {
  const a = (await pool.query(
    `SELECT proxy_host, proxy_port, proxy_protocolo, proxy_usuario, proxy_senha_enc FROM agentes WHERE id = $1 AND proxy_host IS NOT NULL`, [agenteId]
  ).catch(() => ({ rows: [] as any[] }))).rows[0];
  if (!a) return null;
  return {
    host: a.proxy_host, port: Number(a.proxy_port), protocolo: (a.proxy_protocolo === 'socks5' ? 'socks5' : 'http'),
    usuario: a.proxy_usuario || undefined, senha: a.proxy_senha_enc ? decriptarSegredoMetaOficial(a.proxy_senha_enc) : undefined,
  };
}

export async function marcarProxyAplicado(pool: Pool, agenteId: string): Promise<void> {
  await pool.query(`UPDATE agentes SET proxy_aplicado_em = NOW(), proxy_verificado_em = NOW(), updated_at = NOW() WHERE id = $1 AND proxy_host IS NOT NULL`, [agenteId]).catch(() => {});
  invalidarCacheBloqueio();
}

/** Só testa (para a tela mostrar IP/país/tipo antes de aplicar). */
export async function testarProxy(p: ProxyEntrada): Promise<{ saida?: SaidaProxy; recusa?: string | null; erro?: string }> {
  try {
    const saida = await testarSaidaProxy(p);
    return { saida, recusa: motivoRecusaSaida(saida) };
  } catch (e: any) { return { erro: e?.message || String(e) }; }
}

/**
 * Testa, salva e aplica o proxy. Número já conectado → reinicia a conexão para o proxy valer
 * (avisado na tela). Número não pareado → fica salvo e entra no próximo QR.
 * Devolve { erro } em português, ou { situacao } para a tela.
 */
// 2026-10-18 (Sprint 3): troca de IP é o sinal que o proxy deveria evitar ("um número, um IP, para
// sempre"). Pedido real do usuário: revezar 1 proxy entre 2 números a cada hora — cada troca reinicia a
// conexão e o mesmo IP pulando entre números liga os dois. Sem `confirmarTroca`, recusa:
//   - número que recebeu OUTRO IP (ou teve o proxy removido) nas últimas 72h;
//   - IP de saída que esteve em outro número nos últimos 7 dias.
const HORAS_SEM_TROCAR_IP = 72;
const DIAS_IP_DE_OUTRO_NUMERO = 7;

export async function motivoTrocaArriscada(pool: Pool, a: any, ip: string): Promise<string | null> {
  const numero = String(a.numero_conectado || '').replace(/\D/g, '');
  const ultimo = (await pool.query(
    `SELECT tipo, detalhe->>'ip' AS ip, criado_em FROM whatsapp_eventos_saude
     WHERE tipo IN ('proxy_aplicado', 'proxy_removido') AND (instancia = $1 OR ($2 <> '' AND numero = $2))
       AND criado_em >= NOW() - make_interval(hours => $3)
     ORDER BY criado_em DESC LIMIT 1`,
    [a.evolution_instancia, numero, HORAS_SEM_TROCAR_IP]
  ).catch(() => ({ rows: [] as any[] }))).rows[0];
  if (ultimo && (ultimo.tipo === 'proxy_removido' || ultimo.ip !== ip)) {
    const quando = new Date(ultimo.criado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    return `Este número já mudou de IP em ${quando} (${ultimo.tipo === 'proxy_removido' ? 'proxy removido' : `IP ${ultimo.ip}`}). Trocar de novo em menos de ${HORAS_SEM_TROCAR_IP}h reinicia a conexão e é um sinal forte de risco para o WhatsApp — o recomendado é um IP fixo por número.`;
  }
  const outro = (await pool.query(
    `SELECT instancia FROM whatsapp_eventos_saude
     WHERE tipo = 'proxy_aplicado' AND detalhe->>'ip' = $1 AND instancia IS DISTINCT FROM $2
       AND criado_em >= NOW() - make_interval(days => $3) LIMIT 1`,
    [ip, a.evolution_instancia, DIAS_IP_DE_OUTRO_NUMERO]
  ).catch(() => ({ rows: [] as any[] }))).rows[0];
  if (outro) {
    return `O IP ${ip} esteve em outro número (${outro.instancia}) nos últimos ${DIAS_IP_DE_OUTRO_NUMERO} dias. O mesmo IP passando de um número para outro faz o WhatsApp ligar os dois números ao mesmo dono.`;
  }
  return null;
}

async function registrarAplicacao(pool: Pool, a: any, saida: SaidaProxy, host: string, confirmouRisco: boolean): Promise<void> {
  await eventoProxy(pool, a, 'proxy_aplicado', { ip: saida.ip, host, org: saida.org, confirmou_risco: confirmouRisco || undefined });
}

export async function aplicarProxy(pool: Pool, agenteId: string, userId: string, entrada: ProxyEntrada, confirmarTroca = false): Promise<{ erro?: string; precisaConfirmar?: boolean; situacao?: 'aplicado_reconectado' | 'aplicado' | 'salvo_para_o_qr'; saida?: SaidaProxy }> {
  const a = (await pool.query(`SELECT * FROM agentes WHERE id = $1 AND user_id = $2`, [agenteId, userId])).rows[0];
  if (!a?.evolution_instancia) return { erro: 'Instância não encontrada.' };
  const p: ProxyEntrada = {
    ...entrada,
    senha: entrada.senha ?? (a.proxy_senha_enc && a.proxy_host === entrada.host ? decriptarSegredoMetaOficial(a.proxy_senha_enc) : undefined),
  };

  let saida: SaidaProxy;
  try { saida = await testarSaidaProxy(p); } catch (e: any) { return { erro: e?.message || String(e) }; }
  const recusa = motivoRecusaSaida(saida);
  if (recusa) return { erro: recusa, saida };

  const dono = (await pool.query(
    `SELECT nome, evolution_instancia FROM agentes
     WHERE id <> $1 AND proxy_host IS NOT NULL
       AND (proxy_ip_saida = $2 OR (lower(proxy_host) = $3 AND proxy_port = $4 AND COALESCE(proxy_usuario, '') = $5))
     LIMIT 1`,
    [agenteId, saida.ip, p.host, p.port, p.usuario ?? '']
  )).rows[0];
  if (dono) return { erro: `Este proxy sai pelo mesmo IP (${saida.ip}) de outro número (${dono.nome || dono.evolution_instancia}). Cada número precisa de um IP só dele.`, saida };

  const arriscado = await motivoTrocaArriscada(pool, a, saida.ip);
  if (arriscado && !confirmarTroca) return { erro: arriscado, precisaConfirmar: true, saida };
  if (arriscado) log.warn('PROXY', 'Troca de IP arriscada confirmada pelo usuário', { instancia: a.evolution_instancia, ip: saida.ip });

  await pool.query(
    `UPDATE agentes SET proxy_host = $3, proxy_port = $4, proxy_protocolo = $5, proxy_usuario = $6,
            proxy_senha_enc = COALESCE($7, proxy_senha_enc), proxy_aplicado_em = NULL,
            proxy_ip_saida = $8, proxy_pais = $9, proxy_asn = $10, proxy_org = $11, proxy_movel = $12,
            proxy_testado_em = NOW(), updated_at = NOW()
     WHERE id = $1 AND user_id = $2`,
    [agenteId, userId, p.host, p.port, p.protocolo, p.usuario ?? null, p.senha ? encriptarSegredoMetaOficial(p.senha) : null,
     saida.ip, saida.pais, saida.asn, saida.org, saida.movel]
  );

  const { base, key } = credenciais(a);
  const inst = a.evolution_instancia;
  const estado = await estadoEvolution(base, key, inst);
  if (estado === null) {
    // Ainda não existe na Evolution: o proxy vai junto no /instance/create do próximo QR.
    invalidarCacheBloqueio();
    await registrarAplicacao(pool, a, saida, p.host, !!arriscado);
    log.info('PROXY', 'Proxy salvo para o próximo pareamento', { instancia: inst, ip: saida.ip });
    return { situacao: 'salvo_para_o_qr', saida };
  }

  const set = await evolutionFetch(`${base}/proxy/set/${encodeURIComponent(inst)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: key },
    body: JSON.stringify({ enabled: true, ...camposEvolution(p) }),
  }).catch((err: any) => ({ ok: false, status: 0, text: async () => String(err?.message) }) as any);
  if (!set.ok) {
    const corpo = await set.text().catch(() => '');
    log.warn('PROXY', 'Evolution recusou o proxy', { instancia: inst, status: set.status });
    return { erro: `A Evolution recusou o proxy (HTTP ${set.status}). ${/invalid proxy/i.test(corpo) ? 'Ela não conseguiu sair pelo proxy — confira host, porta, usuário e senha.' : ''}`.trim(), saida };
  }

  if (estado === 'open') {
    // Reinicia para o proxy valer de verdade (restart → connectToWhatsapp → loadProxy).
    marcarLogoutPlanejado(inst);
    await evolutionFetch(`${base}/instance/restart/${encodeURIComponent(inst)}`, { method: 'POST', headers: { apikey: key } }).catch(() => null);
    let voltou = false;
    for (let i = 0; i < 10 && !voltou; i++) {
      await new Promise(r => setTimeout(r, 3000));
      voltou = (await estadoEvolution(base, key, inst)) === 'open';
    }
    if (!voltou) {
      log.warn('PROXY', 'Instância não voltou após aplicar proxy', { instancia: inst, ip: saida.ip });
      return { erro: 'O proxy foi aplicado, mas a conexão não voltou em 30 s. Confira na tela de instâncias; se não voltar, remova o proxy (o número volta a sair pelo IP da VPS).', saida };
    }
    await marcarProxyAplicado(pool, agenteId);
    await registrarAplicacao(pool, a, saida, p.host, !!arriscado);
    log.info('PROXY', 'Proxy aplicado e conexão reiniciada', { instancia: inst, ip: saida.ip });
    return { situacao: 'aplicado_reconectado', saida };
  }

  // Existe na Evolution mas não está conectada: o /instance/connect do próximo QR já carrega o proxy.
  await marcarProxyAplicado(pool, agenteId);
  await registrarAplicacao(pool, a, saida, p.host, !!arriscado);
  return { situacao: 'aplicado', saida };
}

export async function removerProxy(pool: Pool, agenteId: string, userId: string): Promise<string | null> {
  const a = (await pool.query(`SELECT * FROM agentes WHERE id = $1 AND user_id = $2`, [agenteId, userId])).rows[0];
  if (!a?.evolution_instancia) return 'Instância não encontrada.';
  const { base, key } = credenciais(a);
  const estado = await estadoEvolution(base, key, a.evolution_instancia);
  if (estado !== null) {
    await evolutionFetch(`${base}/proxy/set/${encodeURIComponent(a.evolution_instancia)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: key },
      body: JSON.stringify({ enabled: false, host: '', port: '', protocol: '', username: '', password: '' }),
    }).catch(() => null);
    if (estado === 'open') {
      marcarLogoutPlanejado(a.evolution_instancia);
      await evolutionFetch(`${base}/instance/restart/${encodeURIComponent(a.evolution_instancia)}`, { method: 'POST', headers: { apikey: key } }).catch(() => null);
    }
  }
  if (a.proxy_host) await eventoProxy(pool, a, 'proxy_removido', { ip: a.proxy_ip_saida, host: a.proxy_host });
  await pool.query(
    `UPDATE agentes SET proxy_host = NULL, proxy_port = NULL, proxy_protocolo = NULL, proxy_usuario = NULL,
            proxy_senha_enc = NULL, proxy_aplicado_em = NULL, proxy_ip_saida = NULL, proxy_pais = NULL,
            proxy_asn = NULL, proxy_org = NULL, proxy_movel = NULL, proxy_testado_em = NULL, updated_at = NOW()
     WHERE id = $1 AND user_id = $2`,
    [agenteId, userId]
  );
  invalidarCacheBloqueio();
  return null;
}

async function eventoProxy(pool: Pool, a: any, tipo: string, detalhe: Record<string, any>): Promise<void> {
  await pool.query(
    `INSERT INTO whatsapp_eventos_saude (numero, instancia, tipo, detalhe) VALUES ($1, $2, $3, $4)`,
    [String(a.numero_conectado || '').replace(/\D/g, '') || null, a.evolution_instancia, tipo, JSON.stringify(detalhe)]
  ).catch(() => {});
}

/**
 * Checagem de hora em hora de todo número com proxy (cron). Para cada um:
 *   1) a Evolution ainda tem o proxy ligado com o mesmo host? (senão: `proxy_perdido`, sai do Global);
 *   2) o IP de saída medido agora é o mesmo gravado? (senão: `proxy_ip_mudou` — proxy rotativo ou
 *      troca do fornecedor; IP novo para uma sessão viva é sinal de risco);
 *   3) o proxy responde? (senão: `proxy_falhou` — o número não consegue reconectar por ele).
 * Falha da Evolution ao consultar não derruba nada (tenta no próximo ciclo).
 */
export async function reverificarProxies(pool: Pool): Promise<{ conferidos: number; problemas: number }> {
  const r = await pool.query(
    `SELECT id, evolution_instancia, evolution_server_url, evolution_api_key, numero_conectado,
            proxy_host, proxy_port, proxy_protocolo, proxy_usuario, proxy_senha_enc, proxy_ip_saida, proxy_aplicado_em
     FROM agentes WHERE proxy_host IS NOT NULL AND evolution_instancia IS NOT NULL
       AND (proxy_verificado_em IS NULL OR proxy_verificado_em < NOW() - INTERVAL '55 minutes')`
  );
  let problemas = 0;
  for (const a of r.rows) {
    const { base, key } = credenciais(a);
    const p: ProxyEntrada = {
      host: a.proxy_host, port: Number(a.proxy_port), protocolo: a.proxy_protocolo === 'socks5' ? 'socks5' : 'http',
      usuario: a.proxy_usuario || undefined, senha: a.proxy_senha_enc ? decriptarSegredoMetaOficial(a.proxy_senha_enc) : undefined,
    };

    if (a.proxy_aplicado_em) {
      const resp = await evolutionFetch(`${base}/proxy/find/${encodeURIComponent(a.evolution_instancia)}`, { headers: { apikey: key } }).catch(() => null);
      if (resp?.ok) {
        const conf: any = await resp.json().catch(() => null);
        if (!(conf?.enabled === true && String(conf?.host || '').toLowerCase() === String(a.proxy_host).toLowerCase())) {
          problemas++;
          await pool.query(`UPDATE agentes SET proxy_aplicado_em = NULL WHERE id = $1`, [a.id]);
          log.warn('PROXY', 'Proxy não está mais ativo na Evolution — número sai do Aquecimento Global', { instancia: a.evolution_instancia });
          await eventoProxy(pool, a, 'proxy_perdido', { host: a.proxy_host });
          continue;
        }
      }
    }

    try {
      const saida = await testarSaidaProxy(p);
      if (a.proxy_ip_saida && saida.ip !== a.proxy_ip_saida) {
        problemas++;
        log.warn('PROXY', 'IP de saída do proxy mudou', { instancia: a.evolution_instancia, de: a.proxy_ip_saida, para: saida.ip });
        await eventoProxy(pool, a, 'proxy_ip_mudou', { de: a.proxy_ip_saida, para: saida.ip, pais: saida.pais, org: saida.org, hospedagem: saida.hospedagem });
      }
      await pool.query(
        `UPDATE agentes SET proxy_ip_saida = $2, proxy_pais = $3, proxy_asn = $4, proxy_org = $5, proxy_movel = $6,
                proxy_testado_em = NOW(), proxy_verificado_em = NOW() WHERE id = $1`,
        [a.id, saida.ip, saida.pais, saida.asn, saida.org, saida.movel]
      );
    } catch (e: any) {
      problemas++;
      log.warn('PROXY', 'Proxy não respondeu na checagem', { instancia: a.evolution_instancia, err: e?.message });
      await eventoProxy(pool, a, 'proxy_falhou', { host: a.proxy_host, erro: String(e?.message || e).slice(0, 200) });
      await pool.query(`UPDATE agentes SET proxy_verificado_em = NOW() WHERE id = $1`, [a.id]);
    }
  }
  return { conferidos: r.rows.length, problemas };
}
