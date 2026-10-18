/**
 * Sprint 6 do maturador (2026-10-18): Embedded Signup v4 — fluxo do servidor com a Meta simulada.
 */
import { describe, it, expect, beforeEach } from 'vitest';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'a'.repeat(64);
import { concluirCadastro, configuracaoCadastro, gerarPin } from '../src/services/embeddedSignup';

function metaFalsa(opts: { tokenOk?: boolean } = {}) {
  const chamadas: { url: string; method: string; body: any }[] = [];
  const f = (async (url: any, init: any = {}) => {
    const u = String(url);
    chamadas.push({ url: u, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    const resp = (status: number, corpo: any) => new Response(typeof corpo === 'string' ? corpo : JSON.stringify(corpo), { status });
    if (u.includes('/oauth/access_token')) return opts.tokenOk === false ? resp(400, { error: { message: 'code expirado' } }) : resp(200, { access_token: 'TOKEN_CLIENTE' });
    if (u.endsWith('/subscribed_apps')) return resp(200, { success: true });
    if (u.includes('?fields=display_phone_number')) return resp(200, { display_phone_number: '+55 11 90000-0000', verified_name: 'Loja', quality_rating: 'GREEN' });
    if (u.endsWith('/register')) return resp(200, { success: true });
    if (u.endsWith('/smb_app_data')) return resp(200, { success: true });
    return resp(404, { error: { message: 'rota não simulada' } });
  }) as typeof fetch;
  return { f, chamadas };
}

function poolFalso() {
  const queries: { sql: string; params: any[] }[] = [];
  return { queries, pool: { query: async (sql: string, params: any[]) => { queries.push({ sql, params }); return { rows: [{ id: 'cfg-1' }], rowCount: 1 }; } } as any };
}

beforeEach(() => {
  process.env.FACEBOOK_APP_ID = '123';
  process.env.FACEBOOK_APP_SECRET = 'segredo';
  process.env.META_ES_CONFIG_ID = '456';
});

describe('configuracaoCadastro', () => {
  it('indica o que falta configurar', () => {
    delete process.env.META_ES_CONFIG_ID;
    expect(configuracaoCadastro()).toMatchObject({ disponivel: false, faltando: ['META_ES_CONFIG_ID'] });
    process.env.META_ES_CONFIG_ID = '456';
    expect(configuracaoCadastro()).toMatchObject({ disponivel: true, appId: '123', configId: '456' });
  });
});

describe('concluirCadastro', () => {
  const dados = { code: 'CODE', waba_id: '111', phone_number_id: '222', business_id: '333' };

  it('número novo: token → webhook → número → registro com PIN, e salva a config', async () => {
    const { f, chamadas } = metaFalsa();
    const { pool, queries } = poolFalso();
    const r = await concluirCadastro(pool, 'user-1', dados, f);
    expect(r.erro).toBeUndefined();
    expect(r.configId).toBe('cfg-1');
    expect(r.etapas.map(e => e.etapa)).toEqual(['token', 'webhook', 'numero', 'registrar']);
    expect(r.etapas.every(e => e.ok)).toBe(true);
    const token = new URL(chamadas[0].url).searchParams;
    expect(token.get('client_id')).toBe('123');
    expect(token.get('client_secret')).toBe('segredo');
    expect(token.get('code')).toBe('CODE');
    expect(chamadas[1]).toMatchObject({ method: 'POST' });
    expect(chamadas[1].url).toMatch(/\/111\/subscribed_apps$/);
    const reg = chamadas.find(c => c.url.endsWith('/222/register'))!;
    expect(reg.body.messaging_product).toBe('whatsapp');
    expect(reg.body.pin).toMatch(/^\d{6}$/);
    const insert = queries.find(q => q.sql.includes('INSERT INTO whatsapp_oficial_config'))!;
    expect(insert.params[2]).toBe('222');
    expect(insert.params[7]).toBe(false); // coexistencia
    expect(insert.params[4]).not.toBe('TOKEN_CLIENTE'); // token criptografado
  });

  it('coexistência: não registra o número e dispara sincronização de contatos e histórico', async () => {
    const { f, chamadas } = metaFalsa();
    const { pool } = poolFalso();
    const r = await concluirCadastro(pool, 'user-1', { ...dados, coexistencia: true }, f);
    expect(r.etapas.map(e => e.etapa)).toEqual(['token', 'webhook', 'numero', 'sincronizar_contatos', 'sincronizar_historico']);
    expect(chamadas.some(c => c.url.endsWith('/register'))).toBe(false);
    const syncs = chamadas.filter(c => c.url.endsWith('/222/smb_app_data')).map(c => c.body.sync_type);
    expect(syncs).toEqual(['smb_app_state_sync', 'history']);
  });

  it('code expirado: erro claro e nada é salvo', async () => {
    const { f } = metaFalsa({ tokenOk: false });
    const { pool, queries } = poolFalso();
    const r = await concluirCadastro(pool, 'user-1', dados, f);
    expect(r.erro).toMatch(/30 s/);
    expect(queries.length).toBe(0);
  });

  it('dados incompletos ou servidor sem configuração são recusados', async () => {
    const { f } = metaFalsa();
    const { pool } = poolFalso();
    expect((await concluirCadastro(pool, 'u', { ...dados, waba_id: 'abc' }, f)).erro).toMatch(/incompletos/);
    delete process.env.FACEBOOK_APP_SECRET;
    expect((await concluirCadastro(pool, 'u', dados, f)).erro).toMatch(/FACEBOOK_APP_SECRET/);
  });

  it('PIN tem sempre 6 dígitos', () => {
    for (let i = 0; i < 200; i++) expect(gerarPin()).toMatch(/^\d{6}$/);
  });
});
