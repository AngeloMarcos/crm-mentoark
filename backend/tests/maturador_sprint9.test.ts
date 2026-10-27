/**
 * Sprint 9 do maturador v5 (2026-10-20): áudio com voz fixa por chip, foto única por envio,
 * figurinha, fração por fase e tetos.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import sharp from 'sharp';
import {
  chancesMidia, vozDoChip, segundosDeFala, custoAudioUsd, gerarAudio, prepararFoto, figurinhaAleatoria,
  _zerarContadoresMidia, TETO_DIA_CHIP,
} from '../src/services/maturadorMidia';
import { estadoControles, CONTROLES_PADRAO } from '../src/services/maturadorControles';

const queries: string[] = [];
const pool: any = { query: async (sql: string) => { queries.push(sql); return { rows: [] }; } };
const salvos: Buffer[] = [];
const salvar = async (buf: Buffer, ext: string) => { salvos.push(buf); return `https://x/uploads/variantes/t${salvos.length}.${ext}`; };

beforeEach(() => {
  _zerarContadoresMidia(); queries.length = 0; salvos.length = 0;
  process.env.OPENAI_API_KEY = 'sk-teste';
  delete process.env.MATURADOR_AUDIO; delete process.env.MATURADOR_AUDIO_MAX_DIA_CONTA;
});
afterEach(() => { delete process.env.OPENAI_API_KEY; });

describe('chancesMidia', () => {
  it('nada de mídia em Perfil, Aquecimento 1, quarentena ou fase desconhecida', () => {
    for (const f of ['perfil', 'aquecimento_1', 'quarentena', 'banida', null, undefined]) {
      expect(chancesMidia(f as any)).toEqual({ audio: 0, foto: 0, figurinha: 0, localizacao: 0 });
    }
  });
  it('cresce com a fase e nunca passa de 20%', () => {
    expect(chancesMidia('aquecimento_3').audio).toBeGreaterThan(chancesMidia('aquecimento_2').audio);
    for (const f of ['aquecimento_2', 'aquecimento_3', 'pre_oficial', 'madura']) {
      for (const v of Object.values(chancesMidia(f))) expect(v).toBeLessThanOrEqual(0.2);
    }
  });
  it('tetos diários por chip existem para os 3 tipos', () => {
    expect(TETO_DIA_CHIP).toMatchObject({ audio: expect.any(Number), foto: expect.any(Number), figurinha: expect.any(Number) });
  });
});

describe('voz do chip', () => {
  it('é sempre a mesma para o mesmo chip e varia entre chips', () => {
    expect(vozDoChip('chip-1')).toEqual(vozDoChip('chip-1'));
    expect(new Set(Array.from({ length: 30 }, (_, i) => vozDoChip(`c${i}`).openai)).size).toBeGreaterThan(3);
  });
  it('duração e custo do áudio', () => {
    expect(segundosDeFala('oi')).toBe(2);
    expect(segundosDeFala('x'.repeat(1000))).toBe(30);
    expect(custoAudioUsd(10)).toBeLessThan(0.003);
  });
});

describe('gerarAudio', () => {
  it('usa a voz fixa do chip, salva o mp3 e registra o gasto', async () => {
    let vozUsada = '';
    const r = await gerarAudio(pool, 'u1', 'chip-1', 'bora tomar um café amanhã 😄', {
      tts: async (_k, texto, voz) => { vozUsada = voz; expect(texto).not.toMatch(/😄/); return Buffer.from('mp3'); }, salvar,
    });
    expect(r).toMatchObject({ url: expect.stringContaining('.mp3'), segundos: expect.any(Number) });
    expect(vozUsada).toBe(vozDoChip('chip-1').openai);
    expect(queries.some(q => q.includes('ai_uso_diario'))).toBe(true);
  });
  it('respeita o teto de áudios por conta por dia', async () => {
    process.env.MATURADOR_AUDIO_MAX_DIA_CONTA = '1';
    const deps = { tts: async () => Buffer.from('mp3'), salvar };
    expect(await gerarAudio(pool, 'u1', 'c', 'primeiro áudio do dia', deps)).not.toBeNull();
    expect(await gerarAudio(pool, 'u1', 'c', 'segundo áudio do dia', deps)).toBeNull();
  });
  it('falha do TTS ou áudio desligado → null (vai como texto)', async () => {
    expect(await gerarAudio(pool, 'u1', 'c', 'teste de falha', { tts: async () => null, salvar })).toBeNull();
    process.env.MATURADOR_AUDIO = 'off';
    expect(await gerarAudio(pool, 'u1', 'c', 'teste desligado', { tts: async () => Buffer.from('x'), salvar })).toBeNull();
  });
});

describe('prepararFoto', () => {
  it('cada envio gera arquivo diferente, mesmo partindo da mesma imagem', async () => {
    const base = await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 120, g: 160, b: 200 } } }).jpeg().toBuffer();
    for (let i = 0; i < 5; i++) await prepararFoto({ baixar: async () => base, salvar });
    const hashes = new Set(salvos.map(b => crypto.createHash('sha256').update(b).digest('hex')));
    expect(hashes.size).toBe(5);
  });
  it('falha ao baixar → null', async () => {
    expect(await prepararFoto({ baixar: async () => { throw new Error('offline'); }, salvar })).toBeNull();
  });
});

describe('figurinha e controle', () => {
  it('figurinha é PNG do Noto Emoji', () => {
    expect(figurinhaAleatoria()).toMatch(/noto-emoji@v2\.047\/png\/512\/emoji_u[0-9a-f]+\.png$/);
  });
  it('controle "Fotos e áudios" fica ativo a partir do Aquecimento 2', () => {
    expect(estadoControles(CONTROLES_PADRAO, { fase: 'aquecimento_1', so_recebe: 'x' }).midia.ativo_agora).toBe(false);
    expect(estadoControles(CONTROLES_PADRAO, { fase: 'aquecimento_2', so_recebe: 'x' }).midia.ativo_agora).toBe(true);
  });
});
