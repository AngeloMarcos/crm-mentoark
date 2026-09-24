import { describe, it, expect } from 'vitest';
import { normalizarTelefone } from '../src/utils/telefone';
import { limparNome, primeiroNomeDe, resolverNome } from '../src/utils/nomes';

describe('normalizarTelefone', () => {
  it('celular com DDI e formatação', () => {
    const r = normalizarTelefone('+55 (11) 98765-4321');
    expect(r.tipo).toBe('celular');
    expect(r.normalizado).toBe('5511987654321');
    expect(r.ddd).toBe('11');
  });

  it('celular sem DDI recebe 55', () => {
    expect(normalizarTelefone('11987654321').normalizado).toBe('5511987654321');
  });

  it('zeros à esquerda e prefixo 00', () => {
    expect(normalizarTelefone('011987654321').normalizado).toBe('5511987654321');
    expect(normalizarTelefone('0055 11 98765-4321').normalizado).toBe('5511987654321');
  });

  it('celular antigo de 8 dígitos ganha o 9', () => {
    const r = normalizarTelefone('551187654321');
    expect(r.tipo).toBe('celular');
    expect(r.normalizado).toBe('5511987654321');
    expect(r.motivo).toBe('9º dígito inserido');
  });

  it('fixo é classificado e mantido com 12 dígitos', () => {
    const r = normalizarTelefone('(11) 3456-7890');
    expect(r.tipo).toBe('fixo');
    expect(r.normalizado).toBe('551134567890');
  });

  it('DDD inexistente é inválido', () => {
    expect(normalizarTelefone('10987654321').tipo).toBe('invalido');
    expect(normalizarTelefone('5520987654321').tipo).toBe('invalido'); // DDD 20 não existe
  });

  it('vazio, lixo e IDs longos (grupo/LID) são inválidos', () => {
    expect(normalizarTelefone('').tipo).toBe('invalido');
    expect(normalizarTelefone(null).tipo).toBe('invalido');
    expect(normalizarTelefone('abc').tipo).toBe('invalido');
    expect(normalizarTelefone('120363394306111833').tipo).toBe('invalido');
    expect(normalizarTelefone('5511952927886-1398018374').tipo).toBe('invalido');
  });

  it('número sem DDD é inválido', () => {
    expect(normalizarTelefone('987654321').tipo).toBe('invalido');
  });

  it('internacional (não-BR) é reconhecido', () => {
    const r = normalizarTelefone('+351 912 345 678');
    expect(r.tipo).toBe('internacional');
    expect(r.normalizado).toBe('351912345678');
  });

  it('é idempotente sobre o próprio resultado', () => {
    const a = normalizarTelefone('(21) 99876-5432');
    const b = normalizarTelefone(a.normalizado);
    expect(b.normalizado).toBe(a.normalizado);
    expect(b.tipo).toBe('celular');
  });

  it('mesmo número em formatos diferentes converge para a mesma chave', () => {
    const formatos = ['11 98765-4321', '(11)987654321', '+5511987654321', '5511987654321', '011 98765 4321'];
    const chaves = new Set(formatos.map(f => normalizarTelefone(f).normalizado));
    expect(chaves.size).toBe(1);
  });
});

describe('limparNome', () => {
  it('remove emojis e decorações', () => {
    expect(limparNome('💢 João Silva ✨')).toBe('João Silva');
    expect(limparNome('• Maria • Souza')).toBe('Maria Souza');
  });

  it('capitaliza só quando tudo é maiúsculo ou minúsculo', () => {
    expect(limparNome('MARIA DA SILVA')).toBe('Maria da Silva');
    expect(limparNome('joão pedro')).toBe('João Pedro');
    expect(limparNome('Gomes Cell Vip')).toBe('Gomes Cell Vip');
  });

  it('rejeita telefone, vazio e genéricos', () => {
    expect(limparNome('5511987654321')).toBeNull();
    expect(limparNome('+55 11 98765-4321')).toBeNull();
    expect(limparNome('   ')).toBeNull();
    expect(limparNome('😀😀')).toBeNull();
    expect(limparNome('Contato')).toBeNull();
    expect(limparNome('A')).toBeNull();
  });

  it('rejeita nome igual ao telefone do contato', () => {
    expect(limparNome('987654', '55987654')).toBeNull();
  });
});

describe('primeiroNomeDe / resolverNome', () => {
  it('ignora título', () => {
    expect(primeiroNomeDe('Dra. Ana Paula')).toBe('Ana');
  });

  it('usa push_name quando o nome é só o número', () => {
    const r = resolverNome('5511987654321', '✨ Carlos Eduardo ✨', '5511987654321');
    expect(r.confiavel).toBe(true);
    expect(r.primeiroNome).toBe('Carlos');
  });

  it('sem nome real: não confiável e primeiro_nome nulo (nunca o telefone)', () => {
    const r = resolverNome('5511987654321', null, '5511987654321');
    expect(r).toEqual({ nome: null, primeiroNome: null, confiavel: false });
  });

  it('prefere o nome cadastrado ao push_name', () => {
    const r = resolverNome('Roberto Lima', 'Beto', '5511999999999');
    expect(r.primeiroNome).toBe('Roberto');
  });
});
