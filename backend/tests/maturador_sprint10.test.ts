/**
 * Sprint 10 do maturador v5 (2026-10-20): status rico — fila de imagens/textos, frase da IA,
 * visibilidade e limites de cadastro.
 */
import { describe, it, expect } from 'vitest';
import {
  montarStatus, destinatariosStatus, fraseDoDiaIA, adicionarTexto, adicionarImagem, MAX_CARACTERES_TEXTO, MAX_ITENS_POR_TIPO,
} from '../src/services/maturadorStatus';
import { CONTROLES_PADRAO } from '../src/services/maturadorControles';
import { STATUS_TEXTOS } from '../src/services/maturadorDialogos';

/** Pool falso: responde conforme o SQL. */
function poolCom(resp: (sql: string, params: any[]) => any[]) {
  const chamadas: { sql: string; params: any[] }[] = [];
  return { chamadas, query: async (sql: string, params: any[] = []) => { chamadas.push({ sql, params }); return { rows: resp(sql, params), rowCount: 1 }; } } as any;
}

describe('montarStatus', () => {
  it('texto cadastrado sai como status de texto e marca o item', async () => {
    const pool = poolCom(sql => sql.includes('FROM maturador_status_itens') ? [{ id: 'i1', tipo: 'texto', conteudo: 'bom dia, gente' }] : []);
    const st = await montarStatus(pool, { userId: 'u', agenteId: 'a' });
    expect(st).toMatchObject({ itemId: 'i1', descricao: 'bom dia, gente', payload: { type: 'text', content: 'bom dia, gente' } });
  });

  it('imagem cadastrada sai re-codificada, com a legenda', async () => {
    const pool = poolCom(sql => sql.includes('FROM maturador_status_itens') ? [{ id: 'i2', tipo: 'imagem', conteudo: 'maturador_status/x.jpg', legenda: 'praia' }] : []);
    const st = await montarStatus(pool, { userId: 'u', agenteId: 'a' }, { variar: async () => 'https://x/uploads/variantes/v.jpg' });
    expect(st.payload).toEqual({ type: 'image', content: 'https://x/uploads/variantes/v.jpg', caption: 'praia' });
    expect(st.itemId).toBe('i2');
  });

  it('sem nada cadastrado: frase da IA; sem IA: banco fixo', async () => {
    const pool = poolCom(() => []);
    for (let i = 0; i < 10; i++) {
      const st = await montarStatus(pool, { userId: 'u', agenteId: 'a' }, { frase: async () => 'sextou finalmente', foto: async () => ({ url: 'https://x/f.jpg', legenda: '' }) });
      expect(st.itemId).toBeNull();
      expect(st.payload.type === 'image' ? st.payload.caption : st.payload.content).toBe('sextou finalmente');
    }
    const semIA = await montarStatus(pool, { userId: 'u', agenteId: 'a' }, { frase: async () => null, foto: async () => null });
    expect(STATUS_TEXTOS).toContain(semIA.payload.content);
  });
});

describe('fraseDoDiaIA', () => {
  it('limpa aspas e recusa conteúdo de negócio', async () => {
    const pool = poolCom(() => []);
    expect(await fraseDoDiaIA(pool, 'u', { completar: async () => '"dia de descansar 😴"' })).toBe('dia de descansar 😴');
    expect(await fraseDoDiaIA(pool, 'u', { completar: async () => 'aproveite nosso desconto hoje' })).toBeNull();
    expect(await fraseDoDiaIA(pool, 'u', { completar: async () => null })).toBeNull();
  });
});

describe('destinatariosStatus', () => {
  it('padrão é só parceiros: o parceiro atual + os de outros pares, sem repetir', async () => {
    expect(CONTROLES_PADRAO.status_visibilidade).toBe('parceiros');
    const pool = poolCom(() => [{ outro: '5511999990001' }, { outro: '5511999990002' }, { outro: null }]);
    const d = await destinatariosStatus(pool, 'a', 'parceiros', '5511999990001');
    expect(d.allContacts).toBe(false);
    expect(d.statusJidList!.sort()).toEqual(['5511999990001@s.whatsapp.net', '5511999990002@s.whatsapp.net']);
  });
  it('"todos" manda para todos os contatos', async () => {
    expect(await destinatariosStatus(poolCom(() => []), 'a', 'todos', '5511999990001')).toEqual({ allContacts: true });
  });
});

describe('cadastro', () => {
  it('texto: vazio, longo demais e acima do limite são recusados', async () => {
    const vazio = poolCom(sql => sql.includes('COUNT') ? [{ imagem: 0, texto: 0 }] : [{ o: 1 }]);
    expect((await adicionarTexto(vazio, 'u', 'a', '  ')).erro).toBeTruthy();
    expect((await adicionarTexto(vazio, 'u', 'a', 'x'.repeat(MAX_CARACTERES_TEXTO + 1))).erro).toMatch(/500/);
    const cheio = poolCom(sql => sql.includes('COUNT') ? [{ imagem: 0, texto: MAX_ITENS_POR_TIPO }] : [{ o: 1 }]);
    expect((await adicionarTexto(cheio, 'u', 'a', 'oi')).erro).toMatch(/20/);
  });
  it('imagem: formato inválido é recusado antes de gravar', async () => {
    const pool = poolCom(sql => sql.includes('COUNT') ? [{ imagem: 0, texto: 0 }] : []);
    expect((await adicionarImagem(pool, 'u', 'a', 'data:application/pdf;base64,AAAA')).erro).toBeTruthy();
    expect(pool.chamadas.some((c: any) => c.sql.includes('INSERT'))).toBe(false);
  });
});
