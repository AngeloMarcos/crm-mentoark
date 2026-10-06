import { describe, it, expect } from 'vitest';
import { motivoSoRecebe, papelGlobal, planejarVinculos, MAX_PARCEIROS, Participante } from '../src/services/maturadorGlobal';
import { validarProxy } from '../src/services/proxyInstancia';

// Sprint 9 (2026-10-06): Maturador Global — número novo NUNCA envia; rede pequena e estável.

const DIA = 86_400_000;
const agora = Date.UTC(2026, 9, 6, 15);
const base = { fase: 'madura', protecao_ate: null, protecao_liberada_em: null, bans_total: 0, primeira_conexao_em: new Date(agora - 90 * DIA) };

describe('motivoSoRecebe — número novo não envia nada', () => {
  it('número dentro do prazo de proteção só recebe', () => {
    expect(motivoSoRecebe({ ...base, fase: 'aquecimento_2', protecao_ate: new Date(agora + 5 * DIA) }, agora)).toMatch(/só recebe até/);
  });
  it('fases perfil e aquecimento_1 só recebem mesmo depois do prazo', () => {
    expect(motivoSoRecebe({ ...base, fase: 'perfil' }, agora)).toMatch(/só recebe/);
    expect(motivoSoRecebe({ ...base, fase: 'aquecimento_1' }, agora)).toMatch(/só recebe/);
  });
  it('quarentena, banido e conta em revisão não enviam', () => {
    expect(motivoSoRecebe({ ...base, fase: 'quarentena' }, agora)).toBeTruthy();
    expect(motivoSoRecebe({ ...base, fase: 'banida' }, agora)).toBeTruthy();
    expect(motivoSoRecebe({ ...base, em_revisao_desde: new Date(agora - DIA) }, agora)).toMatch(/revisão/);
  });
  it('número com ban no histórico só recebe nos primeiros 21 dias', () => {
    const recente = { ...base, fase: 'aquecimento_2', bans_total: 2, primeira_conexao_em: new Date(agora - 15 * DIA) };
    expect(motivoSoRecebe(recente, agora)).toMatch(/ban no histórico/);
    expect(motivoSoRecebe({ ...recente, primeira_conexao_em: new Date(agora - 30 * DIA) }, agora)).toBeNull();
  });
  it('caso real 11946650482: fase perfil, 2 bans, proteção até 18/10 → só recebe', () => {
    const n = { fase: 'perfil', protecao_ate: new Date(Date.UTC(2026, 9, 18)), protecao_liberada_em: null, bans_total: 2, primeira_conexao_em: new Date(Date.UTC(2026, 9, 4)) };
    expect(motivoSoRecebe(n, agora)).toBeTruthy();
    expect(papelGlobal(n, 0, agora)).toBe('receptor');
  });
  it('número maduro liberado pode enviar', () => {
    expect(motivoSoRecebe(base, agora)).toBeNull();
  });
});

describe('papelGlobal', () => {
  it('mentor exige fase madura/pré-oficial, score ≥ 85 e nenhum ban', () => {
    expect(papelGlobal(base, 90, agora)).toBe('mentor');
    expect(papelGlobal(base, 80, agora)).toBe('conversador');
    expect(papelGlobal({ ...base, bans_total: 1 }, 95, agora)).toBe('conversador');
    expect(papelGlobal({ ...base, fase: 'aquecimento_3' }, 95, agora)).toBe('conversador');
  });
  it('quarentena/banida ficam de fora', () => {
    expect(papelGlobal({ ...base, fase: 'quarentena' }, 90, agora)).toBeNull();
  });
});

describe('planejarVinculos', () => {
  const P = (id: string, userId: string, papel: Participante['papel']): Participante => ({ agenteId: id, userId, papel });
  const participantes = [
    P('m1', 'u1', 'mentor'), P('m2', 'u2', 'mentor'), P('m3', 'u3', 'mentor'),
    P('r1', 'u4', 'receptor'), P('r2', 'u5', 'receptor'),
    P('c1', 'u6', 'conversador'), P('c2', 'u7', 'conversador'),
  ];
  const { manter, criar } = planejarVinculos(participantes, []);
  const todos = [...manter, ...criar];
  const grau = (id: string) => todos.filter(v => v.a === id || v.b === id).length;

  it('receptor só aparece como destino de mentoria (nunca envia)', () => {
    for (const v of todos) {
      if (v.tipo === 'conversa') expect(['r1', 'r2']).not.toContain(v.a), expect(['r1', 'r2']).not.toContain(v.b);
      if (v.tipo === 'mentoria') expect(v.a.startsWith('m')).toBe(true), expect(v.b.startsWith('r')).toBe(true);
    }
  });
  it('cada receptor ganha mentores', () => {
    expect(todos.filter(v => v.tipo === 'mentoria' && v.b === 'r1').length).toBeGreaterThanOrEqual(1);
    expect(todos.filter(v => v.tipo === 'mentoria' && v.b === 'r2').length).toBeGreaterThanOrEqual(1);
  });
  it(`ninguém passa de ${MAX_PARCEIROS} parceiros`, () => {
    for (const p of participantes) expect(grau(p.agenteId)).toBeLessThanOrEqual(MAX_PARCEIROS);
  });
  it('rede estável: vínculos válidos são mantidos e inválidos caem', () => {
    const atuais = [{ a: 'm1', b: 'r1', tipo: 'mentoria' as const }, { a: 'r2', b: 'c1', tipo: 'conversa' as const }];
    const r = planejarVinculos(participantes, atuais);
    expect(r.manter).toContainEqual(atuais[0]);
    expect(r.manter).not.toContainEqual(atuais[1]); // receptor numa conversa: inválido
  });
  it('quando o receptor é liberado, a mentoria dele deixa de valer', () => {
    const r = planejarVinculos([P('m1', 'u1', 'mentor'), P('r1', 'u4', 'conversador')], [{ a: 'm1', b: 'r1', tipo: 'mentoria' }]);
    expect(r.manter).toEqual([]);
  });
});

describe('validarProxy', () => {
  it('aceita proxy comum e recusa endereço local/porta inválida', () => {
    expect(validarProxy({ host: 'br.proxy.exemplo.com', port: 8000, protocolo: 'http' }).proxy?.port).toBe(8000);
    expect(validarProxy({ host: '127.0.0.1', port: 80 }).erro).toBeTruthy();
    expect(validarProxy({ host: 'x.com', port: 70000 }).erro).toBeTruthy();
    expect(validarProxy({ host: 'x.com', port: 80, protocolo: 'ftp' }).erro).toBeTruthy();
  });
});

import { ROTA_ENVIO } from '../src/utils/resilientFetch';
describe('trava central de envio (evolutionFetch)', () => {
  const inst = (u: string) => ROTA_ENVIO.exec(u)?.[1] ?? null;
  it('reconhece todo tipo de envio pela instância', () => {
    for (const rota of ['message/sendText', 'message/sendMedia', 'message/sendWhatsAppAudio', 'message/sendReaction',
      'message/sendStatus', 'message/sendPoll', 'chat/markMessageAsRead', 'chat/sendPresence']) {
      expect(inst(`https://disparo.mentoark.com.br/${rota}/crm_5319f0ed61b3_2`)).toBe('crm_5319f0ed61b3_2');
    }
  });
  it('não trava leitura, conexão, configuração nem proxy', () => {
    for (const rota of ['instance/connect', 'instance/connectionState', 'chat/findMessages', 'chat/whatsappNumbers',
      'settings/set', 'proxy/set', 'chat/getBase64FromMediaMessage', 'chat/fetchProfilePictureUrl']) {
      expect(inst(`https://disparo.mentoark.com.br/${rota}/crm_5319f0ed61b3_2`)).toBeNull();
    }
  });
});

import { primeiraMensagemEm, SCORE_MENTOR_TESTE } from '../src/services/maturadorGlobal';
describe('modo teste e 1ª mensagem', () => {
  const DIA_MS = 86_400_000;
  const agora2 = Date.UTC(2026, 9, 6, 16); // 13h em Brasília
  const maduro = { fase: 'madura', protecao_ate: null, protecao_liberada_em: null, bans_total: 0, primeira_conexao_em: new Date(agora2 - 30 * DIA_MS) };
  it('no modo teste, maduro com score 65 é mentor; no modo normal, só conversa', () => {
    expect(papelGlobal(maduro, 65, agora2, SCORE_MENTOR_TESTE)).toBe('mentor');
    expect(papelGlobal(maduro, 65, agora2)).toBe('conversador');
  });
  it('número conectado há menos de 24h só recebe a 1ª mensagem na manhã seguinte (9h–10h Brasília)', () => {
    const em = primeiraMensagemEm(new Date(agora2 - 6 * 3_600_000), agora2);
    expect(em.toISOString().slice(0, 10)).toBe('2026-10-07');
    expect(em.getUTCHours()).toBe(12); // 09h em Brasília
  });
  it('número mais antigo: 1ª mensagem em 1–3h', () => {
    const em = primeiraMensagemEm(new Date(agora2 - 5 * DIA_MS), agora2).getTime() - agora2;
    expect(em).toBeGreaterThanOrEqual(60 * 60_000);
    expect(em).toBeLessThanOrEqual(180 * 60_000);
  });
});
