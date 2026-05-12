import { Router, Response, Request } from 'express';
import { Pool } from 'pg';
import { AuthRequest } from '../middleware';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

// Diretório de uploads (volume Docker)
const UPLOADS_DIR = process.env.UPLOADS_DIR || '/app/uploads';
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Formato não suportado. Use JPG, PNG, WEBP ou GIF.'));
  },
});

const BASE_URL = process.env.API_BASE_URL || 'https://api.mentoark.com.br';

export default function catalogoRouter(pool: Pool): Router {
  const router = Router();

  // ── CATÁLOGOS ──────────────────────────────────────────────

  // GET /api/catalogo — lista catálogos do usuário
  router.get('/', async (req: AuthRequest, res: Response) => {
    try {
      const r = await pool.query(
        `SELECT c.*,
          (SELECT count(*) FROM produtos p WHERE p.catalogo_id = c.id AND p.ativo = true) as total_produtos
         FROM catalogos c
         WHERE c.user_id = $1
         ORDER BY c.ordem ASC, c.created_at DESC`,
        [req.userId]
      );
      res.json(r.rows);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // GET /api/catalogo/:id — detalhes do catálogo + produtos + imagens
  router.get('/:id', async (req: AuthRequest, res: Response) => {
    try {
      const cat = await pool.query(
        'SELECT * FROM catalogos WHERE id = $1 AND user_id = $2',
        [req.params.id, req.userId]
      );
      if (!cat.rows.length) return res.status(404).json({ message: 'Catálogo não encontrado' });

      const produtos = await pool.query(
        `SELECT p.*,
          json_agg(
            json_build_object(
              'id', pi.id, 'url', pi.url, 'legenda', pi.legenda,
              'principal', pi.principal, 'ordem', pi.ordem
            ) ORDER BY pi.principal DESC, pi.ordem ASC
          ) FILTER (WHERE pi.id IS NOT NULL) as imagens
         FROM produtos p
         LEFT JOIN produto_imagens pi ON pi.produto_id = p.id
         WHERE p.catalogo_id = $1 AND p.user_id = $2
         GROUP BY p.id
         ORDER BY p.ordem ASC, p.created_at ASC`,
        [req.params.id, req.userId]
      );

      res.json({ ...cat.rows[0], produtos: produtos.rows });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // POST /api/catalogo — criar catálogo
  router.post('/', async (req: AuthRequest, res: Response) => {
    try {
      const { nome, descricao, ativo = true, ordem = 0 } = req.body;
      if (!nome?.trim()) return res.status(400).json({ message: 'Nome é obrigatório' });
      const r = await pool.query(
        `INSERT INTO catalogos (user_id, nome, descricao, ativo, ordem)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [req.userId, nome.trim(), descricao || null, ativo, ordem]
      );
      res.status(201).json(r.rows[0]);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // PUT /api/catalogo/:id — editar catálogo
  router.put('/:id', async (req: AuthRequest, res: Response) => {
    try {
      const { nome, descricao, ativo, ordem } = req.body;
      const r = await pool.query(
        `UPDATE catalogos SET
          nome = COALESCE($1, nome),
          descricao = COALESCE($2, descricao),
          ativo = COALESCE($3, ativo),
          ordem = COALESCE($4, ordem),
          updated_at = now()
         WHERE id = $5 AND user_id = $6 RETURNING *`,
        [nome || null, descricao || null, ativo ?? null, ordem ?? null, req.params.id, req.userId]
      );
      if (!r.rows.length) return res.status(404).json({ message: 'Catálogo não encontrado' });
      res.json(r.rows[0]);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // DELETE /api/catalogo/:id
  router.delete('/:id', async (req: AuthRequest, res: Response) => {
    try {
      await pool.query('DELETE FROM catalogos WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
      res.status(204).send();
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ── PRODUTOS ──────────────────────────────────────────────

  // POST /api/catalogo/:catalogoId/produtos
  router.post('/:catalogoId/produtos', async (req: AuthRequest, res: Response) => {
    try {
      const { nome, descricao, preco, preco_promocional, codigo, estoque, ativo = true, ordem = 0 } = req.body;
      if (!nome?.trim()) return res.status(400).json({ message: 'Nome é obrigatório' });
      const cat = await pool.query('SELECT id FROM catalogos WHERE id = $1 AND user_id = $2', [req.params.catalogoId, req.userId]);
      if (!cat.rows.length) return res.status(404).json({ message: 'Catálogo não encontrado' });
      const r = await pool.query(
        `INSERT INTO produtos (user_id, catalogo_id, nome, descricao, preco, preco_promocional, codigo, estoque, ativo, ordem)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [req.userId, req.params.catalogoId, nome.trim(), descricao || null, preco || null, preco_promocional || null, codigo || null, estoque || null, ativo, ordem]
      );
      res.status(201).json(r.rows[0]);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // PUT /api/catalogo/:catalogoId/produtos/:id
  router.put('/:catalogoId/produtos/:id', async (req: AuthRequest, res: Response) => {
    try {
      const { nome, descricao, preco, preco_promocional, codigo, estoque, ativo, ordem } = req.body;
      const r = await pool.query(
        `UPDATE produtos SET
          nome = COALESCE($1, nome),
          descricao = COALESCE($2, descricao),
          preco = COALESCE($3, preco),
          preco_promocional = COALESCE($4, preco_promocional),
          codigo = COALESCE($5, codigo),
          estoque = COALESCE($6, estoque),
          ativo = COALESCE($7, ativo),
          ordem = COALESCE($8, ordem),
          updated_at = now()
         WHERE id = $9 AND user_id = $10 RETURNING *`,
        [nome || null, descricao || null, preco ?? null, preco_promocional ?? null, codigo || null, estoque ?? null, ativo ?? null, ordem ?? null, req.params.id, req.userId]
      );
      if (!r.rows.length) return res.status(404).json({ message: 'Produto não encontrado' });
      res.json(r.rows[0]);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // DELETE /api/catalogo/:catalogoId/produtos/:id
  router.delete('/:catalogoId/produtos/:id', async (req: AuthRequest, res: Response) => {
    try {
      // Deleta imagens físicas primeiro
      const imgs = await pool.query('SELECT url FROM produto_imagens WHERE produto_id = $1', [req.params.id]);
      for (const img of imgs.rows) {
        const file = path.join(UPLOADS_DIR, path.basename(img.url));
        if (fs.existsSync(file)) fs.unlinkSync(file);
      }
      await pool.query('DELETE FROM produtos WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
      res.status(204).send();
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ── IMAGENS ──────────────────────────────────────────────

  // POST /api/catalogo/produtos/:produtoId/imagens — upload de imagem
  router.post('/produtos/:produtoId/imagens', upload.single('imagem'), async (req: AuthRequest, res: Response) => {
    try {
      if (!req.file) return res.status(400).json({ message: 'Nenhuma imagem enviada' });
      const { legenda, principal = false, ordem = 0 } = req.body;
      const url = `${BASE_URL}/uploads/${req.file.filename}`;

      if (principal === 'true' || principal === true) {
        await pool.query('UPDATE produto_imagens SET principal = false WHERE produto_id = $1', [req.params.produtoId]);
      }

      const r = await pool.query(
        `INSERT INTO produto_imagens (user_id, produto_id, url, legenda, principal, ordem)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [req.userId, req.params.produtoId, url, legenda || null, principal === 'true' || principal === true, Number(ordem)]
      );
      res.status(201).json(r.rows[0]);
    } catch (e: any) {
      if (req.file) fs.unlinkSync(req.file.path);
      res.status(500).json({ message: e.message });
    }
  });

  // DELETE /api/catalogo/imagens/:id — remove imagem
  router.delete('/imagens/:id', async (req: AuthRequest, res: Response) => {
    try {
      const r = await pool.query('SELECT url FROM produto_imagens WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
      if (!r.rows.length) return res.status(404).json({ message: 'Imagem não encontrada' });
      const file = path.join(UPLOADS_DIR, path.basename(r.rows[0].url));
      if (fs.existsSync(file)) fs.unlinkSync(file);
      await pool.query('DELETE FROM produto_imagens WHERE id = $1', [req.params.id]);
      res.status(204).send();
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ── ENDPOINT PÚBLICO PARA O N8N ──────────────────────────
  // GET /api/catalogo/n8n/:userId — sem autenticação JWT, para o agente n8n buscar produtos
  router.get('/n8n/:userId', async (req: Request, res: Response) => {
    try {
      const { catalogo_id, nome } = req.query;
      let sql = `
        SELECT p.id, p.nome, p.descricao, p.preco, p.preco_promocional, p.codigo,
          c.nome as catalogo,
          json_agg(
            json_build_object('url', pi.url, 'legenda', pi.legenda, 'principal', pi.principal)
            ORDER BY pi.principal DESC, pi.ordem ASC
          ) FILTER (WHERE pi.id IS NOT NULL) as imagens
        FROM produtos p
        JOIN catalogos c ON c.id = p.catalogo_id
        LEFT JOIN produto_imagens pi ON pi.produto_id = p.id
        WHERE p.user_id = $1 AND p.ativo = true AND c.ativo = true
      `;
      const params: any[] = [req.params.userId];
      if (catalogo_id) { sql += ` AND p.catalogo_id = $${params.length + 1}`; params.push(catalogo_id); }
      if (nome) { sql += ` AND p.nome ILIKE $${params.length + 1}`; params.push(`%${nome}%`); }
      sql += ' GROUP BY p.id, c.nome ORDER BY p.ordem ASC, p.nome ASC';
      const r = await pool.query(sql, params);
      res.json({ total: r.rows.length, produtos: r.rows });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  return router;
}
