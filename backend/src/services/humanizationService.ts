const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
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

  if (!apiKey) {
    console.error('[RASTREIO IA - ERRO] humanizarMensagem: OPENAI_API_KEY ausente no ambiente — retornando original');
    return mensagemBase;
  }
  if (!mensagemBase?.trim()) return mensagemBase;

  const cacheKey = mensagemBase.trim().substring(0, 100);
  const variacoes = cache.get(cacheKey) || [];

  if (variacoes.length >= 5 && Math.random() < 0.7) {
    return variacoes[Math.floor(Math.random() * variacoes.length)];
  }

  // ── [RASTREIO IA] Log pré-chamada ──────────────────────────────────────────
  console.log(
    '[RASTREIO IA] Enviando para OpenAI (humanização)',
    '| Modelo:', MODEL,
    '| ApiKey:', `OK (${apiKey.slice(0, 8)}...)`,
    '| System Prompt:', SYSTEM_PROMPT.slice(0, 100).replace(/\n/g, ' '),
    '| Mensagem do Usuário:', mensagemBase.slice(0, 150),
  );

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
      console.error(
        '[RASTREIO IA - ERRO] humanizarMensagem: OpenAI retornou erro',
        '| Status HTTP:', resp.status,
        '| Diagnóstico:', resp.status === 401 ? 'Chave inválida/expirada'
          : resp.status === 429 ? 'Rate limit ou sem saldo'
          : 'Erro no servidor OpenAI',
        '| Detalhe:', errText.slice(0, 200),
      );
      return mensagemBase;
    }

    const data: any = await resp.json();
    const texto = data?.choices?.[0]?.message?.content?.trim();

    if (!texto) {
      console.warn('[RASTREIO IA - ERRO] humanizarMensagem: resposta vazia da OpenAI — usando original');
      return mensagemBase;
    }

    // ── [RASTREIO IA] Log pós-resposta ─────────────────────────────────────
    console.log(
      '[RASTREIO IA] Resposta OpenAI recebida (humanização)',
      '| TokensUsados:', data?.usage?.total_tokens ?? 'N/A',
      '| Resultado:', texto.slice(0, 100),
    );

    variacoes.push(texto);
    if (variacoes.length > CACHE_MAX) variacoes.shift();
    cache.set(cacheKey, variacoes);

    return texto;
  } catch (err: any) {
    console.error(
      '[RASTREIO IA - ERRO] humanizarMensagem: exceção na chamada OpenAI',
      '| Tipo:', err?.name ?? 'Error',
      '| Mensagem:', err?.message,
      '| Stack:', err?.stack?.split('\n')[1]?.trim() ?? 'N/A',
    );
    return mensagemBase;
  }
}
