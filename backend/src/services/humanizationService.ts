// ============================================================
// HUMANIZAÇÃO DE MENSAGENS COM CHATGPT (OpenAI)
// Varia o texto de cada disparo para reduzir risco de bloqueio
// ============================================================
//
// Requer OPENAI_API_KEY no ambiente do backend.
// Se a chave não estiver configurada, retorna o texto original.
// Modelo padrão: gpt-4o-mini (rápido e barato). Override via OPENAI_MODEL.
// ============================================================

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// Cache em memória: chave = primeiros 100 chars da base, valor = variações já geradas
const cache = new Map<string, string[]>();
const CACHE_MAX = 20;

const SYSTEM_PROMPT = `Você é um assistente que reescreve mensagens de WhatsApp para parecerem digitadas naturalmente por uma pessoa diferente a cada envio, evitando padrões repetitivos que disparam filtros anti-spam da Meta.

REGRAS:
- Mantenha EXATAMENTE o mesmo significado, intenção e oferta da mensagem original.
- Preserve nomes próprios, valores, links, números e variáveis como {{nome}}.
- Varie levemente: ordem das frases, escolha de palavras, conectivos, pontuação, uso de emojis (se já houver).
- Mantenha o tom (formal/informal) da original.
- NÃO adicione informações novas, NÃO remova informações.
- NÃO use formatação markdown (sem **, ##, etc).
- Responda APENAS com o texto reescrito, sem aspas, sem explicações.`;

export async function humanizarMensagem(mensagemBase: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !mensagemBase?.trim()) return mensagemBase;

  const cacheKey = mensagemBase.trim().substring(0, 100);
  const variacoes = cache.get(cacheKey) || [];

  // Se já temos variações, retorna uma aleatória (economiza tokens em campanhas grandes)
  if (variacoes.length >= 5 && Math.random() < 0.7) {
    return variacoes[Math.floor(Math.random() * variacoes.length)];
  }

  try {
    const resp = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.9,
        max_tokens: 512,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Mensagem original:\n${mensagemBase}` },
        ],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      console.error('[HUMANIZACAO] Falha OpenAI', resp.status, errText.slice(0, 200));
      return mensagemBase;
    }

    const data: any = await resp.json();
    const texto = data?.choices?.[0]?.message?.content?.trim();
    if (!texto) return mensagemBase;

    // Atualiza cache
    variacoes.push(texto);
    if (variacoes.length > CACHE_MAX) variacoes.shift();
    cache.set(cacheKey, variacoes);

    return texto;
  } catch (err: any) {
    console.error('[HUMANIZACAO] Erro', err.message);
    return mensagemBase;
  }
}
