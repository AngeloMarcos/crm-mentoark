/**
 * identidadeContato.ts — identidade de contato por múltiplos IDs (Sprint 3 / H1, 2026-10-05).
 *
 * [AUDITORIA] BUG GRAVE (medido em produção, 30 dias): 1.952 conversas chegaram por `@lid`
 * (Baileys 7 / WhatsApp passou a esconder o telefone atrás de um "Linked ID") contra 1.991 por
 * telefone. O webhook usava `remoteJid.split('@')[0]` como "telefone" — pra `@lid` isso é o LID,
 * não um telefone. Consequências: (1) a mesma pessoa virava 2 contatos (telefone do disparo +
 * LID da resposta); (2) a resposta ao disparo não casava com quem recebeu (taxa de resposta e
 * score subestimados); (3) a IA respondia com `number: <LID>`, que a Evolution trata como
 * telefone → mensagem pra número inexistente.
 * [AUDITORIA] FIX APLICADO:
 *   - ~55% das mensagens `@lid` trazem o telefone real em `key.remoteJidAlt`/`senderPn`. Cada
 *     par LID↔telefone visto é gravado em `contato_identidades`; mensagens seguintes que chegam
 *     só com o LID são resolvidas pro telefone (`resolverTelefone`);
 *   - quando o par é aprendido e já existia um contato "fantasma" com o LID no lugar do telefone,
 *     ele é mesclado no contato do telefone (`mesclarContatos`) — referências, listas, tags e
 *     histórico de conversa vão junto;
 *   - LID sem telefone conhecido: o contato é marcado `tipo_telefone='lid'` + `whatsapp_jid`, e a
 *     resposta da IA vai pro JID `@lid` (`destinoEnvio`), não pra um "telefone" inexistente.
 * Modelo já preparado pra BSUID/username (API oficial, 2026) — tipos aceitos na tabela, ordem de
 * casamento BSUID → parent BSUID → telefone/wa_id → LID → username.
 */
import { Pool } from 'pg';
import { log } from '../logger';

export type TipoIdentidade = 'telefone' | 'wa_id' | 'lid' | 'bsuid' | 'parent_bsuid' | 'username';

export interface Identidades {
  telefone: string | null;
  lid: string | null;
}

const digitos = (s: unknown) => String(s || '').split('@')[0].split(':')[0].replace(/\D/g, '');

/** Extrai telefone real e LID de uma mensagem 1:1 da Evolution (Baileys). */
export function extrairIdentidades(key: any): Identidades {
  const remoteJid = String(key?.remoteJid || '');
  const alts = [key?.remoteJidAlt, key?.senderPn].map(v => String(v || '')).filter(Boolean);
  if (remoteJid.endsWith('@lid')) {
    const altTel = alts.find(a => a.endsWith('@s.whatsapp.net'));
    return { lid: digitos(remoteJid), telefone: altTel ? digitos(altTel) : null };
  }
  if (remoteJid.endsWith('@s.whatsapp.net')) {
    const altLid = alts.find(a => a.endsWith('@lid'));
    return { telefone: digitos(remoteJid), lid: altLid ? digitos(altLid) : null };
  }
  return { telefone: null, lid: null };
}

// ── Destino de envio para contato só-LID (resposta da IA) ────────────────────────────────────
const destinoLid = new Map<string, { jid: string; em: number }>();
/** Webhook registra: este "telefone" (na verdade um LID) responde pelo JID `@lid`. */
export function lembrarDestinoLid(lid: string, jid: string): void {
  destinoLid.set(lid, { jid, em: Date.now() });
  if (destinoLid.size > 20_000) {
    const limite = Date.now() - 24 * 3_600_000;
    for (const [k, v] of destinoLid) if (v.em < limite) destinoLid.delete(k);
  }
}
/** Pra onde enviar: o JID `@lid` quando o "telefone" é um LID sem telefone conhecido. */
export function destinoEnvio(telefone: string): string {
  return destinoLid.get(digitos(telefone))?.jid ?? telefone;
}

// ── Resolução e registro ─────────────────────────────────────────────────────────────────────
/** Telefone real do contato: o que veio na mensagem, ou o aprendido antes para este LID. */
export async function resolverTelefone(pool: Pool, userId: string, ids: Identidades): Promise<string | null> {
  if (ids.telefone) return ids.telefone;
  if (!ids.lid) return null;
  const r = await pool.query(
    `SELECT telefone FROM contato_identidades WHERE user_id = $1 AND tipo = 'lid' AND valor = $2 AND telefone IS NOT NULL LIMIT 1`,
    [userId, ids.lid]
  ).catch(() => ({ rows: [] as any[] }));
  return r.rows[0]?.telefone ?? null;
}

async function contatoPorTelefone(pool: Pool, userId: string, telefone: string): Promise<{ id: string } | null> {
  const r = await pool.query(
    `SELECT id FROM contatos WHERE user_id = $1 AND telefone IS NOT NULL
       AND RIGHT(regexp_replace(telefone, '\\D', '', 'g'), 11) = RIGHT($2, 11)
       AND COALESCE(tipo_telefone, '') <> 'lid'
     ORDER BY created_at ASC LIMIT 1`,
    [userId, telefone]
  ).catch(() => ({ rows: [] as any[] }));
  return r.rows[0] ?? null;
}

/**
 * Grava as identidades vistas nesta mensagem e, se o par LID↔telefone acabou de ser aprendido e
 * existe contato "fantasma" com o LID no lugar do telefone, mescla no contato do telefone.
 * Nunca lança.
 */
export async function registrarIdentidades(pool: Pool, userId: string, ids: Identidades, instancia: string | null): Promise<void> {
  try {
    const contatoTel = ids.telefone ? await contatoPorTelefone(pool, userId, ids.telefone) : null;
    if (ids.telefone) {
      await pool.query(
        `INSERT INTO contato_identidades (user_id, tipo, valor, contato_id, instancia)
         VALUES ($1, 'telefone', $2, $3, $4)
         ON CONFLICT (user_id, tipo, valor) DO UPDATE
           SET contato_id = COALESCE(EXCLUDED.contato_id, contato_identidades.contato_id), atualizado_em = NOW()`,
        [userId, ids.telefone, contatoTel?.id ?? null, instancia]
      );
    }
    if (ids.lid) {
      await pool.query(
        `INSERT INTO contato_identidades (user_id, tipo, valor, telefone, contato_id, instancia)
         VALUES ($1, 'lid', $2, $3, $4, $5)
         ON CONFLICT (user_id, tipo, valor) DO UPDATE
           SET telefone = COALESCE(EXCLUDED.telefone, contato_identidades.telefone),
               contato_id = COALESCE(EXCLUDED.contato_id, contato_identidades.contato_id),
               atualizado_em = NOW()`,
        [userId, ids.lid, ids.telefone, contatoTel?.id ?? null, instancia]
      );
    }
    // Par completo + contato fantasma com o LID → mescla no contato do telefone.
    if (ids.lid && ids.telefone && contatoTel) {
      const fantasma = await pool.query(
        `SELECT id FROM contatos WHERE user_id = $1 AND id <> $3
           AND regexp_replace(telefone, '\\D', '', 'g') = $2`,
        [userId, ids.lid, contatoTel.id]
      ).catch(() => ({ rows: [] as any[] }));
      for (const f of fantasma.rows) {
        await mesclarContatos(pool, userId, contatoTel.id, f.id, { lid: ids.lid, telefone: ids.telefone });
      }
    }
  } catch (err: any) {
    log.warn('IDENTIDADE', 'Falha ao registrar identidades', { userId, err: err?.message });
  }
}

/** Marca um contato que só tem LID (sem telefone conhecido) — tela mostra "sem telefone". */
export async function marcarContatoSoLid(pool: Pool, userId: string, lid: string, jid: string): Promise<void> {
  await pool.query(
    `UPDATE contatos SET tipo_telefone = 'lid', whatsapp_jid = $3
     WHERE user_id = $1 AND regexp_replace(telefone, '\\D', '', 'g') = $2
       AND (tipo_telefone IS DISTINCT FROM 'lid' OR whatsapp_jid IS DISTINCT FROM $3)`,
    [userId, lid, jid]
  ).catch(() => {});
}

// Tabelas com `contato_id` simples (sem chave única envolvendo o contato).
const TABELAS_REF = ['chamadas', 'corridas', 'disparo_logs', 'follow_ups', 'ia_pausa_log', 'tarefas', 'timeline_eventos', 'contato_respostas'];

/**
 * Mescla `removerId` em `manterId` (mesmo usuário): move todas as referências, combina campos
 * (tags, notas, opt-out, datas, nome quando o mantido só tem número), une o histórico de conversa
 * do JID `@lid` no JID do telefone e apaga o contato removido. Tudo numa transação.
 */
export async function mesclarContatos(
  pool: Pool, userId: string, manterId: string, removerId: string,
  par?: { lid: string; telefone: string }
): Promise<boolean> {
  if (manterId === removerId) return false;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Mesmo contexto de tenant de `withTenantContext` (db.ts): onde o RLS de whatsapp_messages
    // está ativo (homologação), sem isso o UPDATE do histórico não enxerga nenhuma linha.
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
    await client.query(`SELECT set_config('app.is_admin', 'false', true)`);
    const c = await client.query(
      `SELECT * FROM contatos WHERE user_id = $1 AND id = ANY($2::uuid[]) FOR UPDATE`,
      [userId, [manterId, removerId]]
    );
    const manter = c.rows.find((x: any) => x.id === manterId);
    const remover = c.rows.find((x: any) => x.id === removerId);
    if (!manter || !remover) { await client.query('ROLLBACK'); return false; }

    // Comando opcional dentro da transação: se falhar (tabela inexistente num ambiente, etc.),
    // volta só ele via SAVEPOINT — um erro solto abortaria a transação inteira em silêncio.
    let sp = 0;
    const opcional = async (sql: string, params: any[]) => {
      const nome = `sp_${++sp}`;
      await client.query(`SAVEPOINT ${nome}`);
      try { await client.query(sql, params); await client.query(`RELEASE SAVEPOINT ${nome}`); }
      catch { await client.query(`ROLLBACK TO SAVEPOINT ${nome}`); }
    };

    for (const t of TABELAS_REF) {
      await opcional(`UPDATE ${t} SET contato_id = $1 WHERE contato_id = $2`, [manterId, removerId]);
    }
    await opcional(
      `INSERT INTO contato_listas (contato_id, lista_id) SELECT $1, lista_id FROM contato_listas WHERE contato_id = $2 ON CONFLICT DO NOTHING`,
      [manterId, removerId]
    );
    await opcional(`DELETE FROM contato_listas WHERE contato_id = $1`, [removerId]);
    await client.query(`UPDATE contato_identidades SET contato_id = $1 WHERE contato_id = $2`, [manterId, removerId]);

    const soNumero = (n: unknown) => !n || /^[0-9+() -]+$/.test(String(n));
    await client.query(
      `UPDATE contatos SET
         tags = (SELECT ARRAY(SELECT DISTINCT unnest(COALESCE(tags, '{}') || COALESCE($3::text[], '{}')))),
         notas = CASE WHEN COALESCE($4, '') = '' THEN notas
                      WHEN COALESCE(notas, '') = '' THEN $4 ELSE notas || E'\n' || $4 END,
         nome = CASE WHEN $5 THEN $6 ELSE nome END,
         push_name = COALESCE(push_name, $7),
         opt_out = COALESCE(opt_out, false) OR COALESCE($8, false),
         opt_out_at = COALESCE(opt_out_at, $9),
         ultima_mensagem_em = GREATEST(ultima_mensagem_em, $10),
         resposta_em = GREATEST(resposta_em, $11),
         resposta_categoria = COALESCE(resposta_categoria, $12),
         profile_pic_url = COALESCE(profile_pic_url, $13),
         updated_at = NOW()
       WHERE id = $1 AND user_id = $2`,
      [manterId, userId, remover.tags, remover.notas, soNumero(manter.nome) && !soNumero(remover.nome), remover.nome,
       remover.push_name, remover.opt_out, remover.opt_out_at, remover.ultima_mensagem_em, remover.resposta_em,
       remover.resposta_categoria, remover.profile_pic_url]
    );

    // Histórico de conversa do JID @lid passa pro JID do telefone (inbox vira uma conversa só).
    if (par) {
      await opcional(
        `UPDATE whatsapp_messages SET remote_jid = $3 WHERE user_id = $1 AND remote_jid = $2`,
        [userId, `${par.lid}@lid`, `${par.telefone}@s.whatsapp.net`]
      );
      // Estado da IA por telefone: mantém o do telefone; o do LID some se o do telefone existir.
      await opcional(
        `UPDATE dados_cliente SET telefone = $3 WHERE user_id = $1 AND telefone = $2
           AND NOT EXISTS (SELECT 1 FROM dados_cliente d2 WHERE d2.user_id = $1 AND d2.telefone = $3)`,
        [userId, par.lid, par.telefone]
      );
      await opcional(`DELETE FROM dados_cliente WHERE user_id = $1 AND telefone = $2`, [userId, par.lid]);
    }

    await client.query(`DELETE FROM contatos WHERE id = $1 AND user_id = $2`, [removerId, userId]);
    await opcional(
      `INSERT INTO timeline_eventos (contato_id, user_id, tipo, titulo, descricao) VALUES ($1, $2, 'sistema', $3, $4)`,
      [manterId, userId, 'Contato mesclado',
       `A mesma pessoa tinha um segundo registro pelo LID${par ? ` ${par.lid}` : ''} do WhatsApp. Conversas, listas e histórico foram unidos aqui.`]
    );
    await client.query('COMMIT');
    log.info('IDENTIDADE', 'Contatos mesclados', { userId, manterId, removerId, lid: par?.lid });
    return true;
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {});
    log.warn('IDENTIDADE', 'Falha ao mesclar contatos', { userId, manterId, removerId, err: err?.message });
    return false;
  } finally {
    client.release();
  }
}

/** JID da conversa na inbox: o `@lid` quando o contato só tem LID, senão o do telefone. */
export function jidConversa(telefone: string): string {
  const d = destinoEnvio(telefone);
  return d.includes('@') ? d : `${digitos(telefone)}@s.whatsapp.net`;
}
