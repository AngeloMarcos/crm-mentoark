import { Router, Response } from 'express';
import { Pool } from 'pg';
import { AuthRequest } from '../middleware';
import crypto from 'crypto';
import { TIPOS_IA, TipoIA, ehTipoIA, infoTipoIA, listarModelosIA } from '../services/integracoesIA';

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

const COLUNAS = `id, nome, slug, modelo, base_url, suporta_visao, suporta_audio,
  custo_input_mtok, custo_output_mtok, ativo, created_at, updated_at,
  ultimo_teste_em, ultimo_status, ultimo_erro,
  (SELECT count(*)::int FROM agentes a WHERE a.provider_id = ai_providers.id) AS agentes_usando`;

export default function aiProviders(pool: Pool): Router {
  const router = Router();

  /** Testa a chave listando os modelos (2026-10-29) e grava o resultado na integração. */
  async function testarEGravar(id: string, slug: string, apiKey: string, baseUrl: string | null) {
    const r = await listarModelosIA(slug as TipoIA, apiKey, baseUrl);
    await pool.query(
      `UPDATE ai_providers SET ultimo_teste_em = NOW(), ultimo_status = $2, ultimo_erro = $3 WHERE id = $1`,
      [id, r.ok ? 'ok' : 'erro', r.ok ? null : r.erro || `Erro ${r.status}`]
    );
    return r;
  }

  async function chaveDa(id: string, userId: string) {
    const r = await pool.query(`SELECT slug, base_url, api_key_enc FROM ai_providers WHERE id = $1 AND user_id = $2`, [id, userId]);
    const row = r.rows[0];
    if (!row) return null;
    return { slug: row.slug as string, baseUrl: row.base_url as string | null, apiKey: row.api_key_enc ? decryptApiKey(row.api_key_enc) : '' };
  }

  // GET /api/ai-providers/tipos — catálogo das integrações de IA (Integrações, 2026-10-29)
  router.get('/tipos', (_req: AuthRequest, res: Response) => res.json(TIPOS_IA));

  // GET /api/ai-providers/modelos — lista hardcoded de modelos por slug
  router.get('/modelos', (_req: AuthRequest, res: Response) => {
    return res.json(MODELOS_SUGERIDOS);
  });

  // GET /api/ai-providers/:id/modelos — modelos que a CHAVE desta integração enxerga, ao vivo
  // (modelo Cubo). Também atualiza o status do teste da chave.
  router.get('/:id/modelos', async (req: AuthRequest, res: Response) => {
    try {
      const c = await chaveDa(req.params.id, req.userId!);
      if (!c) return res.status(404).json({ message: 'Integração não encontrada' });
      const r = await testarEGravar(req.params.id, c.slug, c.apiKey, c.baseUrl);
      if (!r.ok) return res.status(422).json({ message: r.erro, modelos: [] });
      return res.json({ modelos: r.modelos });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // POST /api/ai-providers/:id/testar — testa a chave gravada e guarda o resultado
  router.post('/:id/testar', async (req: AuthRequest, res: Response) => {
    try {
      const c = await chaveDa(req.params.id, req.userId!);
      if (!c) return res.status(404).json({ message: 'Integração não encontrada' });
      const r = await testarEGravar(req.params.id, c.slug, c.apiKey, c.baseUrl);
      return res.json({ ok: r.ok, status: r.status, erro: r.erro ?? null, total_modelos: r.modelos.length });
    } catch (err: any) {
      return res.status(500).json({ ok: false, message: err.message });
    }
  });

  // POST /api/ai-providers/testar — valida a api_key com o provedor real
  router.post('/testar', async (req: AuthRequest, res: Response) => {
    const { slug, api_key, modelo } = req.body;
    if (!slug || !api_key) {
      return res.status(400).json({ ok: false, message: 'slug e api_key são obrigatórios' });
    }
    // [AUDITORIA] FIX APLICADO: as 3 chamadas abaixo (teste de chave de provider) rodavam sem
    // timeout — AbortController 10s em cada, para não travar a request caso o provedor esteja lento.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      if (slug === 'openai') {
        const r = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${api_key}` },
          signal: controller.signal,
        });
        return res.json({ ok: r.ok, status: r.status });
      }
      if (slug === 'claude') {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': api_key,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: modelo || 'claude-haiku-4-5-20251001',
            max_tokens: 10,
            messages: [{ role: 'user', content: 'ping' }],
          }),
          signal: controller.signal,
        });
        return res.json({ ok: r.ok, status: r.status });
      }
      if (slug === 'gemini' || slug === 'openrouter') {
        const r = await listarModelosIA(slug, api_key, req.body.base_url || null);
        return res.json({ ok: r.ok, status: r.status, message: r.erro });
      }
      return res.json({ ok: false, message: 'Provider não suportado' });
    } catch (e: any) {
      return res.status(500).json({ ok: false, message: e.message });
    } finally {
      clearTimeout(timer);
    }
  });

  // GET /api/ai-providers
  router.get('/', async (req: AuthRequest, res: Response) => {
    try {
      const r = await pool.query(
        `SELECT ${COLUNAS} FROM ai_providers WHERE user_id = $1 ORDER BY created_at`,
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

      // Integrações (2026-10-29): o modelo sai da integração (o agente escolhe); aqui fica só o
      // padrão de quem ainda não escolheu, preenchido com o sugerido do tipo quando vier vazio.
      if (!nome || !slug || !api_key) {
        return res.status(400).json({ message: 'nome, tipo e chave de API são obrigatórios' });
      }
      if (!ehTipoIA(slug)) return res.status(400).json({ message: 'Tipo de integração de IA não suportado' });
      const modeloPadrao = modelo || infoTipoIA(slug)!.modeloSugerido;

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
         RETURNING id`,
        [
          req.userId, nome, slug, modeloPadrao, api_key_enc,
          base_url || null,
          suporta_visao ?? false,
          suporta_audio ?? false,
          custo_input_mtok || null,
          custo_output_mtok || null,
        ]
      );
      const id = r.rows[0].id;
      const teste = await testarEGravar(id, slug, api_key, base_url || null);
      const linha = await pool.query(`SELECT ${COLUNAS} FROM ai_providers WHERE id = $1`, [id]);
      return res.status(201).json({ ...linha.rows[0], teste: { ok: teste.ok, erro: teste.erro ?? null } });
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
         RETURNING id, slug, base_url`,
        vals
      );
      // Chave nova → testa na hora e guarda o resultado (2026-10-29).
      let teste: { ok: boolean; erro: string | null } | undefined;
      if (api_key) {
        const t = await testarEGravar(id, r.rows[0].slug, api_key, r.rows[0].base_url);
        teste = { ok: t.ok, erro: t.erro ?? null };
      }
      const linha = await pool.query(`SELECT ${COLUNAS} FROM ai_providers WHERE id = $1`, [id]);
      return res.json({ ...linha.rows[0], ...(teste ? { teste } : {}) });
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
