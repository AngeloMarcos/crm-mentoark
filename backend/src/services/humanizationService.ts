/**
 * humanizationService.ts — Reescreve mensagens de disparo em massa com pequenas variações via IA,
 * para evitar o padrão "texto idêntico repetido" que dispara filtros anti-spam da Meta/WhatsApp.
 *
 * [AUDITORIA] LÓGICA: NÃO é usado pelo motor de conversa (agentEngine.ts) — o único consumidor é
 * backend/src/services/disparoProcessor.ts (módulo de Disparos/campanhas em massa). Está nesta
 * lista de auditoria do WhatsApp porque opera sobre mensagens enviadas via Evolution API, mas é
 * um recurso do módulo de Disparos, não do chat em si.
 */
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
// [AUDITORIA] LÓGICA: chave de cache é o texto-base da campanha (mesma mensagem, muitos
// destinatários) — o cache reaproveita até 5 variações por campanha (70% de chance) para não
// pagar uma chamada de IA por destinatário. O Map em si nunca remove chaves antigas (só limita o
// array por chave), então cresce com o número de campanhas distintas ao longo da vida do
// processo — não chamei de bug porque o volume esperado (campanhas, não mensagens individuais) é
// baixo o bastante para não ser um problema real de memória na prática.
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

// [AUDITORIA] LÓGICA: usa sempre process.env.OPENAI_API_KEY (chave global do servidor), nunca a
// chave/provider configurado pelo usuário em ai_providers — diferente de agentEngine.ts, que
// resolve provider por usuário (criarProvider) e permite OpenAI/Claude/Gemini. Não marquei como
// bug porque pode ser intencional (custo de humanização de campanha centralizado na plataforma,
// mesmo padrão do OpenClaw), mas vale confirmar com o usuário se cada conta deveria usar sua
// própria chave/provider aqui também.
// [AUDITORIA] FIX PENDENTE (motivo: decisão de produto): se a intenção for usar o provider do
// usuário, precisa receber userId/pool como parâmetro e reusar criarProvider() de providers/index
// — mudança de assinatura que afeta o único chamador (disparoProcessor.ts), fora do escopo desta
// auditoria pontual.
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
