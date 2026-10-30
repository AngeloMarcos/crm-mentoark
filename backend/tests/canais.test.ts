/**
 * Canais (2026-10-30, modelo Cubo): número QR Code atendido pelo cérebro de outro agente.
 */
import { describe, it, expect } from 'vitest';
import { aplicarCerebro } from '../src/services/canais';

describe('aplicarCerebro', () => {
  const numero = {
    id: 'num-1', nome: 'Conexão WhatsApp', prompt_sistema: '', modelo: 'gpt-4o-mini',
    evolution_instancia: 'crm_abc_1', evolution_server_url: 'https://evo', evolution_api_key: 'k1',
    papel: 'comercial', numero_conectado: '5511999990000',
  };
  const cerebro = {
    id: 'ag-stella', nome: 'Stella', prompt_sistema: 'Você é a Stella', modelo: 'gpt-5-nano', provider_id: 'p1',
    evolution_instancia: 'outra', evolution_server_url: 'https://outra', evolution_api_key: 'k2',
    papel: null, numero_conectado: '5511888880000',
  };

  it('cérebro do agente escolhido, transporte do número', () => {
    const r = aplicarCerebro(numero, cerebro);
    expect(r.prompt_sistema).toBe('Você é a Stella');
    expect(r.modelo).toBe('gpt-5-nano');
    expect(r.provider_id).toBe('p1');
    expect(r.evolution_instancia).toBe('crm_abc_1');
    expect(r.evolution_api_key).toBe('k1');
    expect(r.numero_conectado).toBe('5511999990000');
    expect(r.papel).toBe('comercial');
  });

  it('execuções contam para o agente que respondeu, guardando o número de origem', () => {
    const r = aplicarCerebro(numero, cerebro) as any;
    expect(r.id).toBe('ag-stella');
    expect(r.numero_agente_id).toBe('num-1');
  });
});
