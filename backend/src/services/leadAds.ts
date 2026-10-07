/**
 * leadAds.ts — lead de formulário (Facebook/Instagram Lead Ads) vira contato no CRM (Sprint M1, 2026-10-06).
 *
 * [AUDITORIA] LÓGICA: o webhook `leadgen` é do APP (uma URL só pra todos os clientes) e traz só
 * ids (`leadgen_id`, `page_id`, `ad_id`, `form_id`). O dono vem de `meta_paginas` (página que o
 * usuário inscreveu pela tela Conta Meta) e os dados do formulário são buscados na Graph com o
 * token da página (permissão `leads_retrieval`). Cada lead: grava `marketing_leads`, cria/atualiza
 * o contato (origem "Lead Ads", opt-in = o próprio formulário), registra a atribuição e o evento
 * na timeline. Substitui o webhook antigo, que procurava o dono em `facebook_campanhas` (tabela
 * que nada preenche) e por isso falhava sempre com user_id nulo.
 */
import { Pool } from 'pg';
import { log } from '../logger';
import { GRAPH_URL, getContaMeta, graphRequest } from './metaAds';
import { decriptarSegredoMetaOficial } from './metaCloudApi';
import { registrarAtribuicao, salvarEntidades } from './atribuicaoAnuncio';

const CAMPOS_LEAD = 'id,created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,platform,is_organic';

/** Telefone do formulário → só dígitos, com DDI 55 quando vier no formato nacional (10/11 dígitos). */
export function normalizarTelefoneLead(bruto: unknown): string | null {
  const d = String(bruto ?? '').replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d.length >= 12 ? d : null;
}

/** field_data [{name, values[]}] → { nome, telefone, email, extras } */
export function lerCamposLead(fieldData: any[] | undefined) {
  const campos: Record<string, string> = {};
  for (const f of fieldData || []) {
    if (f?.name) campos[String(f.name)] = (f.values || []).map(String).join(', ');
  }
  const nome = campos.full_name || [campos.first_name, campos.last_name].filter(Boolean).join(' ') || null;
  const telefone = normalizarTelefoneLead(campos.phone_number || campos.telefone || campos.whatsapp);
  const email = (campos.email || '').trim().toLowerCase() || null;
  const extras: Record<string, string> = {};
  for (const [k, v] of Object.entries(campos)) {
    if (!['full_name', 'first_name', 'last_name', 'phone_number', 'email'].includes(k)) extras[k] = v;
  }
  return { nome, telefone, email, extras };
}

/** Processa um `change.value` do campo leadgen. Devolve quantos donos receberam o lead. Nunca lança. */
export async function processarLeadgen(pool: Pool, valor: any): Promise<number> {
  const pageId = String(valor?.page_id ?? '');
  const leadgenId = String(valor?.leadgen_id ?? '');
  if (!pageId || !leadgenId) return 0;

  const donos = await pool.query(
    `SELECT user_id, page_token_enc FROM meta_paginas WHERE page_id = $1 AND inscrito_leadgen`, [pageId]
  ).catch(() => ({ rows: [] as any[] }));
  if (!donos.rows.length) {
    log.warn('LEAD_ADS', 'Lead de página que nenhum usuário inscreveu — ignorado', { pageId, leadgenId });
    return 0;
  }

  let entregues = 0;
  for (const dono of donos.rows) {
    try {
      await processarParaUsuario(pool, dono.user_id, dono.page_token_enc, pageId, leadgenId, valor);
      entregues++;
    } catch (err: any) {
      log.error('LEAD_ADS', 'Falha ao processar lead', { userId: dono.user_id, leadgenId, err: err?.message });
    }
  }
  return entregues;
}

async function processarParaUsuario(pool: Pool, userId: string, pageTokenEnc: string | null, pageId: string, leadgenId: string, valor: any) {
  let token = pageTokenEnc ? decriptarSegredoMetaOficial(pageTokenEnc) : null;
  if (!token) token = (await getContaMeta(pool, userId))?.token ?? null;
  const lead = token ? await graphRequest(`${GRAPH_URL}/${encodeURIComponent(leadgenId)}?fields=${CAMPOS_LEAD}`, token) : null;

  const adId = String(lead?.ad_id ?? valor?.ad_id ?? '') || null;
  const adsetId = String(lead?.adset_id ?? valor?.adgroup_id ?? '') || null;
  const campaignId = String(lead?.campaign_id ?? '') || null;
  const formId = String(lead?.form_id ?? valor?.form_id ?? '') || null;

  if (!lead || lead.error) {
    // Sem os dados do formulário não dá pra criar contato — guarda os ids pra não perder o lead.
    log.warn('LEAD_ADS', 'Não foi possível buscar os dados do lead na Meta', { userId, leadgenId, err: lead?.error?.message || 'sem token' });
    await pool.query(
      `INSERT INTO marketing_leads (user_id, meta_lead_id, ad_id, adset_id, formulario_id, page_id, status_crm)
       VALUES ($1,$2,$3,$4,$5,$6,'erro_busca') ON CONFLICT (meta_lead_id) DO NOTHING`,
      [userId, leadgenId, adId, adsetId, formId, pageId]
    );
    return;
  }

  const { nome, telefone, email, extras } = lerCamposLead(lead.field_data);
  const campanhaNome: string | null = lead.campaign_name ?? null;

  // Contato: casa por telefone (índice único user_id+telefone) ou, sem telefone, por e-mail.
  let contatoId: string | null = null;
  const prova = `formulário Lead Ads ${formId ?? ''} (lead ${leadgenId})`.trim();
  if (telefone) {
    const c = await pool.query(
      `INSERT INTO contatos (user_id, nome, telefone, email, origem, status, optin_origem, optin_em, optin_prova)
       VALUES ($1, $2, $3, $4, 'Lead Ads', 'novo', 'lead_ads_formulario', NOW(), $5)
       ON CONFLICT (user_id, telefone) WHERE telefone IS NOT NULL DO UPDATE SET
         email = COALESCE(contatos.email, EXCLUDED.email),
         nome = CASE WHEN contatos.nome IS NULL OR contatos.nome = contatos.telefone THEN EXCLUDED.nome ELSE contatos.nome END,
         optin_origem = COALESCE(contatos.optin_origem, EXCLUDED.optin_origem),
         optin_em = COALESCE(contatos.optin_em, EXCLUDED.optin_em),
         optin_prova = COALESCE(contatos.optin_prova, EXCLUDED.optin_prova)
       RETURNING id`,
      [userId, nome || telefone, telefone, email, prova]
    );
    contatoId = c.rows[0]?.id ?? null;
  } else if (email) {
    const ex = await pool.query(`SELECT id FROM contatos WHERE user_id = $1 AND LOWER(email) = $2 LIMIT 1`, [userId, email]);
    contatoId = ex.rows[0]?.id ?? null;
    if (!contatoId) {
      const c = await pool.query(
        `INSERT INTO contatos (user_id, nome, email, origem, status, optin_origem, optin_em, optin_prova)
         VALUES ($1, $2, $3, 'Lead Ads', 'novo', 'lead_ads_formulario', NOW(), $4) RETURNING id`,
        [userId, nome || email, email, prova]
      );
      contatoId = c.rows[0]?.id ?? null;
    }
  }

  await pool.query(
    `INSERT INTO marketing_leads (user_id, meta_lead_id, nome, telefone, email, campanha, campanha_id, ad_id, adset_id,
                                  formulario_id, page_id, plataforma, dados_extras, contato_id, status_crm, capturado_em)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'novo', COALESCE($15::timestamptz, NOW()))
     ON CONFLICT (meta_lead_id) DO UPDATE SET
       nome = EXCLUDED.nome, telefone = EXCLUDED.telefone, email = EXCLUDED.email, campanha = EXCLUDED.campanha,
       campanha_id = EXCLUDED.campanha_id, ad_id = EXCLUDED.ad_id, adset_id = EXCLUDED.adset_id,
       dados_extras = EXCLUDED.dados_extras, contato_id = EXCLUDED.contato_id,
       status_crm = CASE WHEN marketing_leads.status_crm = 'erro_busca' THEN 'novo' ELSE marketing_leads.status_crm END
     WHERE marketing_leads.user_id = EXCLUDED.user_id`,
    [userId, leadgenId, nome, telefone, email, campanhaNome, campaignId, adId, adsetId, formId, pageId,
     lead.platform === 'ig' ? 'instagram' : 'facebook', JSON.stringify(extras), contatoId, lead.created_time ?? null]
  );

  await salvarEntidades(pool, userId, {
    adId, adNome: lead.ad_name, adsetId, adsetNome: lead.adset_name, campaignId, campaignNome: campanhaNome,
  });
  await registrarAtribuicao(pool, {
    userId, canal: 'lead_ads', contatoId, telefone, metaLeadId: leadgenId, adId, adsetId, campaignId,
    headline: lead.ad_name ?? null, sourceType: lead.is_organic ? 'organico' : 'ad',
    payload: { form_id: formId, page_id: pageId, platform: lead.platform ?? null },
  });

  if (contatoId) {
    await pool.query(
      `UPDATE contatos SET origem_inbound_em = COALESCE(origem_inbound_em, NOW()), origem_inbound_tipo = COALESCE(origem_inbound_tipo, 'anuncio'),
              origem_inbound_campanha = COALESCE(origem_inbound_campanha, $2) WHERE id = $1`,
      [contatoId, (campanhaNome || lead.ad_name || 'Lead Ads').slice(0, 200)]
    ).catch(() => {});
    await pool.query(
      `INSERT INTO timeline_eventos (contato_id, user_id, tipo, titulo, descricao) VALUES ($1, $2, 'sistema', $3, $4)`,
      [contatoId, userId, 'Lead de formulário (Meta)', `Campanha: ${campanhaNome || '—'} · Anúncio: ${lead.ad_name || adId || '—'}`]
    ).catch(() => {});
  }
  log.info('LEAD_ADS', 'Lead de formulário recebido', { userId, leadgenId, contato: !!contatoId, campaignId });
}
