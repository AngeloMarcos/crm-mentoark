import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { authMiddleware } from '../src/middleware';
import disparosRouter, { _lastSentAt } from '../src/routes/disparos';

process.env.JWT_SECRET = 'test-secret-disparos';

const USER_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const TELEFONE = '5511999999999';
const TEXTO = 'Olá {{nome}}, temos uma oferta especial!';
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

function makePool(opts: { hasEvo?: boolean; optOut?: boolean } = {}) {
  return {
    query: async (sql: string, _params: unknown[] = []) => {
      // Evolution API config
      if (/integracoes_config/i.test(sql)) {
        return opts.hasEvo === false
          ? { rows: [] }
          : { rows: [{ url: 'https://evo.test', api_key: 'k123', instancia: 'inst1' }] };
      }
      // opt-out check: SELECT opt_out FROM contatos
      if (/SELECT\s+opt_out/i.test(sql)) {
        return { rows: opts.optOut ? [{ opt_out: true }] : [] };
      }
      // personalização: SELECT nome FROM contatos
      if (/SELECT\s+nome/i.test(sql)) {
        return { rows: [{ nome: 'João Silva' }] };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

const mockFetchOk = () => vi.fn().mockResolvedValue({ ok: true });
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

// Limpa rate limiter entre testes para evitar falsos 429
beforeEach(() => _lastSentAt.clear());
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

// ── CONFORMIDADE META ─────────────────────────────────────────────────────────
describe('Conformidade com política Meta', () => {
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

  it('retorna 400 quando telefone tem formato inválido (letras ou caracteres especiais)', async () => {
    const app = buildApp(makePool({ hasEvo: true }));
    vi.stubGlobal('fetch', mockFetchOk());
    const res = await post(app, { ...validBody(), telefone: 'abc-invalido' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/telefone|formato|inválido/i);
  });

  it('aceita telefone com +, espaço e hífen e normaliza para dígitos', async () => {
    const app = buildApp(makePool({ hasEvo: true }));
    vi.stubGlobal('fetch', mockFetchOk());
    // +55 11 99999-9999 → 5511999999999 (13 dígitos) → válido
    const res = await post(app, { ...validBody(), telefone: '+55 11 99999-9999' });
    expect(res.status).toBe(200);
  });

  it('rejeita telefone com menos de 10 dígitos', async () => {
    const app = buildApp(makePool({ hasEvo: true }));
    vi.stubGlobal('fetch', mockFetchOk());
    const res = await post(app, { ...validBody(), telefone: '999' });
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

  it('retorna 200, substitui {{nome}} e marca log como "sent"', async () => {
    const queries: string[] = [];
    const pool = {
      query: async (sql: string, _params: unknown[] = []) => {
        queries.push(sql);
        if (/integracoes_config/i.test(sql))
          return { rows: [{ url: 'https://evo.test', api_key: 'k', instancia: 'i1' }] };
        if (/SELECT\s+nome/i.test(sql))
          return { rows: [{ nome: 'Maria Souza' }] };
        return { rows: [], rowCount: 0 };
      },
    };
    const mockFetch = mockFetchOk();
    vi.stubGlobal('fetch', mockFetch);
    const app = buildApp(pool);

    const res = await post(app, validBody());

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Verifica que o texto enviado substituiu {{nome}} → "Maria"
    const fetchCall = mockFetch.mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.text).toContain('Maria');
    expect(body.text).not.toContain('{{nome}}');

    // Verifica updates no banco
    const hasSent = queries.some(q => /sent/i.test(q) && /disparo_logs/i.test(q));
    expect(hasSent).toBe(true);
    const hasEnviados = queries.some(q => /enviados.*\+.*1/i.test(q) && /disparos/i.test(q));
    expect(hasEnviados).toBe(true);
  });

  it('retorna 503 quando Evolution API responde com 503', async () => {
    const app = buildApp(makePool({ hasEvo: true }));
    vi.stubGlobal('fetch', mockFetch503());
    const res = await post(app, validBody());
    expect(res.status).toBe(503);
  });

  it('retorna 429 com header Retry-After quando rate limit é atingido', async () => {
    const pool = makePool({ hasEvo: true });
    const app = buildApp(pool);
    vi.stubGlobal('fetch', mockFetchOk());

    // Primeira requisição: passa normalmente
    const first = await post(app, validBody());
    expect(first.status).toBe(200);

    // Segunda imediatamente: deve ser bloqueada pelo rate limiter
    vi.stubGlobal('fetch', mockFetchOk());
    const second = await post(app, validBody());
    expect(second.status).toBe(429);
    expect(second.headers['retry-after']).toBe('1');
  });
});

// ── VALIDAÇÃO DE OPT-OUT (OBRIGATÓRIO PELA META) ──────────────────────────────
describe('Bloqueio de opt-out (contatos.opt_out = true → 403)', () => {
  const optOutKeywords = ['SAIR', 'parar', 'remover', 'descadastrar', 'cancelar', 'stop'];

  for (const keyword of optOutKeywords) {
    it(`bloqueia com 403 quando contato descadastrou via "${keyword}"`, async () => {
      const app = buildApp(makePool({ hasEvo: true, optOut: true }));
      vi.stubGlobal('fetch', mockFetchOk());
      const res = await post(app, validBody());
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/opt.?out|descadastrado|não receber/i);
    });
  }
});

// ── ENDPOINT POST /opt-out ────────────────────────────────────────────────────
describe('POST /api/disparos/opt-out', () => {
  it('retorna 400 quando telefone está ausente', async () => {
    const app = buildApp(makePool());
    const res = await request(app)
      .post('/api/disparos/opt-out')
      .set('Authorization', `Bearer ${token()}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('retorna 200 e executa UPDATE contatos SET opt_out = true', async () => {
    const queries: string[] = [];
    const pool = {
      query: async (sql: string, _params: unknown[] = []) => {
        queries.push(sql);
        return { rows: [], rowCount: 1 };
      },
    };
    const app = buildApp(pool);
    const res = await request(app)
      .post('/api/disparos/opt-out')
      .set('Authorization', `Bearer ${token()}`)
      .send({ telefone: TELEFONE });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const hasUpdate = queries.some(q => /opt_out.*true/i.test(q) && /contatos/i.test(q));
    expect(hasUpdate).toBe(true);
    const hasLog = queries.some(q => /disparo_optouts/i.test(q));
    expect(hasLog).toBe(true);
  });
});
