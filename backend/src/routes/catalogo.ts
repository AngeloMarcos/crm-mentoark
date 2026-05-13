import { Router, Response, Request } from 'express';
import { Pool } from 'pg';
import { AuthRequest } from '../middleware';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

const UPLOADS_DIR = process.env.UPLOADS_DIR || '/app/uploads';
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req: any, _file: any, cb: any) => cb(null, UPLOADS_DIR),
  filename: (_req: any, file: any, cb: any) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req: any, file: any, cb: any) => {
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
      const imgs = await pool.query('SELECT url FROM produto_imagens WHERE produto_id = $1 AND user_id = $2', [req.params.id, req.userId]);
      for (const img of imgs.rows) {
        const file = path.join(UPLOADS_DIR, path.basename(img.url));
        if (fs.existsSync(file)) fs.unlinkSync(file);
      }
      await pool.query('DELETE FROM produtos WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
      res.status(204).send();
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ── WHATSAPP SEND ─────────────────────────────────────────

  /**
   * POST /api/catalogo/whatsapp/produto
   * Envia um produto específico para um ou mais contatos via WhatsApp (Evolution API).
   *
   * Body: {
   *   produto_id: string,
   *   contatos: string[],          // lista de JIDs ou números normalizados
   *   mensagem_extra?: string,     // texto adicional após os dados do produto
   *   intervalo_ms?: number        // delay entre envios (default 3500ms)
   * }
   */
  router.post('/whatsapp/produto', async (req: AuthRequest, res: Response) => {
    try {
      const { produto_id, contatos, mensagem_extra = '', intervalo_ms = 3500 } = req.body;
      if (!produto_id || !Array.isArray(contatos) || contatos.length === 0) {
        return res.status(400).json({ message: 'produto_id e contatos[] são obrigatórios.' });
      }

      // Busca produto + imagem principal
      const pRes = await pool.query(
        `SELECT p.*, pi.url AS img_url
         FROM produtos p
         LEFT JOIN produto_imagens pi ON pi.produto_id = p.id AND pi.principal = true
         WHERE p.id = $1 AND p.user_id = $2`,
        [produto_id, req.userId]
      );
      if (!pRes.rows.length) return res.status(404).json({ message: 'Produto não encontrado.' });
      const produto = pRes.rows[0];

      // Busca config da Evolution API
      const evoRes = await pool.query(
        `SELECT url, api_key, instancia FROM integracoes_config
         WHERE user_id = $1 AND tipo = 'evolution' AND status = 'conectado' LIMIT 1`,
        [req.userId]
      );
      if (!evoRes.rows.length) {
        return res.status(400).json({ message: 'Integração Evolution API não configurada.' });
      }
      const { url: evoUrl, api_key: evoKey, instancia } = evoRes.rows[0];

      // Monta legenda do produto
      const preco = produto.preco ? `R$ ${Number(produto.preco).toFixed(2).replace('.', ',')}` : '';
      const promo = produto.preco_promocional
        ? ` ~~${preco}~~ *R$ ${Number(produto.preco_promocional).toFixed(2).replace('.', ',')}*`
        : preco ? `*${preco}*` : '';
      const caption = [
        `🛍️ *${produto.nome}*`,
        produto.descricao || '',
        promo,
        produto.codigo ? `🏷️ Código: ${produto.codigo}` : '',
        produto.estoque != null ? `📦 Estoque: ${produto.estoque} un.` : '',
        mensagem_extra || '',
      ].filter(Boolean).join('\n');

      const resultados: any[] = [];
      const base = (evoUrl || '').replace(/\/$/, '');

      for (const numero of contatos) {
        let statusLog = 'ENVIADO';
        let erroMsg = null;
        try {
          let resp: any;
          if (produto.img_url) {
            const r = await fetch(`${base}/message/sendMedia/${instancia}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', apikey: evoKey },
              body: JSON.stringify({
                number: numero,
                mediatype: 'image',
                mimetype: 'image/jpeg',
                media: produto.img_url,
                caption,
                fileName: `${produto.nome.replace(/\s+/g, '_')}.jpg`,
              }),
            });
            resp = await r.json();
            if (!r.ok) throw new Error(resp.message || 'Erro Evolution API');
          } else {
            const r = await fetch(`${base}/message/sendText/${instancia}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', apikey: evoKey },
              body: JSON.stringify({ number: numero, text: caption }),
            });
            resp = await r.json();
            if (!r.ok) throw new Error(resp.message || 'Erro Evolution API');
          }
          resultados.push({ numero, status: 'enviado', resp });
        } catch (e: any) {
          statusLog = 'ERRO';
          erroMsg = e.message;
          resultados.push({ numero, status: 'erro', erro: e.message });
        }

        // Registrar no Histórico
        await pool.query(
          `INSERT INTO catalogo_mensagens_logs 
           (user_id, tipo, produto_id, telefone, status, mensagem_texto, midia_url, erro_mensagem)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [req.userId, 'PRODUTO', produto_id, numero, statusLog, caption, produto.img_url, erroMsg]
        );

        if (contatos.indexOf(numero) < contatos.length - 1) {
          await new Promise(r => setTimeout(r, Math.max(2000, Number(intervalo_ms))));
        }
      }

      return res.json({ enviados: resultados.filter(r => r.status === 'enviado').length, erros: resultados.filter(r => r.status === 'erro').length, resultados });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  /**
   * POST /api/catalogo/whatsapp/catalogo
   * Envia todos os produtos (com imagem) de um catálogo para um ou mais contatos.
   * Envia uma mensagem de introdução + cada produto individualmente com delay.
   *
   * Body: {
   *   catalogo_id: string,
   *   contatos: string[],
   *   intro?: string,              // mensagem de introdução
   *   intervalo_ms?: number        // delay entre produtos (default 4000ms)
   *   max_produtos?: number        // limite de produtos por envio (default 10)
   * }
   */
  router.post('/whatsapp/catalogo', async (req: AuthRequest, res: Response) => {
    try {
      const { catalogo_id, contatos, intro, intervalo_ms = 4000, max_produtos = 10 } = req.body;
      if (!catalogo_id || !Array.isArray(contatos) || contatos.length === 0) {
        return res.status(400).json({ message: 'catalogo_id e contatos[] são obrigatórios.' });
      }

      // Valida catálogo
      const catRes = await pool.query(
        'SELECT * FROM catalogos WHERE id = $1 AND user_id = $2 AND ativo = true',
        [catalogo_id, req.userId]
      );
      if (!catRes.rows.length) return res.status(404).json({ message: 'Catálogo não encontrado.' });
      const catalogo = catRes.rows[0];

      // Busca produtos com imagem principal
      const prodRes = await pool.query(
        `SELECT p.*, pi.url AS img_url
         FROM produtos p
         LEFT JOIN produto_imagens pi ON pi.produto_id = p.id AND pi.principal = true
         WHERE p.catalogo_id = $1 AND p.ativo = true
         ORDER BY p.ordem ASC, p.created_at ASC
         LIMIT $2`,
        [catalogo_id, Number(max_produtos)]
      );
      const produtos = prodRes.rows;

      if (produtos.length === 0) {
        return res.status(400).json({ message: 'Catálogo sem produtos ativos.' });
      }

      // Busca config Evolution API
      const evoRes = await pool.query(
        `SELECT url, api_key, instancia FROM integracoes_config
         WHERE user_id = $1 AND tipo = 'evolution' AND status = 'conectado' LIMIT 1`,
        [req.userId]
      );
      if (!evoRes.rows.length) {
        return res.status(400).json({ message: 'Integração Evolution API não configurada.' });
      }
      const { url: evoUrl, api_key: evoKey, instancia } = evoRes.rows[0];
      const base = (evoUrl || '').replace(/\/$/, '');

      const resultados: any[] = [];

      for (const numero of contatos) {
        let statusLog = 'ENVIADO';
        let erroMsg = null;
        try {
          // 1) Envia mensagem de introdução
          const introText = intro
            || `🛒 *${catalogo.nome}*\n${catalogo.descricao || ''}\n\nConfira nossos produtos 👇`;

          await fetch(`${base}/message/sendText/${instancia}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: evoKey },
            body: JSON.stringify({ number: numero, text: introText }),
          });

          await new Promise(r => setTimeout(r, 2000));

          // 2) Envia cada produto
          for (const produto of produtos) {
            const preco = produto.preco ? `*R$ ${Number(produto.preco).toFixed(2).replace('.', ',')}*` : '';
            const caption = [
              `🛍️ *${produto.nome}*`,
              produto.descricao ? produto.descricao.slice(0, 200) : '',
              preco,
            ].filter(Boolean).join('\n');

            if (produto.img_url) {
              await fetch(`${base}/message/sendMedia/${instancia}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', apikey: evoKey },
                body: JSON.stringify({
                  number: numero, mediatype: 'image', mimetype: 'image/jpeg',
                  media: produto.img_url, caption, fileName: `${produto.nome.replace(/\s+/g,'_')}.jpg`,
                }),
              });
            } else {
              await fetch(`${base}/message/sendText/${instancia}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', apikey: evoKey },
                body: JSON.stringify({ number: numero, text: caption }),
              });
            }

            await new Promise(r => setTimeout(r, Math.max(3000, Number(intervalo_ms))));
          }

          resultados.push({ numero, status: 'enviado', produtos_enviados: produtos.length });
        } catch (e: any) {
          statusLog = 'ERRO';
          erroMsg = e.message;
          resultados.push({ numero, status: 'erro', erro: e.message });
        }

        // Registrar no Histórico
        await pool.query(
          `INSERT INTO catalogo_mensagens_logs 
           (user_id, tipo, catalogo_id, telefone, status, mensagem_texto, erro_mensagem)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [req.userId, 'CATALOGO', catalogo_id, numero, statusLog, `Enviado catálogo: ${catalogo.nome} (${produtos.length} produtos)`, erroMsg]
        );

        // Intervalo entre contatos
        if (contatos.indexOf(numero) < contatos.length - 1) {
          await new Promise(r => setTimeout(r, 5000));
        }
      }

      return res.json({
        catalogo: catalogo.nome,
        contatos: contatos.length,
        produtos_por_envio: produtos.length,
        resultados,
      });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ── IMAGENS ──────────────────────────────────────────────

  // POST /api/catalogo/produtos/:produtoId/imagens — upload de imagem
  router.post('/produtos/:produtoId/imagens', upload.single('imagem'), async (req: AuthRequest, res: Response) => {
    try {
      const file = (req as any).file;
      if (!file) return res.status(400).json({ message: 'Nenhuma imagem enviada' });
      const { legenda, principal = false, ordem = 0 } = req.body;
      const url = `${BASE_URL}/uploads/${file.filename}`;

      if (principal === 'true' || principal === true) {
        await pool.query('UPDATE produto_imagens SET principal = false WHERE produto_id = $1 AND user_id = $2', [req.params.produtoId, req.userId]);
      }

      const r = await pool.query(
        `INSERT INTO produto_imagens (user_id, produto_id, url, legenda, principal, ordem)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [req.userId, req.params.produtoId, url, legenda || null, principal === 'true' || principal === true, Number(ordem)]
      );
      res.status(201).json(r.rows[0]);
    } catch (e: any) {
      const file = (req as any).file;
      if (file) fs.unlinkSync(file.path);
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

  return router;
}
