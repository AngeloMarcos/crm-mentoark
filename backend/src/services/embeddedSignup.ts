/**
 * embeddedSignup.ts — Sprint 6 do maturador sem ban (2026-10-18): cadastro de clientes na API oficial
 * pela MentoArk como Tech Provider, via Embedded Signup **v4** (v2/v3 foram descontinuados em
 * 15/10/2026 — ver reports/Maturação WhatsApp e proxy 2026.md).
 *
 * Fluxo (docs Meta "Implementation" + "Onboarding customers as a Tech Provider" + "Onboard WhatsApp
 * Business app users", consultados em 18/10/2026):
 *   1. Navegador: FB.login({ config_id, response_type: 'code', override_default_response_type: true,
 *      extras: { setup: {} } }) — coexistência acrescenta `featureType: 'whatsapp_business_app_onboarding'`.
 *      A janela devolve `WA_EMBEDDED_SIGNUP` com waba_id / phone_number_id / business_id e o `code`
 *      (vale 30 s).
 *   2. Servidor (`concluirCadastro`): troca o code pelo token do cliente
 *      (GET /oauth/access_token?client_id&client_secret&code), inscreve o NOSSO app no webhook da WABA
 *      (POST /<WABA_ID>/subscribed_apps) e:
 *        - número novo na API: registra (POST /<PHONE_ID>/register com PIN de 6 dígitos);
 *        - coexistência: NÃO registra (já está registrado no app) e dispara a sincronização de
 *          contatos e histórico (POST /<PHONE_ID>/smb_app_data, sync_type smb_app_state_sync e
 *          history) — a Meta só aceita até 24h depois do cadastro.
 *   3. Webhook do app (um só, para todos os clientes): /webhook/meta/app — ver routes/metaWebhook.ts.
 *
 * Variáveis de ambiente: FACEBOOK_APP_ID, FACEBOOK_APP_SECRET, META_ES_CONFIG_ID (configuração de
 * "Cadastro incorporado do WhatsApp" no Login do Facebook para Empresas), META_WEBHOOK_VERIFY_TOKEN,
 * META_GRAPH_VERSION (opcional).
 */
import { Pool } from 'pg';
import crypto from 'crypto';
import { encriptarSegredoMetaOficial, versaoGraph } from './metaCloudApi';
import { log } from '../logger';

export interface ConfigCadastro {
  disponivel: boolean;
  appId: string | null;
  configId: string | null;
  versao: string;
  faltando: string[];
}

/** Valores públicos para o SDK no navegador (App ID e config_id não são segredo). */
export function configuracaoCadastro(): ConfigCadastro {
  const faltando = ['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET', 'META_ES_CONFIG_ID'].filter(v => !process.env[v]);
  return {
    disponivel: faltando.length === 0,
    appId: process.env.FACEBOOK_APP_ID || null,
    configId: process.env.META_ES_CONFIG_ID || null,
    versao: versaoGraph(),
    faltando,
  };
}

export interface DadosCadastro {
  code: string;
  waba_id: string;
  phone_number_id: string;
  business_id?: string | null;
  coexistencia?: boolean;
}

export interface EtapaCadastro { etapa: string; ok: boolean; detalhe?: string }

type FetchLike = typeof fetch;

async function graph(f: FetchLike, path: string, token: string | null, init: { method?: string; body?: unknown } = {}): Promise<{ ok: boolean; status: number; data: any; erro?: string }> {
  try {
    const resp = await f(`https://graph.facebook.com/${versaoGraph()}/${path}`, {
      method: init.method || 'GET',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const texto = await resp.text();
    let data: any = texto;
    try { data = JSON.parse(texto); } catch { /* token vem como texto em algumas versões */ }
    return { ok: resp.ok, status: resp.status, data, erro: resp.ok ? undefined : (data?.error?.message || `Erro ${resp.status} da Meta`) };
  } catch (err: any) {
    return { ok: false, status: 0, data: null, erro: err?.message || 'Falha de rede ao contatar a Meta' };
  }
}

/** Troca o code (30 s de validade) pelo token de negócio do cliente. */
export async function trocarCodePorToken(code: string, f: FetchLike = fetch): Promise<{ token?: string; erro?: string }> {
  const q = new URLSearchParams({
    client_id: process.env.FACEBOOK_APP_ID || '',
    client_secret: process.env.FACEBOOK_APP_SECRET || '',
    code,
  });
  const r = await graph(f, `oauth/access_token?${q.toString()}`, null);
  if (!r.ok) return { erro: r.erro };
  const token = typeof r.data === 'string' ? r.data : r.data?.access_token;
  return token ? { token } : { erro: 'A Meta não devolveu o token do cliente.' };
}

export function gerarPin(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * Conclui o cadastro: token → inscrição no webhook → registro (ou sincronização na coexistência) →
 * grava em `whatsapp_oficial_config` (origem 'embedded_signup', ativo). Cada etapa volta no resultado
 * para a tela mostrar o que deu certo; só a troca de token é obrigatória para salvar.
 */
export async function concluirCadastro(pool: Pool, userId: string, d: DadosCadastro, f: FetchLike = fetch): Promise<{ configId?: string; etapas: EtapaCadastro[]; erro?: string }> {
  const etapas: EtapaCadastro[] = [];
  const cfg = configuracaoCadastro();
  if (!cfg.disponivel) return { etapas, erro: `Cadastro pela Meta não configurado no servidor (faltando: ${cfg.faltando.join(', ')}).` };
  if (!/^\d+$/.test(String(d.waba_id || '')) || !/^\d+$/.test(String(d.phone_number_id || '')) || !d.code) {
    return { etapas, erro: 'Dados do cadastro incompletos (code, waba_id e phone_number_id são obrigatórios).' };
  }

  const t = await trocarCodePorToken(d.code, f);
  etapas.push({ etapa: 'token', ok: !!t.token, detalhe: t.erro });
  if (!t.token) return { etapas, erro: `Não foi possível concluir com a Meta: ${t.erro}. O código vale só 30 s — tente o cadastro de novo.` };
  const token = t.token;

  const sub = await graph(f, `${d.waba_id}/subscribed_apps`, token, { method: 'POST' });
  etapas.push({ etapa: 'webhook', ok: sub.ok, detalhe: sub.erro });

  const info = await graph(f, `${d.phone_number_id}?fields=display_phone_number,verified_name,quality_rating`, token);
  etapas.push({ etapa: 'numero', ok: info.ok, detalhe: info.erro });

  let pin: string | null = null;
  if (d.coexistencia) {
    for (const tipo of ['smb_app_state_sync', 'history']) {
      const s = await graph(f, `${d.phone_number_id}/smb_app_data`, token, { method: 'POST', body: { messaging_product: 'whatsapp', sync_type: tipo } });
      etapas.push({ etapa: tipo === 'history' ? 'sincronizar_historico' : 'sincronizar_contatos', ok: s.ok, detalhe: s.erro });
    }
  } else {
    pin = gerarPin();
    const reg = await graph(f, `${d.phone_number_id}/register`, token, { method: 'POST', body: { messaging_product: 'whatsapp', pin } });
    etapas.push({ etapa: 'registrar', ok: reg.ok, detalhe: reg.erro });
    if (!reg.ok) pin = null;
  }

  const r = await pool.query(
    `INSERT INTO whatsapp_oficial_config
       (user_id, numero_exibicao, phone_number_id, waba_id, access_token_enc, graph_api_version, ativo,
        origem, business_id, coexistencia, pin_enc, cadastro_em, quality_rating, ultima_conexao_em)
     VALUES ($1, $2, $3, $4, $5, $6, true, 'embedded_signup', $7, $8, $9, NOW(), $10, NOW())
     ON CONFLICT (user_id, phone_number_id) WHERE phone_number_id IS NOT NULL DO UPDATE SET
       numero_exibicao = EXCLUDED.numero_exibicao, waba_id = EXCLUDED.waba_id, access_token_enc = EXCLUDED.access_token_enc,
       graph_api_version = EXCLUDED.graph_api_version, ativo = true, origem = 'embedded_signup',
       business_id = EXCLUDED.business_id, coexistencia = EXCLUDED.coexistencia,
       pin_enc = COALESCE(EXCLUDED.pin_enc, whatsapp_oficial_config.pin_enc), cadastro_em = NOW(),
       quality_rating = EXCLUDED.quality_rating, ultima_conexao_em = NOW(), ultimo_erro = NULL, updated_at = NOW()
     RETURNING id`,
    [userId, info.data?.display_phone_number ?? null, d.phone_number_id, d.waba_id, encriptarSegredoMetaOficial(token),
     versaoGraph(), d.business_id ?? null, !!d.coexistencia, pin ? encriptarSegredoMetaOficial(pin) : null,
     info.data?.quality_rating ?? null]
  );
  log.info('EMBEDDED_SIGNUP', 'Número oficial cadastrado pela Meta', {
    userId, phoneNumberId: d.phone_number_id, wabaId: d.waba_id, coexistencia: !!d.coexistencia,
    etapas: etapas.map(e => `${e.etapa}:${e.ok ? 'ok' : 'falhou'}`).join(','),
  });
  return { configId: r.rows[0].id, etapas };
}
