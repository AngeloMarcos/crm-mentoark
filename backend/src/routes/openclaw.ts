import { Router, Request, Response } from 'express';
import { Pool } from 'pg';

export function makeOpenClawRouter(pool: Pool): Router {
  const router = Router();

  // POST /api/openclaw/chat
  // Body: { message: string, sessionKey?: string }
  // Returns: { reply: string, toolCalls: number }
  router.post('/chat', async (req: Request, res: Response) => {
    const { message, sessionKey } = req.body as { message?: string; sessionKey?: string };

    if (!message?.trim()) {
      return res.status(400).json({ error: 'message é obrigatório' });
    }

    try {
      const result = await callProxy(message.trim(), sessionKey?.trim() || 'default');
      return res.json(result);
    } catch (err: any) {
      console.error('[OPENCLAW] Erro:', err.message);
      return res.status(500).json({ error: err.message || 'Erro ao chamar OpenClaw' });
    }
  });

  return router;
}

// URL do proxy HTTP que roda no host da VPS (fora do container Docker)
const OPENCLAW_PROXY = process.env.OPENCLAW_PROXY_URL || 'http://172.19.0.1:18790';

export async function chamarOpenClawAgent(
  mensagem: string,
  sessionKey: string,
  _apiKey: string,
  timeoutMs = 45_000,
): Promise<string> {
  const { reply } = await callProxy(mensagem, sessionKey, timeoutMs);
  return reply;
}

async function callProxy(
  message: string,
  sessionKey: string,
  timeoutMs = 45_000,
): Promise<{ reply: string; toolCalls: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${OPENCLAW_PROXY}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, sessionKey }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const err = await res.text().catch(() => String(res.status));
      throw new Error(`proxy ${res.status}: ${err.slice(0, 200)}`);
    }

    const data = await res.json() as { reply?: string; toolCalls?: number; error?: string };
    if (data.error) throw new Error(data.error);
    if (!data.reply) throw new Error('OpenClaw não retornou texto');

    return { reply: data.reply, toolCalls: data.toolCalls ?? 0 };
  } finally {
    clearTimeout(timer);
  }
}
