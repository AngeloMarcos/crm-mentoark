import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { authMiddleware, AuthRequest } from '../src/middleware';
import { makeCrud } from '../src/crud';

process.env.JWT_SECRET = 'test-secret-multitenant';

// ── Mock minimal pg.Pool capturing all queries ────────────────────────────
type Capture = { sql: string; params: any[] };
const captured: Capture[] = [];
const fakeRows: any[] = [
  { id: '1', user_id: 'user-A', nome: 'A1' },
  { id: '2', user_id: 'user-A', nome: 'A2' },
];
const mockPool: any = {
  query: async (sql: string, params: any[] = []) => {
    captured.push({ sql, params });
    if (/DELETE/i.test(sql)) return { rows: [], rowCount: 1 };
    return { rows: fakeRows, rowCount: fakeRows.length };
  },
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/contatos', authMiddleware, makeCrud(mockPool, 'contatos'));
  return app;
}

const sign = (payload: any) => jwt.sign(payload, process.env.JWT_SECRET!);

describe('Multi-tenant isolation — security', () => {
  let app: express.Express;
  beforeAll(() => { app = buildApp(); });

  it('rejeita request sem Authorization header', async () => {
    const res = await request(app).get('/api/contatos');
    expect(res.status).toBe(401);
  });

  it('rejeita JWT sem campo sub (não pode listar dados de outros tenants)', async () => {
    const token = sign({ role: 'user', email: 'x@y.z' }); // sem sub
    const res = await request(app)
      .get('/api/contatos')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/sub/i);
  });

  it('rejeita JWT inválido', async () => {
    const res = await request(app)
      .get('/api/contatos')
      .set('Authorization', 'Bearer not-a-jwt');
    expect(res.status).toBe(401);
  });

  it('GET com sub válido aplica filtro user_id na SQL', async () => {
    captured.length = 0;
    const token = sign({ sub: 'user-A', role: 'user' });
    const res = await request(app)
      .get('/api/contatos')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const last = captured.at(-1)!;
    expect(last.sql).toMatch(/WHERE user_id = \$1/);
    expect(last.params[0]).toBe('user-A');
  });

  it('GET nunca executa query sem filtro user_id quando o token é válido', async () => {
    captured.length = 0;
    const token = sign({ sub: 'user-B', role: 'user' });
    await request(app)
      .get('/api/contatos?status=novo')
      .set('Authorization', `Bearer ${token}`);
    const last = captured.at(-1)!;
    expect(last.sql).toMatch(/user_id = \$1/);
    expect(last.params).toContain('user-B');
    // Garante que nenhum dado de outro tenant pode vazar via param
    expect(last.params).not.toContain('user-A');
  });

  it('DELETE bulk sem nenhum filtro retorna 400 (nunca apaga tudo)', async () => {
    const token = sign({ sub: 'user-A', role: 'user' });
    const res = await request(app)
      .delete('/api/contatos')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('DELETE bulk com filtro inclui user_id na cláusula WHERE', async () => {
    captured.length = 0;
    const token = sign({ sub: 'user-A', role: 'user' });
    const res = await request(app)
      .delete('/api/contatos?status=novo')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);
    const last = captured.at(-1)!;
    expect(last.sql).toMatch(/DELETE FROM contatos WHERE user_id = \$1/);
    expect(last.params[0]).toBe('user-A');
  });
});
