import { describe, it, expect } from 'vitest';
import { garantirDonoDaInstancia, idCombinaComPrefixo, prefixoDoDono } from '../src/services/tenantInstancia';

const MENTOARK = '435ee472-0fc3-4015-995a-ae6e1c80606d';
const GMAIL = '5319f0ed-61b3-4232-80e1-f236bb751e49';
const MEMBRO_DA_MENTOARK = 'aaaaaaaa-0000-4000-8000-000000000001';

/** Pool falso: devolve os donos possíveis para o prefixo consultado. */
const poolCom = (donos: Record<string, string[]>) => ({
  query: async (_sql: string, params: string[]) => {
    const pref = String(params[0]).replace('%', '');
    return { rows: (donos[pref] ?? []).map(id => ({ id })) };
  },
}) as any;

const donoDaConta = (mapa: Record<string, string> = {}) => async (id: string) => mapa[id] ?? id;

describe('prefixoDoDono', () => {
  it('reconhece o padrão da plataforma, com ou sem sufixo numérico', () => {
    expect(prefixoDoDono('crm_5319f0ed61b3')).toBe('5319f0ed61b3');
    expect(prefixoDoDono('crm_5319f0ed61b3_2')).toBe('5319f0ed61b3');
    expect(prefixoDoDono('CRM_435EE4720FC3_3')).toBe('435ee4720fc3');
  });
  it('nomes livres ou malformados não têm dono por prefixo', () => {
    for (const n of ['Mento 2', 'crm_123', 'crm_zzzzzzzzzzzz', 'minha_instancia', '', null, undefined, 'crm_5319f0ed61b3_x', 'x_crm_5319f0ed61b3']) {
      expect(prefixoDoDono(n as any), String(n)).toBeNull();
    }
  });
  it('casa o id com o prefixo ignorando hífen e caixa', () => {
    expect(idCombinaComPrefixo(GMAIL, '5319f0ed61b3')).toBe(true);
    expect(idCombinaComPrefixo(MENTOARK, '5319f0ed61b3')).toBe(false);
    expect(idCombinaComPrefixo(null, '5319f0ed61b3')).toBe(false);
  });
});

describe('garantirDonoDaInstancia (isolamento entre contas)', () => {
  const pool = poolCom({ '5319f0ed61b3': [GMAIL], '435ee4720fc3': [MENTOARK] });

  it('o caso real: agentes apontou a instância da conta gmail para a Mentoark → volta para a gmail', async () => {
    const r = await garantirDonoDaInstancia(pool, 'crm_5319f0ed61b3', MENTOARK, donoDaConta());
    expect(r).toEqual({ userId: GMAIL, corrigido: true, donoDaInstancia: GMAIL });
  });
  it('resolução correta não é tocada', async () => {
    const r = await garantirDonoDaInstancia(pool, 'crm_5319f0ed61b3_2', GMAIL, donoDaConta());
    expect(r).toEqual({ userId: GMAIL, corrigido: false, donoDaInstancia: GMAIL });
  });
  it('membro de equipe do dono continua valendo (compara pela conta raiz)', async () => {
    const r = await garantirDonoDaInstancia(pool, 'crm_435ee4720fc3', MEMBRO_DA_MENTOARK, donoDaConta({ [MEMBRO_DA_MENTOARK]: MENTOARK }));
    expect(r.corrigido).toBe(false);
    expect(r.userId).toBe(MEMBRO_DA_MENTOARK);
  });
  it('membro de OUTRA conta não passa', async () => {
    const r = await garantirDonoDaInstancia(pool, 'crm_5319f0ed61b3', MEMBRO_DA_MENTOARK, donoDaConta({ [MEMBRO_DA_MENTOARK]: MENTOARK }));
    expect(r.corrigido).toBe(true);
    expect(r.userId).toBe(GMAIL);
  });
  it('nome fora do padrão: nada é alterado', async () => {
    const r = await garantirDonoDaInstancia(pool, 'Mento 2', MENTOARK, donoDaConta());
    expect(r).toEqual({ userId: MENTOARK, corrigido: false, donoDaInstancia: null });
  });
  it('prefixo sem dono ou ambíguo: não "corrige" ninguém', async () => {
    const semDono = await garantirDonoDaInstancia(poolCom({}), 'crm_5319f0ed61b3', MENTOARK, donoDaConta());
    expect(semDono.corrigido).toBe(false);
    const ambiguo = await garantirDonoDaInstancia(poolCom({ '5319f0ed61b3': [GMAIL, MENTOARK] }), 'crm_5319f0ed61b3', MENTOARK, donoDaConta());
    expect(ambiguo.corrigido).toBe(false);
  });
  it('falha de banco não derruba nem troca o usuário', async () => {
    const quebrado = { query: async () => { throw new Error('db off'); } } as any;
    const r = await garantirDonoDaInstancia(quebrado, 'crm_5319f0ed61b3', MENTOARK, donoDaConta());
    expect(r).toEqual({ userId: MENTOARK, corrigido: false, donoDaInstancia: null });
  });
});
