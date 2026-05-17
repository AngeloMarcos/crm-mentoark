import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { authMiddleware } from '../src/middleware';
import disparosRouter, { _lastSentAt } from '../src/routes/disparos';

process.env.JWT_SECRET = 'test-secret-disparos';

// Mock do fetch global (Evolution API)
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const USER_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const sign = (sub = USER_ID) => jwt.sign({ sub, role: 'user' }, process.env.JWT_SECRET!);

// Payload base válido para POST /disparos/enviar
const baseBody = {
  telefone: '5511999990001',
  texto: 'Olá {{nome}}, tudo bem?',
  disparo_log_id: 'log-001',
  disparo_id: 'dis-001',
};

// Tempo dentro da janela (10:00 BRT = 13:00 UTC) — usado como padrão em beforeEach
const WITHIN_WINDOW = new Date('2024-06-15T13:00:00.000Z');

// Pool factory com rastreamento de queries para asserções
function makePool(opts: {
  hasEvo?: boolean;
  optOut?: boolean | null;
  nome?: string;
  hasContact?: boolean;
} = {}) {
  const { hasEvo = true, optOut = null, nome = 'João Silva', hasContact = true } = opts;
  const queries: string[] = [];
  const pool = {
    _queries: queries,
    query: async (sql: string, _p: unknown[] = []) => {
      queries.push(sql);
      if (/integracoes_config/i.test(sql)) {
        return hasEvo
          ? { rows: [{ url: 'https://evo.test', api_key: 'k123', instancia: 'inst1' }] }
          : { rows: [] };
      }
      // Verificação de opt-out (antes do rate limit)
      if (/SELECT\s+opt_out/i.test(sql)) {
        return optOut === null ? { rows: [] } : { rows: [{ opt_out: optOut }] };
      }
      // Personalização de nome
      if (/SELECT\s+nome/i.test(sql)) {
        return hasContact ? { rows: [{ nome }] } : { rows: [] };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  return pool;
}

function buildApp(pool: ReturnType<typeof makePool>) {
  const app = express();
  app.use(express.json());
  app.use('/api/disparos', authMiddleware, disparosRouter(pool as any));
  return app;
}

const post = (app: express.Express, body: object, tok = sign()) =>
  request(app)
    .post('/api/disparos/enviar')
    .set('Authorization', `Bearer ${tok}`)
    .send(body);

// Antes de cada teste: limpar rate limit, resetar fetch e fixar horário dentro da janela
beforeEach(() => {
  _lastSentAt.clear();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '' });
  vi.useFakeTimers();
  vi.setSystemTime(WITHIN_WINDOW); // 10:00 BRT — garante que a janela não bloqueia por padrão
});

afterEach(() => {
  vi.useRealTimers();
});

// ── BLOCO 1: Validação de campos obrigatórios ─────────────────────────────────

describe('BLOCO 1 — Validação de campos obrigatórios (400)', () => {
  let app: express.Express;
  beforeEach(() => { app = buildApp(makePool()); });

  it('1. sem telefone → 400', async () => {
    const { telefone: _, ...body } = baseBody;
    const res = await post(app, body);
    expect(res.status).toBe(400);
  });

  it('2. sem texto → 400', async () => {
    const { texto: _, ...body } = baseBody;
    const res = await post(app, body);
    expect(res.status).toBe(400);
  });

  it('3. sem disparo_log_id → 400', async () => {
    const { disparo_log_id: _, ...body } = baseBody;
    const res = await post(app, body);
    expect(res.status).toBe(400);
  });

  it('4. sem disparo_id → 400', async () => {
    const { disparo_id: _, ...body } = baseBody;
    const res = await post(app, body);
    expect(res.status).toBe(400);
  });

  it('5. todos os campos ausentes → 400', async () => {
    const res = await post(app, {});
    expect(res.status).toBe(400);
  });

  it('6. texto só com espaços → 400 menciona "vazio"', async () => {
    const res = await post(app, { ...baseBody, texto: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/vazio/i);
  });

  it('7. texto com 4097 chars → 400 menciona "4096"', async () => {
    const res = await post(app, { ...baseBody, texto: 'A'.repeat(4097) });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/4096/);
  });
});

// ── BLOCO 2: Validação de telefone — normalizarTelefone ───────────────────────

describe('BLOCO 2 — normalizarTelefone (validação de formato)', () => {
  let app: express.Express;
  beforeEach(() => { app = buildApp(makePool()); });

  it('8. "123" (menos de 10 dígitos) → 400 "formato inválido"', async () => {
    const res = await post(app, { ...baseBody, telefone: '123' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/formato inválido/i);
  });

  it('9. "1234567890123456" (16 dígitos) → 400', async () => {
    const res = await post(app, { ...baseBody, telefone: '1234567890123456' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/formato inválido/i);
  });

  it('10. "abc1234567890" (letras inválidas) → 400', async () => {
    const res = await post(app, { ...baseBody, telefone: 'abc1234567890' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/formato inválido/i);
  });

  it('11. "+55 11 99999-0001" (dígitos, +, espaço, hífen) → 200', async () => {
    const res = await post(app, { ...baseBody, telefone: '+55 11 99999-0001' });
    expect(res.status).toBe(200);
  });

  it('12. "+5511999990001" (+ prefixo, sem separadores) → 200', async () => {
    const res = await post(app, { ...baseBody, telefone: '+5511999990001' });
    expect(res.status).toBe(200);
  });

  it('13. "5511999990001" (11 dígitos puros) → 200', async () => {
    const res = await post(app, { ...baseBody, telefone: '5511999990001' });
    expect(res.status).toBe(200);
  });
});

// ── BLOCO 3: Janela de envio (dentroDaJanela) ─────────────────────────────────
// BRT = UTC-3 (America/Sao_Paulo, sem horário de verão desde 2019).
// Horários abaixo expressos como UTC equivalente:
//   07:59 BRT = 10:59 UTC  |  08:00 BRT = 11:00 UTC
//   21:00 BRT = 00:00 UTC  |  21:01 BRT = 00:01 UTC
//   00:00 BRT = 03:00 UTC

describe('BLOCO 3 — dentroDaJanela (horário de Brasília)', () => {
  it('14. 07:59 BRT → 400 "Fora da janela", grava status=scheduled', async () => {
    vi.setSystemTime(new Date('2024-01-15T10:59:00.000Z')); // 07:59 BRT
    const pool = makePool();
    const app = buildApp(pool);

    const res = await post(app, baseBody);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Fora da janela/i);
    expect(
      pool._queries.some(q => /UPDATE disparo_logs/i.test(q) && /scheduled/i.test(q))
    ).toBe(true);
  });

  it('15. 08:00 BRT → não bloqueia por janela', async () => {
    vi.setSystemTime(new Date('2024-01-15T11:00:00.000Z')); // 08:00 BRT
    const app = buildApp(makePool());

    const res = await post(app, baseBody);

    expect(res.status).not.toBe(400);
    expect(String(res.body.message ?? '')).not.toMatch(/Fora da janela/i);
  });

  it('16. 21:00 BRT → não bloqueia (limite é 21:01+)', async () => {
    vi.setSystemTime(new Date('2024-01-16T00:00:00.000Z')); // 21:00 BRT
    const app = buildApp(makePool());

    const res = await post(app, baseBody);

    expect(res.status).not.toBe(400);
    expect(String(res.body.message ?? '')).not.toMatch(/Fora da janela/i);
  });

  it('17. 21:01 BRT → 400 "Fora da janela"', async () => {
    vi.setSystemTime(new Date('2024-01-16T00:01:00.000Z')); // 21:01 BRT
    const app = buildApp(makePool());

    const res = await post(app, baseBody);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Fora da janela/i);
  });

  it('18. 00:00 BRT → 400 "Fora da janela"', async () => {
    vi.setSystemTime(new Date('2024-01-15T03:00:00.000Z')); // 00:00 BRT
    const app = buildApp(makePool());

    const res = await post(app, baseBody);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Fora da janela/i);
  });
});

// ── BLOCO 4: Opt-out ──────────────────────────────────────────────────────────

describe('BLOCO 4 — Opt-out', () => {
  it('19. opt_out=true → 403, grava status=optout, fetch NÃO chamado', async () => {
    const pool = makePool({ optOut: true });
    const app = buildApp(pool);

    const res = await post(app, baseBody);

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/não receber/i);
    expect(
      pool._queries.some(q => /UPDATE disparo_logs/i.test(q) && /optout/i.test(q))
    ).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('20. opt_out=false → envia normalmente (200)', async () => {
    const app = buildApp(makePool({ optOut: false }));

    const res = await post(app, baseBody);

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('21. contato não encontrado (rows=[]) → opt_out ausente é permitido, envia (200)', async () => {
    const app = buildApp(makePool({ optOut: null }));

    const res = await post(app, baseBody);

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

// ── BLOCO 5: Rate limiting ────────────────────────────────────────────────────

describe('BLOCO 5 — Rate limiting (1 msg/s por user_id)', () => {
  it('22. 1ª=200, 2ª imediata=429 com header Retry-After: 1', async () => {
    const app = buildApp(makePool());

    const first = await post(app, baseBody);
    expect(first.status).toBe(200);

    const second = await post(app, baseBody);
    expect(second.status).toBe(429);
    expect(second.headers['retry-after']).toBe('1');
  });

  it('23. intervalo >1000ms entre envios → ambos 200', async () => {
    // Fake timers já ativos (beforeEach definiu 10:00 BRT)
    const t0 = Date.now();
    const app = buildApp(makePool());

    const first = await post(app, baseBody);
    expect(first.status).toBe(200);

    // Avança 1001ms: Date.now() agora retorna t0 + 1001, dentro da janela ainda
    vi.setSystemTime(t0 + 1001);

    const second = await post(app, baseBody);
    expect(second.status).toBe(200);
  });
});

// ── BLOCO 6: Personalização e chamada à Evolution API ────────────────────────

describe('BLOCO 6 — Personalização e chamada à Evolution API', () => {
  it('substitui {{nome}} pelo primeiro nome do contato no payload enviado', async () => {
    const app = buildApp(makePool({ nome: 'Maria Souza' }));

    await post(app, baseBody);

    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.text).toContain('Maria');
    expect(payload.text).not.toContain('{{nome}}');
  });

  it('substitui {{telefone}} pelo número normalizado no payload', async () => {
    const app = buildApp(makePool());

    await post(app, {
      ...baseBody,
      texto: 'Seu número: {{telefone}}',
      telefone: '+55 11 99999-0001',
    });

    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.text).toContain('5511999990001');
    expect(payload.text).not.toContain('{{telefone}}');
  });

  it('usa "você" quando contato não possui nome cadastrado', async () => {
    // hasContact: false → rows=[] → nome ?? 'você' → 'você'
    const app = buildApp(makePool({ hasContact: false }));

    await post(app, baseBody);

    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.text).toContain('você');
  });

  it('Evolution API não configurada → 400', async () => {
    const app = buildApp(makePool({ hasEvo: false }));

    const res = await post(app, baseBody);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/evolution|configura/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Evolution API responde 503 → repassa status 503', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    });
    const app = buildApp(makePool());

    const res = await post(app, baseBody);

    expect(res.status).toBe(503);
  });

  it('envia com status=sent e incrementa enviados no banco após sucesso', async () => {
    const pool = makePool();
    const app = buildApp(pool);

    const res = await post(app, baseBody);

    expect(res.status).toBe(200);
    expect(pool._queries.some(q => /sent/i.test(q) && /disparo_logs/i.test(q))).toBe(true);
    expect(pool._queries.some(q => /enviados.*\+.*1/i.test(q) && /disparos\b/i.test(q))).toBe(true);
  });
});

// ── BLOCO 7: POST /opt-out ────────────────────────────────────────────────────

describe('BLOCO 7 — POST /api/disparos/opt-out', () => {
  const optOut = (app: express.Express, body: object) =>
    request(app)
      .post('/api/disparos/opt-out')
      .set('Authorization', `Bearer ${sign()}`)
      .send(body);

  it('sem telefone → 400', async () => {
    const app = buildApp(makePool());
    const res = await optOut(app, {});
    expect(res.status).toBe(400);
  });

  it('telefone válido → 200, UPDATE contatos.opt_out=true e INSERT disparo_optouts', async () => {
    const pool = makePool();
    const app = buildApp(pool);

    const res = await optOut(app, { telefone: '5511999990001' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(pool._queries.some(q => /UPDATE contatos/i.test(q) && /opt_out.*true/i.test(q))).toBe(true);
    expect(pool._queries.some(q => /INSERT.*disparo_optouts/i.test(q))).toBe(true);
  });

  it('telefone com +, espaços e hífen → 200 (normaliza antes de gravar)', async () => {
    const pool = makePool();
    const app = buildApp(pool);

    const res = await optOut(app, { telefone: '+55 11 99999-0001' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
