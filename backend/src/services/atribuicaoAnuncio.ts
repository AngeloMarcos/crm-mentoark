/**
 * atribuicaoAnuncio.ts — grava de qual anúncio cada contato veio (Sprint M1, 2026-10-06).
 *
 * [AUDITORIA] LÓGICA: três portas de entrada chamam `registrarAtribuicao`:
 *   - número oficial (metaWebhookProcessor → `msg.referral`: source_id, ctwa_clid, source_url…);
 *   - Evolution (smartLinks.registrarOrigemInbound → `contextInfo.externalAdReply`: sourceId,
 *     ctwaClid, sourceUrl…) — os campos dependem da versão do WhatsApp/Baileys, por isso tudo é
 *     opcional e o payload cru fica guardado;
 *   - Lead Ads (services/leadAds.ts → lead com ad_id/adset_id/campaign_id).
 * Cada toque vira uma linha (o primeiro toque é `contatos.primeira_atribuicao_id`). Quando só
 * temos o ad_id, a hierarquia (conjunto/campanha) e os nomes são buscados na Graph em segundo
 * plano e ficam em `meta_entidades` — usa o token Meta Ads do usuário; sem token, fica só o id.
 * Nunca lança: atribuição é acessória, não pode derrubar o processamento da mensagem.
 */
import { Pool } from 'pg';
import { log } from '../logger';
import { GRAPH_URL, getContaMeta, graphRequest } from './metaAds';

export interface DadosAtribuicao {
  userId: string;
  canal: 'ctwa' | 'lead_ads' | 'utm';
  contatoId?: string | null;
  telefone?: string | null;
  ctwaClid?: string | null;
  metaLeadId?: string | null;
  adId?: string | null;
  adsetId?: string | null;
  campaignId?: string | null;
  sourceType?: string | null;
  sourceUrl?: string | null;
  headline?: string | null;
  payload?: unknown;
}

const digitos = (s: unknown) => String(s ?? '').replace(/\D/g, '');
const txt = (v: unknown, max = 500) => (v == null || v === '' ? null : String(v).slice(0, max));

export async function registrarAtribuicao(pool: Pool, d: DadosAtribuicao): Promise<string | null> {
  try {
    const telefone = d.telefone ? digitos(d.telefone) || null : null;
    let contatoId = d.contatoId || null;
    if (!contatoId && telefone) {
      const c = await pool.query(
        `SELECT id FROM contatos WHERE user_id = $1 AND telefone ILIKE $2 ORDER BY created_at LIMIT 1`,
        [d.userId, `%${telefone.slice(-11)}`]
      ).catch(() => ({ rows: [] as any[] }));
      contatoId = c.rows[0]?.id ?? null;
    }

    const dia = new Date().toISOString().slice(0, 10);
    const chave = d.ctwaClid ? `ctwa:${d.ctwaClid}`
      : d.metaLeadId ? `lead:${d.metaLeadId}`
      : `${d.canal}:${d.adId || d.sourceUrl || '?'}:${telefone || contatoId || '?'}:${dia}`;

    const ins = await pool.query(
      `INSERT INTO atribuicoes_anuncio
         (user_id, contato_id, telefone, canal, chave, ctwa_clid, meta_lead_id, ad_id, adset_id, campaign_id,
          source_type, source_url, headline, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (user_id, chave) DO UPDATE SET contato_id = COALESCE(atribuicoes_anuncio.contato_id, EXCLUDED.contato_id)
       RETURNING id, (xmax = 0) AS novo`,
      [d.userId, contatoId, telefone, d.canal, chave, txt(d.ctwaClid), txt(d.metaLeadId), txt(d.adId, 40),
       txt(d.adsetId, 40), txt(d.campaignId, 40), txt(d.sourceType, 40), txt(d.sourceUrl, 1000),
       txt(d.headline, 300), d.payload ? JSON.stringify(d.payload) : null]
    );
    const id: string = ins.rows[0].id;
    if (ins.rows[0].novo) {
      if (contatoId) {
        await pool.query(
          `UPDATE contatos SET primeira_atribuicao_id = COALESCE(primeira_atribuicao_id, $2) WHERE id = $1`,
          [contatoId, id]
        ).catch(() => {});
      }
      log.info('ATRIBUICAO', 'Toque de anúncio registrado', { userId: d.userId, canal: d.canal, adId: d.adId, temClid: !!d.ctwaClid });
      if (d.adId && !d.campaignId) void enriquecerAnuncio(pool, d.userId, d.adId);
    }
    return id;
  } catch (err: any) {
    log.warn('ATRIBUICAO', 'Falha ao registrar atribuição de anúncio', { userId: d.userId, canal: d.canal, err: err?.message });
    return null;
  }
}

/** Grava/atualiza nomes da hierarquia anúncio → conjunto → campanha no cache. */
export async function salvarEntidades(pool: Pool, userId: string, e: {
  adId?: string | null; adNome?: string | null; adStatus?: string | null; thumbnail?: string | null;
  adsetId?: string | null; adsetNome?: string | null; adsetStatus?: string | null;
  campaignId?: string | null; campaignNome?: string | null; campaignStatus?: string | null; objetivo?: string | null;
}): Promise<void> {
  const linhas: [string, string, string | null, string | null, string | null, string | null, string | null][] = [];
  if (e.campaignId) linhas.push([e.campaignId, 'campaign', null, e.campaignNome ?? null, e.campaignStatus ?? null, e.objetivo ?? null, null]);
  if (e.adsetId) linhas.push([e.adsetId, 'adset', e.campaignId ?? null, e.adsetNome ?? null, e.adsetStatus ?? null, null, null]);
  if (e.adId) linhas.push([e.adId, 'ad', e.adsetId ?? null, e.adNome ?? null, e.adStatus ?? null, null, e.thumbnail ?? null]);
  for (const [id, nivel, parent, nome, status, objetivo, thumb] of linhas) {
    await pool.query(
      `INSERT INTO meta_entidades (user_id, id, nivel, parent_id, campaign_id, nome, status, objetivo, thumbnail_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (user_id, id) DO UPDATE SET
         parent_id = COALESCE(EXCLUDED.parent_id, meta_entidades.parent_id),
         campaign_id = COALESCE(EXCLUDED.campaign_id, meta_entidades.campaign_id),
         nome = COALESCE(EXCLUDED.nome, meta_entidades.nome),
         status = COALESCE(EXCLUDED.status, meta_entidades.status),
         objetivo = COALESCE(EXCLUDED.objetivo, meta_entidades.objetivo),
         thumbnail_url = COALESCE(EXCLUDED.thumbnail_url, meta_entidades.thumbnail_url),
         atualizado_em = NOW()`,
      [userId, id, nivel, parent, e.campaignId ?? null, nome, status, objetivo, thumb]
    ).catch(err => log.warn('ATRIBUICAO', 'Falha ao gravar meta_entidades', { err: err?.message }));
  }
}

// Evita martelar a Graph quando o mesmo anúncio traz vários contatos em sequência.
const consultadosRecentemente = new Map<string, number>();

async function enriquecerAnuncio(pool: Pool, userId: string, adId: string): Promise<void> {
  const k = `${userId}:${adId}`;
  const agora = Date.now();
  if ((consultadosRecentemente.get(k) ?? 0) > agora - 10 * 60_000) return;
  consultadosRecentemente.set(k, agora);
  if (consultadosRecentemente.size > 5000) consultadosRecentemente.clear();
  try {
    const conta = await getContaMeta(pool, userId);
    if (!conta) return; // sem Meta Ads conectado: fica só o ad_id
    const ad = await graphRequest(
      `${GRAPH_URL}/${encodeURIComponent(adId)}?fields=id,name,status,adset{id,name,status},campaign{id,name,status,objective},creative{thumbnail_url}`,
      conta.token
    );
    if (ad?.error) {
      log.warn('ATRIBUICAO', 'Graph não devolveu o anúncio (conta de anúncios diferente do token?)', { userId, adId, err: ad.error.message });
      return;
    }
    await salvarEntidades(pool, userId, {
      adId, adNome: ad.name, adStatus: ad.status, thumbnail: ad.creative?.thumbnail_url,
      adsetId: ad.adset?.id, adsetNome: ad.adset?.name, adsetStatus: ad.adset?.status,
      campaignId: ad.campaign?.id, campaignNome: ad.campaign?.name, campaignStatus: ad.campaign?.status, objetivo: ad.campaign?.objective,
    });
    await pool.query(
      `UPDATE atribuicoes_anuncio SET adset_id = COALESCE(adset_id, $3), campaign_id = COALESCE(campaign_id, $4)
       WHERE user_id = $1 AND ad_id = $2 AND campaign_id IS NULL`,
      [userId, adId, ad.adset?.id ?? null, ad.campaign?.id ?? null]
    );
  } catch (err: any) {
    log.warn('ATRIBUICAO', 'Falha ao enriquecer anúncio', { userId, adId, err: err?.message });
  }
}

/** Toques de anúncio de um contato (mais recente primeiro), com nomes do cache. */
export async function atribuicoesDoContato(pool: Pool, userId: string, contatoId: string) {
  const c = await pool.query(`SELECT telefone, primeira_atribuicao_id FROM contatos WHERE id = $1 AND user_id = $2`, [contatoId, userId]);
  if (!c.rows[0]) return null;
  const tel = digitos(c.rows[0].telefone);
  // Toques gravados antes de o contato existir (Evolution registra a origem antes de criar o
  // contato) ficam só com telefone — vincula aqui e preenche o primeiro toque se faltar.
  if (tel) {
    const soltos = await pool.query(
      `UPDATE atribuicoes_anuncio SET contato_id = $2
        WHERE user_id = $1 AND contato_id IS NULL AND telefone LIKE '%' || RIGHT($3, 11) RETURNING id`,
      [userId, contatoId, tel]
    ).catch(() => ({ rowCount: 0 }));
    if (soltos.rowCount && !c.rows[0].primeira_atribuicao_id) {
      const p = await pool.query(
        `UPDATE contatos SET primeira_atribuicao_id = (
           SELECT id FROM atribuicoes_anuncio WHERE user_id = $2 AND contato_id = $1 ORDER BY criado_em LIMIT 1)
         WHERE id = $1 RETURNING primeira_atribuicao_id`,
        [contatoId, userId]
      ).catch(() => ({ rows: [] as any[] }));
      c.rows[0].primeira_atribuicao_id = p.rows[0]?.primeira_atribuicao_id ?? null;
    }
  }
  const r = await pool.query(
    `SELECT a.id, a.canal, a.ad_id, a.adset_id, a.campaign_id, a.source_type, a.source_url, a.headline,
            a.ctwa_clid IS NOT NULL AS tem_clid, a.meta_lead_id, a.criado_em,
            ad.nome AS anuncio_nome, ad.thumbnail_url, cj.nome AS conjunto_nome, cp.nome AS campanha_nome
       FROM atribuicoes_anuncio a
       LEFT JOIN meta_entidades ad ON ad.user_id = a.user_id AND ad.id = a.ad_id
       LEFT JOIN meta_entidades cj ON cj.user_id = a.user_id AND cj.id = a.adset_id
       LEFT JOIN meta_entidades cp ON cp.user_id = a.user_id AND cp.id = a.campaign_id
      WHERE a.user_id = $1
        AND (a.contato_id = $2 OR (a.contato_id IS NULL AND $3 <> '' AND a.telefone LIKE '%' || RIGHT($3, 11)))
      ORDER BY a.criado_em DESC
      LIMIT 50`,
    [userId, contatoId, tel]
  );
  return { primeira_atribuicao_id: c.rows[0].primeira_atribuicao_id, toques: r.rows };
}
