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

const app = express();

// ── Middleware ──────────────────────────────────────────────
// CORS: aceita origens fixas + qualquer subdomínio lovable.app/lovableproject.com
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
    if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return cb(null, true);
    return cb(new Error(`CORS bloqueado: ${origin}`));
  },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// ── Serve uploads ──────────────────────────────────────────
const UPLOADS_DIR = process.env.UPLOADS_DIR || '/app/uploads';
app.use('/uploads', express.static(UPLOADS_DIR));

// ── Public routes ───────────────────────────────────────────
app.use('/auth', authRouter);

// ── Protected routes (JWT required) ─────────────────────────
// Rota pública do catálogo para n8n (deve vir antes do middleware de auth)
app.use('/api/catalogo/n8n', (req, res, next) => {
  // Passa para o router do catálogo, que deve lidar com a rota /n8n/:userId
  next();
});

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
];
for (const table of SIMPLE_TABLES) {
  app.use(`/api/${table}`, makeCrud(pool, table));
}

// Tabelas compartilhadas (sem user_id) — banco único com Lovable
const SHARED_TABLES = ['dados_cliente', 'chat_messages', 'chats'];
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
});

export default app;
