/**
 * subscription.ts — estado da assinatura por tenant (owner_id).
 *
 * [AUDITORIA] LÓGICA (2026-09-10 — versão gratuita com trial de 3 dias): 1 linha por tenant em
 * `assinaturas`. `status` = trial | ativa | expirada. Este módulo resolve o status em tempo real
 * (não depende do cron): um trial cujo `trial_fim` já passou é tratado como `expirada` na hora,
 * e a linha é persistida. Cache curto em memória pra não bater no banco a cada request.
 *
 * A TRAVA de escrita (bloquear POST/PUT/PATCH/DELETE do tenant quando `expirada`) vive em
 * `middleware.ts` (assinaturaGuard) e só liga com `TRIAL_ENFORCEMENT=on` — este módulo é só a
 * fonte de verdade do status, usado pelo banner (GET /api/assinatura) e pela trava.
 */
import { Pool } from 'pg';
import { log } from '../logger';

const TRIAL_DIAS = 3;
const DIA_MS = 86_400_000;
// Contas criadas antes disto são grandfathered (nunca entram em trial). = dia do deploy da Fase 1.
const CUTOFF_GRANDFATHER = new Date('2026-09-11T00:00:00Z');
const CACHE_TTL_MS = 60_000;

export type AssinaturaStatus = 'trial' | 'ativa' | 'expirada';

export interface Assinatura {
  owner_id: string;
  status: AssinaturaStatus;
  plano: string;
  trial_inicio: string | null;
  trial_fim: string | null;
  ativada_em: string | null;
  observacao: string | null;
  dias_restantes: number; // só faz sentido em 'trial'
  read_only: boolean;     // true quando 'expirada'
}

const cache = new Map<string, { data: Assinatura; exp: number }>();

export function invalidarAssinaturaCache(ownerId?: string) {
  if (ownerId) cache.delete(ownerId);
  else cache.clear();
}

/** Tenant-raiz do usuário logado: COALESCE(owner_id, id). */
export async function resolverOwnerId(pool: Pool, userId: string): Promise<string> {
  try {
    const r = await pool.query(
      `SELECT COALESCE(owner_id, id)::text AS owner_id FROM users WHERE id = $1 LIMIT 1`,
      [userId]
    );
    return r.rows[0]?.owner_id || userId;
  } catch {
    return userId;
  }
}

export async function getAssinatura(pool: Pool, ownerId: string): Promise<Assinatura> {
  const hit = cache.get(ownerId);
  if (hit && hit.exp > Date.now()) return hit.data;

  let row = (await pool.query(`SELECT * FROM assinaturas WHERE owner_id = $1`, [ownerId])).rows[0];

  if (!row) {
    // Sem linha (falha no register, ou tenant que a migração de grandfather não pegou):
    // cria on-the-fly. Conta anterior ao cutoff => 'ativa'; conta nova => 'trial' a partir da
    // criação do usuário (uma conta criada há 5 dias já nasce expirada aqui, de propósito).
    const u = (await pool.query(`SELECT created_at FROM users WHERE id = $1`, [ownerId])).rows[0];
    const criadoEm: Date = u?.created_at ? new Date(u.created_at) : new Date();
    const grandfather = criadoEm < CUTOFF_GRANDFATHER;
    const trialInicio = grandfather ? null : criadoEm;
    const trialFim = grandfather ? null : new Date(criadoEm.getTime() + TRIAL_DIAS * DIA_MS);
    row = (await pool.query(
      `INSERT INTO assinaturas (owner_id, status, plano, trial_inicio, trial_fim, ativada_em, observacao)
       VALUES ($1, $2, 'free', $3, $4, $5, $6)
       ON CONFLICT (owner_id) DO UPDATE SET updated_at = now()
       RETURNING *`,
      [
        ownerId,
        grandfather ? 'ativa' : 'trial',
        trialInicio, trialFim,
        grandfather ? new Date() : null,
        grandfather ? 'grandfathered automático (sem linha na migração)' : 'trial criado on-the-fly',
      ]
    ).catch(err => { log.warn('ASSINATURA', 'Falha ao criar linha on-the-fly', { ownerId, err: err?.message }); return { rows: [] as any[] }; })).rows[0];
  }

  if (!row) {
    // Não deu pra ler nem criar — fail-open (nunca trava por erro de infra).
    const fallback: Assinatura = {
      owner_id: ownerId, status: 'ativa', plano: 'free',
      trial_inicio: null, trial_fim: null, ativada_em: null,
      observacao: 'fallback (erro ao resolver assinatura)', dias_restantes: 0, read_only: false,
    };
    return fallback;
  }

  let status: AssinaturaStatus = row.status;
  if (status === 'trial' && row.trial_fim && new Date(row.trial_fim).getTime() < Date.now()) {
    status = 'expirada';
    await pool.query(
      `UPDATE assinaturas SET status = 'expirada', updated_at = now() WHERE owner_id = $1 AND status = 'trial'`,
      [ownerId]
    ).catch(() => {});
  }

  const diasRestantes = status === 'trial' && row.trial_fim
    ? Math.max(0, Math.ceil((new Date(row.trial_fim).getTime() - Date.now()) / DIA_MS))
    : 0;

  const data: Assinatura = {
    owner_id: ownerId,
    status,
    plano: row.plano,
    trial_inicio: row.trial_inicio,
    trial_fim: row.trial_fim,
    ativada_em: row.ativada_em,
    observacao: row.observacao,
    dias_restantes: diasRestantes,
    read_only: status === 'expirada',
  };

  cache.set(ownerId, { data, exp: Date.now() + CACHE_TTL_MS });
  return data;
}
