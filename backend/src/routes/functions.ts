import { Router, Response } from 'express';
import { Pool } from 'pg';
import { AuthRequest } from '../middleware';

function normalizarBR(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, '').replace(/^0+/, '');
  if (!d) return null;
  if (!d.startsWith('55') && (d.length === 10 || d.length === 11)) d = '55' + d;
  if (!d.startsWith('55') || d.length < 12) return null;
  const ddd = d.slice(2, 4);
  let resto = d.slice(4);
  if (resto.length === 8 && /^[6-9]/.test(resto)) resto = '9' + resto;
  if (/^[2-5]/.test(resto)) return null;
  if (resto.length !== 9 || !resto.startsWith('9')) return null;
  return '55' + ddd + resto;
}

export default function functions(pool: Pool): Router {
  const router = Router();

  // POST /api/functions/validar-numeros-whatsapp
  router.post('/validar-numeros-whatsapp', async (req: AuthRequest, res: Response) => {
    try {
      const { contato_ids, lista_id } = req.body as { contato_ids?: string[]; lista_id?: string };
      const userId = req.userId;

      // Load Evolution config
      const evoRes = await pool.query(
        `SELECT url, api_key, instancia FROM integracoes_config
         WHERE user_id = $1 AND tipo = 'evolution' AND status = 'ativo' LIMIT 1`,
        [userId]
      );
      const evo = evoRes.rows[0];
      if (!evo?.url || !evo?.api_key || !evo?.instancia) {
        return res.status(400).json({ error: 'Evolution API não configurada' });
      }

      // Load target contacts
      let cSql = `SELECT id, telefone, tags FROM contatos WHERE user_id = $1 AND telefone IS NOT NULL`;
      const cParams: any[] = [userId];
      let cIdx = 2;
      if (contato_ids?.length) {
        const ph = contato_ids.map(() => `$${cIdx++}`).join(', ');
        cSql += ` AND id IN (${ph})`;
        cParams.push(...contato_ids);
      }
      if (lista_id) {
        cSql += ` AND lista_id = $${cIdx++}`;
        cParams.push(lista_id);
      }
      const contatos = (await pool.query(cSql, cParams)).rows;
      if (!contatos.length) return res.json({ ok: true, total: 0, validos: 0, invalidos: 0, fixos: 0 });

      const fixos: string[] = [];
      const mapJid = new Map<string, string[]>();
      for (const c of contatos) {
        const jid = normalizarBR(c.telefone);
        if (!jid) { fixos.push(c.id); continue; }
        const arr = mapJid.get(jid) ?? [];
        arr.push(c.id);
        mapJid.set(jid, arr);
      }

      const jids = Array.from(mapJid.keys());
      const baseUrl = evo.url.replace(/\/$/, '');
      const invalidosIds = new Set<string>(fixos);
      let validos = 0;
      const CHUNK = 50;

      for (let i = 0; i < jids.length; i += CHUNK) {
        const lote = jids.slice(i, i + CHUNK);
        try {
          const r = await fetch(`${baseUrl}/chat/whatsappNumbers/${evo.instancia}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: evo.api_key },
            body: JSON.stringify({ numbers: lote }),
          });
          if (!r.ok) continue;
          const json = await r.json() as any[];
          for (const item of json ?? []) {
            const num = (item.number ?? item.jid ?? '').replace(/\D/g, '');
            const ids = mapJid.get(num) ?? [];
            if (item.exists) validos += ids.length;
            else ids.forEach((id) => invalidosIds.add(id));
          }
        } catch { /* skip batch error */ }
      }

      // Update invalid tags
      if (invalidosIds.size) {
        const ids = Array.from(invalidosIds);
        const rows = (await pool.query(`SELECT id, tags FROM contatos WHERE id = ANY($1) AND user_id = $2`, [ids, userId])).rows;
        for (const c of rows) {
          const tags: string[] = Array.isArray(c.tags) ? c.tags : [];
          if (!tags.includes('whatsapp_invalido')) {
            await pool.query(`UPDATE contatos SET tags = $1 WHERE id = $2 AND user_id = $3`, [[...tags, 'whatsapp_invalido'], c.id, userId]);
          }
        }
      }

      return res.json({ ok: true, total: contatos.length, validos, invalidos: invalidosIds.size, fixos: fixos.length });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  return router;
}
