import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import jwt from 'jsonwebtoken';

const ADMIN_KEY = process.env.OPENCLAW_ADMIN_KEY;
if (!ADMIN_KEY) {
  console.warn('[OPENCLAW] OPENCLAW_ADMIN_KEY não configurado — acesso via admin key desabilitado (apenas JWT funcionará)');
}
const OPENCLAW_PROXY = process.env.OPENCLAW_PROXY_URL || 'http://172.19.0.1:18790';

function checkAuth(req: Request, res: Response): boolean {
  // 1. Admin key no header (curl/ferramentas externas) — apenas se configurada
  if (ADMIN_KEY) {
    const headerKey = req.headers['x-openclaw-key'] as string | undefined;
    if (headerKey && headerKey === ADMIN_KEY) return true;

    // 2. Admin key no body (CRM frontend — evita CORS preflight em header customizado)
    const bodyKey = (req.body as any)?._adminKey;
    if (bodyKey && bodyKey === ADMIN_KEY) return true;
  }

  // 3. JWT Bearer válido
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(auth.slice(7), process.env.JWT_SECRET!) as any;
      (req as any).user = payload;
      return true;
    } catch {
      // token inválido ou expirado
    }
  }

  res.status(401).json({ error: 'Autenticação necessária' });
  return false;
}

export function makeOpenClawRouter(_pool: Pool): Router {
  const router = Router();

  router.post('/chat', async (req: Request, res: Response) => {
    if (!checkAuth(req, res)) return;

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
