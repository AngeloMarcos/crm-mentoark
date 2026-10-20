/**
 * maturadorMidia.ts — Sprint 9 do maturador v5 (2026-10-20, modelo ChipFlow — ver
 * docs/maturador/SPRINTS_MATURADOR_V5.md): áudio, foto e figurinha nas conversas do aquecimento.
 * Conta só de texto não parece gente — quem usa WhatsApp de verdade manda áudio, foto e figurinha.
 *
 *   - Áudio: a própria fala da conversa vira mensagem de voz (PTT) com voz FIXA por chip
 *     (OpenAI TTS; ElevenLabs da conta como alternativa). A Evolution mostra "gravando…" pelo
 *     tempo do `delay` (confirmado no código da 2.3.7: `presence: "recording"`).
 *   - Foto: imagem aleatória do Lorem Picsum (licença Unsplash, uso livre), baixada e
 *     re-codificada com tamanho/qualidade sorteados — cada envio tem arquivo e hash diferentes.
 *   - Figurinha: emoji grande (Noto Emoji, Apache 2.0) — a Evolution converte para webp.
 *   - Fração de mídia cresce com a fase (0% em Perfil/Aquecimento 1) e respeita o controle
 *     "Fotos e áudios". Teto por chip por dia e teto de áudio pago por conta por dia.
 *   - Arquivos gerados vão para `uploads/variantes/` — a limpeza que já existe (cron, 12 h) apaga.
 *   - Qualquer falha → a fala sai como texto normal. Mídia nunca trava o maturador.
 */
import { Pool } from 'pg';
import path from 'path';
import crypto from 'crypto';
import { promises as fs } from 'fs';
import sharp from 'sharp';
import { log } from '../logger';
import { criarProvider } from './index';
import { registrarUsoIA } from '../utils/aiCusto';
import { sintetizarVoz } from '../utils/elevenlabs';

const UPLOADS_DIR = process.env.UPLOADS_DIR || '/app/uploads';
const API_BASE_URL = process.env.API_BASE_URL || 'https://api.mentoark.com.br';
const VARIANTES_DIR = path.join(UPLOADS_DIR, 'variantes');

// ── Quanto de mídia por fase ─────────────────────────────────────────────────────────────────
export type Chances = { audio: number; foto: number; figurinha: number };
const CHANCES_POR_FASE: Record<string, Chances> = {
  aquecimento_2: { audio: 0.08, foto: 0.10, figurinha: 0.05 },
  aquecimento_3: { audio: 0.12, foto: 0.15, figurinha: 0.07 },
  pre_oficial:   { audio: 0.15, foto: 0.20, figurinha: 0.08 },
  madura:        { audio: 0.15, foto: 0.20, figurinha: 0.08 },
};
const NENHUMA: Chances = { audio: 0, foto: 0, figurinha: 0 };

/** Perfil, Aquecimento 1, quarentena, banida ou fase desconhecida: só texto. */
export function chancesMidia(fase: string | null | undefined): Chances {
  return (fase && CHANCES_POR_FASE[fase]) || NENHUMA;
}

// Por chip, por dia (contado em maturador_mensagens).
export const TETO_DIA_CHIP: Record<'audio' | 'foto' | 'figurinha', number> = { audio: 8, foto: 3, figurinha: 5 };

// ── Voz fixa por chip ────────────────────────────────────────────────────────────────────────
function hash(s: string): number {
  return [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 23);
}
const VOZES_OPENAI = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse'];
// Vozes "premade" da ElevenLabs (presentes em toda conta), faladas em português pelo multilingual_v2.
const VOZES_ELEVEN = ['pNInz6obpgDQGcFmaJgB', 'EXAVITQu4vr4xnAvoD3D', 'TxGEqnHWrfWFTfGW9XjX', 'ErXwobaYiN019PkySvjV',
  'MF3mDGbpmxXwEDPqf8yC', '21m00Tcm4TlvDq8ikWAM'];
const JEITOS = ['tranquilo e meio sonolento', 'animado', 'apressado, falando rápido', 'descontraído, rindo um pouco', 'cansado depois do trabalho'];

export function vozDoChip(agenteId: string): { openai: string; eleven: string; jeito: string } {
  const h = hash(agenteId);
  return {
    openai: VOZES_OPENAI[h % VOZES_OPENAI.length],
    eleven: VOZES_ELEVEN[(h >>> 5) % VOZES_ELEVEN.length],
    jeito: JEITOS[(h >>> 9) % JEITOS.length],
  };
}

/** Duração aproximada da fala (pt-BR ≈ 14 caracteres/s), entre 2 e 30 s. */
export function segundosDeFala(texto: string): number {
  return Math.min(30, Math.max(2, Math.round(texto.length / 14)));
}

// gpt-4o-mini-tts: ~US$ 0,015 por minuto de áudio gerado.
export function custoAudioUsd(segundos: number): number {
  return (segundos / 60) * 0.015;
}

// ── Freio de custo do áudio (por conta por dia) ──────────────────────────────────────────────
const audiosHoje = new Map<string, number>();
function chaveDia(userId: string): string {
  return `${userId}:${new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })}`;
}
export function maxAudiosDiaConta(): number {
  const n = Number(process.env.MATURADOR_AUDIO_MAX_DIA_CONTA);
  return Number.isFinite(n) && n >= 0 ? n : 20;
}
/** Só para testes. */
export function _zerarContadoresMidia(): void { audiosHoje.clear(); }

async function salvarVariante(buf: Buffer, ext: string): Promise<string> {
  const nome = `mat_${crypto.randomUUID()}.${ext}`;
  await fs.mkdir(VARIANTES_DIR, { recursive: true });
  await fs.writeFile(path.join(VARIANTES_DIR, nome), buf);
  return `${API_BASE_URL}/uploads/variantes/${nome}`;
}

async function chaveOpenAI(pool: Pool, userId: string): Promise<string | null> {
  const p = await criarProvider(pool, userId, null).catch(() => null);
  if (p && p.providerSlug === 'openai' && p.apiKey) return p.apiKey;
  return process.env.OPENAI_API_KEY || null;
}

async function ttsOpenAI(apiKey: string, texto: string, voz: string, jeito: string): Promise<Buffer | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const r = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.MATURADOR_TTS_MODELO || 'gpt-4o-mini-tts',
        voice: voz,
        input: texto,
        instructions: `Fale em português do Brasil, sotaque paulista, como um áudio casual de WhatsApp para um amigo. Tom ${jeito}. Natural, sem soar como locutor.`,
        response_format: 'mp3',
      }),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      log.warn('MATURADOR_MIDIA', 'OpenAI TTS recusou', { status: r.status });
      return null;
    }
    return Buffer.from(await r.arrayBuffer());
  } catch (err: any) {
    log.warn('MATURADOR_MIDIA', 'Falha no OpenAI TTS', { err: err?.message });
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Gera a fala do chip em áudio e devolve a URL pública do mp3 (a Evolution converte para
 * ogg/opus e envia como mensagem de voz). null = manda como texto.
 */
export async function gerarAudio(pool: Pool, userId: string, agenteId: string, texto: string,
  deps: { tts?: typeof ttsOpenAI; eleven?: typeof sintetizarVoz; salvar?: typeof salvarVariante } = {}): Promise<{ url: string; segundos: number } | null> {
  if (/^(off|0|false)$/i.test(String(process.env.MATURADOR_AUDIO || '').trim())) return null;
  const limpo = texto.replace(/\p{Extended_Pictographic}/gu, '').replace(/\s+/g, ' ').trim();
  if (limpo.length < 4 || limpo.length > 300) return null;
  const chave = chaveDia(userId);
  const usados = audiosHoje.get(chave) ?? 0;
  if (usados >= maxAudiosDiaConta()) return null;

  const voz = vozDoChip(agenteId);
  const segundos = segundosDeFala(limpo);
  const tts = deps.tts ?? ttsOpenAI;
  const salvar = deps.salvar ?? salvarVariante;
  try {
    let buf: Buffer | null = null;
    const key = await chaveOpenAI(pool, userId);
    if (key) {
      audiosHoje.set(chave, usados + 1);
      buf = await tts(key, limpo, voz.openai, voz.jeito);
      if (buf) {
        await registrarUsoIA(pool, {
          userId, providerSlug: 'openai', modelo: process.env.MATURADOR_TTS_MODELO || 'gpt-4o-mini-tts',
          tokensEntrada: limpo.length, tokensSaida: 0, custoUsd: custoAudioUsd(segundos),
        });
      }
    }
    if (!buf) {
      // Alternativa: ElevenLabs da própria conta (gasta os créditos dela, não a chave do servidor).
      const r = await pool.query(
        `SELECT api_key FROM integracoes_config WHERE user_id = $1 AND tipo = 'elevenlabs' AND status = 'conectado' LIMIT 1`, [userId]
      ).catch(() => ({ rows: [] as any[] }));
      const elevenKey = r.rows[0]?.api_key;
      if (elevenKey) buf = await (deps.eleven ?? sintetizarVoz)(limpo, elevenKey, voz.eleven);
    }
    if (!buf) return null;
    return { url: await salvar(buf, 'mp3'), segundos };
  } catch (err: any) {
    log.warn('MATURADOR_MIDIA', 'Falha ao gerar áudio — vai como texto', { err: err?.message });
    return null;
  }
}

// ── Foto ─────────────────────────────────────────────────────────────────────────────────────
export const LEGENDAS_FOTO = [
  'olha isso', 'olha que vista', 'foto de hoje', 'achei bonito', 'vi isso agora', 'olha só',
  'tirei essa mais cedo', 'lembrei de vc', 'bom demais', '', '', '',
];

/** Baixa uma foto aleatória e re-codifica (tamanho e qualidade sorteados) → arquivo único. */
export async function prepararFoto(deps: { baixar?: (url: string) => Promise<Buffer>; salvar?: typeof salvarVariante } = {}): Promise<{ url: string; legenda: string } | null> {
  try {
    const largura = [960, 1024, 1080, 1200, 1280][Math.floor(Math.random() * 5)];
    const altura = Math.random() < 0.5 ? Math.round(largura * 0.75) : Math.round(largura * 1.25);
    const origem = `https://picsum.photos/seed/${crypto.randomUUID()}/${largura}/${altura}`;
    const baixar = deps.baixar ?? (async (u: string) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 20_000);
      try {
        const r = await fetch(u, { signal: ctrl.signal });
        if (!r.ok) throw new Error(`picsum ${r.status}`);
        return Buffer.from(await r.arrayBuffer());
      } finally { clearTimeout(t); }
    });
    const original = await baixar(origem);
    const foto = await sharp(original)
      .modulate({ brightness: 0.97 + Math.random() * 0.06, saturation: 0.95 + Math.random() * 0.1 })
      .jpeg({ quality: 78 + Math.floor(Math.random() * 15) })
      .toBuffer();
    const url = await (deps.salvar ?? salvarVariante)(foto, 'jpg');
    return { url, legenda: LEGENDAS_FOTO[Math.floor(Math.random() * LEGENDAS_FOTO.length)] };
  } catch (err: any) {
    log.warn('MATURADOR_MIDIA', 'Falha ao preparar foto', { err: err?.message });
    return null;
  }
}

// ── Figurinha ────────────────────────────────────────────────────────────────────────────────
const EMOJIS_FIGURINHA = ['1f602', '1f923', '1f605', '1f60d', '1f62d', '1f644', '1f914', '1f60e', '1f97a', '1f633',
  '1f64f', '1f44d', '1f44f', '1f525', '2764', '1f389', '1f634', '1f924', '1f92f', '1f62c'];

export function figurinhaAleatoria(): string {
  const cp = EMOJIS_FIGURINHA[Math.floor(Math.random() * EMOJIS_FIGURINHA.length)];
  return `https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji@v2.047/png/512/emoji_u${cp}.png`;
}

/** Quantas mídias de cada tipo o chip já mandou hoje (horário de Brasília). */
export async function midiasHoje(pool: Pool, agenteId: string, hoje: string): Promise<Record<'audio' | 'foto' | 'figurinha', number>> {
  const r = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE tipo = 'audio')::int AS audio,
            COUNT(*) FILTER (WHERE tipo = 'foto')::int AS foto,
            COUNT(*) FILTER (WHERE tipo = 'figurinha')::int AS figurinha
     FROM maturador_mensagens
     WHERE de_agente_id = $1 AND (created_at AT TIME ZONE 'America/Sao_Paulo')::date = $2::date`,
    [agenteId, hoje]
  ).catch(() => ({ rows: [{ audio: 99, foto: 99, figurinha: 99 }] }));
  return r.rows[0];
}
