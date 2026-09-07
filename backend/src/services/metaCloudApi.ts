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
  const r = await pool.query(`SELECT * FROM whatsapp_oficial_config WHERE user_id = $1 LIMIT 1`, [userId]);
  return r.rows[0] || null;
}

function graphUrl(cfg: MetaOficialConfig, path: string): string {
  return `https://graph.facebook.com/${cfg.graph_api_version}/${path}`;
}

// [AUDITORIA] LÓGICA: chamada leve (GET, não gasta cota de mensagem) só pra confirmar que
// `phone_number_id` + token realmente correspondem a um número válido e acessível com esse
// token — usado pelo botão "Testar conexão" da tela de configuração, mesmo espírito de
// `testarEvolution()` (Agentes.tsx) já usado pro canal não-oficial.
export async function testarConexaoMetaOficial(cfg: MetaOficialConfig): Promise<{ ok: boolean; numeroExibicao?: string; nomeVerificado?: string; qualidade?: string; erro?: string }> {
  if (!cfg.phone_number_id || !cfg.access_token_enc) {
    return { ok: false, erro: 'Preencha Phone Number ID e Access Token antes de testar.' };
  }
  try {
    const token = decriptar(cfg.access_token_enc);
    const url = graphUrl(cfg, `${cfg.phone_number_id}?fields=verified_name,display_phone_number,quality_rating`);
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data: any = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return { ok: false, erro: data?.error?.message || `Erro ${resp.status} da Graph API` };
    }
    return {
      ok: true,
      numeroExibicao: data.display_phone_number,
      nomeVerificado: data.verified_name,
      qualidade: data.quality_rating,
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
