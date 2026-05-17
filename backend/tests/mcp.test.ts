import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http, { AddressInfo } from 'http';
import express from 'express';
import request from 'supertest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { mcpRouter, buildServer } from '../src/routes/mcp';

// ── Setup global ───────────────────────────────────────────────────────────────

const MCP_SECRET = 'test-mcp-secret-456';
process.env.MCP_SECRET = MCP_SECRET;

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

// ── Helpers ────────────────────────────────────────────────────────────────────

// Pool com handlers configuráveis por padrão de SQL (rastreável)
function makePool(handlers: Record<string, (params: any[]) => any> = {}) {
  const queries: { sql: string; params: any[] }[] = [];
  const pool = {
    _queries: queries,
    query: async (sql: string, params: any[] = []) => {
      queries.push({ sql, params });
      for (const [pattern, handler] of Object.entries(handlers)) {
        if (new RegExp(pattern, 'i').test(sql)) return handler(params);
      }
      return { rows: [], rowCount: 0 };
    },
  };
  return pool as any;
}

function buildApp(pool: ReturnType<typeof makePool>) {
  const app = express();
  app.use(express.json());
  app.use('/mcp', mcpRouter(pool));
  return app;
}

// Extrai o primeiro JSON-RPC result de uma resposta SSE ou JSON
function extractResult(res: any): any {
  const ct: string = res.headers['content-type'] ?? '';
  if (ct.includes('text/event-stream')) {
    const line = (res.text as string).split('\n').find(l => l.startsWith('data: '));
    return line ? JSON.parse(line.slice(6)) : null;
  }
  return typeof res.body === 'object' ? res.body : JSON.parse(res.text);
}

const ACCEPT = 'application/json, text/event-stream';

const INIT_BODY = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test', version: '1.0' },
  },
};

async function mcpPost(app: express.Express, body: object, sessionId?: string) {
  const req = request(app)
    .post('/mcp')
    .set('x-mcp-key', MCP_SECRET)
    .set('Accept', ACCEPT)
    .set('Content-Type', 'application/json');
  if (sessionId) req.set('mcp-session-id', sessionId);
  return req.send(body);
}

// Cria um par Client/Server via InMemoryTransport (sem HTTP) para testar ferramentas
async function buildClient(pool: ReturnType<typeof makePool>) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer(pool);
  const client = new Client({ name: 'test', version: '1.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

const closeClient = (c: Client) => c.close().catch(() => {});

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '' });
});

// ── BLOCO 1: checkAuth — autenticação em todos os endpoints ───────────────────

describe('BLOCO 1 — checkAuth (autenticação)', () => {
  const ENDPOINTS = [
    { method: 'post' as const, path: '/mcp' },
    { method: 'get' as const, path: '/mcp' },
    { method: 'delete' as const, path: '/mcp' },
    { method: 'get' as const, path: '/mcp/sse' },
    { method: 'post' as const, path: '/mcp/messages' },
  ];

  describe('MCP_SECRET não configurado → 503 em todos os endpoints', () => {
    const savedSecret = process.env.MCP_SECRET;
    beforeEach(() => { delete process.env.MCP_SECRET; });
    afterEach(() => { process.env.MCP_SECRET = savedSecret; });

    for (const { method, path } of ENDPOINTS) {
      it(`${method.toUpperCase()} ${path} → 503`, async () => {
        const app = buildApp(makePool());
        const res = await (request(app) as any)[method](path)
          .set('x-mcp-key', MCP_SECRET)
          .set('Accept', ACCEPT)
          .send({});
        expect(res.status).toBe(503);
        expect(res.body.error).toMatch(/MCP_SECRET/i);
      });
    }
  });

  it('chave errada via x-mcp-key → 401', async () => {
    const app = buildApp(makePool());
    const res = await request(app).post('/mcp')
      .set('x-mcp-key', 'chave-errada')
      .set('Accept', ACCEPT).send(INIT_BODY);
    expect(res.status).toBe(401);
  });

  it('chave errada via Authorization Bearer → 401', async () => {
    const app = buildApp(makePool());
    const res = await request(app).post('/mcp')
      .set('Authorization', 'Bearer chave-errada')
      .set('Accept', ACCEPT).send(INIT_BODY);
    expect(res.status).toBe(401);
  });

  it('sem nenhum header de auth → 401', async () => {
    const app = buildApp(makePool());
    const res = await request(app).post('/mcp').set('Accept', ACCEPT).send(INIT_BODY);
    expect(res.status).toBe(401);
  });

  it('chave correta via x-mcp-key → não retorna 401 nem 503', async () => {
    const app = buildApp(makePool());
    const res = await request(app).post('/mcp')
      .set('x-mcp-key', MCP_SECRET).set('Accept', ACCEPT).send(INIT_BODY);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(503);
  });

  it('chave correta via Authorization Bearer → não retorna 401 nem 503', async () => {
    const app = buildApp(makePool());
    const res = await request(app).post('/mcp')
      .set('Authorization', `Bearer ${MCP_SECRET}`).set('Accept', ACCEPT).send(INIT_BODY);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(503);
  });
});

// ── BLOCO 2: Streamable HTTP — POST /mcp ─────────────────────────────────────

describe('BLOCO 2 — POST /mcp (Streamable HTTP)', () => {
  let app: express.Express;
  beforeEach(() => { app = buildApp(makePool()); });

  it('sem Accept → 406', async () => {
    const res = await request(app).post('/mcp')
      .set('x-mcp-key', MCP_SECRET)
      .set('Content-Type', 'application/json')
      .send(INIT_BODY);
    expect(res.status).toBe(406);
  });

  it('initialize → 200 + protocolVersion e serverInfo no corpo', async () => {
    const res = await mcpPost(app, INIT_BODY);
    expect(res.status).toBe(200);
    const msg = extractResult(res);
    expect(msg?.result?.protocolVersion).toBe('2024-11-05');
    expect(msg?.result?.serverInfo?.name).toBe('mentoark-crm');
    expect(msg?.result?.serverInfo?.version).toBe('1.0.0');
  });

  it('initialize → header Mcp-Session-Id presente na resposta', async () => {
    const res = await mcpPost(app, INIT_BODY);
    expect(res.headers['mcp-session-id']).toBeTruthy();
  });

  it('session ID inválido (sem initialize prévio) → 404', async () => {
    const res = await mcpPost(
      app,
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      'session-id-que-nao-existe'
    );
    expect(res.status).toBe(404);
  });

  it('fluxo completo: initialize → notifications/initialized → tools/list → 8 ferramentas', async () => {
    // 1. Initialize
    const initRes = await mcpPost(app, INIT_BODY);
    expect(initRes.status).toBe(200);
    const sessionId = initRes.headers['mcp-session-id'];
    expect(sessionId).toBeTruthy();

    // 2. Notification (sem id = sem resposta esperada)
    await mcpPost(app, { jsonrpc: '2.0', method: 'notifications/initialized' }, sessionId);

    // 3. tools/list
    const listRes = await mcpPost(
      app,
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      sessionId
    );
    expect(listRes.status).toBe(200);
    const msg = extractResult(listRes);
    const names: string[] = msg?.result?.tools?.map((t: any) => t.name) ?? [];
    expect(names).toHaveLength(8);
    for (const n of [
      'buscar_contatos', 'obter_historico_conversa', 'criar_contato',
      'atualizar_status_contato', 'enviar_mensagem_whatsapp',
      'listar_agentes', 'buscar_conhecimento', 'resumo_dashboard',
    ]) {
      expect(names, `ferramenta ausente: ${n}`).toContain(n);
    }
  });
});

// ── BLOCO 3: GET /mcp — retomada de sessão ───────────────────────────────────

describe('BLOCO 3 — GET /mcp (retomada de sessão Streamable HTTP)', () => {
  let app: express.Express;
  beforeEach(() => { app = buildApp(makePool()); });

  it('sem Mcp-Session-Id → 404', async () => {
    const res = await request(app).get('/mcp').set('x-mcp-key', MCP_SECRET);
    expect(res.status).toBe(404);
  });

  it('Mcp-Session-Id inválido → 404', async () => {
    const res = await request(app).get('/mcp')
      .set('x-mcp-key', MCP_SECRET)
      .set('mcp-session-id', 'invalido-abc');
    expect(res.status).toBe(404);
  });
});

// ── BLOCO 4: DELETE /mcp — encerramento de sessão ────────────────────────────

describe('BLOCO 4 — DELETE /mcp (encerramento de sessão)', () => {
  let app: express.Express;
  beforeEach(() => { app = buildApp(makePool()); });

  it('sem session ID → 200 ok (no-op)', async () => {
    const res = await request(app).delete('/mcp').set('x-mcp-key', MCP_SECRET);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('session válido → 200 + POST subsequente com mesmo ID → 404', async () => {
    const initRes = await mcpPost(app, INIT_BODY);
    const sid = initRes.headers['mcp-session-id'];
    expect(sid).toBeTruthy();

    const del = await request(app).delete('/mcp')
      .set('x-mcp-key', MCP_SECRET)
      .set('mcp-session-id', sid);
    expect(del.status).toBe(200);

    // Sessão foi removida — próxima requisição com o mesmo ID retorna 404
    const next = await mcpPost(
      app,
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      sid
    );
    expect(next.status).toBe(404);
  });
});

// ── BLOCO 5: GET /mcp/sse — transporte SSE legacy ────────────────────────────

describe('BLOCO 5 — GET /mcp/sse (SSE legacy)', () => {
  it('sem auth → 401 imediato (sem estabelecer SSE)', async () => {
    const app = buildApp(makePool());
    const res = await request(app).get('/mcp/sse');
    expect(res.status).toBe(401);
  });

  it('com auth → 200, Content-Type: text/event-stream, emite evento endpoint', () =>
    new Promise<void>((resolve, reject) => {
      const app = buildApp(makePool());
      const httpServer = http.createServer(app);
      httpServer.listen(0, () => {
        const { port } = httpServer.address() as AddressInfo;
        const req = http.get(
          { host: 'localhost', port, path: '/mcp/sse', headers: { 'x-mcp-key': MCP_SECRET } },
          res => {
            expect(res.statusCode).toBe(200);
            expect(res.headers['content-type']).toContain('text/event-stream');
            let buf = '';
            res.on('data', chunk => {
              buf += chunk.toString();
              // O transporte SSE emite "event: endpoint" com a URL de mensagens
              if (buf.includes('endpoint') || buf.includes('sessionId')) {
                req.destroy();
                httpServer.close(() => resolve());
              }
            });
          }
        );
        req.on('error', err => {
          const code = (err as NodeJS.ErrnoException).code;
          if (code === 'ECONNRESET' || code === 'ECONNREFUSED') {
            httpServer.close(() => resolve());
          } else {
            httpServer.close(() => reject(err));
          }
        });
        setTimeout(
          () => httpServer.close(() => reject(new Error('SSE timeout: nenhum evento recebido em 3s'))),
          3000
        );
      });
    })
  );
});

// ── BLOCO 6: POST /mcp/messages — mensagens SSE legacy ───────────────────────

describe('BLOCO 6 — POST /mcp/messages (SSE messages)', () => {
  let app: express.Express;
  beforeEach(() => { app = buildApp(makePool()); });

  it('sem auth → 401', async () => {
    const res = await request(app).post('/mcp/messages?sessionId=qualquer').send({});
    expect(res.status).toBe(401);
  });

  it('sessionId inexistente → 404', async () => {
    const res = await request(app).post('/mcp/messages?sessionId=nao-existe')
      .set('x-mcp-key', MCP_SECRET)
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    expect(res.status).toBe(404);
  });
});

// ── BLOCO 7: tools/list via InMemoryTransport ─────────────────────────────────

describe('BLOCO 7 — tools/list (todas as ferramentas registradas)', () => {
  it('todas as 8 ferramentas presentes, com nome e descrição', async () => {
    const { client } = await buildClient(makePool());
    const { tools } = await client.listTools();
    await closeClient(client);

    const names = tools.map(t => t.name);
    expect(names).toHaveLength(8);
    for (const n of [
      'buscar_contatos', 'obter_historico_conversa', 'criar_contato',
      'atualizar_status_contato', 'enviar_mensagem_whatsapp',
      'listar_agentes', 'buscar_conhecimento', 'resumo_dashboard',
    ]) {
      expect(names, `ausente: ${n}`).toContain(n);
    }
    for (const t of tools) {
      expect(t.description, `${t.name} sem descrição`).toBeTruthy();
    }
  });
});

// ── BLOCO 8: Tool buscar_contatos ─────────────────────────────────────────────

describe('BLOCO 8 — buscar_contatos', () => {
  it('executa SELECT com user_id, query ILIKE e limit; retorna JSON dos contatos', async () => {
    const pool = makePool({
      'FROM contatos': () => ({
        rows: [{
          id: 'c1', nome: 'João Silva', telefone: '5511999990001',
          email: null, status: 'novo', origem: 'organico', opt_out: false, created_at: '2024-01-01',
        }],
      }),
    });
    const { client } = await buildClient(pool);
    const res = await client.callTool({
      name: 'buscar_contatos',
      arguments: { user_id: 'u1', query: 'João', limit: 5 },
    });
    await closeClient(client);

    const data = JSON.parse((res.content[0] as any).text);
    expect(data[0].nome).toBe('João Silva');

    const q = pool._queries.find((x: any) => /FROM contatos/i.test(x.sql));
    expect(q?.params[0]).toBe('u1');       // user_id — isolamento
    expect(q?.params[1]).toBe('%João%');    // query ILIKE
    expect(q?.params[2]).toBe(5);           // limit
  });

  it('usa limit padrão 10 quando não informado', async () => {
    const pool = makePool({ 'FROM contatos': () => ({ rows: [] }) });
    const { client } = await buildClient(pool);
    await client.callTool({ name: 'buscar_contatos', arguments: { user_id: 'u1', query: 'x' } });
    await closeClient(client);

    const q = pool._queries.find((x: any) => /FROM contatos/i.test(x.sql));
    expect(q?.params[2]).toBe(10);
  });
});

// ── BLOCO 9: Tool obter_historico_conversa ────────────────────────────────────

describe('BLOCO 9 — obter_historico_conversa', () => {
  it('retorna mensagens em ordem cronológica (mais antiga primeiro)', async () => {
    const pool = makePool({
      'n8n_chat_histories': () => ({
        rows: [
          // DESC do banco → primeira = mais recente; reverse() inverte para ASC
          { session_id: 's1', message: JSON.stringify({ role: 'user', content: 'Olá' }), created_at: '2024-01-02' },
          { session_id: 's1', message: JSON.stringify({ role: 'assistant', content: 'Oi!' }), created_at: '2024-01-01' },
        ],
      }),
    });
    const { client } = await buildClient(pool);
    const res = await client.callTool({
      name: 'obter_historico_conversa',
      arguments: { user_id: 'u1', session_id: 's1' },
    });
    await closeClient(client);

    const lines = (res.content[0] as any).text.split('\n');
    expect(lines[0]).toContain('assistant'); // 2024-01-01 — mais antigo
    expect(lines[1]).toContain('user');      // 2024-01-02 — mais recente
  });

  it('"Sem histórico" quando não há mensagens', async () => {
    const pool = makePool({ 'n8n_chat_histories': () => ({ rows: [] }) });
    const { client } = await buildClient(pool);
    const res = await client.callTool({
      name: 'obter_historico_conversa',
      arguments: { user_id: 'u1', session_id: 's1' },
    });
    await closeClient(client);
    expect((res.content[0] as any).text).toContain('Sem histórico');
  });

  it('isola por user_id ($2 na query)', async () => {
    const pool = makePool({ 'n8n_chat_histories': () => ({ rows: [] }) });
    const { client } = await buildClient(pool);
    await client.callTool({
      name: 'obter_historico_conversa',
      arguments: { user_id: 'user-A', session_id: 's1' },
    });
    await closeClient(client);

    const q = pool._queries.find((x: any) => /n8n_chat_histories/i.test(x.sql));
    expect(q?.params[1]).toBe('user-A');
  });

  it('aceita mensagem já como objeto (não string)', async () => {
    const pool = makePool({
      'n8n_chat_histories': () => ({
        rows: [{
          session_id: 's1',
          message: { role: 'user', content: 'Mensagem objeto' }, // objeto, não string
          created_at: '2024-01-01',
        }],
      }),
    });
    const { client } = await buildClient(pool);
    const res = await client.callTool({
      name: 'obter_historico_conversa',
      arguments: { user_id: 'u1', session_id: 's1' },
    });
    await closeClient(client);
    expect((res.content[0] as any).text).toContain('Mensagem objeto');
  });
});

// ── BLOCO 10: Tool criar_contato ──────────────────────────────────────────────

describe('BLOCO 10 — criar_contato', () => {
  it('telefone já existe (ILIKE nos últimos 11 dígitos) → "Contato já existe: id=..."', async () => {
    const pool = makePool({
      'SELECT id FROM contatos': () => ({ rows: [{ id: 'existing-id' }] }),
    });
    const { client } = await buildClient(pool);
    const res = await client.callTool({
      name: 'criar_contato',
      arguments: { user_id: 'u1', nome: 'João', telefone: '5511999999999' },
    });
    await closeClient(client);

    const text = (res.content[0] as any).text;
    expect(text).toContain('já existe');
    expect(text).toContain('existing-id');
    // INSERT não deve ter sido chamado
    expect(pool._queries.some((q: any) => /INSERT/i.test(q.sql))).toBe(false);
  });

  it('novo contato → INSERT e retorna "Contato criado"', async () => {
    const pool = makePool({
      'SELECT id FROM contatos': () => ({ rows: [] }),
      'INSERT INTO contatos': () => ({
        rows: [{ id: 'new-id', nome: 'Maria', telefone: '5511999990002' }],
      }),
    });
    const { client } = await buildClient(pool);
    const res = await client.callTool({
      name: 'criar_contato',
      arguments: { user_id: 'u1', nome: 'Maria', telefone: '5511999990002' },
    });
    await closeClient(client);

    const text = (res.content[0] as any).text;
    expect(text).toContain('Contato criado');
    expect(text).toContain('new-id');
  });

  it('origem padrão é "MCP" quando não informada', async () => {
    const pool = makePool({
      'SELECT id FROM contatos': () => ({ rows: [] }),
      'INSERT INTO contatos': () => ({ rows: [{ id: 'x', nome: 'T', telefone: '5511999999990' }] }),
    });
    const { client } = await buildClient(pool);
    await client.callTool({
      name: 'criar_contato',
      arguments: { user_id: 'u1', nome: 'Test', telefone: '5511999999990' },
    });
    await closeClient(client);

    const ins = pool._queries.find((q: any) => /INSERT/i.test(q.sql));
    expect(ins?.params[4]).toBe('MCP');
  });

  it('email opcional → INSERT com null quando ausente', async () => {
    const pool = makePool({
      'SELECT id FROM contatos': () => ({ rows: [] }),
      'INSERT INTO contatos': () => ({ rows: [{ id: 'y', nome: 'T', telefone: '5511999999991' }] }),
    });
    const { client } = await buildClient(pool);
    await client.callTool({
      name: 'criar_contato',
      arguments: { user_id: 'u1', nome: 'Test', telefone: '5511999999991' },
    });
    await closeClient(client);

    const ins = pool._queries.find((q: any) => /INSERT/i.test(q.sql));
    expect(ins?.params[3]).toBeNull(); // email = null
  });
});

// ── BLOCO 11: Tool atualizar_status_contato ───────────────────────────────────

const CONTATO_UUID = 'aaaaaaaa-0000-0000-0000-000000000001';

describe('BLOCO 11 — atualizar_status_contato', () => {
  it('contato não encontrado → "Contato não encontrado"', async () => {
    const pool = makePool({ 'UPDATE contatos': () => ({ rows: [] }) });
    const { client } = await buildClient(pool);
    const res = await client.callTool({
      name: 'atualizar_status_contato',
      arguments: { user_id: 'u1', contato_id: CONTATO_UUID, status: 'qualificado' },
    });
    await closeClient(client);
    expect((res.content[0] as any).text).toContain('não encontrado');
  });

  it('atualização bem-sucedida → "Status atualizado" com dados do contato', async () => {
    const pool = makePool({
      'UPDATE contatos': () => ({
        rows: [{ id: CONTATO_UUID, nome: 'João', status: 'qualificado' }],
      }),
    });
    const { client } = await buildClient(pool);
    const res = await client.callTool({
      name: 'atualizar_status_contato',
      arguments: { user_id: 'u1', contato_id: CONTATO_UUID, status: 'qualificado' },
    });
    await closeClient(client);

    const text = (res.content[0] as any).text;
    expect(text).toContain('Status atualizado');
    expect(text).toContain('qualificado');
  });

  it('UPDATE escopa por user_id ($3 na query) — isolamento multi-tenant', async () => {
    const pool = makePool({ 'UPDATE contatos': () => ({ rows: [] }) });
    const { client } = await buildClient(pool);
    await client.callTool({
      name: 'atualizar_status_contato',
      arguments: { user_id: 'user-X', contato_id: CONTATO_UUID, status: 'fechado' },
    });
    await closeClient(client);

    const upd = pool._queries.find((q: any) => /UPDATE contatos/i.test(q.sql));
    expect(upd?.params[2]).toBe('user-X');
  });

  it('todos os status válidos são aceitos pelo schema', async () => {
    const statuses = ['novo', 'em_contato', 'qualificado', 'proposta', 'fechado', 'perdido'] as const;
    for (const status of statuses) {
      const pool = makePool({ 'UPDATE contatos': () => ({ rows: [] }) });
      const { client } = await buildClient(pool);
      // Se o schema rejeitar, callTool lançará exceção
      await expect(
        client.callTool({
          name: 'atualizar_status_contato',
          arguments: { user_id: 'u1', contato_id: CONTATO_UUID, status },
        })
      ).resolves.toBeDefined();
      await closeClient(client);
    }
  });
});

// ── BLOCO 12: Tool enviar_mensagem_whatsapp ───────────────────────────────────

describe('BLOCO 12 — enviar_mensagem_whatsapp', () => {
  it('Evolution não configurada → mensagem de erro, fetch NÃO chamado', async () => {
    const pool = makePool({ 'integracoes_config': () => ({ rows: [] }) });
    const { client } = await buildClient(pool);
    const res = await client.callTool({
      name: 'enviar_mensagem_whatsapp',
      arguments: { user_id: 'u1', telefone: '5511999990001', texto: 'Olá' },
    });
    await closeClient(client);

    expect((res.content[0] as any).text).toContain('não configurada');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Evolution OK → chama fetch com URL, apikey e payload corretos', async () => {
    const pool = makePool({
      'integracoes_config': () => ({
        rows: [{ url: 'https://evo.test/', api_key: 'k123', instancia: 'inst1' }],
      }),
    });
    const { client } = await buildClient(pool);
    const res = await client.callTool({
      name: 'enviar_mensagem_whatsapp',
      arguments: { user_id: 'u1', telefone: '5511999990001', texto: 'Olá teste' },
    });
    await closeClient(client);

    expect((res.content[0] as any).text).toContain('Mensagem enviada');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('evo.test');
    expect(url).toContain('inst1');
    expect(url).not.toContain('//message'); // trailing slash removida
    expect(opts.headers.apikey).toBe('k123');
    const body = JSON.parse(opts.body);
    expect(body.number).toBe('5511999990001');
    expect(body.text).toBe('Olá teste');
    expect(body.delay).toBe(1200);
  });

  it('Evolution retorna erro HTTP → "Erro Evolution <status>: <body>"', async () => {
    const pool = makePool({
      'integracoes_config': () => ({
        rows: [{ url: 'https://evo.test', api_key: 'k', instancia: 'i' }],
      }),
    });
    fetchMock.mockResolvedValue({ ok: false, status: 503, text: async () => 'Service Unavailable' });
    const { client } = await buildClient(pool);
    const res = await client.callTool({
      name: 'enviar_mensagem_whatsapp',
      arguments: { user_id: 'u1', telefone: '5511', texto: 'test' },
    });
    await closeClient(client);

    const text = (res.content[0] as any).text;
    expect(text).toContain('503');
    expect(text).toContain('Unavailable');
  });

  it('isola credenciais por user_id (busca na integracoes_config com $1=user_id)', async () => {
    const pool = makePool({ 'integracoes_config': () => ({ rows: [] }) });
    const { client } = await buildClient(pool);
    await client.callTool({
      name: 'enviar_mensagem_whatsapp',
      arguments: { user_id: 'user-isolado', telefone: '5511', texto: 'x' },
    });
    await closeClient(client);

    const q = pool._queries.find((x: any) => /integracoes_config/i.test(x.sql));
    expect(q?.params[0]).toBe('user-isolado');
  });
});

// ── BLOCO 13: Tool listar_agentes ─────────────────────────────────────────────

describe('BLOCO 13 — listar_agentes', () => {
  it('retorna JSON dos agentes ordenados por nome', async () => {
    const pool = makePool({
      'FROM agentes': () => ({
        rows: [
          { id: 'a1', nome: 'Agente Vendas', evolution_instancia: 'inst1', modelo: 'gpt-4', temperatura: 0.7, ativo: true },
        ],
      }),
    });
    const { client } = await buildClient(pool);
    const res = await client.callTool({ name: 'listar_agentes', arguments: { user_id: 'u1' } });
    await closeClient(client);

    const data = JSON.parse((res.content[0] as any).text);
    expect(data).toHaveLength(1);
    expect(data[0].nome).toBe('Agente Vendas');
    expect(pool._queries[0].params[0]).toBe('u1');
  });

  it('retorna array vazio quando não há agentes', async () => {
    const pool = makePool({ 'FROM agentes': () => ({ rows: [] }) });
    const { client } = await buildClient(pool);
    const res = await client.callTool({ name: 'listar_agentes', arguments: { user_id: 'u1' } });
    await closeClient(client);

    const data = JSON.parse((res.content[0] as any).text);
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(0);
  });
});

// ── BLOCO 14: Tool buscar_conhecimento ────────────────────────────────────────

describe('BLOCO 14 — buscar_conhecimento', () => {
  it('sem tipo → SQL sem filtro AND tipo, params=[user_id]', async () => {
    const pool = makePool({ 'FROM conhecimento': () => ({ rows: [] }) });
    const { client } = await buildClient(pool);
    await client.callTool({ name: 'buscar_conhecimento', arguments: { user_id: 'u1' } });
    await closeClient(client);

    const q = pool._queries.find((x: any) => /FROM conhecimento/i.test(x.sql));
    expect(q?.sql).not.toMatch(/AND tipo/i);
    expect(q?.params).toHaveLength(1);
  });

  it('com tipo → SQL com filtro AND tipo = $2, params=[user_id, tipo]', async () => {
    const pool = makePool({ 'FROM conhecimento': () => ({ rows: [] }) });
    const { client } = await buildClient(pool);
    await client.callTool({ name: 'buscar_conhecimento', arguments: { user_id: 'u1', tipo: 'faq' } });
    await closeClient(client);

    const q = pool._queries.find((x: any) => /FROM conhecimento/i.test(x.sql));
    expect(q?.sql).toMatch(/AND tipo/i);
    expect(q?.params[1]).toBe('faq');
  });

  it('formata saída como [tipo / campo]\\nconteudo quando campo presente', async () => {
    const pool = makePool({
      'FROM conhecimento': () => ({
        rows: [{ tipo: 'faq', campo: 'Horário', conteudo: 'Das 8h às 18h' }],
      }),
    });
    const { client } = await buildClient(pool);
    const res = await client.callTool({ name: 'buscar_conhecimento', arguments: { user_id: 'u1' } });
    await closeClient(client);

    const text = (res.content[0] as any).text;
    expect(text).toContain('[faq / Horário]');
    expect(text).toContain('Das 8h às 18h');
  });

  it('formata como [tipo] (sem "/ campo") quando campo é null', async () => {
    const pool = makePool({
      'FROM conhecimento': () => ({
        rows: [{ tipo: 'personalidade', campo: null, conteudo: 'Sou amigável' }],
      }),
    });
    const { client } = await buildClient(pool);
    const res = await client.callTool({ name: 'buscar_conhecimento', arguments: { user_id: 'u1' } });
    await closeClient(client);

    const text = (res.content[0] as any).text;
    expect(text).toContain('[personalidade]');
    expect(text).not.toMatch(/\/ null/);
  });

  it('"Nenhum conhecimento cadastrado" quando base está vazia', async () => {
    const pool = makePool({ 'FROM conhecimento': () => ({ rows: [] }) });
    const { client } = await buildClient(pool);
    const res = await client.callTool({ name: 'buscar_conhecimento', arguments: { user_id: 'u1' } });
    await closeClient(client);
    expect((res.content[0] as any).text).toContain('Nenhum conhecimento');
  });

  it('múltiplos itens separados por linha em branco (\\n\\n)', async () => {
    const pool = makePool({
      'FROM conhecimento': () => ({
        rows: [
          { tipo: 'faq', campo: 'A', conteudo: 'resposta A' },
          { tipo: 'faq', campo: 'B', conteudo: 'resposta B' },
        ],
      }),
    });
    const { client } = await buildClient(pool);
    const res = await client.callTool({ name: 'buscar_conhecimento', arguments: { user_id: 'u1' } });
    await closeClient(client);
    expect((res.content[0] as any).text).toContain('\n\n');
  });
});

// ── BLOCO 15: Tool resumo_dashboard ──────────────────────────────────────────

describe('BLOCO 15 — resumo_dashboard', () => {
  it('retorna contatos_por_status e disparos_7d no JSON', async () => {
    const pool = makePool({
      'FROM contatos': () => ({
        rows: [
          { status: 'novo', total: '15' },
          { status: 'qualificado', total: '5' },
        ],
      }),
      'FROM disparo_logs': () => ({
        rows: [{ total: '50', enviados: '42' }],
      }),
    });
    const { client } = await buildClient(pool);
    const res = await client.callTool({ name: 'resumo_dashboard', arguments: { user_id: 'u1' } });
    await closeClient(client);

    const data = JSON.parse((res.content[0] as any).text);
    expect(data.contatos_por_status).toHaveLength(2);
    expect(data.contatos_por_status[0].status).toBe('novo');
    expect(data.disparos_7d.total).toBe('50');
    expect(data.disparos_7d.enviados).toBe('42');
  });

  it('executa as duas queries com user_id isolado (multi-tenant)', async () => {
    const pool = makePool({
      'FROM contatos': () => ({ rows: [] }),
      'FROM disparo_logs': () => ({ rows: [{ total: '0', enviados: '0' }] }),
    });
    const { client } = await buildClient(pool);
    await client.callTool({ name: 'resumo_dashboard', arguments: { user_id: 'user-Z' } });
    await closeClient(client);

    expect(pool._queries.length).toBeGreaterThanOrEqual(2);
    for (const q of pool._queries) {
      expect(q.params[0], `query "${q.sql.slice(0, 40)}..." usou user_id errado`).toBe('user-Z');
    }
  });

  it('queries executadas em paralelo (Promise.all — ambas presentes mesmo com pool vazio)', async () => {
    const pool = makePool({
      'FROM contatos': () => ({ rows: [] }),
      'FROM disparo_logs': () => ({ rows: [{ total: '0', enviados: '0' }] }),
    });
    const { client } = await buildClient(pool);
    await client.callTool({ name: 'resumo_dashboard', arguments: { user_id: 'u1' } });
    await closeClient(client);

    const sqls = pool._queries.map((q: any) => q.sql);
    expect(sqls.some((s: string) => /contatos/i.test(s))).toBe(true);
    expect(sqls.some((s: string) => /disparo_logs/i.test(s))).toBe(true);
  });
});
