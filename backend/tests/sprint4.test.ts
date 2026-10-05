import { describe, it, expect } from 'vitest';
import { classificarFalha } from '../src/services/metricasDisparo';
import { textoDeRespostaAutomatica } from '../src/services/agentEngine';

// Sprint 4 (2026-10-05): classificação de falha da fila (H4) e detecção de resposta automática (H1).
describe('classificarFalha (H4)', () => {
  it('Connection Closed é instância caída, não culpa do contato', () => {
    expect(classificarFalha(500, 'Evolution API 500: {"status":500,"response":{"message":"Connection Closed"}}')).toBe('instancia_caida');
  });
  it('erro de rede e 5xx genérico são instância caída', () => {
    expect(classificarFalha(undefined, 'fetch failed', 'ECONNREFUSED')).toBe('instancia_caida');
    expect(classificarFalha(503, 'Service Unavailable')).toBe('instancia_caida');
  });
  it('número sem WhatsApp é numero_invalido', () => {
    expect(classificarFalha(400, 'Evolution API 400: {"response":{"message":[{"exists":false,"jid":"5562...@s.whatsapp.net"}]}}')).toBe('numero_invalido');
  });
  it('403/429 é restrição', () => {
    expect(classificarFalha(403, 'forbidden')).toBe('restricao');
    expect(classificarFalha(429, 'rate-overlimit')).toBe('restricao');
  });
  it('resto é erro desconhecido', () => {
    expect(classificarFalha(400, 'Bad Request: invalid payload')).toBe('erro_desconhecido');
  });
});

describe('resposta automática de outra empresa (H1)', () => {
  it.each([
    'Olá! Esta é uma mensagem automática. Em breve retornaremos.',
    'A Pizzaria Bella agradece seu contato! Digite o número da opção desejada:',
    'No momento não estamos disponíveis. Nosso horário de atendimento é de 9h às 18h.',
    'Obrigado por entrar em contato com a Central dos Planos.',
    'Você está fora do horário de atendimento.',
  ])('detecta robô: "%s"', t => expect(textoDeRespostaAutomatica(t)).toBe(true));
  it.each([
    'qual o horário de atendimento de vocês?', 'Bom dia, tudo bem?', 'obrigado pelo retorno!',
    'vocês abrem sábado?', '', 'quero saber o preço',
  ])('cliente real não é robô: "%s"', t => expect(textoDeRespostaAutomatica(t)).toBe(false));
});
