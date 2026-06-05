import { Router, Request, Response } from 'express';
import { spawn } from 'child_process';
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

    const openaiKey = process.env.OPENAI_API_KEY || '';
    if (!openaiKey) {
      return res.status(503).json({ error: 'OPENAI_API_KEY não configurada' });
    }

    const args = [
      '--agent', 'main',
      '--message', message.trim(),
      '--json',
    ];

    if (sessionKey?.trim()) {
      args.push('--session-key', sessionKey.trim());
    }

    try {
      const result = await runOpenClaw(args, openaiKey);
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
  apiKey: string,
  timeoutMs = 45_000,
): Promise<string> {
  const args = [
    '--agent', 'main',
    '--session-key', sessionKey,
    '--message', mensagem,
    '--json',
  ];

  const { reply } = await runOpenClaw(args, apiKey, timeoutMs);
  return reply;
}

function runOpenClaw(
  args: string[],
  openaiKey: string,
  timeoutMs = 45_000,
): Promise<{ reply: string; toolCalls: number }> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';

    const proc = spawn('openclaw', ['agent', ...args], {
      env: { ...process.env, OPENAI_API_KEY: openaiKey },
      timeout: timeoutMs,
    });

    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`openclaw saiu com código ${code}: ${stderr.slice(0, 300)}`));
        return;
      }

      try {
        const parsed = JSON.parse(stdout);
        const result = parsed?.result ?? parsed;
        const reply: string = result?.finalAssistantVisibleText
          || result?.finalAssistantRawText
          || '';
        const toolCalls: number = result?.toolSummary?.calls ?? 0;

        if (!reply) {
          reject(new Error('OpenClaw não retornou texto'));
          return;
        }

        resolve({ reply, toolCalls });
      } catch {
        reject(new Error(`Falha ao parsear resposta OpenClaw: ${stdout.slice(0, 300)}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Falha ao iniciar openclaw: ${err.message}`));
    });
  });
}
