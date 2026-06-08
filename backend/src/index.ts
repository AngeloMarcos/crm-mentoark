import dotenv from 'dotenv';
dotenv.config();

// ============================================================
// HANDLERS GLOBAIS DE ERRO — previne crash do processo Node
// ============================================================
process.on('uncaughtException', (error: Error) => {
  console.error('[CRASH] uncaughtException:', {
    message: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString(),
  });
  // Não chama process.exit — deixa o orquestrador (Docker/PM2) decidir
});

process.on('unhandledRejection', (reason: unknown) => {
  console.error('[CRASH] unhandledRejection:', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
    timestamp: new Date().toISOString(),
  });
});

process.on('SIGTERM', () => {
  console.log('[SHUTDOWN] SIGTERM recebido, encerrando graciosamente...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[SHUTDOWN] SIGINT recebido, encerrando...');
  process.exit(0);
});
// ============================================================

import express from 'express';
import cors from 'cors';
import path from 'path';

import { pool } from './db';
import { authMiddleware, adminMiddleware } from './middleware';
import { makeCrud } from './crud';

import authRouter from './auth';
import contatosRouter from './routes/contatos';
import disparosRouter from './routes/disparos';
import agentPromptsRouter from './routes/agent_prompts';
import agentConfigRouter from './routes/agent-config';
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
import whatsappRouter from './routes/whatsapp';
import cargosRouter from './routes/cargos';
import { mcpRouter } from './routes/mcp';
import marketingRouter from './routes/marketing';
import teamRouter, { teamInvitePublicRouter } from './routes/team';
import equipeRouter from './routes/equipe';
import subPerfisRouter from './routes/subperfis';
import kanbanRouter, { kanbanWebhookN8n } from './routes/kanban';
import aiProvidersRouter from './routes/ai-providers';
import aiUsoRouter from './routes/ai-uso';
import integracoesRouter from './routes/integracoes';
import n8nRouter, { n8nSecretMiddleware } from './routes/n8n';
import adminFirewallRouter, { createFirewallMiddleware } from './routes/admin_firewall';
import suporteCopilotoRouter from './routes/suporte_copiloto';
import { makeOpenClawRouter } from './routes/openclaw';
import { initCronJobs } from './cron';
import { runMigrations } from './migrations';
import { processarDisparos } from './services/disparoProcessor';

const UPLOADS_DIR = process.env.UPLOADS_DIR || '/app/uploads';

const app = express();
app.set('trust proxy', 1); // Traefik reverse proxy

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
app.use(express.json({ limit: '1mb' }));

// ── Servir imagens de upload com log de auditoria ──────────────────────────
app.use('/uploads', (req, res, next) => {
  const ip = (req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || '').split(',')[0].trim();
  console.log(`[UPLOAD_ACCESS] ${new Date().toISOString()} ${ip} ${req.path}`);
  next();
}, express.static(UPLOADS_DIR));

// ── Firewall passivo (no-op enquanto firewall_ligado = false) ───────────────
// Montado antes de TODAS as rotas. Com firewall_ligado=false (padrão do banco),
// retorna next() imediatamente — zero impacto em OpenAI, Evolution e webhooks.
app.use(createFirewallMiddleware(pool));

// ── Public routes ───────────────────────────────────────────
const marketing = marketingRouter(pool);
app.use('/auth', authRouter);
app.use('/auth', teamInvitePublicRouter(pool)); // /auth/invite/:token + /auth/accept-invite
app.use('/webhook', webhookRouter(pool));
// ── MCP com CORS específico para n8n Cloud ─────────────────────────────────
app.use('/mcp', (req, res, next) => {
  const mcpOrigins = (process.env.MCP_ALLOWED_ORIGINS || 'https://fierceparrot-n8n.cloudfy.live')
    .split(',').map(s => s.trim());

  const origin = req.headers.origin;
  if (!origin || mcpOrigins.includes(origin) || mcpOrigins.includes('*')) {
    res.header('Access-Control-Allow-Origin', origin || '*');
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-mcp-key, mcp-session-id');
  res.header('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
}, mcpRouter(pool));
app.use('/api/marketing', marketing.public); // Public part of marketing (callback, webhook)

// ── Rotas n8n (x-n8n-secret, sem JWT) ─────────────────────────────────────
app.use('/api/n8n', n8nRouter(pool));

// ── OpenClaw Admin (sem JWT — protegido por X-Openclaw-Key ou JWT) ──────────
app.use('/api/openclaw', makeOpenClawRouter(pool));

// Webhook público do Kanban (sem JWT, autenticado por x-webhook-secret)
app.post('/api/kanban/webhook/n8n', kanbanWebhookN8n(pool));

// Alias item 1: GET /api/agentes/by-instancia/:instancia
app.get('/api/agentes/by-instancia/:instancia', n8nSecretMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, user_id, nome, modelo, temperatura, max_tokens, n8n_webhook_url
       FROM agentes WHERE evolution_instancia = $1 AND ativo = true LIMIT 1`,
      [req.params.instancia]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Agente não encontrado' });
    return res.json(r.rows[0]);
  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
});

// Alias item 2: GET /api/agent_prompts/ativo?user_id=xxx
app.get('/api/agent_prompts/ativo', n8nSecretMiddleware, async (req, res) => {
  const userId = req.query.user_id as string;
  if (!userId) return res.status(400).json({ error: 'user_id é obrigatório' });
  try {
    const r = await pool.query(
      `SELECT id, nome, conteudo, ativo FROM agent_prompts
       WHERE user_id = $1 AND ativo = true LIMIT 1`,
      [userId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Prompt ativo não encontrado' });
    return res.json(r.rows[0]);
  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
});

// Endpoint do catálogo para n8n — protegido por segredo compartilhado
app.get('/api/catalogo/n8n/:userId', async (req, res) => {
  const expected = process.env.N8N_CATALOG_SECRET;
  if (!expected) {
    console.error('[CATALOGO_N8N] N8N_CATALOG_SECRET não configurado — endpoint desabilitado');
    return res.status(503).json({ error: 'Endpoint não configurado' });
  }
  const secret = req.headers['x-n8n-secret'] as string;
  if (!secret || secret !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
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
  // 'agentes' — registrado separadamente abaixo com stripFields
  'conhecimento',
  // 'integracoes_config' — removido do CRUD genérico: usa rota dedicada com upsert (ON CONFLICT)
  'catalogos',
  'produtos',
  // 'produto_imagens' removido: só pode ser gravado via rotas especializadas
  // (catalogo.ts / galeria.ts) que validam propriedade do produto.
  'dados_cliente',
  'chat_messages',
  'chats',
  'respostas_rapidas',
  'tags',
  'funil_estagios',
  'follow_ups',
  'workflows',
];
for (const table of SIMPLE_TABLES) {
  app.use(`/api/${table}`, makeCrud(pool, table));
}

// Agentes: campos do Lovable que não existem na tabela são ignorados silenciosamente
app.use('/api/agentes', makeCrud(pool, 'agentes', {
  stripFields: [
    // Campos que o Lovable envia mas não existem em agentes
    'tipo', 'config', 'provider_slug', 'instancia', 'active',
    // Campos de outras versões/aliases
    'provider', 'modelo_id', 'modalidade_audio', 'modalidade_imagem',
    'modalidade_video', 'mcp_tools', 'name', 'description',
    'is_active', 'enabled', 'settings', 'metadata',
  ],
  transformRow: (row: any) => {
    const threshold = row.rag_threshold;
    const parsed = typeof threshold === 'string' && threshold.trim() !== ''
      ? parseFloat(threshold)
      : threshold;
    return {
      ...row,
      rag_threshold: Number.isFinite(parsed) ? parsed : null,
    };
  },
}));

// Tabelas compartilhadas (REALMENTE globais, sem user_id)
const SHARED_TABLES: string[] = [];
for (const table of SHARED_TABLES) {
  app.use(`/api/${table}`, makeCrud(pool, table, { userIdCol: null }));
}

// Specialized routes
app.use('/api/contatos', contatosRouter(pool));
app.use('/api/disparos', disparosRouter(pool));
app.use('/api/agent_prompts', agentPromptsRouter(pool));
app.use('/api/agent-config',  agentConfigRouter(pool));
app.use('/api/documents', documentsRouter(pool));
app.use('/api/n8n_chat_histories', n8nChatRouter(pool));
app.use('/api/dashboard', dashboardRouter(pool));
app.use('/api/functions', functionsRouter(pool));
app.use('/api/leads', leadsBuscarRouter(pool));
app.use('/api/catalogo', catalogoRouter(pool));
app.use('/api/elevenlabs', elevenLabsRouter(pool));
app.use('/api/galeria',    galeriaRouter(pool));
app.use('/api/modulos',   modulosRouter(pool));
app.use('/api/whatsapp', whatsappRouter(pool));
app.use('/api/marketing', marketing.protected); // Protected part of marketing (status, campaigns)
app.use('/api/team', teamRouter(pool));
app.use('/api/equipes', equipeRouter(pool));
app.use('/api/sub-perfis', subPerfisRouter(pool));
app.use('/api/kanban', kanbanRouter(pool));
app.use('/api/ai-providers', aiProvidersRouter(pool));
app.use('/api/ai', aiUsoRouter(pool));
app.use('/api/integracoes_config', integracoesRouter(pool));
app.use('/api/cargos', cargosRouter(pool));
app.use('/api/suporte',        suporteCopilotoRouter(pool));
app.use('/api/admin/firewall', adminFirewallRouter(pool));

// Virtual tables for Database compatibility
app.use('/api', usuariosRouter(pool));

// ── Security Panel endpoints ─────────────────────────────────

// GET /api/seguranca/logins-recentes — refresh_tokens dos últimos 30 dias (admin)
app.get('/api/seguranca/logins-recentes', authMiddleware, adminMiddleware, async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT rt.user_id, u.email, rt.created_at, rt.expires_at, rt.revoked
       FROM refresh_tokens rt
       LEFT JOIN users u ON u.id = rt.user_id
       WHERE rt.created_at > NOW() - INTERVAL '30 days'
       ORDER BY rt.created_at DESC
       LIMIT 200`
    );
    res.json(r.rows);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

app.get('/api/seguranca/status-chaves', authMiddleware, adminMiddleware, (_req, res) => {
  const chaves = [
    { chave: 'JWT_SECRET',            configurado: !!process.env.JWT_SECRET },
    { chave: 'MCP_SECRET',            configurado: !!process.env.MCP_SECRET },
    { chave: 'N8N_CATALOG_SECRET',    configurado: !!process.env.N8N_CATALOG_SECRET },
    { chave: 'FACEBOOK_APP_ID',       configurado: !!process.env.FACEBOOK_APP_ID },
    { chave: 'FACEBOOK_APP_SECRET',   configurado: !!process.env.FACEBOOK_APP_SECRET },
    { chave: 'OPENAI_API_KEY',        configurado: !!process.env.OPENAI_API_KEY },
    { chave: 'EVOLUTION_API_KEY',     configurado: !!process.env.EVOLUTION_API_KEY },
    { chave: 'N8N_CRIS_WEBHOOK',      configurado: !!process.env.N8N_CRIS_WEBHOOK },
  ];
  res.json(chaves);
});

// ── Diagnóstico WhatsApp (admin) ─────────────────────────────
// GET /api/admin/webhook-trace?phone=11999190910
// Retorna: estado do número no banco + linhas do log_geral.txt filtradas.
app.get('/api/admin/webhook-trace', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const phoneRaw = String(req.query.phone || '').replace(/\D/g, '');
    if (!phoneRaw) return res.status(400).json({ message: 'phone obrigatório' });
    const suffix = phoneRaw.slice(-11);
    const like = `%${suffix}%`;

    const [msgs, dedup, contato, optout] = await Promise.all([
      pool.query(
        `SELECT instance_name, remote_jid, message_id, from_me, message_type,
                LEFT(content,200) AS content, status, timestamp_wa, created_at
         FROM whatsapp_messages
         WHERE remote_jid LIKE $1
         ORDER BY created_at DESC LIMIT 30`,
        [like]
      ).catch(() => ({ rows: [] })),
      pool.query(
        `SELECT message_id, instancia, criado_em FROM webhook_mensagens_processadas
         WHERE message_id LIKE $1 ORDER BY criado_em DESC LIMIT 20`,
        [like]
      ).catch(() => ({ rows: [] })),
      pool.query(
        `SELECT id, nome, push_name, telefone, opt_out, atendente_pausou_ia,
                origem, status, updated_at
         FROM contatos WHERE telefone LIKE $1 LIMIT 5`,
        [like]
      ).catch(() => ({ rows: [] })),
      pool.query(
        `SELECT telefone, motivo, created_at FROM disparo_optouts
         WHERE telefone LIKE $1 ORDER BY created_at DESC LIMIT 5`,
        [like]
      ).catch(() => ({ rows: [] })),
    ]);

    // Ler tail do log_geral.txt filtrado pelo número
    let logLines: string[] = [];
    try {
      const fs = await import('fs');
      const path = '/opt/crm/backend/log_geral.txt';
      if (fs.existsSync(path)) {
        const stat = fs.statSync(path);
        const size = stat.size;
        const readSize = Math.min(size, 500_000); // últimos ~500KB
        const fd = fs.openSync(path, 'r');
        const buf = Buffer.alloc(readSize);
        fs.readSync(fd, buf, 0, readSize, size - readSize);
        fs.closeSync(fd);
        const lines = buf.toString('utf8').split('\n');
        logLines = lines.filter(l => l.includes(suffix) || l.includes(phoneRaw)).slice(-100);
      }
    } catch {}

    res.json({
      phone: phoneRaw,
      suffix,
      whatsapp_messages: msgs.rows,
      dedup: dedup.rows,
      contato: contato.rows,
      opt_out: optout.rows,
      logs: logLines,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});


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
runMigrations(pool).catch(err => console.error('[MIGRATIONS] Erro:', err));
app.listen(PORT, '0.0.0.0', () => {
  console.log(`API running on port ${PORT}`);
  initCronJobs();
  
  // Motor de disparos: verifica mensagens pendentes a cada 2 segundos
  setInterval(() => {
    processarDisparos(pool);
  }, 2000);
});

export default app;