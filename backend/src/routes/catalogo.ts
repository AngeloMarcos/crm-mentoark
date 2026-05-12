import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { AuthRequest } from '../middleware';

const UPLOADS_DIR = process.env.UPLOADS_DIR || '/app/uploads';

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|webp)$/i;
    if (!allowed.test(file.originalname)) {
      return cb(new Error('Apenas imagens são permitidas'));
    }
    cb(null, true);
  },
});

const API_BASE = process.env.API_URL || 'https://api.mentoark.com.br';

function imageUrl(filename: string) {
  return `${API_BASE}/uploads/${filename}`;
}

export default function catalogo(pool: Pool): Router {
  const router = Router();

  // ── CATALOGOS ────────────────────────────────────────────────

  // GET /api/catalogo — lista catálogos do usuário
  router.get('/', async (req: AuthRequest, res: Response) => {
    try {
      const r = await pool.query(
        `SELECT c.*,
          COUNT(p.id) AS total_produtos
         FROM catalogos c
         LEFT JOIN produtos p ON p.catalogo_id = c.id AND p.ativo = true
         WHERE c.user_id = $1
         GROUP BY c.id
         ORDER BY c.created_at DESC`,
        [req.userId]
      );
      return res.json(r.rows);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // POST /api/catalogo — criar catálogo
  router.post('/', async (req: AuthRequest, res: Response) => {
    try {
      const { nome, descricao } = req.body;
      if (!nome) return res.status(400).json({ message: 'Nome obrigatório' });

      const r = await pool.query(
        `INSERT INTO catalogos (user_id, nome, descricao, ativo)
         VALUES ($1, $2, $3, true) RETURNING *`,
        [req.userId, nome, descricao || null]
      );
      return res.status(201).json(r.rows[0]);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // PATCH /api/catalogo/:id — atualizar catálogo
  router.patch('/:id', async (req: AuthRequest, res: Response) => {
    try {
      const { nome, descricao, ativo } = req.body;
      const r = await pool.query(
        `UPDATE catalogos
         SET nome = COALESCE($1, nome),
             descricao = COALESCE($2, descricao),
             ativo = COALESCE($3, ativo),
             updated_at = NOW()
         WHERE id = $4 AND user_id = $5
         RETURNING *`,
        [nome, descricao, ativo, req.params.id, req.userId]
      );
      if (!r.rows.length) return res.status(404).json({ message: 'Catálogo não encontrado' });
      return res.json(r.rows[0]);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // DELETE /api/catalogo/:id
  router.delete('/:id', async (req: AuthRequest, res: Response) => {
    try {
      // Delete associated images from disk
      const imagens = await pool.query(
        `SELECT pi.url FROM produto_imagens pi
         JOIN produtos p ON p.id = pi.produto_id
         WHERE p.catalogo_id = $1 AND p.user_id = $2`,
        [req.params.id, req.userId]
      );
      for (const row of imagens.rows) {
        const filename = row.url.split('/uploads/').pop();
        if (filename) {
          const filePath = path.join(UPLOADS_DIR, filename);
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
      }

      await pool.query(
        'DELETE FROM catalogos WHERE id = $1 AND user_id = $2',
        [req.params.id, req.userId]
      );
      return res.status(204).send();
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ── PRODUTOS ─────────────────────────────────────────────────

  // GET /api/catalogo/:catalogoId/produtos
  router.get('/:catalogoId/produtos', async (req: AuthRequest, res: Response) => {
    try {
      const r = await pool.query(
        `SELECT p.*,
          json_agg(
            json_build_object('id', pi.id, 'url', pi.url, 'legenda', pi.legenda, 'ordem', pi.ordem)
            ORDER BY pi.ordem ASC
          ) FILTER (WHERE pi.id IS NOT NULL) AS imagens
         FROM produtos p
         LEFT JOIN produto_imagens pi ON pi.produto_id = p.id
         WHERE p.catalogo_id = $1 AND p.user_id = $2
         GROUP BY p.id
         ORDER BY p.ordem ASC, p.created_at ASC`,
        [req.params.catalogoId, req.userId]
      );
      return res.json(r.rows);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // POST /api/catalogo/:catalogoId/produtos
  router.post('/:catalogoId/produtos', async (req: AuthRequest, res: Response) => {
    try {
      const { nome, descricao, preco, ordem } = req.body;
      if (!nome) return res.status(400).json({ message: 'Nome obrigatório' });

      // Verify catalog ownership
      const cat = await pool.query(
        'SELECT id FROM catalogos WHERE id = $1 AND user_id = $2',
        [req.params.catalogoId, req.userId]
      );
      if (!cat.rows.length) return res.status(404).json({ message: 'Catálogo não encontrado' });

      const r = await pool.query(
        `INSERT INTO produtos (catalogo_id, user_id, nome, descricao, preco, ativo, ordem)
         VALUES ($1, $2, $3, $4, $5, true, $6) RETURNING *`,
        [req.params.catalogoId, req.userId, nome, descricao || null, preco || null, ordem || 0]
      );
      return res.status(201).json({ ...r.rows[0], imagens: [] });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // PATCH /api/catalogo/:catalogoId/produtos/:id
  router.patch('/:catalogoId/produtos/:id', async (req: AuthRequest, res: Response) => {
    try {
      const { nome, descricao, preco, ativo, ordem } = req.body;
      const r = await pool.query(
        `UPDATE produtos
         SET nome = COALESCE($1, nome),
             descricao = COALESCE($2, descricao),
             preco = COALESCE($3, preco),
             ativo = COALESCE($4, ativo),
             ordem = COALESCE($5, ordem),
             updated_at = NOW()
         WHERE id = $6 AND user_id = $7 AND catalogo_id = $8
         RETURNING *`,
        [nome, descricao, preco, ativo, ordem, req.params.id, req.userId, req.params.catalogoId]
      );
      if (!r.rows.length) return res.status(404).json({ message: 'Produto não encontrado' });
      return res.json(r.rows[0]);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // DELETE /api/catalogo/:catalogoId/produtos/:id
  router.delete('/:catalogoId/produtos/:id', async (req: AuthRequest, res: Response) => {
    try {
      // Delete images from disk
      const imagens = await pool.query(
        'SELECT url FROM produto_imagens WHERE produto_id = $1',
        [req.params.id]
      );
      for (const row of imagens.rows) {
        const filename = row.url.split('/uploads/').pop();
        if (filename) {
          const filePath = path.join(UPLOADS_DIR, filename);
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
      }

      await pool.query(
        'DELETE FROM produtos WHERE id = $1 AND user_id = $2 AND catalogo_id = $3',
        [req.params.id, req.userId, req.params.catalogoId]
      );
      return res.status(204).send();
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ── IMAGENS ──────────────────────────────────────────────────

  // POST /api/catalogo/:catalogoId/produtos/:produtoId/imagens — upload
  router.post(
    '/:catalogoId/produtos/:produtoId/imagens',
    upload.array('imagens', 20),
    async (req: AuthRequest, res: Response) => {
      try {
        const files = req.files as Express.Multer.File[];
        if (!files?.length) return res.status(400).json({ message: 'Nenhuma imagem enviada' });

        // Verify product ownership
        const prod = await pool.query(
          'SELECT id FROM produtos WHERE id = $1 AND user_id = $2 AND catalogo_id = $3',
          [req.params.produtoId, req.userId, req.params.catalogoId]
        );
        if (!prod.rows.length) {
          // Cleanup uploaded files
          files.forEach(f => fs.existsSync(f.path) && fs.unlinkSync(f.path));
          return res.status(404).json({ message: 'Produto não encontrado' });
        }

        // Get current max order
        const maxOrd = await pool.query(
          'SELECT COALESCE(MAX(ordem), 0) AS m FROM produto_imagens WHERE produto_id = $1',
          [req.params.produtoId]
        );
        let ordem = parseInt(maxOrd.rows[0].m, 10) + 1;

        const inserted: any[] = [];
        for (const file of files) {
          const url = imageUrl(file.filename);
          const r = await pool.query(
            `INSERT INTO produto_imagens (produto_id, url, legenda, ordem)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [req.params.produtoId, url, file.originalname, ordem++]
          );
          inserted.push(r.rows[0]);
        }

        return res.status(201).json(inserted);
      } catch (err: any) {
        return res.status(500).json({ message: err.message });
      }
    }
  );

  // DELETE /api/catalogo/:catalogoId/produtos/:produtoId/imagens/:id
  router.delete(
    '/:catalogoId/produtos/:produtoId/imagens/:id',
    async (req: AuthRequest, res: Response) => {
      try {
        const img = await pool.query(
          `SELECT pi.* FROM produto_imagens pi
           JOIN produtos p ON p.id = pi.produto_id
           WHERE pi.id = $1 AND p.id = $2 AND p.user_id = $3`,
          [req.params.id, req.params.produtoId, req.userId]
        );
        if (!img.rows.length) return res.status(404).json({ message: 'Imagem não encontrada' });

        const filename = img.rows[0].url.split('/uploads/').pop();
        if (filename) {
          const filePath = path.join(UPLOADS_DIR, filename);
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }

        await pool.query('DELETE FROM produto_imagens WHERE id = $1', [req.params.id]);
        return res.status(204).send();
      } catch (err: any) {
        return res.status(500).json({ message: err.message });
      }
    }
  );

  // ── ENDPOINT PÚBLICO PARA N8N ────────────────────────────────
  // GET /api/catalogo/n8n/:userId — sem JWT, para agentes n8n
  // IMPORTANTE: montar esta rota ANTES do authMiddleware no index.ts
  router.get('/n8n/:userId', async (req: Request, res: Response) => {
    try {
      const r = await pool.query(
        `SELECT c.id AS catalogo_id, c.nome AS catalogo, c.descricao AS catalogo_descricao,
                p.id AS produto_id, p.nome AS produto, p.descricao, p.preco,
                pi.url AS imagem_url, pi.legenda, pi.ordem AS imagem_ordem
         FROM catalogos c
         JOIN produtos p ON p.catalogo_id = c.id AND p.ativo = true
         LEFT JOIN produto_imagens pi ON pi.produto_id = p.id
         WHERE c.user_id = $1 AND c.ativo = true
         ORDER BY c.id, p.ordem ASC, pi.ordem ASC`,
        [req.params.userId]
      );

      // Group by catalog → products → images
      const catalogMap = new Map<string, any>();
      for (const row of r.rows) {
        if (!catalogMap.has(row.catalogo_id)) {
          catalogMap.set(row.catalogo_id, {
            id: row.catalogo_id,
            nome: row.catalogo,
            descricao: row.catalogo_descricao,
            produtos: new Map(),
          });
        }
        const cat = catalogMap.get(row.catalogo_id)!;
        if (!cat.produtos.has(row.produto_id)) {
          cat.produtos.set(row.produto_id, {
            id: row.produto_id,
            nome: row.produto,
            descricao: row.descricao,
            preco: row.preco,
            imagens: [],
          });
        }
        if (row.imagem_url) {
          cat.produtos.get(row.produto_id)!.imagens.push({
            url: row.imagem_url,
            legenda: row.legenda,
          });
        }
      }

      const result = Array.from(catalogMap.values()).map(c => ({
        ...c,
        produtos: Array.from(c.produtos.values()),
      }));

      return res.json(result);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  return router;
}
