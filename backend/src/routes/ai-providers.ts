import { Router, Response } from 'express';
import { Pool } from 'pg';
import { AuthRequest } from '../middleware';
import crypto from 'crypto';

function encryptApiKey(apiKey: string): string {
  const encKey = process.env.ENCRYPTION_KEY;
  if (!encKey || encKey.length < 64) throw new Error('ENCRYPTION_KEY inválida ou ausente (precisa de 32 bytes hex = 64 chars)');
  const keyBuf = Buffer.from(encKey, 'hex');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', keyBuf, iv);
  const encrypted = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decryptApiKey(apiKeyEnc: string): string {
  const encKey = process.env.ENCRYPTION_KEY;
  if (!encKey || encKey.length < 64) throw new Error('ENCRYPTION_KEY inválida');
  const keyBuf = Buffer.from(encKey, 'hex');
  const [ivHex, encHex] = apiKeyEnc.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const encBuf = Buffer.from(encHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', keyBuf, iv);
  return Buffer.concat([decipher.update(encBuf), decipher.final()]).toString('utf8');
}

const MODELOS_SUGERIDOS: Record<string, string[]> = {
  claude:  ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-6'],
  openai:  ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'],
  gemini:  ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash'],
};

export default function aiProviders(pool: Pool): Router {
  const router = Router();

  // GET /api/ai-providers/modelos — lista hardcoded de modelos por slug
  router.get('/modelos', (_req: AuthRequest, res: Response) => {
    return res.json(MODELOS_SUGERIDOS);
  });

  // GET /api/ai-providers
  router.get('/', async (req: AuthRequest, res: Response) => {
    try {
      const r = await pool.query(
        `SELECT id, nome, slug, modelo, base_url, suporta_visao, suporta_audio,
                custo_input_mtok, custo_output_mtok, ativo, created_at
         FROM ai_providers WHERE user_id = $1 ORDER BY created_at`,
        [req.userId]
      );
      return res.json(r.rows);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // POST /api/ai-providers
  router.post('/', async (req: AuthRequest, res: Response) => {
    try {
      const {
        nome, slug, modelo, api_key, base_url,
        suporta_visao, suporta_audio,
        custo_input_mtok, custo_output_mtok,
      } = req.body;

      if (!nome || !slug || !modelo || !api_key) {
        return res.status(400).json({ message: 'nome, slug, modelo e api_key são obrigatórios' });
      }

      let api_key_enc: string;
      try {
        api_key_enc = encryptApiKey(api_key);
      } catch (e: any) {
        return res.status(500).json({ message: 'Erro ao criptografar api_key: ' + e.message });
      }

      const r = await pool.query(
        `INSERT INTO ai_providers
           (user_id, nome, slug, modelo, api_key_enc, base_url,
            suporta_visao, suporta_audio, custo_input_mtok, custo_output_mtok)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING id, nome, slug, modelo, base_url, suporta_visao, suporta_audio,
                   custo_input_mtok, custo_output_mtok, ativo, created_at`,
        [
          req.userId, nome, slug, modelo, api_key_enc,
          base_url || null,
          suporta_visao ?? false,
          suporta_audio ?? false,
          custo_input_mtok || null,
          custo_output_mtok || null,
        ]
      );
      return res.status(201).json(r.rows[0]);
    } catch (err: any) {
      if (err.code === '23505') return res.status(409).json({ message: 'Provider com esse slug já existe para esse usuário' });
      return res.status(500).json({ message: err.message });
    }
  });

  // PATCH /api/ai-providers/:id
  router.patch('/:id', async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const {
        nome, modelo, suporta_visao, suporta_audio,
        ativo, custo_input_mtok, custo_output_mtok, api_key,
      } = req.body;

      // Verificar posse
      const check = await pool.query(
        `SELECT id, api_key_enc FROM ai_providers WHERE id = $1 AND user_id = $2`,
        [id, req.userId]
      );
      if (!check.rows.length) return res.status(404).json({ message: 'Provider não encontrado' });

      const sets: string[] = [];
      const vals: any[] = [];
      let idx = 1;

      if (nome !== undefined)              { sets.push(`nome = $${idx++}`);               vals.push(nome); }
      if (modelo !== undefined)            { sets.push(`modelo = $${idx++}`);             vals.push(modelo); }
      if (suporta_visao !== undefined)     { sets.push(`suporta_visao = $${idx++}`);      vals.push(suporta_visao); }
      if (suporta_audio !== undefined)     { sets.push(`suporta_audio = $${idx++}`);      vals.push(suporta_audio); }
      if (ativo !== undefined)             { sets.push(`ativo = $${idx++}`);              vals.push(ativo); }
      if (custo_input_mtok !== undefined)  { sets.push(`custo_input_mtok = $${idx++}`);  vals.push(custo_input_mtok); }
      if (custo_output_mtok !== undefined) { sets.push(`custo_output_mtok = $${idx++}`); vals.push(custo_output_mtok); }

      if (api_key) {
        const enc = encryptApiKey(api_key);
        sets.push(`api_key_enc = $${idx++}`);
        vals.push(enc);
      }

      if (!sets.length) return res.status(400).json({ message: 'Nenhum campo para atualizar' });

      sets.push(`updated_at = now()`);
      vals.push(id, req.userId);

      const r = await pool.query(
        `UPDATE ai_providers SET ${sets.join(', ')}
         WHERE id = $${idx} AND user_id = $${idx + 1}
         RETURNING id, nome, slug, modelo, base_url, suporta_visao, suporta_audio,
                   custo_input_mtok, custo_output_mtok, ativo, updated_at`,
        vals
      );
      return res.json(r.rows[0]);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // DELETE /api/ai-providers/:id
  router.delete('/:id', async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;

      // Verificar se algum agente usa esse provider
      const usage = await pool.query(
        `SELECT COUNT(*) AS cnt FROM agentes WHERE provider_id = $1 AND user_id = $2`,
        [id, req.userId]
      );
      if (parseInt(usage.rows[0].cnt, 10) > 0) {
        return res.status(400).json({
          message: 'Este provider está em uso por um ou mais agentes. Remova ou troque o provider dos agentes antes de deletar.',
        });
      }

      const r = await pool.query(
        `DELETE FROM ai_providers WHERE id = $1 AND user_id = $2 RETURNING id`,
        [id, req.userId]
      );
      if (!r.rows.length) return res.status(404).json({ message: 'Provider não encontrado' });
      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  return router;
}
