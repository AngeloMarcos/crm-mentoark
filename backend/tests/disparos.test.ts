import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { authMiddleware } from '../src/middleware';
import disparosRouter from '../src/routes/disparos';

process.env.JWT_SECRET = 'test-secret-disparos';

const USER_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const TELEFONE = '5511999999999';
const TEXTO = 'Olá, temos uma oferta especial para você!';
const DISPARO_LOG_ID = 'log-001';
const DISPARO_ID = 'camp-001';

const sign = (payload: object) => jwt.sign(payload, process.env.JWT_SECRET!);
const token = () => sign({ sub: USER_ID, role: 'user' });

function buildApp(pool: object) {
  const app = express();
  app.use(express.json());
  app.use('/api/disparos', authMiddleware, disparosRouter(pool as any));
  return app;
}

function makePool(opts: { hasEvo?: boolean; optOutPhone?: string } = {}) {
  return {
    query: async (sql: string, _params: unknown[] = []) => {
      if (/integracoes_config/i.test(sql)) {
        return opts.hasEvo === false
          ? { rows: [] }
          : { rows: [{ url: 'https://evo.test', api_key: 'k123', instancia: 'inst1' }] };
      }
      if (/opt_out/i.test(sql)) {
        return opts.optOutPhone
          ? { rows: [{ telefone: opts.optOutPhone }] }
          : { rows: [] };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

const mockFetchOk = () =>
  vi.fn().mockResolvedValue({ ok: true });

const mockFetch503 = () =>
  vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => 'Service Unavailable' });

const validBody = () => ({
  telefone: TELEFONE,
  texto: TEXTO,
  disparo_log_id: DISPARO_LOG_ID,
  disparo_id: DISPARO_ID,
});

const post = (app: ReturnType<typeof buildApp>, body: object) =>
  request(app)
    .post('/api/disparos/enviar')
    .set('Authorization', `Bearer ${token()}`)
    .send(body);

afterEach(() => vi.unstubAllGlobals());

// ── VALIDAÇÃO DE CAMPOS OBRIGATÓRIOS ──────────────────────────────────────────
describe('Validação de campos obrigatórios (400)', () => {
  const pool = makePool({ hasEvo: true });
  const app = buildApp(pool);

  it('retorna 400 quando telefone está ausente', async () => {
    const { telefone: _, ...body } = validBody();
    const res = await post(app, body);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/telefone/i);
  });

  it('retorna 400 quando texto está ausente', async () => {
    const { texto: _, ...body } = validBody();
    const res = await post(app, body);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/texto/i);
  });

  it('retorna 400 quando disparo_log_id está ausente', async () => {
    const { disparo_log_id: _, ...body } = validBody();
    const res = await post(app, body);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/disparo_log_id/i);
  });

  it('retorna 400 quando disparo_id está ausente', async () => {
    const { disparo_id: _, ...body } = validBody();
    const res = await post(app, body);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/disparo_id/i);
  });
});

// ── CONFORMIDADE META (TDD — falharão até disparos.ts ser atualizado) ─────────
describe('Conformidade com política Meta — TDD', () => {
  it('retorna 400 quando texto ultrapassa 4096 caracteres', async () => {
    const app = buildApp(makePool({ hasEvo: true }));
    vi.stubGlobal('fetch', mockFetchOk());
    const res = await post(app, { ...validBody(), texto: 'A'.repeat(4097) });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/4096|longo/i);
  });

  it('retorna 400 quando texto contém apenas espaços em branco', async () => {
    const app = buildApp(makePool({ hasEvo: true }));
    vi.stubGlobal('fetch', mockFetchOk());
    const res = await post(app, { ...validBody(), texto: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/vazio|espaço|blank/i);
  });

  it('retorna 400 quando telefone tem formato inválido', async () => {
    const app = buildApp(makePool({ hasEvo: true }));
    vi.stubGlobal('fetch', mockFetchOk());
    const res = await post(app, { ...validBody(), telefone: 'abc-invalido' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/telefone|formato|inválido/i);
  });
});

// ── FLUXO FELIZ ───────────────────────────────────────────────────────────────
describe('Fluxo feliz', () => {
  it('retorna 400 quando Evolution API não está configurada', async () => {
    const app = buildApp(makePool({ hasEvo: false }));
    const res = await post(app, validBody());
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/evolution|configura/i);
  });

  it('retorna 200 e atualiza log como "sent" quando envio tem sucesso', async () => {
    const queries: string[] = [];
    const pool = {
      query: async (sql: string, _params: unknown[] = []) => {
        queries.push(sql);
        if (/integracoes_config/i.test(sql))
          return { rows: [{ url: 'https://evo.test', api_key: 'k', instancia: 'i1' }] };
        return { rows: [], rowCount: 0 };
      },
    };
    const app = buildApp(pool);
    vi.stubGlobal('fetch', mockFetchOk());

    const res = await post(app, validBody());

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const hasSentUpdate = queries.some(q => /sent/i.test(q) && /disparo_logs/i.test(q));
    expect(hasSentUpdate).toBe(true);
    const hasEnviadosIncr = queries.some(q => /enviados.*\+.*1/i.test(q) && /disparos/i.test(q));
    expect(hasEnviadosIncr).toBe(true);
  });

  // TDD — implementar retry automático com backoff em disparos.ts
  it('retorna 503 quando Evolution API responde com 503 após retries', async () => {
    const app = buildApp(makePool({ hasEvo: true }));
    vi.stubGlobal('fetch', mockFetch503());
    const res = await post(app, validBody());
    expect(res.status).toBe(503);
  });
});

// ── OPT-OUT AUTOMÁTICO (TDD — falharão até disparos.ts verificar a tabela) ───
describe('Bloqueio de opt-out automático — TDD', () => {
  const optOutKeywords = ['SAIR', 'parar', 'remover', 'descadastrar', 'cancelar', 'stop'];

  for (const keyword of optOutKeywords) {
    it(`bloqueia envio quando contato descadastrou com "${keyword}"`, async () => {
      const app = buildApp(makePool({ hasEvo: true, optOutPhone: TELEFONE }));
      vi.stubGlobal('fetch', mockFetchOk());
      const res = await post(app, validBody());
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/opt.?out|descadastrado|cancelou|bloqueado/i);
    });
  }
});
