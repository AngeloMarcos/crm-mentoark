/**
 * vision.ts — análise de imagens de WhatsApp via Vision API da OpenAI (gpt-4o-mini).
 *
 * Recebe os bytes já decriptografados da imagem (ver whatsappMediaStorage.ts — a URL
 * crua da Evolution é sempre cifrada, nunca deve ser baixada/enviada direto pra cá,
 * mesma ressalva já aplicada em transcribe.ts para áudio) e devolve uma descrição curta
 * gerada pela IA, ou `null` em qualquer falha. Nunca lança.
 */
import { log } from '../logger';

const VISION_URL = 'https://api.openai.com/v1/chat/completions';
const VISION_TIMEOUT_MS = 8_000;

const PROMPT_ANALISE_IMAGEM =
  'Analise esta imagem enviada pelo cliente em um chat de suporte de vendas e faça uma ' +
  'descrição curta e resumida de no máximo 1 frase do que ela representa (ex: comprovante ' +
  'de Pix no valor de X, foto de produto, captura de tela de erro, etc.). Seja extremamente ' +
  'direto e objetivo.';

export async function analisarImagem(
  imageBuffer: Buffer,
  mimeType: string,
  openAiApiKey: string,
): Promise<string | null> {
  if (!imageBuffer?.length || !openAiApiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);

  try {
    const base64 = imageBuffer.toString('base64');
    const mime = mimeType || 'image/jpeg';

    const response = await fetch(VISION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openAiApiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: PROMPT_ANALISE_IMAGEM },
              { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
            ],
          },
        ],
        max_tokens: 100,
      }),
      signal: controller.signal,
    }).catch((err: Error) => {
      log.warn('VISION', 'Falha de rede ao chamar Vision API', { err: err.message });
      return null;
    });
    if (!response) return null;

    if (!response.ok) {
      const corpoErro = await response.text().catch(() => '');
      log.warn('VISION', 'Vision API retornou erro', { status: response.status, corpoErro: corpoErro.slice(0, 300) });
      return null;
    }

    const data = await response.json().catch((err: Error) => {
      log.warn('VISION', 'Falha ao parsear JSON da Vision API', { err: err.message });
      return null;
    });
    if (!data) return null;

    const descricao = (data as any)?.choices?.[0]?.message?.content;
    if (typeof descricao !== 'string' || !descricao.trim()) return null;

    return descricao.trim();
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      log.warn('VISION', `Timeout (${VISION_TIMEOUT_MS}ms) ao chamar Vision API`);
    } else {
      log.warn('VISION', 'Erro inesperado na análise de imagem', { err: err?.message });
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}
