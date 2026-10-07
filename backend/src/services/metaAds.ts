/**
 * metaAds.ts — credencial Meta Ads por usuário + acesso à Graph API, compartilhado entre
 * routes/marketing.ts e services/atribuicaoAnuncio.ts / services/leadAds.ts (Sprint M1, 2026-10-06).
 */
import { Pool } from 'pg';
import { log } from '../logger';
import { encriptarSegredoMetaOficial, decriptarSegredoMetaOficial } from './metaCloudApi';

// [AUDITORIA] FIX APLICADO (Sprint Conexão Meta Ads, 2026-10-03): v19.0 saiu do suporte da Meta
// — todas as chamadas usam só esta constante, configurável por `META_GRAPH_VERSION`.
export const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v23.0';
export const GRAPH_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;

// [AUDITORIA] FIX APLICADO (Sprint Conexão Meta Ads, 2026-10-03): token gravado criptografado
// (`access_token_enc`, mesmo esquema AES-256-CBC/ENCRYPTION_KEY de `whatsapp_oficial_config`).
// Linhas antigas ainda em texto plano são migradas na primeira leitura.
export type ContaMeta = {
  token: string;
  ad_account_id: string | null;
  nome_conta: string | null;
  tipo_token: string;
  token_expira_em: Date | null;
};

export async function getContaMeta(pool: Pool, userId: string | undefined): Promise<ContaMeta | null> {
  const { rows: [c] } = await pool.query(
    `SELECT access_token, access_token_enc, ad_account_id, nome_conta, tipo_token, token_expira_em
     FROM facebook_contas WHERE user_id=$1`, [userId]
  );
  if (!c) return null;
  let token: string | null = null;
  if (c.access_token_enc) {
    token = decriptarSegredoMetaOficial(c.access_token_enc);
  } else if (c.access_token) {
    token = c.access_token;
    await pool.query(
      `UPDATE facebook_contas SET access_token_enc=$2, access_token=NULL WHERE user_id=$1`,
      [userId, encriptarSegredoMetaOficial(c.access_token)]
    ).catch(err => log.warn('MARKETING', 'Falha ao migrar token Meta para formato criptografado', { err: err?.message }));
  }
  if (!token) return null;
  return {
    token,
    ad_account_id: c.ad_account_id || null,
    nome_conta: c.nome_conta,
    tipo_token: c.tipo_token || 'oauth',
    token_expira_em: c.token_expira_em,
  };
}

/** GET/POST/DELETE na Graph com timeout de 15s. Devolve o JSON cru (pode conter `error`). */
export async function graphRequest(url: string, token: string, method: 'GET' | 'POST' | 'DELETE' = 'GET'): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const r = await fetch(url, {
      method,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      signal: controller.signal,
    });
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}
