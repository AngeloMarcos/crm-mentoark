import { describe, it, expect, vi, beforeEach } from 'vitest';

// Sprint 7 (2026-10-06): H6 (perfil do negócio, registro), H7 (Marketing Messages API) e a
// segunda trava de escopo da IA no número oficial.

const chamadas: { path: string; body: any }[] = [];
vi.mock('../src/services/metaCloudApi', async (orig) => {
  const real: any = await orig();
  return {
    ...real,
    graphFetch: vi.fn(async (_cfg: any, path: string, opts: any = {}) => {
      chamadas.push({ path, body: opts.body });
      return { ok: true, data: { messages: [{ id: 'wamid.TESTE' }] } };
    }),
  };
});

import { validarPerfil, rotulosRegistro } from '../src/routes/metaOficial';
import { processarEnvioOficial } from '../src/services/disparoOficial';
import { ehInstanciaOficial } from '../src/services/agentEngine';

describe('validarPerfil (H6)', () => {
  it('aceita campos dentro dos limites e só envia o que veio', () => {
    const v = validarPerfil({ about: 'Atendimento das 9h às 18h', websites: ['https://mentoark.com.br'], vertical: 'PROF_SERVICES' });
    expect(v.erro).toBeUndefined();
    expect(v.perfil).toEqual({ about: 'Atendimento das 9h às 18h', websites: ['https://mentoark.com.br'], vertical: 'PROF_SERVICES' });
  });
  it('recusa recado longo, e-mail inválido, 3 sites, site sem http e setor inexistente', () => {
    expect(validarPerfil({ about: 'x'.repeat(140) }).erro).toMatch(/139/);
    expect(validarPerfil({ email: 'nao-e-email' }).erro).toMatch(/E-mail/);
    expect(validarPerfil({ websites: ['https://a.com', 'https://b.com', 'https://c.com'] }).erro).toMatch(/2 sites/);
    expect(validarPerfil({ websites: ['mentoark.com.br'] }).erro).toMatch(/http/);
    expect(validarPerfil({ vertical: 'CASSINO' }).erro).toMatch(/Setor/);
  });
});

describe('rotulosRegistro (H6)', () => {
  it('traduz plataforma e status do nome', () => {
    expect(rotulosRegistro({ platform_type: 'CLOUD_API', name_status: 'APPROVED' })).toEqual({ nome_status_pt: 'Nome aprovado', registro_pt: 'Registrado na Cloud API' });
    expect(rotulosRegistro({ platform_type: 'NOT_APPLICABLE', name_status: 'PENDING_REVIEW' }).registro_pt).toMatch(/não registrado/);
  });
});

describe('ehInstanciaOficial', () => {
  it('reconhece só o prefixo do número oficial', () => {
    expect(ehInstanciaOficial('meta_oficial:123')).toBe(true);
    expect(ehInstanciaOficial('crm_435ee4720fc3')).toBe(false);
    expect(ehInstanciaOficial(null)).toBe(false);
  });
});

/** Pool falso para o envio oficial: config, template, contato com opt-in; o resto vazio. */
function poolEnvio(cfg: any, categoria: string) {
  const sqls: { sql: string; params: any[] }[] = [];
  return {
    sqls,
    query: async (sql: string, params: any[] = []) => {
      sqls.push({ sql, params });
      if (sql.includes('FROM whatsapp_oficial_config WHERE id')) return { rows: [cfg] };
      if (sql.includes('FROM meta_templates')) return { rows: [{ status: 'APPROVED', categoria }] };
      if (sql.includes('FROM contatos WHERE user_id')) {
        return { rows: [{ id: 'c1', nome: 'Ana Souza', telefone: '5511999998888', tipo_telefone: 'celular', optin_origem: 'smart_link' }] };
      }
      return { rows: [], rowCount: 1 };
    },
  } as any;
}

describe('envio oficial pela Marketing Messages API (H7)', () => {
  const msg = { log_id: 'l1', disparo_id: 'd1', user_id: 'u1', telefone: '5511999998888' };
  const camp = { oficial_config_id: 'cfg1', meta_template_nome: 'promo', meta_template_idioma: 'pt_BR', meta_variaveis: { 1: 'primeiro_nome' } };
  const cfgBase = { id: 'cfg1', user_id: 'u1', ativo: true, phone_number_id: 'pn1', waba_id: 'w1', quality_rating: 'GREEN' };
  beforeEach(() => { chamadas.length = 0; });

  it('Marketing com a flag ligada sai por /marketing_messages e grava o endpoint', async () => {
    const pool = poolEnvio({ ...cfgBase, usar_mm_api: true }, 'MARKETING');
    await processarEnvioOficial(pool, msg, camp);
    expect(chamadas[0].path).toBe('pn1/marketing_messages');
    expect(chamadas[0].body.template.components[0].parameters[0].text).toBe('Ana');
    expect(pool.sqls.some((s: any) => s.sql.includes('meta_endpoint') && s.params.includes('marketing_messages'))).toBe(true);
  });
  it('flag desligada continua em /messages', async () => {
    await processarEnvioOficial(poolEnvio({ ...cfgBase, usar_mm_api: false }, 'MARKETING'), msg, camp);
    expect(chamadas[0].path).toBe('pn1/messages');
  });
  it('Utilidade nunca vai para /marketing_messages (a Meta recusa)', async () => {
    await processarEnvioOficial(poolEnvio({ ...cfgBase, usar_mm_api: true }, 'UTILITY'), msg, camp);
    expect(chamadas[0].path).toBe('pn1/messages');
  });
});
