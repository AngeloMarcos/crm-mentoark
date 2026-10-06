/**
 * metaCloudApi.ts — canal de envio via WhatsApp Business Platform oficial da Meta (Cloud API).
 *
 * [AUDITORIA] LÓGICA (Sprint Estruturar API Oficial, 2026-09-06, pedido explícito do usuário):
 * canal NOVO, paralelo à Evolution — não a substitui. Pesquisa feita antes de implementar
 * (documentação oficial da Meta, ver migrations.ts pro resumo completo): a Groups API oficial só
 * serve pra grupo criado pela própria empresa (máx. 8 participantes, exige Official Business
 * Account) — sem equivalente pra gerenciar grupo comunitário grande já existente. Por decisão
 * explícita do usuário, este canal cobre só conversa 1:1 com cliente; grupo continua na Evolution.
 *
 * Preço mudou em 2025: não é mais por "conversa" de 24h, é por MENSAGEM, variando por categoria
 * (marketing/utility/authentication cobram; "service" — resposta dentro da janela de 24h aberta
 * pelo cliente — é grátis) e por país. Todo template (HSM) precisa ser aprovado pela Meta antes
 * de usar — é o que a aba "API Oficial" de DisparoTemplateEditor.tsx vai submeter de verdade
 * quando essa integração estiver completa (ainda não está — esta é só a camada de conexão base:
 * enviar texto/mídia, testar credenciais, e receber webhook. Submissão de template e resposta
 * automática via agentEngine.ts ficam pra uma fase seguinte, depois de confirmar que a conexão
 * básica funciona contra a conta real do usuário).
 */
import crypto from 'crypto';
import { Pool } from 'pg';
import { log } from '../logger';

export interface MetaOficialConfig {
  id: string;
  user_id: string;
  numero_exibicao: string | null;
  phone_number_id: string | null;
  waba_id: string | null;
  access_token_enc: string | null;
  app_secret_enc: string | null;
  verify_token: string;
  graph_api_version: string;
  ativo: boolean;
}

// [AUDITORIA] LÓGICA: mesmo esquema de criptografia já usado em `ai-providers.ts`
// (`api_key_enc`/AES-256-CBC/`ENCRYPTION_KEY`) — duplicado aqui (não importado de lá) de
// propósito: são dois arquivos de credenciais diferentes (provider de IA vs canal de WhatsApp),
// evita acoplar um ao outro só por reaproveitar 8 linhas; a lógica em si tem que ficar idêntica,
// não a localização do código.
function encriptar(valor: string): string {
  const encKey = process.env.ENCRYPTION_KEY;
  if (!encKey || encKey.length < 64) throw new Error('ENCRYPTION_KEY inválida ou ausente (precisa de 32 bytes hex = 64 chars)');
  const keyBuf = Buffer.from(encKey, 'hex');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', keyBuf, iv);
  const enc = Buffer.concat([cipher.update(valor, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + enc.toString('hex');
}

function decriptar(valorEnc: string): string {
  const encKey = process.env.ENCRYPTION_KEY;
  if (!encKey || encKey.length < 64) throw new Error('ENCRYPTION_KEY inválida ou ausente');
  const keyBuf = Buffer.from(encKey, 'hex');
  const [ivHex, encHex] = valorEnc.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', keyBuf, iv);
  return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString('utf8');
}

export { encriptar as encriptarSegredoMetaOficial };

export async function buscarConfigMetaOficial(pool: Pool, userId: string): Promise<MetaOficialConfig | null> {
  const r = await pool.query(`SELECT * FROM whatsapp_oficial_config WHERE user_id = $1 ORDER BY created_at LIMIT 1`, [userId]);
  return r.rows[0] || null;
}

// Sprint 6 / H2: versão da Graph API centralizada (env META_GRAPH_VERSION), não espalhada por config.
export function versaoGraph(cfg?: { graph_api_version?: string | null }): string {
  return process.env.META_GRAPH_VERSION || cfg?.graph_api_version || 'v21.0';
}
function graphUrl(cfg: MetaOficialConfig, path: string): string {
  return `https://graph.facebook.com/${versaoGraph(cfg)}/${path}`;
}

// [AUDITORIA] LÓGICA (2026-09-16): a Graph API devolve o limite de mensagens como um enum tipo
// "TIER_250" / "TIER_10K" / "TIER_UNLIMITED" — igual ao rótulo mostrado em Business Manager, mas
// nunca documentado com uma lista fechada de valores possíveis (Meta já mudou os degraus antes,
// ex.: o antigo "TIER_1K" virou um patamar de 2 mil). Em vez de mapear um enum fixo (quebraria
// silenciosamente se a Meta adicionar um degrau novo), extrai o número e o multiplicador "K" do
// próprio nome do enum — funciona pra qualquer TIER_<n>[K] que a Meta já usou ou venha a usar.
/** Chamada genérica à Graph API com o token da config (Sprint 5, 2026-10-05). Nunca lança. */
export async function graphFetch(
  cfg: MetaOficialConfig, path: string, init: { method?: string; body?: unknown } = {}
): Promise<{ ok: boolean; status: number; data: any; erro?: string }> {
  if (!cfg.access_token_enc) return { ok: false, status: 0, data: null, erro: 'Access Token não configurado' };
  try {
    const resp = await fetch(graphUrl(cfg, path), {
      method: init.method || 'GET',
      headers: { Authorization: `Bearer ${decriptar(cfg.access_token_enc)}`, 'Content-Type': 'application/json' },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const data: any = await resp.json().catch(() => ({}));
    return { ok: resp.ok, status: resp.status, data, erro: resp.ok ? undefined : (data?.error?.message || `Erro ${resp.status} da Graph API`) };
  } catch (err: any) {
    return { ok: false, status: 0, data: null, erro: err?.message || 'Falha de rede ao contatar a Meta' };
  }
}

/**
 * Limite de mensagens do número. [AUDITORIA] BUG CORRIGIDO (2026-10-05): o teste de conexão
 * pedia `messaging_limit_tier` junto com os outros campos — a Meta descontinuou esse campo em
 * fev/2026 e a Graph API rejeita a requisição INTEIRA quando um campo não existe, então o teste
 * passaria a falhar sempre. Agora o limite é pedido à parte, tentando o campo novo e caindo pro
 * antigo; falha aqui não derruba o teste.
 */
export async function buscarLimiteMensagens(cfg: MetaOficialConfig): Promise<string | null> {
  for (const campo of ['whatsapp_business_manager_messaging_limit', 'messaging_limit_tier']) {
    const r = await graphFetch(cfg, `${cfg.phone_number_id}?fields=${campo}`);
    const v = r.ok ? r.data?.[campo] : null;
    if (v) return typeof v === 'string' ? v : (v.current_limit || v.max_daily_conversations_per_business || null);
  }
  return null;
}

export function parseLimiteMensagens(tier: string | null | undefined): { valor: number | null; label: string } {
  if (!tier) return { valor: null, label: '—' };
  if (tier === 'TIER_UNLIMITED') return { valor: null, label: 'Ilimitado' };
  const m = /^TIER_(\d+)(K)?$/.exec(tier);
  if (!m) return { valor: null, label: tier };
  const valor = parseInt(m[1], 10) * (m[2] ? 1000 : 1);
  return { valor, label: valor.toLocaleString('pt-BR') };
}

// [AUDITORIA] LÓGICA: chamada leve (GET, não gasta cota de mensagem) só pra confirmar que
// `phone_number_id` + token realmente correspondem a um número válido e acessível com esse
// token — usado pelo botão "Testar conexão" da tela de configuração, mesmo espírito de
// `testarEvolution()` (Agentes.tsx) já usado pro canal não-oficial. Também traz `quality_rating`
// e `messaging_limit_tier` (pedido do usuário: ver quanto de limite a Meta libera, mesmo sem
// ainda ter a estrutura completa de disparo pela API Oficial) pra persistir e mostrar na tela.
export async function testarConexaoMetaOficial(cfg: MetaOficialConfig): Promise<{
  ok: boolean; numeroExibicao?: string; nomeVerificado?: string; qualidade?: string;
  limiteTier?: string; limiteValor?: number | null; limiteLabel?: string; erro?: string;
}> {
  if (!cfg.phone_number_id || !cfg.access_token_enc) {
    return { ok: false, erro: 'Preencha Phone Number ID e Access Token antes de testar.' };
  }
  try {
    const token = decriptar(cfg.access_token_enc);
    // Sem `messaging_limit_tier` aqui (descontinuado — ver buscarLimiteMensagens abaixo).
    const url = graphUrl(cfg, `${cfg.phone_number_id}?fields=verified_name,display_phone_number,quality_rating`);
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data: any = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return { ok: false, erro: data?.error?.message || `Erro ${resp.status} da Graph API` };
    }
    const limiteTier = await buscarLimiteMensagens(cfg).catch(() => null);
    const { valor, label } = parseLimiteMensagens(limiteTier);
    return {
      ok: true,
      numeroExibicao: data.display_phone_number,
      nomeVerificado: data.verified_name,
      qualidade: data.quality_rating,
      limiteTier: limiteTier ?? undefined,
      limiteValor: valor,
      limiteLabel: label,
    };
  } catch (err: any) {
    log.error('META_OFICIAL', 'Falha ao testar conexão', { err: err?.message });
    return { ok: false, erro: err?.message || 'Falha de rede ao contatar a Meta' };
  }
}

export async function enviarTextoMetaOficial(cfg: MetaOficialConfig, numeroDestino: string, texto: string): Promise<{ ok: boolean; messageId?: string; erro?: string }> {
  if (!cfg.access_token_enc || !cfg.phone_number_id) return { ok: false, erro: 'Canal não configurado' };
  try {
    const token = decriptar(cfg.access_token_enc);
    const resp = await fetch(graphUrl(cfg, `${cfg.phone_number_id}/messages`), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: numeroDestino.replace(/\D/g, ''),
        type: 'text',
        text: { body: texto },
      }),
    });
    const data: any = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      log.warn('META_OFICIAL', 'Falha ao enviar texto', { status: resp.status, erro: data?.error?.message });
      return { ok: false, erro: data?.error?.message || `Erro ${resp.status}` };
    }
    return { ok: true, messageId: data?.messages?.[0]?.id };
  } catch (err: any) {
    log.error('META_OFICIAL', 'Erro inesperado ao enviar texto', { err: err?.message });
    return { ok: false, erro: err?.message };
  }
}

// [AUDITORIA] LÓGICA: verificação de assinatura do webhook (`X-Hub-Signature-256`) — a Meta
// assina o corpo cru da requisição com HMAC-SHA256 usando o App Secret; sem essa checagem,
// qualquer requisição POST pra essa URL (pública, sem JWT — a Meta não manda nosso token)
// seria aceita como se viesse da Meta de verdade. Comparação em tempo constante
// (`timingSafeEqual`) — evita vazar o segredo por diferença de tempo de resposta.
export function verificarAssinaturaWebhook(appSecret: string, rawBody: Buffer, assinaturaHeader: string | undefined): boolean {
  if (!assinaturaHeader?.startsWith('sha256=')) return false;
  const esperado = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const recebido = assinaturaHeader.slice('sha256='.length);
  try {
    return crypto.timingSafeEqual(Buffer.from(esperado, 'hex'), Buffer.from(recebido, 'hex'));
  } catch {
    return false; // tamanho diferente — nunca é igual mesmo, mas timingSafeEqual lança em vez de devolver false
  }
}

export function decriptarSegredoMetaOficial(valorEnc: string): string {
  return decriptar(valorEnc);
}
