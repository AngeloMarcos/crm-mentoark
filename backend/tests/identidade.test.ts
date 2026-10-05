import { describe, it, expect } from 'vitest';
import { extrairIdentidades, destinoEnvio, lembrarDestinoLid, jidConversa } from '../src/services/identidadeContato';
import { avaliarElegibilidade } from '../src/utils/elegibilidade';

// Sprint 3 / H1 e H7 (2026-10-05): identidade por LID e regras novas de elegibilidade.
describe('extrairIdentidades (payload Evolution/Baileys)', () => {
  it('LID com telefone real em remoteJidAlt', () => {
    expect(extrairIdentidades({ remoteJid: '96645555474650@lid', remoteJidAlt: '5511991909106@s.whatsapp.net' }))
      .toEqual({ lid: '96645555474650', telefone: '5511991909106' });
  });
  it('LID sem telefone', () => {
    expect(extrairIdentidades({ remoteJid: '96645555474650@lid' })).toEqual({ lid: '96645555474650', telefone: null });
  });
  it('telefone com LID em remoteJidAlt', () => {
    expect(extrairIdentidades({ remoteJid: '5511991909106@s.whatsapp.net', remoteJidAlt: '96645555474650@lid' }))
      .toEqual({ telefone: '5511991909106', lid: '96645555474650' });
  });
  it('senderPn também serve como telefone do LID', () => {
    expect(extrairIdentidades({ remoteJid: '1234567890123@lid', senderPn: '5521999998888@s.whatsapp.net' }).telefone).toBe('5521999998888');
  });
  it('grupo não gera identidade 1:1', () => {
    expect(extrairIdentidades({ remoteJid: '120363428155111167@g.us' })).toEqual({ telefone: null, lid: null });
  });
});

describe('destino de envio para contato só-LID', () => {
  it('responde pelo JID @lid quando lembrado, senão pelo telefone', () => {
    lembrarDestinoLid('77777777777777', '77777777777777@lid');
    expect(destinoEnvio('77777777777777')).toBe('77777777777777@lid');
    expect(destinoEnvio('5511999990000')).toBe('5511999990000');
    expect(jidConversa('77777777777777')).toBe('77777777777777@lid');
    expect(jidConversa('5511999990000')).toBe('5511999990000@s.whatsapp.net');
  });
});

const base = {
  id: 'x', telefone: '5511999990000', telefone_normalizado: null, tipo_telefone: 'celular', whatsapp_status: null,
  opt_out: false, bot_detectado: false, resposta_categoria: null, resposta_em: null, ultimo_disparo_em: null,
  nome_confiavel: true, propensao: null,
};

describe('elegibilidade — regras da Sprint 3', () => {
  it('contato só-LID não recebe disparo', () => {
    expect(avaliarElegibilidade({ ...base, telefone: '96645555474650', tipo_telefone: 'lid' })).toBe('grupo_ou_lid');
  });
  it('contato frio sai só quando "somente conhecidos" está ligado', () => {
    expect(avaliarElegibilidade({ ...base, conhecido: false })).toBeNull();
    expect(avaliarElegibilidade({ ...base, conhecido: false }, { somenteConhecidos: true })).toBe('contato_frio');
    expect(avaliarElegibilidade({ ...base, conhecido: true }, { somenteConhecidos: true })).toBeNull();
    expect(avaliarElegibilidade({ ...base }, { somenteConhecidos: true })).toBeNull(); // não avaliado
  });
});

import { pediuAtendenteHumano } from '../src/services/agentEngine';

describe('passagem para humano (H9)', () => {
  it.each([
    'quero falar com um atendente', 'Falar com atendente', 'atendente', 'Atendente!', 'humano',
    'posso conversar com uma pessoa?', 'não quero falar com robô', 'quero falar com o corretor',
  ])('detecta pedido: "%s"', t => expect(pediuAtendenteHumano(t)).toBe(true));
  it.each([
    'qual o preço do apartamento?', 'o atendente de ontem foi ótimo, quero agendar visita para sábado de manhã',
    'bom dia', '', 'tem algum humano que trabalha aí no sábado? queria saber o horário de funcionamento da loja e se aceitam cartão',
  ])('não detecta: "%s"', t => expect(pediuAtendenteHumano(t)).toBe(false));
});
