import { Router, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import { AuthRequest } from '../middleware';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

const UPLOADS_DIR = process.env.UPLOADS_DIR || '/app/uploads';
const BASE_URL    = process.env.API_BASE_URL  || 'https://api.mentoark.com.br';

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Limites por MIME (MB)
const MIME_LIMITS: Record<string, number> = {
  'image/jpeg': 15, 'image/jpg': 15, 'image/png': 15,
  'image/webp': 15, 'image/gif': 15, 'image/avif': 15,
  'application/pdf': 25,
  'audio/mpeg': 50, 'audio/ogg': 50, 'audio/wav': 50,
  'audio/mp4': 50,  'audio/m4a': 50, 'audio/webm': 50,
};

const ALLOWED_MIMES = Object.keys(MIME_LIMITS);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename:    (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `g_${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // limite global — validação por tipo feita na rota
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIMES.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Formato não suportado. Use JPG, PNG, WEBP, GIF, AVIF, PDF ou áudio (MP3, OGG, WAV, M4A).'));
  },
});

function detectMediaType(mime: string): 'image' | 'pdf' | 'audio' {
  if (mime.startsWith('image/'))      return 'image';
  if (mime === 'application/pdf')     return 'pdf';
  return 'audio';
}

export default function galeriaRouter(pool: Pool): Router {
  const router = Router();

  // ─── GET /api/galeria ─────────────────────────────────────────────────────
  // Query params: ?tag=X  ?tipo=pdf  ?pasta=Y  ?q=banner  ?limit=60  ?offset=0
  router.get('/', async (req: AuthRequest, res: Response) => {
    try {
      const { tag, q, tipo, pasta, limit = '60', offset = '0' } = req.query as Record<string, string>;
      const params: any[] = [req.userId];
      let where = 'WHERE user_id = $1';
      let idx = 2;

      if (tag) {
        where += ` AND $${idx} = ANY(tags)`;
        params.push(tag); idx++;
      }
      if (q) {
        where += ` AND (
          titulo    ILIKE $${idx} OR
          filename  ILIKE $${idx} OR
          descricao ILIKE $${idx} OR
          EXISTS (
            SELECT 1 FROM unnest(tags) t(tag)
            WHERE t.tag ILIKE $${idx}
          )
        )`;
        params.push(`%${q}%`); idx++;
      }
      if (tipo) {
        where += ` AND media_type = $${idx}`;
        params.push(tipo); idx++;
      }
      if (pasta) {
        where += ` AND pasta = $${idx}`;
        params.push(pasta); idx++;
      }

      const [r, total] = await Promise.all([
        pool.query(
          `SELECT * FROM galeria_midias ${where}
           ORDER BY created_at DESC
           LIMIT $${idx} OFFSET $${idx + 1}`,
          [...params, Number(limit), Number(offset)]
        ),
        pool.query(
          `SELECT count(*)::int AS total FROM galeria_midias ${where}`,
          params
        ),
      ]);

      return res.json({ images: r.rows, total: total.rows[0].total });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ─── GET /api/galeria/tags ─────────────────────────────────────────────────
  router.get('/tags', async (req: AuthRequest, res: Response) => {
    try {
      const r = await pool.query(
        `SELECT
           t.id, t.nome, t.cor, t.icone, t.created_at,
           COUNT(m.id)::int AS total_midias
         FROM galeria_tags t
         LEFT JOIN galeria_midias m
           ON t.nome = ANY(m.tags) AND m.user_id = t.user_id
         WHERE t.user_id = $1
         GROUP BY t.id
         ORDER BY t.nome`,
        [req.userId]
      );
      return res.json(r.rows);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ─── POST /api/galeria/tags ───────────────────────────────────────────────
  router.post('/tags', async (req: AuthRequest, res: Response) => {
    try {
      const { nome, cor = '#6366f1', icone = 'tag' } = req.body;
      if (!nome?.trim()) return res.status(400).json({ message: 'Nome é obrigatório.' });

      const exists = await pool.query(
        'SELECT id FROM galeria_tags WHERE user_id = $1 AND nome = $2',
        [req.userId, nome.trim()]
      );
      if (exists.rows.length) return res.status(409).json({ message: 'Tag já existe.' });

      const r = await pool.query(
        `INSERT INTO galeria_tags (user_id, nome, cor, icone)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [req.userId, nome.trim(), cor, icone]
      );
      return res.status(201).json(r.rows[0]);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ─── PATCH /api/galeria/tags/:id ─────────────────────────────────────────
  router.patch('/tags/:id', async (req: AuthRequest, res: Response) => {
    try {
      const { nome, cor, icone } = req.body;

      const current = await pool.query(
        'SELECT * FROM galeria_tags WHERE id = $1 AND user_id = $2',
        [req.params.id, req.userId]
      );
      if (!current.rows.length) return res.status(404).json({ message: 'Tag não encontrada.' });

      const oldNome = current.rows[0].nome;
      const newNome = nome?.trim() ?? oldNome;

      if (newNome !== oldNome) {
        const dup = await pool.query(
          'SELECT id FROM galeria_tags WHERE user_id = $1 AND nome = $2 AND id != $3',
          [req.userId, newNome, req.params.id]
        );
        if (dup.rows.length) return res.status(409).json({ message: 'Já existe outra tag com esse nome.' });

        await pool.query(
          `UPDATE galeria_midias
           SET tags = array_replace(tags, $1, $2)
           WHERE user_id = $3 AND $1 = ANY(tags)`,
          [oldNome, newNome, req.userId]
        );
      }

      const r = await pool.query(
        `UPDATE galeria_tags
         SET nome  = COALESCE($1, nome),
             cor   = COALESCE($2, cor),
             icone = COALESCE($3, icone)
         WHERE id = $4 AND user_id = $5
         RETURNING *`,
        [newNome, cor ?? null, icone ?? null, req.params.id, req.userId]
      );
      return res.json(r.rows[0]);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ─── DELETE /api/galeria/tags/:id ────────────────────────────────────────
  router.delete('/tags/:id', async (req: AuthRequest, res: Response) => {
    try {
      const tag = await pool.query(
        'SELECT nome FROM galeria_tags WHERE id = $1 AND user_id = $2',
        [req.params.id, req.userId]
      );
      if (!tag.rows.length) return res.status(404).json({ message: 'Tag não encontrada.' });

      const nome = tag.rows[0].nome;
      await pool.query(
        `UPDATE galeria_midias
         SET tags = array_remove(tags, $1)
         WHERE user_id = $2 AND $1 = ANY(tags)`,
        [nome, req.userId]
      );
      await pool.query(
        'DELETE FROM galeria_tags WHERE id = $1 AND user_id = $2',
        [req.params.id, req.userId]
      );
      return res.status(204).send();
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ─── GET /api/galeria/pastas ──────────────────────────────────────────────
  router.get('/pastas', async (req: AuthRequest, res: Response) => {
    try {
      const r = await pool.query(
        `SELECT * FROM galeria_pastas WHERE user_id = $1 ORDER BY ordem, nome`,
        [req.userId]
      );
      return res.json(r.rows);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ─── POST /api/galeria/pastas ─────────────────────────────────────────────
  router.post('/pastas', async (req: AuthRequest, res: Response) => {
    try {
      const { nome, cor = '#6366f1', icone = 'folder' } = req.body;
      if (!nome?.trim()) return res.status(400).json({ message: 'Nome é obrigatório.' });
      const r = await pool.query(
        `INSERT INTO galeria_pastas (user_id, nome, cor, icone)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [req.userId, nome.trim(), cor, icone]
      );
      return res.status(201).json(r.rows[0]);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ─── PATCH /api/galeria/pastas/:id ───────────────────────────────────────
  router.patch('/pastas/:id', async (req: AuthRequest, res: Response) => {
    try {
      const { nome, cor, icone, ordem } = req.body;
      const r = await pool.query(
        `UPDATE galeria_pastas
         SET nome  = COALESCE($1, nome),
             cor   = COALESCE($2, cor),
             icone = COALESCE($3, icone),
             ordem = COALESCE($4, ordem)
         WHERE id = $5 AND user_id = $6
         RETURNING *`,
        [nome ?? null, cor ?? null, icone ?? null, ordem ?? null, req.params.id, req.userId]
      );
      if (!r.rows.length) return res.status(404).json({ message: 'Pasta não encontrada.' });
      return res.json(r.rows[0]);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ─── DELETE /api/galeria/pastas/:id ──────────────────────────────────────
  router.delete('/pastas/:id', async (req: AuthRequest, res: Response) => {
    try {
      const r = await pool.query(
        'DELETE FROM galeria_pastas WHERE id = $1 AND user_id = $2 RETURNING id',
        [req.params.id, req.userId]
      );
      if (!r.rows.length) return res.status(404).json({ message: 'Pasta não encontrada.' });
      return res.status(204).send();
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ─── POST /api/galeria/upload ─────────────────────────────────────────────
  // Form-data: imagens[] (múltiplos arquivos), tags (JSON array ou CSV), titulo, pasta
  router.post('/upload', (req: AuthRequest, res: Response, next: NextFunction) => {
    upload.array('imagens', 20)(req as any, res, (err: any) => {
      if (err) return res.status(400).json({ message: err.message });
      next();
    });
  }, async (req: AuthRequest, res: Response) => {
    const files = (req as any).files as Express.Multer.File[];
    try {
      if (!files || files.length === 0) {
        return res.status(400).json({ message: 'Nenhum arquivo enviado.' });
      }

      // Valida limite por tipo MIME
      for (const file of files) {
        const limitMB = MIME_LIMITS[file.mimetype] ?? 15;
        if (file.size > limitMB * 1024 * 1024) {
          files.forEach(f => { try { fs.unlinkSync(f.path); } catch {} });
          return res.status(400).json({
            message: `"${file.originalname}" excede o limite de ${limitMB} MB para este tipo de arquivo.`,
          });
        }
      }

      let tags: string[] = [];
      if (req.body.tags) {
        try { tags = JSON.parse(req.body.tags); }
        catch { tags = String(req.body.tags).split(',').map(t => t.trim()).filter(Boolean); }
      }
      const pasta = req.body.pasta || 'geral';

      const inserted: any[] = [];
      for (const file of files) {
        const url        = `${BASE_URL}/uploads/${file.filename}`;
        const titulo     = req.body.titulo || file.originalname.replace(/\.[^.]+$/, '');
        const media_type = detectMediaType(file.mimetype);
        const r = await pool.query(
          `INSERT INTO galeria_midias
             (user_id, url, filename, tamanho, tipo, tags, titulo, media_type, pasta)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [req.userId, url, file.filename, file.size, file.mimetype, tags, titulo, media_type, pasta]
        );
        inserted.push(r.rows[0]);
      }

      return res.status(201).json(inserted.length === 1 ? inserted[0] : inserted);
    } catch (err: any) {
      if (files) files.forEach(f => { try { fs.unlinkSync(f.path); } catch {} });
      return res.status(500).json({ message: err.message });
    }
  });

  // ─── PATCH /api/galeria/:id ───────────────────────────────────────────────
  router.patch('/:id', async (req: AuthRequest, res: Response) => {
    try {
      const { titulo, tags, pasta, descricao } = req.body;
      const r = await pool.query(
        `UPDATE galeria_midias
         SET titulo    = COALESCE($1, titulo),
             tags      = COALESCE($2, tags),
             pasta     = COALESCE($3, pasta),
             descricao = COALESCE($4, descricao)
         WHERE id = $5 AND user_id = $6
         RETURNING *`,
        [titulo ?? null, tags ?? null, pasta ?? null, descricao ?? null, req.params.id, req.userId]
      );
      if (!r.rows.length) return res.status(404).json({ message: 'Mídia não encontrada.' });
      return res.json(r.rows[0]);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ─── DELETE /api/galeria/:id ──────────────────────────────────────────────
  router.delete('/:id', async (req: AuthRequest, res: Response) => {
    try {
      const r = await pool.query(
        'SELECT filename FROM galeria_midias WHERE id = $1 AND user_id = $2',
        [req.params.id, req.userId]
      );
      if (!r.rows.length) return res.status(404).json({ message: 'Mídia não encontrada.' });

      const filepath = path.join(UPLOADS_DIR, r.rows[0].filename);
      try { if (fs.existsSync(filepath)) fs.unlinkSync(filepath); } catch {}

      await pool.query('DELETE FROM galeria_midias WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
      return res.status(204).send();
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ─── POST /api/galeria/produto/:produtoId ─────────────────────────────────
  router.post('/produto/:produtoId', async (req: AuthRequest, res: Response) => {
    try {
      const { galeria_imagem_id, principal = false, ordem = 0, legenda } = req.body;
      if (!galeria_imagem_id) return res.status(400).json({ message: 'galeria_imagem_id é obrigatório.' });

      // Verifica que o produto pertence ao usuário (anti escalada de privilégio)
      const ownProd = await pool.query(
        'SELECT id FROM produtos WHERE id = $1 AND user_id = $2',
        [req.params.produtoId, req.userId]
      );
      if (!ownProd.rows.length) {
        return res.status(403).json({ message: 'Produto não encontrado ou sem permissão.' });
      }

      const gImg = await pool.query(
        'SELECT * FROM galeria_midias WHERE id = $1 AND user_id = $2',
        [galeria_imagem_id, req.userId]
      );
      if (!gImg.rows.length) return res.status(404).json({ message: 'Mídia da galeria não encontrada.' });

      const img = gImg.rows[0];
      if (principal) {
        await pool.query(
          'UPDATE produto_imagens SET principal = false WHERE produto_id = $1 AND user_id = $2',
          [req.params.produtoId, req.userId]
        );
      }

      const r = await pool.query(
        `INSERT INTO produto_imagens
           (user_id, produto_id, url, legenda, principal, ordem, galeria_imagem_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [req.userId, req.params.produtoId, img.url, legenda || img.titulo || null, principal, Number(ordem), galeria_imagem_id]
      );
      return res.status(201).json(r.rows[0]);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  return router;
}
