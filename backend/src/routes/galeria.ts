import { Router, Response } from 'express';
import { Pool } from 'pg';
import { AuthRequest } from '../middleware';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

const UPLOADS_DIR = process.env.UPLOADS_DIR || '/app/uploads';
const BASE_URL    = process.env.API_BASE_URL  || 'https://api.mentoark.com.br';

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename:    (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `g_${uuidv4()}${ext}`);   // prefixo "g_" identifica imagens da galeria
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
  fileFilter: (_req, file, cb) => {
    const ok = ['image/jpeg','image/jpg','image/png','image/webp','image/gif','image/avif'];
    if (ok.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Formato não suportado. Use JPG, PNG, WEBP, GIF ou AVIF.'));
  },
});

export default function galeriaRouter(pool: Pool): Router {
  const router = Router();

  // ─── GET /api/galeria ─────────────────────────────────────────────────────
  // Lista todas as imagens da galeria do usuário
  // Query params: ?tag=produto  ?q=banner  ?limit=50  ?offset=0
  router.get('/', async (req: AuthRequest, res: Response) => {
    try {
      const { tag, q, limit = '60', offset = '0' } = req.query as Record<string,string>;
      const params: any[] = [req.userId];
      let where = 'WHERE user_id = $1';
      let idx = 2;

      if (tag) {
        where += ` AND $${idx} = ANY(tags)`;
        params.push(tag);
        idx++;
      }
      if (q) {
        where += ` AND (titulo ILIKE $${idx} OR filename ILIKE $${idx})`;
        params.push(`%${q}%`);
        idx++;
      }

      const r = await pool.query(
        `SELECT * FROM galeria_imagens ${where}
         ORDER BY created_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, Number(limit), Number(offset)]
      );

      const total = await pool.query(
        `SELECT count(*)::int AS total FROM galeria_imagens ${where}`,
        params
      );

      return res.json({ images: r.rows, total: total.rows[0].total });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ─── GET /api/galeria/tags ─────────────────────────────────────────────────
  // Retorna todas as tags usadas pelo usuário (para filtros no frontend)
  router.get('/tags', async (req: AuthRequest, res: Response) => {
    try {
      const r = await pool.query(
        `SELECT DISTINCT unnest(tags) AS tag
         FROM galeria_imagens
         WHERE user_id = $1
         ORDER BY tag`,
        [req.userId]
      );
      return res.json(r.rows.map(row => row.tag));
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ─── POST /api/galeria/upload ─────────────────────────────────────────────
  // Faz upload de uma ou várias imagens para a galeria
  // Form-data: imagens[] (múltiplos arquivos), tags (JSON array ou CSV), titulo
  router.post('/upload', upload.array('imagens', 20), async (req: AuthRequest, res: Response) => {
    try {
      const files = (req as any).files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return res.status(400).json({ message: 'Nenhuma imagem enviada.' });
      }

      let tags: string[] = [];
      if (req.body.tags) {
        try { tags = JSON.parse(req.body.tags); } catch { tags = String(req.body.tags).split(',').map(t => t.trim()).filter(Boolean); }
      }

      const inserted: any[] = [];
      for (const file of files) {
        const url = `${BASE_URL}/uploads/${file.filename}`;
        const titulo = req.body.titulo || file.originalname.replace(/\.[^.]+$/, '');
        const r = await pool.query(
          `INSERT INTO galeria_imagens (user_id, url, filename, tamanho, tipo, tags, titulo)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
          [req.userId, url, file.filename, file.size, file.mimetype, tags, titulo]
        );
        inserted.push(r.rows[0]);
      }

      return res.status(201).json(inserted.length === 1 ? inserted[0] : inserted);
    } catch (err: any) {
      // Limpa arquivos enviados em caso de erro de DB
      const files = (req as any).files as Express.Multer.File[] | undefined;
      if (files) files.forEach(f => { try { fs.unlinkSync(f.path); } catch {} });
      return res.status(500).json({ message: err.message });
    }
  });

  // ─── PATCH /api/galeria/:id ───────────────────────────────────────────────
  // Atualiza titulo e/ou tags de uma imagem
  router.patch('/:id', async (req: AuthRequest, res: Response) => {
    try {
      const { titulo, tags } = req.body;
      const r = await pool.query(
        `UPDATE galeria_imagens
         SET titulo = COALESCE($1, titulo),
             tags   = COALESCE($2, tags)
         WHERE id = $3 AND user_id = $4
         RETURNING *`,
        [titulo ?? null, tags ?? null, req.params.id, req.userId]
      );
      if (!r.rows.length) return res.status(404).json({ message: 'Imagem não encontrada.' });
      return res.json(r.rows[0]);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ─── DELETE /api/galeria/:id ──────────────────────────────────────────────
  // Remove imagem da galeria (e o arquivo físico)
  router.delete('/:id', async (req: AuthRequest, res: Response) => {
    try {
      const r = await pool.query(
        'SELECT filename FROM galeria_imagens WHERE id = $1 AND user_id = $2',
        [req.params.id, req.userId]
      );
      if (!r.rows.length) return res.status(404).json({ message: 'Imagem não encontrada.' });

      const filepath = path.join(UPLOADS_DIR, r.rows[0].filename);
      try { if (fs.existsSync(filepath)) fs.unlinkSync(filepath); } catch {}

      await pool.query('DELETE FROM galeria_imagens WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
      return res.status(204).send();
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ─── POST /api/galeria/produto/:produtoId ─────────────────────────────────
  // Vincula uma imagem da galeria a um produto (cria produto_imagem referenciando a galeria)
  // Body: { galeria_imagem_id, principal?, ordem?, legenda? }
  router.post('/produto/:produtoId', async (req: AuthRequest, res: Response) => {
    try {
      const { galeria_imagem_id, principal = false, ordem = 0, legenda } = req.body;
      if (!galeria_imagem_id) return res.status(400).json({ message: 'galeria_imagem_id é obrigatório.' });

      // Busca a imagem na galeria para obter a URL
      const gImg = await pool.query(
        'SELECT * FROM galeria_imagens WHERE id = $1 AND user_id = $2',
        [galeria_imagem_id, req.userId]
      );
      if (!gImg.rows.length) return res.status(404).json({ message: 'Imagem da galeria não encontrada.' });

      const img = gImg.rows[0];

      if (principal) {
        await pool.query('UPDATE produto_imagens SET principal = false WHERE produto_id = $1 AND user_id = $2', [req.params.produtoId, req.userId]);
      }

      const r = await pool.query(
        `INSERT INTO produto_imagens (user_id, produto_id, url, legenda, principal, ordem, galeria_imagem_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [req.userId, req.params.produtoId, img.url, legenda || img.titulo || null, principal, Number(ordem), galeria_imagem_id]
      );
      return res.status(201).json(r.rows[0]);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  return router;
}
