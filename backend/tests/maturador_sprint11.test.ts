/**
 * Sprint 11 do maturador v5 (2026-10-23): grupos do aquecimento — limites de entrada, fase e cadastro.
 */
import { describe, it, expect } from 'vitest';
import {
  faseEntraEmGrupo, liberadoParaEntrar, adicionarGrupo, MAX_GRUPOS_POR_CONTA, MAX_ENTRADAS_DIA_CHIP,
} from '../src/services/maturadorGrupos';
import { estadoControles, CONTROLES_PADRAO } from '../src/services/maturadorControles';

const H = 3_600_000;

describe('faseEntraEmGrupo', () => {
  it('só a partir do Aquecimento 2', () => {
    for (const f of ['perfil', 'aquecimento_1', 'quarentena', 'banida', null]) expect(faseEntraEmGrupo(f as any)).toBe(false);
    for (const f of ['aquecimento_2', 'aquecimento_3', 'pre_oficial', 'madura']) expect(faseEntraEmGrupo(f)).toBe(true);
  });
  it('controle "Grupos" fica ativo a partir do Aquecimento 2', () => {
    expect(estadoControles(CONTROLES_PADRAO, { fase: 'aquecimento_1', so_recebe: 'x' }).grupos.ativo_agora).toBe(false);
    expect(estadoControles(CONTROLES_PADRAO, { fase: 'madura', so_recebe: null }).grupos.ativo_agora).toBe(true);
  });
});

describe('liberadoParaEntrar', () => {
  // Meio-dia de Brasília (15h UTC), para "hoje" não virar ontem/amanhã.
  const agora = Date.UTC(2026, 9, 23, 15, 0, 0);
  it('nunca entrou: liberado', () => {
    expect(liberadoParaEntrar([], agora)).toBe(true);
  });
  it('precisa de 2 h desde a última entrada', () => {
    expect(liberadoParaEntrar([{ em: new Date(agora - 1 * H) }], agora)).toBe(false);
    expect(liberadoParaEntrar([{ em: new Date(agora - 2.1 * H) }], agora)).toBe(true);
  });
  it(`no máximo ${MAX_ENTRADAS_DIA_CHIP} por dia`, () => {
    const duas = [{ em: new Date(agora - 3 * H) }, { em: new Date(agora - 2.5 * H) }];
    expect(liberadoParaEntrar(duas, agora)).toBe(false);
    // Entradas de ontem não contam para hoje.
    expect(liberadoParaEntrar([{ em: new Date(agora - 26 * H) }, { em: new Date(agora - 25 * H) }], agora)).toBe(true);
  });
});

describe('adicionarGrupo', () => {
  const poolCom = (total: number, inseriu = true) => ({
    query: async (sql: string) => sql.includes('COUNT') ? { rows: [{ n: total }] } : { rows: inseriu ? [{ id: 'g1' }] : [], rowCount: inseriu ? 1 : 0 },
  }) as any;
  it('aceita link completo e só o código', async () => {
    expect((await adicionarGrupo(poolCom(0), 'u', 'https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv')).grupo).toBeTruthy();
    expect((await adicionarGrupo(poolCom(0), 'u', 'AbCdEfGhIjKlMnOpQrStUv')).grupo).toBeTruthy();
  });
  it('recusa link inválido, limite de 5 e repetido', async () => {
    expect((await adicionarGrupo(poolCom(0), 'u', 'oi')).erro).toBeTruthy();
    expect((await adicionarGrupo(poolCom(MAX_GRUPOS_POR_CONTA), 'u', 'https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv')).erro).toMatch(/5/);
    expect((await adicionarGrupo(poolCom(1, false), 'u', 'https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv')).erro).toMatch(/já está/);
  });
});
