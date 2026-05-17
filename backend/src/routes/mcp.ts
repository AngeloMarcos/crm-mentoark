import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

// SSE sessions (Claude Code / legacy clients)
const sseSessions = new Map<string, SSEServerTransport>();

// Streamable HTTP sessions (n8n, Claude Desktop)
const httpSessions = new Map<string, StreamableHTTPServerTransport>();

function checkAuth(req: Request, res: Response): boolean {
  const secret = process.env.MCP_SECRET;
  if (!secret) {
    // MCP_SECRET obrigatório — sem ele o endpoint fica indisponível (não aberto)
    res.status(503).json({ error: 'MCP não disponível: MCP_SECRET não configurado no servidor' });
    return false;
  }
  const key =
    (req.headers['x-mcp-key'] as string) ||
    (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (key !== secret) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

export function buildServer(pool: Pool): McpServer {
  const server = new McpServer({ name: 'mentoark-crm', version: '1.0.0' });

  // ── buscar_contatos ────────────────────────────────────────
  server.tool(
    'buscar_contatos',
    'Busca contatos no CRM por nome, telefone ou email',
    {
      user_id: z.string().describe('UUID do usuário dono dos dados'),
      query: z.string().describe('Termo de busca (nome, telefone ou email)'),
      limit: z.number().int().min(1).max(50).optional().default(10),
    },
    async ({ user_id, query, limit }) => {
      const r = await pool.query(
        `SELECT id, nome, telefone, email, status, origem, opt_out, created_at
         FROM contatos
         WHERE user_id = $1
           AND (nome ILIKE $2 OR telefone ILIKE $2 OR email ILIKE $2)
         ORDER BY nome
         LIMIT $3`,
        [user_id, `%${query}%`, limit ?? 10],
      );
      return { content: [{ type: 'text' as const, text: JSON.stringify(r.rows, null, 2) }] };
    },
  );

  // ── obter_historico_conversa ───────────────────────────────
  server.tool(
    'obter_historico_conversa',
    'Retorna o histórico de mensagens de uma conversa identificada pelo telefone (session_id), filtrado por user_id para isolamento multi-tenant',
    {
      user_id: z.string().describe('UUID do usuário dono da conversa (obrigatório para isolamento)'),
      session_id: z.string().describe('Telefone no formato 5511999999999 ou session_id'),
      limit: z.number().int().min(1).max(100).optional().default(20),
    },
    async ({ user_id, session_id, limit }) => {
      const r = await pool.query(
        `SELECT session_id, message, created_at
         FROM n8n_chat_histories
         WHERE session_id = $1 AND user_id = $2
         ORDER BY created_at DESC
         LIMIT $3`,
        [session_id, user_id, limit ?? 20],
      );
      const linhas = r.rows.reverse().map(row => {
        const msg = typeof row.message === 'string' ? JSON.parse(row.message) : row.message;
        return `[${row.created_at}] ${msg.role}: ${msg.content}`;
      });
      return {
        content: [{
          type: 'text' as const,
          text: linhas.length ? linhas.join('\n') : 'Sem histórico para este contato',
        }],
      };
    },
  );

  // ── criar_contato ──────────────────────────────────────────
  server.tool(
    'criar_contato',
    'Cria um novo contato no CRM (ignora se telefone já existe)',
    {
      user_id: z.string(),
      nome: z.string().describe('Nome completo do contato'),
      telefone: z.string().describe('Telefone no formato 5511999999999'),
      email: z.string().email().optional(),
      origem: z.string().optional().default('MCP'),
    },
    async ({ user_id, nome, telefone, email, origem }) => {
      const existente = await pool.query(
        `SELECT id FROM contatos WHERE user_id = $1 AND telefone ILIKE $2 LIMIT 1`,
        [user_id, `%${telefone.slice(-11)}`],
      );
      if (existente.rows.length) {
        return { content: [{ type: 'text' as const, text: `Contato já existe: id=${existente.rows[0].id}` }] };
      }
      const r = await pool.query(
        `INSERT INTO contatos (user_id, nome, telefone, email, origem, status)
         VALUES ($1, $2, $3, $4, $5, 'novo')
         RETURNING id, nome, telefone`,
        [user_id, nome, telefone, email ?? null, origem ?? 'MCP'],
      );
      return { content: [{ type: 'text' as const, text: `Contato criado: ${JSON.stringify(r.rows[0])}` }] };
    },
  );

  // ── atualizar_status_contato ───────────────────────────────
  server.tool(
    'atualizar_status_contato',
    'Atualiza o status de um contato no funil de vendas',
    {
      user_id: z.string(),
      contato_id: z.string().uuid(),
      status: z.enum(['novo', 'em_contato', 'qualificado', 'proposta', 'fechado', 'perdido']),
    },
    async ({ user_id, contato_id, status }) => {
      const r = await pool.query(
        `UPDATE contatos SET status = $1, updated_at = NOW()
         WHERE id = $2 AND user_id = $3
         RETURNING id, nome, status`,
        [status, contato_id, user_id],
      );
      if (!r.rows.length) return { content: [{ type: 'text' as const, text: 'Contato não encontrado' }] };
      return { content: [{ type: 'text' as const, text: `Status atualizado: ${JSON.stringify(r.rows[0])}` }] };
    },
  );

  // ── enviar_mensagem_whatsapp ───────────────────────────────
  server.tool(
    'enviar_mensagem_whatsapp',
    'Envia uma mensagem de texto via WhatsApp usando a Evolution API configurada do usuário',
    {
      user_id: z.string().describe('UUID do usuário para buscar credenciais Evolution'),
      telefone: z.string().describe('Número destino no formato 5511999999999'),
      texto: z.string().describe('Texto da mensagem a enviar'),
    },
    async ({ user_id, telefone, texto }) => {
      const evo = await pool.query(
        `SELECT url, api_key, instancia FROM integracoes_config
         WHERE user_id = $1 AND tipo = 'evolution' AND status IN ('ativo','conectado')
         LIMIT 1`,
        [user_id],
      );
      if (!evo.rows.length) {
        return { content: [{ type: 'text' as const, text: 'Evolution API não configurada para este usuário' }] };
      }
      const { url, api_key, instancia } = evo.rows[0];
      const resp = await fetch(`${url.replace(/\/$/, '')}/message/sendText/${instancia}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: api_key },
        body: JSON.stringify({ number: telefone, text: texto, delay: 1200 }),
      });
      if (!resp.ok) {
        const err = await resp.text().catch(() => '');
        return { content: [{ type: 'text' as const, text: `Erro Evolution ${resp.status}: ${err}` }] };
      }
      return { content: [{ type: 'text' as const, text: `✓ Mensagem enviada para ${telefone}` }] };
    },
  );

  // ── listar_agentes ─────────────────────────────────────────
  server.tool(
    'listar_agentes',
    'Lista os agentes de IA configurados de um usuário com suas instâncias Evolution',
    {
      user_id: z.string(),
    },
    async ({ user_id }) => {
      const r = await pool.query(
        `SELECT id, nome, evolution_instancia, modelo, temperatura, ativo
         FROM agentes WHERE user_id = $1 ORDER BY nome`,
        [user_id],
      );
      return { content: [{ type: 'text' as const, text: JSON.stringify(r.rows, null, 2) }] };
    },
  );

  // ── buscar_conhecimento ────────────────────────────────────
  server.tool(
    'buscar_conhecimento',
    'Acessa a base de conhecimento do usuário: personalidade do agente, informações do negócio, FAQ, objeções e scripts',
    {
      user_id: z.string(),
      tipo: z.enum(['personalidade', 'negocio', 'faq', 'objecao', 'script']).optional(),
    },
    async ({ user_id, tipo }) => {
      const params: any[] = [user_id];
      let sql = `SELECT tipo, campo, conteudo FROM conhecimento WHERE user_id = $1`;
      if (tipo) { sql += ` AND tipo = $2`; params.push(tipo); }
      sql += ` ORDER BY tipo, created_at LIMIT 30`;
      const r = await pool.query(sql, params);
      const txt = r.rows
        .map(k => `[${k.tipo}${k.campo ? ' / ' + k.campo : ''}]\n${k.conteudo}`)
        .join('\n\n');
      return {
        content: [{
          type: 'text' as const,
          text: txt || 'Nenhum conhecimento cadastrado para este usuário',
        }],
      };
    },
  );

  // ── resumo_dashboard ───────────────────────────────────────
  server.tool(
    'resumo_dashboard',
    'Retorna métricas resumidas do CRM: total de contatos, distribuição por status e disparos recentes',
    {
      user_id: z.string(),
    },
    async ({ user_id }) => {
      const [contatos, disparos] = await Promise.all([
        pool.query(
          `SELECT status, COUNT(*) AS total
           FROM contatos WHERE user_id = $1
           GROUP BY status ORDER BY total DESC`,
          [user_id],
        ),
        pool.query(
          `SELECT COUNT(*) AS total, SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) AS enviados
           FROM disparo_logs WHERE user_id = $1
             AND created_at > NOW() - INTERVAL '7 days'`,
          [user_id],
        ),
      ]);
      const resumo = {
        contatos_por_status: contatos.rows,
        disparos_7d: disparos.rows[0],
      };
      return { content: [{ type: 'text' as const, text: JSON.stringify(resumo, null, 2) }] };
    },
  );

  return server;
}

export function mcpRouter(pool: Pool): Router {
  const router = Router();

  // ── Streamable HTTP — POST /mcp (n8n, Claude Desktop) ─────────────────────
  // Suporta sessões (stateful) ou requests independentes (stateless).
  router.post('/', async (req: Request, res: Response) => {
    if (!checkAuth(req, res)) return;

    const existingId = req.headers['mcp-session-id'] as string | undefined;
    if (existingId) {
      const transport = httpSessions.get(existingId);
      if (!transport) {
        res.status(404).json({ error: 'MCP session not found' });
        return;
      }
      await transport.handleRequest(req, res, req.body);
      return;
    }

    // Nova sessão
    let capturedId: string | undefined;
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => {
        capturedId = randomUUID();
        return capturedId;
      },
    });
    const server = buildServer(pool);
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);

    // Registra sessão após handleRequest ter gerado o ID
    const sid = capturedId ?? transport.sessionId;
    if (sid) {
      httpSessions.set(sid, transport);
      transport.onclose = () => httpSessions.delete(sid);
    }
  });

  // GET /mcp — retomada de sessão SSE via Streamable HTTP
  router.get('/', async (req: Request, res: Response) => {
    if (!checkAuth(req, res)) return;
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !httpSessions.has(sessionId)) {
      res.status(404).json({ error: 'Use POST /mcp para inicializar uma sessão' });
      return;
    }
    await httpSessions.get(sessionId)!.handleRequest(req, res);
  });

  // DELETE /mcp — encerramento explícito de sessão
  router.delete('/', async (req: Request, res: Response) => {
    if (!checkAuth(req, res)) return;
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (sessionId) httpSessions.delete(sessionId);
    res.status(200).json({ ok: true });
  });

  // ── SSE legacy — GET /mcp/sse (Claude Code) ───────────────────────────────
  router.get('/sse', async (req: Request, res: Response) => {
    if (!checkAuth(req, res)) return;
    const transport = new SSEServerTransport('/mcp/messages', res);
    sseSessions.set(transport.sessionId, transport);
    const server = buildServer(pool);
    await server.connect(transport);
    req.on('close', () => sseSessions.delete(transport.sessionId));
  });

  // POST /mcp/messages — mensagens SSE legacy
  router.post('/messages', async (req: Request, res: Response) => {
    if (!checkAuth(req, res)) return;
    const sessionId = req.query.sessionId as string;
    const transport = sseSessions.get(sessionId);
    if (!transport) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    await transport.handlePostMessage(req, res, req.body);
  });

  return router;
}
