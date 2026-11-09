/**
 * Sprint Atendimento v1, Fase 2: regras das ações do atendente (rotas em routes/atendimentos.ts).
 */
import { describe, it, expect } from 'vitest';
import { erroDeEstado, lerMinutosPausa, lerNota, lerFiltrosConversas, ehUuid, registrarEnvioHumanoApi } from '../src/services/atendimento';
import { normalizarEscopos } from '../src/services/apiKeys';

describe('ações permitidas por estado', () => {
  it.each(['atribuir', 'transferir', 'resolver', 'pausar-ia'] as const)('%s não vale em atendimento resolvido', acao => {
    expect(erroDeEstado('resolvido', acao)).toMatch(/resolvido/i);
  });

  it.each(['aberto', 'aguardando'])('resolver vale em %s', estado => {
    expect(erroDeEstado(estado, 'resolver')).toBeNull();
  });

  it('reabrir só vale em atendimento resolvido', () => {
    expect(erroDeEstado('resolvido', 'reabrir')).toBeNull();
    expect(erroDeEstado('aberto', 'reabrir')).toMatch(/resolvido/i);
  });
});

describe('prazo da pausa da IA', () => {
  it('null é "até eu devolver"', () => {
    expect(lerMinutosPausa(null)).toEqual({ minutos: null });
  });

  it('aceita minutos inteiros até 7 dias', () => {
    expect(lerMinutosPausa(30)).toEqual({ minutos: 30 });
    expect(lerMinutosPausa(10080)).toEqual({ minutos: 10080 });
  });

  it.each([undefined, 0, -5, 1.5, 10081, '30', {}])('recusa %s', valor => {
    expect(lerMinutosPausa(valor as any).erro).toBeTruthy();
  });
});

describe('nota interna', () => {
  it('apara os espaços', () => {
    expect(lerNota('  cliente pediu retorno  ')).toEqual({ texto: 'cliente pediu retorno' });
  });

  it.each(['', '   ', null, undefined, 42])('recusa %s', valor => {
    expect(lerNota(valor as any).erro).toBeTruthy();
  });

  it('recusa nota acima de 4000 caracteres', () => {
    expect(lerNota('x'.repeat(4001)).erro).toBeTruthy();
    expect(lerNota('x'.repeat(4000)).texto).toHaveLength(4000);
  });
});

describe('filtros da lista de conversas', () => {
  it('sem filtro nenhum', () => {
    expect(lerFiltrosConversas({}, 'u1')).toEqual({ estado: null, atendenteId: null, semAtendente: false });
  });

  it('aceita os três estados', () => {
    for (const estado of ['aberto', 'aguardando', 'resolvido']) {
      expect(lerFiltrosConversas({ estado }, 'u1').estado).toBe(estado);
    }
  });

  it('estado desconhecido é ignorado', () => {
    expect(lerFiltrosConversas({ estado: "x' OR 1=1" }, 'u1').estado).toBeNull();
  });

  it('meus=1 filtra por quem está logado, nunca por id vindo de fora', () => {
    expect(lerFiltrosConversas({ meus: '1', atendente_id: 'outro' }, 'u1').atendenteId).toBe('u1');
  });

  it('sem_atendente=1', () => {
    expect(lerFiltrosConversas({ sem_atendente: '1' }, 'u1').semAtendente).toBe(true);
  });
});

describe('id de atendimento', () => {
  it('reconhece uuid', () => {
    expect(ehUuid('3f2b8a10-1c2d-4e5f-8a9b-0c1d2e3f4a5b')).toBe(true);
  });

  it.each(['abc', '', undefined, "1' OR '1'='1"])('recusa %s', valor => {
    expect(ehUuid(valor as any)).toBe(false);
  });
});

describe('envio como humano pela API pública', () => {
  const conversa = { userId: 'u1', instancia: 'i1', remoteJid: '5511999999999@s.whatsapp.net', telefone: '5511999999999', autorId: 'u2' };

  it('falha de banco não derruba o envio, que já foi feito', async () => {
    const poolQuebrado = { query: async () => { throw new Error('banco fora'); } } as any;
    await expect(registrarEnvioHumanoApi(poolQuebrado, conversa)).resolves.toBeUndefined();
  });

  it('pausa a IA por 1 hora', async () => {
    const chamadas: { sql: string; params: unknown[] }[] = [];
    const pool = { query: async (sql: string, params: unknown[]) => {
      chamadas.push({ sql, params });
      return /UPDATE contatos/.test(sql) ? { rows: [{ ia_pausada_ate: new Date() }], rowCount: 1 } : { rows: [], rowCount: 0 };
    } } as any;
    await registrarEnvioHumanoApi(pool, conversa);
    const pausa = chamadas.find(c => /UPDATE contatos SET atendente_pausou_ia = true/.test(c.sql));
    expect(pausa?.params[2]).toBe(60);
  });
});

describe('escopo da API', () => {
  it('conversations aceita update', () => {
    expect(normalizarEscopos({ conversations: ['read', 'update'] })).toEqual({ conversations: ['read', 'update'] });
  });
});
