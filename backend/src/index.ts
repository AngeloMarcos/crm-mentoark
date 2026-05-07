import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';

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

const app = express();

// ── Middleware ──────────────────────────────────────────────
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// ── Public routes ───────────────────────────────────────────
app.use('/auth', authRouter);

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
];
for (const table of SIMPLE_TABLES) {
  app.use(`/api/${table}`, makeCrud(pool, table));
}

// Tabelas compartilhadas (sem user_id) — migração para banco único
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

// Virtual tables for Supabase compatibility
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
