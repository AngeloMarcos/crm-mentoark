/**
 * transcribe.ts — transcrição de áudio via Whisper API (OpenAI).
 *
 * Recebe os bytes já decriptografados de um áudio de WhatsApp (ver
 * whatsappMediaStorage.ts — a URL crua da Evolution é sempre cifrada, nunca deve
 * ser passada direto pra cá) e devolve o texto transcrito, ou `null` em qualquer
 * falha (rede, timeout, erro HTTP, parse). Nunca lança — chamador nunca precisa
 * de try/catch pra usar isto.
 */
import { log } from '../logger';

const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';
const TRANSCRIBE_TIMEOUT_MS = 8_000;

export async function transcreverAudio(
  audioBuffer: Buffer,
  mimeType: string,
  openAiApiKey: string,
): Promise<string | null> {
  if (!audioBuffer?.length || !openAiApiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRANSCRIBE_TIMEOUT_MS);

  try {
    const formData = new FormData();
    const file = new Blob([audioBuffer], { type: mimeType || 'audio/ogg' });
    formData.append('file', file, 'audio.ogg');
    formData.append('model', 'whisper-1');
    formData.append('language', 'pt');

    const response = await fetch(WHISPER_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${openAiApiKey}` },
      body: formData,
      signal: controller.signal,
    }).catch((err: Error) => {
      log.warn('TRANSCRIBE', 'Falha de rede ao chamar Whisper API', { err: err.message });
      return null;
    });
    if (!response) return null;

    if (!response.ok) {
      const corpoErro = await response.text().catch(() => '');
      log.warn('TRANSCRIBE', 'Whisper API retornou erro', { status: response.status, corpoErro: corpoErro.slice(0, 300) });
      return null;
    }

    const data = await response.json().catch((err: Error) => {
      log.warn('TRANSCRIBE', 'Falha ao parsear JSON da Whisper API', { err: err.message });
      return null;
    });
    if (!data) return null;

    const texto = (data as any)?.text;
    if (typeof texto !== 'string' || !texto.trim()) return null;

    return texto.trim();
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      log.warn('TRANSCRIBE', `Timeout (${TRANSCRIBE_TIMEOUT_MS}ms) ao chamar Whisper API`);
    } else {
      log.warn('TRANSCRIBE', 'Erro inesperado na transcrição', { err: err?.message });
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}
