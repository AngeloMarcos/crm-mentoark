/**
 * backupInstancia.ts — backup agendado (CSV) de contatos e conversas por instância (Sprint 3 /
 * H10, entregue na Sprint 8 em 2026-10-06): um ban não pode fazer o cliente perder os leads.
 *
 * [AUDITORIA] LÓGICA:
 *   - por instância conectada: `contatos.csv.gz` (quem conversou com aquela instância) e
 *     `conversas.csv.gz` (mensagens dos últimos 30 dias, sem mídia — só tipo e texto);
 *   - gravado em WHATSAPP_MEDIA_DIR/backups/<user_id>/<instância>/<data>-*.csv.gz — volume
 *     persistente e NÃO servido publicamente (diferente de /app/uploads, que é estático aberto);
 *     download só pela rota autenticada, conferindo o dono;
 *   - a VPS já teve disco cheio derrubando o Postgres: gzip, só as 3 cópias mais recentes por
 *     instância e nada é gravado com menos de 5 GB livres no disco.
 */
import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { withTenantContext } from '../db';
import { log } from '../logger';

const BASE = path.join(process.env.WHATSAPP_MEDIA_DIR || '/app/wa-media', 'backups');
const COPIAS = 3;
const MIN_LIVRE_BYTES = 5 * 1024 ** 3;

const seguro = (s: string) => String(s).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
function csv(linhas: any[], colunas: string[]): string {
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const t = v instanceof Date ? v.toISOString() : Array.isArray(v) ? v.join('|') : String(v);
    return /[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  // Separador ';' (Excel em pt-BR abre direto) e BOM UTF-8 para acentos.
  return '﻿' + [colunas.join(';'), ...linhas.map(l => colunas.map(c => esc(l[c])).join(';'))].join('\r\n');
}

export function dirBackup(userId: string, instancia: string): string {
  return path.join(BASE, seguro(userId), seguro(instancia));
}

async function espacoLivre(): Promise<number> {
  try {
    await fs.promises.mkdir(BASE, { recursive: true });
    const s = await (fs.promises as any).statfs(BASE);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return Number.MAX_SAFE_INTEGER; // sem statfs (Node antigo/Windows): não bloqueia
  }
}

export async function gerarBackupInstancia(pool: Pool, userId: string, instancia: string): Promise<{ contatos: number; mensagens: number } | null> {
  if (await espacoLivre() < MIN_LIVRE_BYTES) {
    log.warn('BACKUP', 'Pouco espaço em disco — backup não gerado', { instancia });
    return null;
  }
  const dados = await withTenantContext({ userId, isAdmin: false }, async client => {
    const msgs = await client.query(
      `SELECT split_part(remote_jid, '@', 1) AS conversa, push_name, from_me, message_type AS tipo, content AS texto,
              COALESCE(timestamp_wa, created_at) AS quando
       FROM whatsapp_messages
       WHERE user_id = $1 AND instance_name = $2 AND deleted_at IS NULL AND remote_jid NOT LIKE '%@g.us'
         AND NOT maturador_global -- Sprint 9: conversa com número de outra conta não vai para o backup do cliente
         AND created_at >= NOW() - INTERVAL '30 days'
       ORDER BY conversa, quando`,
      [userId, instancia]
    );
    const contatos = await client.query(
      `SELECT c.nome, c.telefone, c.email, c.empresa, c.cidade, c.estado, c.status, c.tags, c.optin_origem, c.opt_out,
              c.ultima_mensagem_em
       FROM contatos c
       WHERE c.user_id = $1 AND c.telefone IS NOT NULL AND EXISTS (
         SELECT 1 FROM whatsapp_messages m WHERE m.user_id = c.user_id AND m.instance_name = $2
           AND RIGHT(split_part(m.remote_jid, '@', 1), 11) = RIGHT(regexp_replace(c.telefone, '\\D', '', 'g'), 11))
       ORDER BY c.nome`,
      [userId, instancia]
    );
    return { msgs: msgs.rows, contatos: contatos.rows };
  });
  const dir = dirBackup(userId, instancia);
  await fs.promises.mkdir(dir, { recursive: true });
  const dia = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }); // AAAA-MM-DD
  await fs.promises.writeFile(path.join(dir, `${dia}-contatos.csv.gz`), zlib.gzipSync(csv(dados.contatos,
    ['nome', 'telefone', 'email', 'empresa', 'cidade', 'estado', 'status', 'tags', 'optin_origem', 'opt_out', 'ultima_mensagem_em'])));
  await fs.promises.writeFile(path.join(dir, `${dia}-conversas.csv.gz`), zlib.gzipSync(csv(dados.msgs,
    ['conversa', 'push_name', 'from_me', 'tipo', 'texto', 'quando'])));
  // Retenção: só as COPIAS datas mais recentes.
  const datas = [...new Set((await fs.promises.readdir(dir)).map(f => f.slice(0, 10)))].sort().reverse();
  for (const velha of datas.slice(COPIAS)) {
    for (const f of await fs.promises.readdir(dir)) if (f.startsWith(velha)) await fs.promises.unlink(path.join(dir, f)).catch(() => {});
  }
  return { contatos: dados.contatos.length, mensagens: dados.msgs.length };
}

/** Cron diário: todas as instâncias com número conectado. */
export async function gerarBackupsTodas(pool: Pool): Promise<number> {
  const r = await pool.query(
    `SELECT DISTINCT user_id, evolution_instancia FROM agentes WHERE evolution_instancia IS NOT NULL AND numero_conectado IS NOT NULL`
  );
  let n = 0;
  for (const a of r.rows) {
    const res = await gerarBackupInstancia(pool, a.user_id, a.evolution_instancia).catch(err => {
      log.warn('BACKUP', 'Falha no backup da instância', { instancia: a.evolution_instancia, err: err?.message });
      return null;
    });
    if (res) n++;
  }
  log.info('BACKUP', 'Backups por instância gerados', { instancias: n });
  return n;
}

/** Arquivos de backup de uma instância (mais recentes primeiro). */
export async function listarBackups(userId: string, instancia: string): Promise<{ arquivo: string; bytes: number }[]> {
  const dir = dirBackup(userId, instancia);
  const arquivos = await fs.promises.readdir(dir).catch(() => [] as string[]);
  const out: { arquivo: string; bytes: number }[] = [];
  for (const f of arquivos.sort().reverse()) {
    const st = await fs.promises.stat(path.join(dir, f)).catch(() => null);
    if (st) out.push({ arquivo: f, bytes: st.size });
  }
  return out;
}
