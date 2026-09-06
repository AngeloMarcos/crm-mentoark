/**
 * humanizationService.ts — Reescreve mensagens de disparo em massa com pequenas variações via IA,
 * para evitar o padrão "texto idêntico repetido" que dispara filtros anti-spam da Meta/WhatsApp.
 *
 * [AUDITORIA] LÓGICA: NÃO é usado pelo motor de conversa (agentEngine.ts) — o único consumidor é
 * backend/src/services/disparoProcessor.ts (módulo de Disparos/campanhas em massa). Está nesta
 * lista de auditoria do WhatsApp porque opera sobre mensagens enviadas via Evolution API, mas é
 * um recurso do módulo de Disparos, não do chat em si.
 */
import { Pool } from 'pg';
import { criarProvider } from './providers/index';
import { log } from '../logger';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
// Exportado (não só local) pra `disparoProcessor.ts` registrar o custo com o modelo real usado,
// em vez de arriscar hardcodar um valor que diverge de `OPENAI_MODEL` se essa env var mudar.
export const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
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

// [AUDITORIA] BUG (achado 2026-09-02, revisão de gastos de IA pedida pelo usuário antes de
// reconectar a chave da OpenAI: "preciso que não ocorra mais os gastos absurdos de IA"): esta
// função paga OpenAI de verdade (uma chamada por variação nova, ~30% das mensagens de campanha
// depois do cache aquecer — nada desprezível numa campanha de milhares de contatos) mas nunca
// devolvia os tokens usados pro chamador registrar em `ai_uso_diario` — só um `log.info` solto,
// que não aparece em NENHUM dashboard. Mesmo padrão exato que deixou o gasto de mídia de grupo
// invisível até o saldo zerar em 14/08 (ver AUDITORIA_LOG.md). [AUDITORIA] FIX APLICADO: retorno
// muda de `string` pra `{ texto, tokensEntrada, tokensSaida }` — o chamador (`disparoProcessor.ts`)
// agora registra o custo real via `registrarUsoIA()`, mesmo padrão já usado por Vision/Whisper.
// [AUDITORIA] FIX APLICADO (achado 2026-09-02, mesma sessão, resposta explícita do usuário: "a
// chave vai ficar só na conta da mentoark, cada usuário novo deverá ter sua chave"): antes,
// SEMPRE usava `process.env.OPENAI_API_KEY` (chave global do servidor), pra qualquer conta,
// mesmo quem já tivesse configurado a própria em `ai_providers` — cada campanha de disparo de
// QUALQUER cliente consumia o saldo da Mentoark, nunca o próprio, mesmo já tendo chave cadastrada.
// Agora resolve o provider do tenant primeiro (mesma função/tabela que `agentEngine.ts` já usa,
// `criarProvider`/`ai_providers`) — só cai pro fallback global se o tenant não tiver provider
// próprio configurado (aí sim, por decisão do usuário, é esperado consumir o saldo compartilhado).
// Restrito a `providerSlug === 'openai'` de propósito: esta função é uma chamada crua ao endpoint
// REST da OpenAI (`OPENAI_API_URL` abaixo), não a abstração `AIProvider` — um provider Claude
// configurado aqui falharia (401, endpoint errado), então cai pro fallback global nesse caso
// específico em vez de tentar e falhar sempre.
export async function humanizarMensagem(
  mensagemBase: string, pool: Pool, userId: string,
): Promise<{ texto: string; tokensEntrada: number; tokensSaida: number; modelo: string }> {
  const providerInfo = await criarProvider(pool, userId, null).catch(() => null);
  const apiKey = (providerInfo?.providerSlug === 'openai' ? providerInfo.apiKey : null) || process.env.OPENAI_API_KEY;
  const modelo = (providerInfo?.providerSlug === 'openai' ? providerInfo.modelo : null) || MODEL;
  const semCusto = (texto: string) => ({ texto, tokensEntrada: 0, tokensSaida: 0, modelo });

  if (!apiKey) {
    log.error('RASTREIO IA - ERRO', 'humanizarMensagem: nenhuma chave OpenAI disponível (nem provider do tenant, nem OPENAI_API_KEY do ambiente) — retornando original');
    return semCusto(mensagemBase);
  }
  if (!mensagemBase?.trim()) return semCusto(mensagemBase);

  const cacheKey = mensagemBase.trim().substring(0, 100);
  const variacoes = cache.get(cacheKey) || [];

  if (variacoes.length >= 5 && Math.random() < 0.7) {
    return semCusto(variacoes[Math.floor(Math.random() * variacoes.length)]);
  }

  // ── [RASTREIO IA] Log pré-chamada ──────────────────────────────────────────
  log.info('RASTREIO IA', 'Enviando para OpenAI (humanização)', {
    modelo,
    chaveDoTenant: providerInfo?.providerSlug === 'openai',
    apiKeyPreview: `OK (${apiKey.slice(0, 8)}...)`,
    systemPrompt: SYSTEM_PROMPT.slice(0, 100).replace(/\n/g, ' '),
    mensagemUsuario: mensagemBase.slice(0, 150),
  });

  // [AUDITORIA] FIX APLICADO: esta chamada é aguardada (await) dentro do loop principal de
  // disparoProcessor.ts, uma mensagem por vez — sem timeout, uma OpenAI lenta/travada bloqueava
  // o processamento de TODA a fila de disparos em massa. AbortController com 15s, mesmo padrão
  // já usado em agentEngine.ts (transcreverAudio).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const resp = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelo,
        temperature: 0.9,
        max_tokens: 512,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Mensagem original:\n${mensagemBase}` },
        ],
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      log.error('RASTREIO IA - ERRO', 'humanizarMensagem: OpenAI retornou erro', {
        statusHttp: resp.status,
        diagnostico: resp.status === 401 ? 'Chave inválida/expirada'
          : resp.status === 429 ? 'Rate limit ou sem saldo'
          : 'Erro no servidor OpenAI',
        detalhe: errText.slice(0, 200),
      });
      return semCusto(mensagemBase);
    }

    const data: any = await resp.json();
    const texto = data?.choices?.[0]?.message?.content?.trim();

    if (!texto) {
      log.warn('RASTREIO IA - ERRO', 'humanizarMensagem: resposta vazia da OpenAI — usando original');
      return semCusto(mensagemBase);
    }

    const tokensEntrada = data?.usage?.prompt_tokens || 0;
    const tokensSaida = data?.usage?.completion_tokens || 0;

    // ── [RASTREIO IA] Log pós-resposta ─────────────────────────────────────
    log.info('RASTREIO IA', 'Resposta OpenAI recebida (humanização)', {
      tokensUsados: data?.usage?.total_tokens ?? 'N/A',
      resultado: texto.slice(0, 100),
    });

    variacoes.push(texto);
    if (variacoes.length > CACHE_MAX) variacoes.shift();
    cache.set(cacheKey, variacoes);

    return { texto, tokensEntrada, tokensSaida, modelo };
  } catch (err: any) {
    log.error('RASTREIO IA - ERRO', 'humanizarMensagem: exceção na chamada OpenAI', {
      tipo: err?.name ?? 'Error',
      err: err?.message,
      stack: err?.stack,
    });
    return semCusto(mensagemBase);
  }
}
