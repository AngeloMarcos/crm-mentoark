import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import crypto from 'crypto';
import { Pool } from 'pg';
import type { MCPTool } from '../mcp/tools';
import { log } from '../logger';

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

export interface AIProvider {
  complete(
    messages: AIMessage[],
    systemPrompt: string,
    tools: MCPTool[],
    options: { model: string; temperature: number; maxTokens: number }
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
    opts: { model: string; temperature: number; maxTokens: number }
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

// ── OpenAI Provider ──────────────────────────────────────────────────────────
export class OpenAIProvider implements AIProvider {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async complete(
    messages: AIMessage[],
    systemPrompt: string,
    tools: MCPTool[],
    opts: { model: string; temperature: number; maxTokens: number }
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

    const resp = await this.client.chat.completions.create({
      model: opts.model || 'gpt-4o-mini',
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens || 1024,
      messages: allMessages,
      tools: openaiTools.length ? openaiTools : undefined,
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

// ── Factory: criar provider pelo slug configurado no banco ───────────────────
export async function criarProvider(
  pool: Pool,
  userId: string,
  providerId?: string | null
): Promise<{ provider: AIProvider; modelo: string; providerSlug: string; apiKey: string } | null> {
  const query = providerId
    ? `SELECT * FROM ai_providers WHERE id = $1 AND user_id = $2 AND ativo = true LIMIT 1`
    : `SELECT * FROM ai_providers WHERE user_id = $1 AND ativo = true ORDER BY created_at LIMIT 1`;
  const params = providerId ? [providerId, userId] : [userId];

  const r = await pool.query(query, params).catch(() => ({ rows: [] as any[] }));
  if (!r.rows.length) return null;

  const cfg = r.rows[0];

  let apiKey: string;
  try {
    const encKey = process.env.ENCRYPTION_KEY || '';
    const keyBuf = Buffer.from(encKey, 'hex');
    const [ivHex, encHex] = cfg.api_key_enc.split(':');
    const decipher = crypto.createDecipheriv('aes-256-cbc', keyBuf, Buffer.from(ivHex, 'hex'));
    apiKey = Buffer.concat([
      decipher.update(Buffer.from(encHex, 'hex')),
      decipher.final(),
    ]).toString();
  } catch {
    log.warn('PROVIDER', 'Falha ao descriptografar api_key — usando variável de ambiente');
    apiKey = process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || '';
  }

  let provider: AIProvider;
  switch (cfg.slug) {
    case 'claude':
      provider = new ClaudeProvider(apiKey);
      break;
    case 'openai':
    default:
      provider = new OpenAIProvider(apiKey);
  }

  return { provider, modelo: cfg.modelo, providerSlug: cfg.slug, apiKey };
}
