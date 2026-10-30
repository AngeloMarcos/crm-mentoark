/**
 * Integrações num lugar só (2026-10-29, modelo Cubo): modelos ao vivo da chave, status da chave,
 * parâmetros de modelos de raciocínio.
 */
import { describe, it, expect } from 'vitest';
import { ehModeloDeChat, listarModelosIA, baseUrlDoTipo } from '../src/services/integracoesIA';
import { modeloDeRaciocinio } from '../src/services/providers/index';
import { statusIA } from '../src/routes/integracoesHub';

const resposta = (status: number, json: unknown) =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(json) } as Response);

describe('modelos de chat', () => {
  it('OpenAI: só modelos de conversa', () => {
    expect(ehModeloDeChat('openai', 'gpt-4o-mini')).toBe(true);
    expect(ehModeloDeChat('openai', 'gpt-5-nano')).toBe(true);
    expect(ehModeloDeChat('openai', 'o3-mini')).toBe(true);
    expect(ehModeloDeChat('openai', 'text-embedding-3-large')).toBe(false);
    expect(ehModeloDeChat('openai', 'whisper-1')).toBe(false);
    expect(ehModeloDeChat('openai', 'gpt-4o-realtime-preview')).toBe(false);
    expect(ehModeloDeChat('openai', 'gpt-image-1')).toBe(false);
  });
});

describe('modelo de raciocínio (recusa max_tokens/temperature)', () => {
  it('família gpt-5 e o-series sim; gpt-4o não', () => {
    expect(modeloDeRaciocinio('gpt-5-nano')).toBe(true);
    expect(modeloDeRaciocinio('o4-mini')).toBe(true);
    expect(modeloDeRaciocinio('openai/gpt-5')).toBe(true);
    expect(modeloDeRaciocinio('gpt-4o-mini')).toBe(false);
    expect(modeloDeRaciocinio('gpt-4.1-mini')).toBe(false);
  });
});

describe('listarModelosIA', () => {
  it('chave válida: lista filtrada e ordenada', async () => {
    const f = (() => resposta(200, { data: [{ id: 'whisper-1' }, { id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] })) as unknown as typeof fetch;
    const r = await listarModelosIA('openai', 'sk-x', null, f);
    expect(r.ok).toBe(true);
    expect(r.modelos.map(m => m.id)).toEqual(['gpt-4o', 'gpt-4o-mini']);
  });

  it('chave recusada: motivo legível, sem modelos', async () => {
    const f = (() => resposta(401, { error: { message: 'Incorrect API key' } })) as unknown as typeof fetch;
    const r = await listarModelosIA('openai', 'sk-x', null, f);
    expect(r.ok).toBe(false);
    expect(r.erro).toContain('Chave recusada');
    expect(r.modelos).toEqual([]);
  });

  it('Gemini usa o endpoint compatível', async () => {
    let url = '';
    const f = ((u: string) => { url = u; return resposta(200, { data: [{ id: 'models/gemini-2.5-flash' }, { id: 'models/text-embedding-004' }] }); }) as unknown as typeof fetch;
    const r = await listarModelosIA('gemini', 'AIza', null, f);
    expect(url).toBe(`${baseUrlDoTipo('gemini')!.replace(/\/$/, '')}/models`);
    expect(r.modelos.map(m => m.id)).toEqual(['gemini-2.5-flash']);
  });
});

describe('statusIA', () => {
  const base = { ativo: true, ultimo_status: null, ultimo_erro: null, ultimo_teste_em: null };
  it('desligada, recusada, válida, não testada', () => {
    expect(statusIA({ ...base, ativo: false }).status).toBe('desligada');
    expect(statusIA({ ...base, ultimo_status: 'erro', ultimo_erro: 'Chave recusada' })).toEqual({ status: 'erro', detalhe: 'Chave recusada' });
    expect(statusIA({ ...base, ultimo_status: 'ok' }).status).toBe('ok');
    expect(statusIA(base).status).toBe('atencao');
  });
});
