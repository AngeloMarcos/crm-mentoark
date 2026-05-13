import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import path from 'path';

import { pool } from './db';
import { authMiddleware } from './middleware';
import { makeCrud } from './crud';

import authRouter from './auth';
import contatosRouter from './routes/contatos';
import disparosRouter from './routes/disparos';
import agentPromptsRouter from './routes/agent_prompts';
import documentsRouter from './routes/documents';
import n8nChatRouter from './routes/n8n_chat_histories';
import dashboardRouter from './routes/dashboard';
import usuariosRouter from './routes/usuarios';
import functionsRouter from './routes/functions';
import leadsBuscarRouter from './routes/leads-buscar';
import catalogoRouter from './routes/catalogo';
import webhookRouter from './routes/webhook';
import elevenLabsRouter from './routes/elevenlabs';
import galeriaRouter from './routes/galeria';
import modulosRouter from './routes/modulos';
import { mcpRouter } from './routes/mcp';
import { initCronJobs } from './cron';

const UPLOADS_DIR = process.env.UPLOADS_DIR || '/app/uploads';

const app = express();

// ── Middleware ──────────────────────────────────────────────
const staticOrigins = (process.env.CORS_ORIGIN || 'https://crm.mentoark.com.br')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (staticOrigins.includes(origin)) return cb(null, true);
    if (/\.lovable\.app$/.test(new URL(origin).hostname)) return cb(null, true);
    if (/\.lovableproject\.com$/.test(new URL(origin).hostname)) return cb(null, true);
    if (process.env.NODE_ENV !== 'production' && /^https?:\/\/localhost(:\d+)?$/.test(origin)) return cb(null, true);
    return cb(new Error(`CORS bloqueado: ${origin}`));
  },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// ── Servir imagens de upload (público, sem JWT) ──────────────
app.use('/uploads', express.static(UPLOADS_DIR));

// ── Public routes ───────────────────────────────────────────
app.use('/auth', authRouter);
app.use('/webhook', webhookRouter(pool));
app.use('/mcp', mcpRouter(pool));

// Endpoint público do catálogo para n8n (sem JWT)
app.get('/api/catalogo/n8n/:userId', async (req, res) => {
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
    const catalogMap = new Map<string, any>();
    for (const row of r.rows) {
      if (!catalogMap.has(row.catalogo_id)) {
        catalogMap.set(row.catalogo_id, {
          id: row.catalogo_id, nome: row.catalogo,
          descricao: row.catalogo_descricao, produtos: new Map(),
        });
      }
      const cat = catalogMap.get(row.catalogo_id)!;
      if (!cat.produtos.has(row.produto_id)) {
        cat.produtos.set(row.produto_id, {
          id: row.produto_id, nome: row.produto,
          descricao: row.descricao, preco: row.preco, imagens: [],
        });
      }
      if (row.imagem_url) {
        cat.produtos.get(row.produto_id)!.imagens.push({ url: row.imagem_url, legenda: row.legenda });
      }
    }
    const result = Array.from(catalogMap.values()).map(c => ({
      ...c, produtos: Array.from(c.produtos.values()),
    }));
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
});

// ── Protected routes (JWT required) ─────────────────────────
app.use('/api', authMiddleware);

// Standard CRUD tables (generic factory)
const SIMPLE_TABLES = [
  'listas',
  'chamadas',
  'timeline_eventos',
  'tarefas',
  'campanhas',
  'disparo_logs',
  'agentes',
  'conhecimento',
  'integracoes_config',
  'catalogos',
  'produtos',
  'produto_imagens',
  'dados_cliente',
  'chat_messages',
  'chats',
];
for (const table of SIMPLE_TABLES) {
  app.use(`/api/${table}`, makeCrud(pool, table));
}

// Tabelas compartilhadas (REALMENTE globais, sem user_id)
const SHARED_TABLES: string[] = [];
for (const table of SHARED_TABLES) {
  app.use(`/api/${table}`, makeCrud(pool, table, { userIdCol: null }));
}

// Specialized routes
app.use('/api/contatos', contatosRouter(pool));
app.use('/api/disparos', disparosRouter(pool));
app.use('/api/agent_prompts', agentPromptsRouter(pool));
app.use('/api/documents', documentsRouter(pool));
app.use('/api/n8n_chat_histories', n8nChatRouter(pool));
app.use('/api/dashboard', dashboardRouter(pool));
app.use('/api/functions', functionsRouter(pool));
app.use('/api/leads', leadsBuscarRouter(pool));
app.use('/api/catalogo', catalogoRouter(pool));
app.use('/api/elevenlabs', elevenLabsRouter(pool));
app.use('/api/galeria',    galeriaRouter(pool));
app.use('/api/modulos',   modulosRouter(pool));

// Virtual tables for Database compatibility
app.use('/api', usuariosRouter(pool));

// ── Health check ─────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch {
    res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});

// ── Global error handler ─────────────────────────────────────
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ message: 'Erro interno do servidor' });
});

const PORT = parseInt(process.env.PORT || '3000', 10);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`API running on port ${PORT}`);
  initCronJobs();
});

export default app;