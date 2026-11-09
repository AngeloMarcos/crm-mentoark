/**
 * Sprint Atendimento v1 (diagnosticos/SPRINT_ATENDIMENTO_V1.md), Fase 1: regras do ciclo de vida.
 */
import { describe, it, expect } from 'vitest';
import {
  jidAtendivel, ehReabertura, iaEstaPausada, efeitosDaSaida,
  registrarEntrada, registrarSaida, marcarAguardando, encerrarPausasVencidas,
} from '../src/services/atendimento';

const AGORA = new Date('2026-11-09T12:00:00Z');
const horasAtras = (h: number) => new Date(AGORA.getTime() - h * 3_600_000);

describe('quais conversas viram atendimento', () => {
  it('aceita conversa individual, inclusive LID e BSUID da API oficial', () => {
    expect(jidAtendivel('5511999999999@s.whatsapp.net')).toBe(true);
    expect(jidAtendivel('123456@lid')).toBe(true);
    expect(jidAtendivel('abc@bsuid')).toBe(true);
  });

  it('recusa grupo, canal e status', () => {
    expect(jidAtendivel('120363@g.us')).toBe(false);
    expect(jidAtendivel('120363@newsletter')).toBe(false);
    expect(jidAtendivel('status@broadcast')).toBe(false);
    expect(jidAtendivel('')).toBe(false);
  });
});

describe('reabertura', () => {
  it('atendimento resolvido há menos de 24h conta como reabertura', () => {
    expect(ehReabertura(horasAtras(23), AGORA)).toBe(true);
  });

  it('resolvido há 24h ou mais é atendimento novo', () => {
    expect(ehReabertura(horasAtras(24), AGORA)).toBe(false);
  });

  it('sem atendimento anterior não é reabertura', () => {
    expect(ehReabertura(null, AGORA)).toBe(false);
  });
});

describe('IA pausada', () => {
  const noFuturo = horasAtras(-1);
  const noPassado = horasAtras(1);

  it('pausa sem prazo continua valendo (os 1.048 contatos de hoje)', () => {
    expect(iaEstaPausada({ atendentePausouIa: true, atendimentoIa: null, iaPausadaAte: null }, AGORA)).toBe(true);
  });

  it('pausa com prazo no futuro vale', () => {
    expect(iaEstaPausada({ atendentePausouIa: true, atendimentoIa: 'pause', iaPausadaAte: noFuturo }, AGORA)).toBe(true);
  });

  it('pausa com prazo vencido libera a IA mesmo antes do cron limpar as colunas', () => {
    expect(iaEstaPausada({ atendentePausouIa: true, atendimentoIa: 'pause', iaPausadaAte: noPassado }, AGORA)).toBe(false);
  });

  it('pausa só em dados_cliente continua valendo', () => {
    expect(iaEstaPausada({ atendentePausouIa: false, atendimentoIa: 'pause', iaPausadaAte: null }, AGORA)).toBe(true);
  });

  it('sem pausa nenhuma a IA responde', () => {
    expect(iaEstaPausada({ atendentePausouIa: false, atendimentoIa: 'ativo', iaPausadaAte: null }, AGORA)).toBe(false);
  });
});

describe('efeitos de uma mensagem enviada', () => {
  const novo = { estado: 'aberto', atendente_id: null, primeira_resposta_em: null, primeira_resposta_humana_em: null };

  it('primeira resposta da IA marca só a 1ª resposta', () => {
    expect(efeitosDaSaida(novo, { origem: 'ia', autorId: null }, AGORA)).toEqual({
      primeiraRespostaEm: AGORA, primeiraRespostaHumanaEm: null, atendenteId: null, estado: null,
    });
  });

  it('IA respondendo de novo não muda nada', () => {
    expect(efeitosDaSaida({ ...novo, primeira_resposta_em: horasAtras(1) }, { origem: 'ia', autorId: null }, AGORA)).toBeNull();
  });

  it('humano sem atendente definido assume o atendimento', () => {
    expect(efeitosDaSaida(novo, { origem: 'humano', autorId: 'u1' }, AGORA)).toEqual({
      primeiraRespostaEm: AGORA, primeiraRespostaHumanaEm: AGORA, atendenteId: 'u1', estado: null,
    });
  });

  it('humano não tira o atendimento de quem já é o atendente', () => {
    const efeitos = efeitosDaSaida({ ...novo, atendente_id: 'u2' }, { origem: 'humano', autorId: 'u1' }, AGORA);
    expect(efeitos?.atendenteId).toBeNull();
  });

  it('humano responder quem pediu humano tira o atendimento de "aguardando"', () => {
    const efeitos = efeitosDaSaida({ ...novo, estado: 'aguardando' }, { origem: 'humano', autorId: 'u1' }, AGORA);
    expect(efeitos?.estado).toBe('aberto');
  });

  it('resposta da IA não tira de "aguardando"', () => {
    const efeitos = efeitosDaSaida({ ...novo, estado: 'aguardando' }, { origem: 'ia', autorId: null }, AGORA);
    expect(efeitos?.estado).toBeNull();
  });

  it('humano que já respondeu e já é o atendente não gera escrita', () => {
    const atendido = { estado: 'aberto', atendente_id: 'u1', primeira_resposta_em: horasAtras(2), primeira_resposta_humana_em: horasAtras(1) };
    expect(efeitosDaSaida(atendido, { origem: 'humano', autorId: 'u1' }, AGORA)).toBeNull();
  });
});

// Regra do caminho quente: falha no atendimento nunca pode derrubar o webhook nem a IA.
describe('falha de banco não propaga', () => {
  const poolQuebrado = { query: async () => { throw new Error('banco fora'); } } as any;
  const conversa = { userId: 'u1', instancia: 'i1', remoteJid: '5511999999999@s.whatsapp.net', telefone: '5511999999999' };

  it('registrarEntrada', async () => {
    await expect(registrarEntrada(poolQuebrado, conversa)).resolves.toBeUndefined();
  });

  it('registrarSaida', async () => {
    await expect(registrarSaida(poolQuebrado, { ...conversa, origem: 'ia', autorId: null })).resolves.toBeUndefined();
  });

  it('marcarAguardando', async () => {
    await expect(marcarAguardando(poolQuebrado, conversa)).resolves.toBeUndefined();
  });

  it('encerrarPausasVencidas devolve zero', async () => {
    await expect(encerrarPausasVencidas(poolQuebrado)).resolves.toBe(0);
  });
});

describe('grupo não toca no banco', () => {
  const poolEspiao = () => {
    const chamadas: string[] = [];
    return { chamadas, pool: { query: async (sql: string) => { chamadas.push(sql); return { rows: [], rowCount: 0 }; } } as any };
  };
  const grupo = { userId: 'u1', instancia: 'i1', remoteJid: '120363@g.us', telefone: '120363' };

  it('registrarEntrada ignora grupo', async () => {
    const { chamadas, pool } = poolEspiao();
    await registrarEntrada(pool, grupo);
    expect(chamadas).toEqual([]);
  });

  it('registrarSaida ignora grupo', async () => {
    const { chamadas, pool } = poolEspiao();
    await registrarSaida(pool, { ...grupo, origem: 'humano', autorId: 'u1' });
    expect(chamadas).toEqual([]);
  });
});
