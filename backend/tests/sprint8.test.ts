import { describe, it, expect } from 'vitest';
import { avaliarElegibilidade } from '../src/utils/elegibilidade';
import { tratarLimiteConvite } from '../src/radar/validacao';

// Sprint 8 (2026-10-06): Sprint 4 / H5 (validação da lista) e H7 (Radar com proteção da instância).

const base = {
  id: 'c1', telefone: '5511999998888', telefone_normalizado: '5511999998888', tipo_telefone: 'celular',
  whatsapp_status: 'valido', opt_out: false, bot_detectado: false, resposta_categoria: null, resposta_em: null,
  ultimo_disparo_em: null, nome_confiavel: true, propensao: null,
};

describe('elegibilidade (H5)', () => {
  it('número de outro país sai só quando a pré-checagem bloqueia estrangeiros', () => {
    const gringo = { ...base, telefone: '14155552671', telefone_normalizado: '14155552671', tipo_telefone: 'internacional' };
    expect(avaliarElegibilidade(gringo, { bloquearEstrangeiros: true })).toBe('estrangeiro');
    expect(avaliarElegibilidade(gringo, {})).toBeNull(); // envio não muda campanha já criada
  });
  it('número brasileiro não é estrangeiro', () => {
    expect(avaliarElegibilidade(base, { bloquearEstrangeiros: true })).toBeNull();
  });
  it('contato pessoal (lista de ignorados da IA) não recebe campanha', () => {
    expect(avaliarElegibilidade({ ...base, pessoal: true })).toBe('pessoal');
  });
});

describe('tratarLimiteConvite (H7)', () => {
  function poolFalso(limites24h: number) {
    const sqls: { sql: string; params: any[] }[] = [];
    return {
      sqls,
      query: async (sql: string, params: any[] = []) => {
        sqls.push({ sql, params });
        if (sql.includes('FROM agentes')) return { rows: [{ n: '5511999990000' }] };
        if (sql.includes("tipo = 'rate_limit'")) return { rows: [{ n: limites24h }] };
        return { rows: [] };
      },
    } as any;
  }
  it('registra evento rate_limit e pausa 30 min no 1º 429', async () => {
    const pool = poolFalso(1);
    expect(await tratarLimiteConvite(pool, 'crm_prosp', 'Evolution limitou as requisições (429)')).toBe(30);
    expect(pool.sqls.some((s: any) => s.sql.includes('INSERT INTO whatsapp_eventos_saude') && s.params.includes('rate_limit'))).toBe(true);
    expect(pool.sqls.some((s: any) => s.sql.includes('INSERT INTO radar_pausas') && s.params[0] === 'convite:crm_prosp')).toBe(true);
  });
  it('backoff exponencial: 3º 429 em 24h pausa 2h; teto de 24h', async () => {
    expect(await tratarLimiteConvite(poolFalso(3), 'x', '429')).toBe(120);
    expect(await tratarLimiteConvite(poolFalso(20), 'x', '429')).toBe(24 * 60);
  });
});
