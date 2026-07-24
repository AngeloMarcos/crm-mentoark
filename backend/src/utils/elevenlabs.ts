import { log } from '../logger';

const ELEVENLABS_API = 'https://api.elevenlabs.io/v1';

// [AUDITORIA] LÓGICA: chamada de síntese de voz standalone, usada por agentEngine.ts (resposta
// automática em áudio). Deliberadamente NÃO compartilhada com routes/elevenlabs.ts (que já tem
// sua própria implementação inline, testada e em produção) — duplicar essas ~15 linhas é mais
// seguro aqui do que refatorar uma rota existente só pra reuso, por enquanto (ver AUDITORIA_PROTOCOLO.md,
// critério "mudança pequena e isolada").
export async function sintetizarVoz(
  text: string,
  apiKey: string,
  voiceId: string,
  modelId = 'eleven_multilingual_v2',
): Promise<Buffer | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${ELEVENLABS_API}/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const err = await response.text().catch(() => '');
      log.warn('ELEVENLABS', 'Erro ao sintetizar voz', { status: response.status, err: err.slice(0, 200) });
      return null;
    }

    return Buffer.from(await response.arrayBuffer());
  } catch (err: any) {
    log.warn('ELEVENLABS', 'Falha de rede/timeout ao sintetizar voz', { err: err?.message });
    return null;
  } finally {
    clearTimeout(timer);
  }
}
