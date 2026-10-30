import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import crypto from 'crypto';
import { Pool } from 'pg';
import type { MCPTool } from '../mcp/tools';
import { log } from '../../logger';
import { baseUrlDoTipo } from '../integracoesIA';

export interface AIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | ContentPart[];
}

export interface ContentPart {
  type: 'text' | 'image_url' | 'image';
  text?: string;
  image_url?: { url: string };
  source?: { type: 'base64'; media_type: string; data: string };
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, any>;
}

export interface AIResponse {
  text: string | null;
  toolCalls: ToolCall[];
  inputTokens: number;
  outputTokens: number;
  finishReason: string;
}

// [AUDITORIA] LÓGICA (Sprint Agentes Configurações Avançadas, 2026-09-04): `serviceTier`/
// `reasoningEffort` opcionais aqui pra manter a mesma assinatura entre providers — só
// `OpenAIProvider` usa os dois de verdade (ver comentário lá pra `reasoningEffort`, que só se
// aplica a modelos da família "raciocínio"); Claude ignora ambos silenciosamente.
export interface AICompleteOptions {
  model: string;
  temperature: number;
  maxTokens: number;
  serviceTier?: string | null;
  reasoningEffort?: string | null;
}

export interface AIProvider {
  complete(
    messages: AIMessage[],
    systemPrompt: string,
    tools: MCPTool[],
    options: AICompleteOptions
  ): Promise<AIResponse>;
}

// ── Claude Provider ──────────────────────────────────────────────────────────
export class ClaudeProvider implements AIProvider {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async complete(
    messages: AIMessage[],
    systemPrompt: string,
    tools: MCPTool[],
    opts: AICompleteOptions
  ): Promise<AIResponse> {
    const anthropicTools = tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    }));

    const resp = await this.client.messages.create({
      model: opts.model || 'claude-haiku-4-5-20251001',
      max_tokens: opts.maxTokens || 1024,
      system: systemPrompt,
      messages: messages
        .filter(m => m.role !== 'system')
        .map(m => ({
          role: m.role as 'user' | 'assistant',
          content: typeof m.content === 'string' ? m.content : (m.content as any),
        })),
      tools: anthropicTools.length ? (anthropicTools as any) : undefined,
    });

    const text = resp.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('') || null;

    const toolCalls: ToolCall[] = resp.content
      .filter((b: any) => b.type === 'tool_use')
      .map((b: any) => ({ id: b.id, name: b.name, input: b.input }));

    return {
      text,
      toolCalls,
      inputTokens: resp.usage.input_tokens,
      outputTokens: resp.usage.output_tokens,
      finishReason: resp.stop_reason || 'stop',
    };
  }
}

/** Modelos de raciocínio da OpenAI (o1/o3/o4 e toda a família gpt-5, com ou sem prefixo de rota). */
export function modeloDeRaciocinio(modelo: string | null | undefined): boolean {
  const m = String(modelo || '').replace(/^openai\//i, '');
  return /^(o1|o3|o4)(-|$)/i.test(m) || /^gpt-5/i.test(m);
}

// ── OpenAI Provider ──────────────────────────────────────────────────────────
export class OpenAIProvider implements AIProvider {
  private client: OpenAI;

  constructor(apiKey: string, baseURL?: string | null) {
    // [AUDITORIA] LÓGICA (correção de segurança pós-incidente 2026-07-28/31): maxRetries: 1 em
    // vez do default do SDK (2) — evita triplicar tráfego/custo em 429/5xx sustentado, mantendo
    // 1 retentativa pra falha transitória legítima. Ver mesmo comentário em agentEngine.ts.
    // Integrações (2026-10-29): `baseURL` atende OpenRouter e Gemini, que falam a mesma API.
    this.client = new OpenAI({ apiKey, maxRetries: 1, ...(baseURL ? { baseURL } : {}) });
    this.apiDaOpenAI = !baseURL;
  }

  private apiDaOpenAI: boolean;

  async complete(
    messages: AIMessage[],
    systemPrompt: string,
    tools: MCPTool[],
    opts: AICompleteOptions
  ): Promise<AIResponse> {
    const openaiTools = tools.map(t => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    }));

    const allMessages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...messages
        .filter(m => m.role !== 'system')
        .map(m => ({
          role: m.role as 'user' | 'assistant',
          content:
            typeof m.content === 'string'
              ? m.content
              : (m.content.map((p: any) =>
                  p.type === 'text' ? { type: 'text' as const, text: p.text } : p
                ) as any),
        })),
    ];

    // [AUDITORIA] LÓGICA (Sprint Agentes Configurações Avançadas, 2026-09-04): `reasoning_effort`
    // só é aceito pela API pra modelos da família "raciocínio" (o1/o3/o4/gpt-5 variantes
    // "thinking") — mandar esse parâmetro pra gpt-4o/gpt-4o-mini (os únicos que o seletor de
    // modelo hoje realmente oferece, `Agentes.tsx`) retorna erro 400 da OpenAI ("Unsupported
    // parameter"), o que quebraria TODO agente ativo respondendo cliente de verdade — por isso
    // só inclui o parâmetro quando `opts.model` bate com esse padrão; nos demais casos o campo
    // fica gravado no banco (pronto pra quando o seletor ganhar um modelo reasoning) mas não é
    // enviado — mesmo espírito de "não quebra call existente" que motivou o campo opcional na
    // interface. `service_tier` já é aceito por qualquer modelo desta API, sem essa restrição.
    // Integrações (2026-10-29): a família gpt-5 também é de raciocínio e, como o1/o3/o4, recusa
    // `max_tokens` e `temperature` diferente de 1 (400 "Unsupported parameter") — usa
    // `max_completion_tokens` e deixa a temperatura no padrão. Só vale para a API da OpenAI.
    const ehModeloRaciocinio = this.apiDaOpenAI && modeloDeRaciocinio(opts.model);
    const resp = await this.client.chat.completions.create({
      model: opts.model || 'gpt-4o-mini',
      ...(ehModeloRaciocinio
        ? { max_completion_tokens: opts.maxTokens || 1024 }
        : { temperature: opts.temperature ?? 0.7, max_tokens: opts.maxTokens || 1024 }),
      messages: allMessages,
      tools: openaiTools.length ? openaiTools : undefined,
      ...(opts.serviceTier ? { service_tier: opts.serviceTier as any } : {}),
      ...(opts.reasoningEffort && ehModeloRaciocinio ? { reasoning_effort: opts.reasoningEffort as any } : {}),
    });

    const choice = resp.choices[0];
    const text = choice.message.content || null;
    const toolCalls: ToolCall[] = (choice.message.tool_calls || []).map(tc => ({
      id: tc.id,
      name: tc.function.name,
      input: JSON.parse(tc.function.arguments || '{}'),
    }));

    return {
      text,
      toolCalls,
      inputTokens: resp.usage?.prompt_tokens || 0,
      outputTokens: resp.usage?.completion_tokens || 0,
      finishReason: choice.finish_reason || 'stop',
    };
  }
}

/** Decifra `ai_providers.api_key_enc` (AES-256-CBC com ENCRYPTION_KEY, formato `iv:dados` em hex). */
export function decifrarChaveIA(apiKeyEnc: string): string {
  const keyBuf = Buffer.from(process.env.ENCRYPTION_KEY || '', 'hex');
  const [ivHex, encHex] = apiKeyEnc.split(':');
  const decipher = crypto.createDecipheriv('aes-256-cbc', keyBuf, Buffer.from(ivHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString();
}

// ── Factory: criar provider pelo slug configurado no banco ───────────────────
export async function criarProvider(
  pool: Pool,
  userId: string,
  providerId?: string | null
): Promise<{ provider: AIProvider; modelo: string; providerSlug: string; apiKey: string; explicito: boolean } | null> {
  const query = providerId
    ? `SELECT * FROM ai_providers WHERE id = $1 AND user_id = $2 AND ativo = true LIMIT 1`
    : `SELECT * FROM ai_providers WHERE user_id = $1 AND ativo = true ORDER BY created_at LIMIT 1`;
  const params = providerId ? [providerId, userId] : [userId];

  const r = await pool.query(query, params).catch(() => ({ rows: [] as any[] }));
  if (!r.rows.length) return null;

  const cfg = r.rows[0];

  let apiKey: string;
  try {
    apiKey = decifrarChaveIA(cfg.api_key_enc);
  } catch {
    log.warn('PROVIDER', 'Falha ao descriptografar api_key — usando variável de ambiente');
    apiKey = process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || '';
  }

  // Integrações (2026-10-29): Gemini e OpenRouter falam a API da OpenAI num endereço próprio.
  const provider: AIProvider = cfg.slug === 'claude'
    ? new ClaudeProvider(apiKey)
    : new OpenAIProvider(apiKey, baseUrlDoTipo(cfg.slug, cfg.base_url));

  // `explicito`: o agente escolheu esta integração. Aí o modelo é o do agente; na integração
  // padrão da conta (sem escolha) continua valendo o modelo gravado nela, como antes.
  return { provider, modelo: cfg.modelo, providerSlug: cfg.slug, apiKey, explicito: !!providerId };
}
