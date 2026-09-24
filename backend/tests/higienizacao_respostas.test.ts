import { describe, it, expect } from 'vitest';
import { ehOptOutProvavel, ehPedidoDeOptOut } from '../src/utils/optout';
import { classificarResposta } from '../src/utils/respostas';
import { avaliarElegibilidade, montarRecorte, ContatoParaChecagem } from '../src/utils/elegibilidade';
import { construirModelo, MINIMO_AMOSTRAS, prever, segmentoDe } from '../src/utils/propensao';

describe('opt-out por intenção (porte Deskcomm)', () => {
  it('pedidos inequívocos', () => {
    for (const t of ['não quero mais receber', 'Pare de me mandar mensagem', 'SAIR', 'stop.', 'me tira da lista', 'quero me descadastrar', 'não me mande mais']) {
      expect(ehPedidoDeOptOut(t), t).toBe(true);
    }
  });
  it('NÃO é opt-out: vocabulário do dia a dia e troca de assunto', () => {
    for (const t of ['posso sair antes das 15h?', 'tem como parar a dor?', 'preciso sair mais cedo', 'não quero receber ligação, só whatsapp',
      'pare de mandar o pedido nesse endereço', 'não me mande mais boletos', 'quero sair do grupo do trabalho']) {
      expect(ehPedidoDeOptOut(t), t).toBe(false);
    }
  });
  it('ambíguo só vira "provável", nunca inequívoco', () => {
    expect(ehPedidoDeOptOut('me deixa em paz')).toBe(false);
    expect(ehOptOutProvavel('me deixa em paz')).toBe(true);
    expect(ehOptOutProvavel('oi, tudo bem?')).toBe(false);
    expect(ehOptOutProvavel(null)).toBe(false);
  });
});

describe('classificarResposta (frases reais de produção, sem dados pessoais)', () => {
  const cat = (t: string) => classificarResposta(t).categoria;

  it('interesse', () => {
    for (const t of ['quero', 'Pode mostrar', 'Gostaria de conhecer melhor', 'quanto custa?', 'explica', 'me explica melhor', 'como funciona', 'me manda a proposta', 'tenho interesse sim']) {
      expect(cat(t), t).toBe('interesse');
    }
  });
  it('recusa: "tenho interesse" dentro de "não tenho interesse" NÃO é interesse', () => {
    for (const t of ['Obrigado! No momento não tenho interesse', 'Olá obrigada, mas nesse momento não preciso', 'não quero', 'sem interesse', 'não me interessa']) {
      expect(cat(t), t).toBe('negativa');
    }
  });
  it('opt_out explícito', () => {
    expect(cat('não quero mais receber')).toBe('opt_out');
    expect(cat('sair')).toBe('opt_out');
    expect(cat('posso sair antes das 15h?')).not.toBe('opt_out');
  });
  it('robôs/atendimento automático', () => {
    for (const t of [
      'Olá 👋 Dantec agradece por sua mensagem, assim que possível entraremos em contato!',
      '‎Streaming agradece seu contato. Como podemos ajudar?',
      'PG Missaglia Social Media Olá seja bem-vindo (a) No que posso ajudar?',
      'Olá! Já recebemos sua solicitação ✅ Em instantes uma de nossas atendentes vai te chamar.',
      'Agradecemos seu contato. Como podemos ajudar?',
      'Olá! Obrigada pelo contato. No momento posso estar em atendimento, mas retornarei assim que possível.',
      'Para agilizar seu atendimento, digite o número da opção desejada',
      'Nosso horário de atendimento é de segunda a sexta',
      '👋Olá !! estamos muito felizes com o seu contato 🛍️ Produtos e Serviços',
    ]) expect(cat(t), t).toBe('auto_resposta');
  });
  it('robô que menciona "gostaria de conhecer" continua sendo robô (não interesse)', () => {
    expect(cat('Olá! Seja bem-vindo! Gostaria de conhecer nossos serviços? Digite 1 para saber mais')).toBe('auto_resposta');
  });
  it('neutras', () => {
    for (const t of ['Oie', '?', 'Boa tarde', 'Isso é passado', 'Encaminhe para o Paulo 11 99855-6672', '']) {
      expect(cat(t), t).toBe('outra');
    }
  });
});

const base = (o: Partial<ContatoParaChecagem> = {}): ContatoParaChecagem => ({
  id: 'x', telefone: '5511987654321', telefone_normalizado: '5511987654321', tipo_telefone: 'celular',
  whatsapp_status: 'pendente', opt_out: false, bot_detectado: false, resposta_categoria: null, resposta_em: null,
  ultimo_disparo_em: null, nome_confiavel: true, propensao: null, ...o,
});

describe('avaliarElegibilidade', () => {
  const agora = new Date('2026-09-24T12:00:00Z');
  it('contato normal é elegível', () => { expect(avaliarElegibilidade(base(), { agora })).toBeNull(); });
  it('cada motivo, na ordem de precedência', () => {
    expect(avaliarElegibilidade(base({ telefone: '', telefone_normalizado: null }), { agora })).toBe('sem_telefone');
    expect(avaliarElegibilidade(base({ tipo_telefone: 'fixo' }), { agora })).toBe('telefone_invalido');
    expect(avaliarElegibilidade(base({ telefone_normalizado: '72580803362944771' }), { agora })).toBe('grupo_ou_lid');
    expect(avaliarElegibilidade(base({ opt_out: true }), { agora })).toBe('opt_out');
    expect(avaliarElegibilidade(base({ resposta_categoria: 'opt_out' }), { agora })).toBe('opt_out');
    expect(avaliarElegibilidade(base({ bot_detectado: true }), { agora })).toBe('robo');
    expect(avaliarElegibilidade(base({ whatsapp_status: 'sem_whatsapp' }), { agora })).toBe('sem_whatsapp');
  });
  it('recusa suprime por 90 dias e depois volta', () => {
    const recente = base({ resposta_categoria: 'negativa', resposta_em: '2026-08-01T12:00:00Z' });
    const antiga = base({ resposta_categoria: 'negativa', resposta_em: '2026-05-01T12:00:00Z' });
    expect(avaliarElegibilidade(recente, { agora })).toBe('resposta_negativa');
    expect(avaliarElegibilidade(antiga, { agora })).toBeNull();
    expect(avaliarElegibilidade(base({ resposta_categoria: 'negativa', resposta_em: null }), { agora })).toBe('resposta_negativa');
  });
  it('robô pode ser liberado; cooldown e sem nome são opcionais', () => {
    expect(avaliarElegibilidade(base({ bot_detectado: true }), { agora, excluirRobos: false })).toBeNull();
    const recente = base({ ultimo_disparo_em: '2026-09-24T06:00:00Z' });
    expect(avaliarElegibilidade(recente, { agora, cooldownHoras: 24 })).toBe('cooldown');
    expect(avaliarElegibilidade(recente, { agora, cooldownHoras: 0 })).toBeNull();
    expect(avaliarElegibilidade(base({ nome_confiavel: false }), { agora })).toBeNull();
    expect(avaliarElegibilidade(base({ nome_confiavel: false }), { agora, excluirSemNome: true })).toBe('sem_nome');
  });
});

describe('montarRecorte', () => {
  it('conta motivos e ordena elegíveis por propensão (sem histórico por último, estável)', () => {
    const r = montarRecorte([
      base({ id: 'a', propensao: null }), base({ id: 'b', propensao: '12.5' }), base({ id: 'c', opt_out: true }),
      base({ id: 'd', propensao: 20 }), base({ id: 'e', bot_detectado: true }), base({ id: 'f', propensao: 12.5 }),
    ]);
    expect(r.total).toBe(6);
    expect(r.elegiveis.map(c => c.id)).toEqual(['d', 'b', 'f', 'a']);
    expect(r.excluidos).toEqual({ opt_out: 1, robo: 1 });
  });
});

describe('propensão (média suavizada)', () => {
  const amostras = (origem: string, nomeReal: boolean, n: number, resp: number) =>
    Array.from({ length: n }, (_, i) => ({ origem, nomeReal, respondeuHumano: i < resp }));

  it('segmentos e origem', () => {
    expect(segmentoDe('Grupo WhatsApp', true)).toBe('grupo|nome');
    expect(segmentoDe('Importado (Disparos)', false)).toBe('importado|sem_nome');
    expect(segmentoDe(null, true)).toBe('outro|nome');
  });
  it('sem amostra suficiente não inventa nota', () => {
    const m = construirModelo(amostras('Grupo WhatsApp', true, MINIMO_AMOSTRAS - 1, 3));
    expect(prever(m, 'Grupo WhatsApp', true)).toBeNull();
  });
  it('segmento melhor recebe nota maior; poucas amostras puxam para a média global', () => {
    const m = construirModelo([
      ...amostras('Grupo WhatsApp', true, 100, 20),     // 20%
      ...amostras('Grupo WhatsApp', false, 100, 5),     // 5%
      ...amostras('Importado', true, 3, 3),             // 3 amostras, 100% — não pode virar 100%
    ]);
    const a = prever(m, 'Grupo WhatsApp', true)!;
    const b = prever(m, 'Grupo WhatsApp', false)!;
    const c = prever(m, 'Importado', true)!;
    expect(a).toBeGreaterThan(b);
    expect(c).toBeLessThan(0.3);
    expect(c).toBeGreaterThan(m.taxaGlobal);
  });
  it('segmento nunca visto usa a taxa global', () => {
    const m = construirModelo(amostras('Grupo WhatsApp', true, 60, 6));
    expect(prever(m, 'Manual', false)).toBeCloseTo(m.taxaGlobal, 5);
  });
});
