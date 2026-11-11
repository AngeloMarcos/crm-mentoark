/**
 * Campos personalizados do contato (2026-11-11): chave, validação de valores por tipo e a
 * ferramenta da IA.
 */
import { describe, it, expect } from 'vitest';
import {
  gerarChave, chaveLivre, normalizarOpcoes, validarDefinicao, lerNumero, lerData, normalizarValor,
  prepararValores, formatarValor, montarCamposIA, decidirRegistroIA, type CampoPersonalizado,
} from '../src/services/camposPersonalizados';

const campo = (tipo: CampoPersonalizado['tipo'], extra: Partial<CampoPersonalizado> = {}): CampoPersonalizado =>
  ({ id: 'c-' + tipo, nome: 'Campo ' + tipo, chave: tipo, tipo, opcoes: [], ...extra });

describe('chave do campo', () => {
  it('sai do nome, sem acento nem símbolo', () => {
    expect(gerarChave('Orçamento mensal (R$)')).toBe('orcamento_mensal_r');
    expect(gerarChave('  Cidade  ')).toBe('cidade');
    expect(gerarChave('2º contato')).toBe('campo_2_contato');
    expect(gerarChave('!!!')).toBe('campo');
  });
  it('não repete chave já usada', () => {
    expect(chaveLivre('cidade', [])).toBe('cidade');
    expect(chaveLivre('cidade', ['cidade', 'cidade_2'])).toBe('cidade_3');
  });
});

describe('definição', () => {
  it('opções: aparadas, sem vazias nem repetidas', () => {
    expect(normalizarOpcoes(['Casa', ' casa ', '', 'Apto'])).toEqual(['Casa', 'Apto']);
    expect(normalizarOpcoes('A\nB, C')).toEqual(['A', 'B', 'C']);
  });
  it('seleção sem opção é recusada; tipo desconhecido também', () => {
    expect(validarDefinicao({ nome: 'Imóvel', tipo: 'selecao', opcoes: [] }, false).ok).toBe(false);
    expect(validarDefinicao({ nome: 'X', tipo: 'cor' }, false).ok).toBe(false);
    expect(validarDefinicao({ tipo: 'texto' }, false).ok).toBe(false);
    const ok = validarDefinicao({ nome: 'Imóvel', tipo: 'selecao', opcoes: ['Casa'], ia_preenche: true }, false);
    expect(ok.ok && ok.dados).toMatchObject({ nome: 'Imóvel', tipo: 'selecao', opcoes: ['Casa'], ia_preenche: true });
  });
  it('edição parcial valida só o que veio', () => {
    const r = validarDefinicao({ descricao: 'Pergunte só se fizer sentido' }, true);
    expect(r.ok && r.dados).toEqual({ descricao: 'Pergunte só se fizer sentido' });
  });
});

describe('números e datas', () => {
  it('lê formatos brasileiros e por extenso curto', () => {
    expect(lerNumero('1.234,56')).toBe(1234.56);
    expect(lerNumero('1234.56')).toBe(1234.56);
    expect(lerNumero('1.234')).toBe(1234);
    expect(lerNumero('12,5')).toBe(12.5);
    expect(lerNumero('R$ 5 mil')).toBe(5000);
    expect(lerNumero('2,5k')).toBe(2500);
    expect(lerNumero('1,2 milhão')).toBe(1200000);
    expect(lerNumero(300)).toBe(300);
    expect(lerNumero('uns 300')).toBeNull();
  });
  it('datas válidas no calendário', () => {
    expect(lerData('11/11/2026')).toBe('2026-11-11');
    expect(lerData('5/3/26')).toBe('2026-03-05');
    expect(lerData('2026-02-28')).toBe('2026-02-28');
    expect(lerData('31/02/2026')).toBeNull();
    expect(lerData('amanhã')).toBeNull();
  });
});

describe('valor por tipo', () => {
  const sel = campo('selecao', { opcoes: ['Casa', 'Apartamento'] });
  const mult = campo('multipla', { opcoes: ['Manhã', 'Tarde', 'Noite'] });
  it('vazio apaga', () => {
    expect(normalizarValor(campo('texto'), '  ')).toEqual({ ok: true, valor: null });
    expect(normalizarValor(mult, [])).toEqual({ ok: true, valor: null });
  });
  it('seleção casa sem diferenciar maiúsculas e guarda a opção oficial', () => {
    expect(normalizarValor(sel, 'apartamento')).toEqual({ ok: true, valor: 'Apartamento' });
    expect(normalizarValor(sel, 'Terreno').ok).toBe(false);
  });
  it('múltipla aceita lista ou texto com vírgulas, sem repetir', () => {
    expect(normalizarValor(mult, 'manhã, noite, Manhã')).toEqual({ ok: true, valor: ['Manhã', 'Noite'] });
    expect(normalizarValor(mult, ['Tarde', 'Madrugada']).ok).toBe(false);
  });
  it('sim/não, moeda e data', () => {
    expect(normalizarValor(campo('sim_nao'), 'Não')).toEqual({ ok: true, valor: false });
    expect(normalizarValor(campo('sim_nao'), true)).toEqual({ ok: true, valor: true });
    expect(normalizarValor(campo('sim_nao'), 'talvez').ok).toBe(false);
    expect(normalizarValor(campo('moeda'), 'R$ 3.500,00')).toEqual({ ok: true, valor: 3500 });
    expect(normalizarValor(campo('data'), '01/12/2026')).toEqual({ ok: true, valor: '2026-12-01' });
  });
});

describe('lote de valores', () => {
  const campos = [campo('texto', { chave: 'cidade' }), campo('moeda', { chave: 'orcamento' })];
  it('separa o que gravar do que apagar', () => {
    expect(prepararValores(campos, { cidade: 'Santos', orcamento: '' })).toEqual({ ok: true, gravar: { cidade: 'Santos' }, apagar: ['orcamento'] });
  });
  it('chave desconhecida ou valor inválido recusa o lote inteiro', () => {
    expect(prepararValores(campos, { cidade: 'Santos', cor: 'azul' })).toMatchObject({ ok: false, code: 'unknown_custom_field', chave: 'cor' });
    expect(prepararValores(campos, { orcamento: 'caro' })).toMatchObject({ ok: false, code: 'invalid_value', chave: 'orcamento' });
  });
  it('formata para leitura', () => {
    expect(formatarValor({ tipo: 'data' }, '2026-12-01')).toBe('01/12/2026');
    expect(formatarValor({ tipo: 'sim_nao' }, false)).toBe('Não');
    expect(formatarValor({ tipo: 'multipla' }, ['A', 'B'])).toBe('A, B');
    expect(formatarValor({ tipo: 'moeda' }, 3500)).toMatch(/3\.500,00/);
  });
});

describe('IA', () => {
  const campos: CampoPersonalizado[] = [
    campo('moeda', { nome: 'Orçamento', chave: 'orcamento', ia_preenche: true, descricao: 'Quanto pode investir por mês.' }),
    campo('selecao', { nome: 'Imóvel', chave: 'imovel', opcoes: ['Casa', 'Apartamento'], ia_preenche: true }),
    campo('texto', { nome: 'CPF', chave: 'cpf' }),
    campo('texto', { nome: 'Antigo', chave: 'antigo', ia_preenche: true, ativo: false }),
  ];
  it('só oferece campos ativos liberados à IA, com o que já foi preenchido', () => {
    const r = montarCamposIA(campos, { orcamento: 2000 })!;
    expect(r.liberados.map(c => c.chave)).toEqual(['orcamento', 'imovel']);
    expect((r.ferramenta.input_schema.properties as any).campo.enum).toEqual(['Orçamento', 'Imóvel']);
    expect(r.instrucao).toMatch(/Orçamento .*já registrado: R\$\s?2\.000,00/);
    expect(r.instrucao).toMatch(/Imóvel .*ainda não informado.*Opções: Casa, Apartamento/);
    expect(r.instrucao).not.toMatch(/CPF|Antigo/);
  });
  it('nenhum campo liberado → sem ferramenta', () => {
    expect(montarCamposIA([campo('texto')], {})).toBeNull();
  });
  it('registro da IA: valida campo e valor', () => {
    const { liberados } = montarCamposIA(campos, {})!;
    expect(decidirRegistroIA(liberados, 'orçamento', 'uns 5 mil')).toMatchObject({ ok: false });
    expect(decidirRegistroIA(liberados, 'Orçamento', '5 mil')).toMatchObject({ ok: true, valor: 5000 });
    expect(decidirRegistroIA(liberados, 'CPF', '123')).toMatchObject({ ok: false, erro: 'campo não liberado para a IA.' });
    expect(decidirRegistroIA(liberados, 'Imóvel', 'casa')).toMatchObject({ ok: true, valor: 'Casa' });
  });
});
