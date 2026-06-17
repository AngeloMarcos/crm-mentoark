import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import jwt from 'jsonwebtoken';
import { exec as nodeExec } from 'child_process';

const ADMIN_KEY = process.env.OPENCLAW_ADMIN_KEY;
if (!ADMIN_KEY) {
  console.warn('[OPENCLAW] OPENCLAW_ADMIN_KEY não configurado — acesso via admin key desabilitado (apenas JWT funcionará)');
}

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
      res.status(401).json({ error: 'Sessão inválida ou expirada. Faça login novamente.', code: 'TOKEN_EXPIRED' });
      return false;
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
      const statusCode = (err as any).statusCode ?? 500;
      return res.status(statusCode).json({ error: err.message || 'Erro ao chamar OpenClaw' });
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
  const { reply } = await callProxy(mensagem, sessionKey, timeoutMs, apiKey);
  return reply;
}

async function callProxy(
  message: string,
  sessionKey: string,
  timeoutMs = 45_000,
  apiKey?: string,
): Promise<{ reply: string; toolCalls: number }> {
  const proxyUrl = process.env.OPENCLAW_PROXY_URL;
  
  // Se não tiver proxy configurado, chama OpenAI diretamente
  if (!proxyUrl || proxyUrl === 'http://172.19.0.1:18790') {
    return callOpenAIDirect(message, timeoutMs, apiKey);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${proxyUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, sessionKey }),
      signal: controller.signal,
    });

    if (!res.ok) {
      // O body do erro é lido mas não repassado ao fallback — útil só para debug local.
      const errBody = await res.text().catch(() => String(res.status));
      console.warn(`[OPENCLAW] Proxy falhou (${res.status}): ${errBody.slice(0, 120)}, usando OpenAI direto`);
      return callOpenAIDirect(message, timeoutMs, apiKey);
    }

    const data = await res.json() as { reply?: string; toolCalls?: number; error?: string };
    // Erros vindos do proxy retornam 502 para que o frontend possa diferenciá-los de erros internos (500)
    if (data.error) throw makeError(data.error, 502);
    if (!data.reply) throw makeError('OpenClaw não retornou texto', 502);

    return { reply: data.reply, toolCalls: data.toolCalls ?? 0 };
  } catch (err: any) {
    // err.message pode ser undefined se err não for um Error padrão (ex: rejeição de Promise com string)
    const msg: string = err?.message ?? '';
    if (msg.includes('fetch failed') || msg.includes('ECONNREFUSED') || msg.includes('ECONNRESET')) {
      console.warn('[OPENCLAW] Proxy inacessível, usando OpenAI direto');
      return callOpenAIDirect(message, timeoutMs, apiKey);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function makeError(message: string, statusCode: number): Error {
  const err = new Error(message);
  (err as any).statusCode = statusCode;
  return err;
}

// ── Prompt de sistema do OpenClaw Admin ─────────────────────────────────────
const OPENCLAW_SYSTEM_PROMPT = `Você é o OpenClaw Admin, agente de administração da VPS MentoArk.
Especializado em infraestrutura Docker, Linux e código TypeScript/Node.js.
Você tem acesso à ferramenta "exec" para executar comandos shell diretamente na VPS.

Regras:
- Responda sempre em português, de forma concisa e técnica.
- Use a ferramenta exec para obter dados reais antes de responder (docker ps, df -h, etc).
- NUNCA execute comandos destrutivos: rm -rf /, mkfs, dd if=/dev/zero, shutdown, reboot.
- Para ver logs: docker logs <container> --tail 50
- Para status dos containers: docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
- Para disco: df -h /
- Para memória: free -h

Data/hora atual: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`;

// ── Definição das ferramentas OpenAI ─────────────────────────────────────────
const OPENCLAW_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'exec',
      description: 'Executa um comando shell na VPS e retorna o output',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'Comando shell a executar (ex: docker ps, df -h, cat /etc/hosts)',
          },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_file',
      description: 'Lê o conteúdo de um arquivo na VPS',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Caminho absoluto do arquivo' },
        },
        required: ['path'],
      },
    },
  },
];

// ── Comandos proibidos ────────────────────────────────────────────────────────
const BLOCKED_PATTERNS = [
  /rm\s+-rf\s+\//,
  /mkfs/,
  /dd\s+if=\/dev\/zero/,
  /:\(\)\s*\{/,        // fork bomb
  /shutdown/,
  /reboot/,
  /halt/,
  /poweroff/,
];

function isCommandBlocked(cmd: string): boolean {
  return BLOCKED_PATTERNS.some(p => p.test(cmd));
}

// ── Execução de comandos shell ────────────────────────────────────────────────
function runExec(command: string): Promise<string> {
  return new Promise(resolve => {
    nodeExec(command, { timeout: 30_000, maxBuffer: 200 * 1024 }, (err, stdout, stderr) => {
      const out = (stdout || stderr || err?.message || 'Sem saída').trim();
      resolve(out.slice(0, 3000));
    });
  });
}

// ── Fallback: OpenAI direto com suporte a ferramentas ────────────────────────
// apiKey: usa a chave do agente se fornecida, caso contrário cai para OPENAI_API_KEY do env.
async function callOpenAIDirect(
  message: string,
  timeoutMs: number,
  apiKey?: string,
): Promise<{ reply: string; toolCalls: number }> {
  const key = apiKey || process.env.OPENAI_API_KEY;
  if (!key) {
    throw makeError('IA não configurada. Configure a chave OpenAI no painel de Integrações.', 503);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Reconstrói o prompt de sistema com a hora atual
  const systemPrompt = `Você é o OpenClaw Admin, agente de administração da VPS MentoArk.
Especializado em infraestrutura Docker, Linux e código TypeScript/Node.js.
Você tem acesso à ferramenta "exec" para executar comandos shell diretamente na VPS.

Regras:
- Responda sempre em português, de forma concisa e técnica.
- Use a ferramenta exec para obter dados reais antes de responder (docker ps, df -h, etc).
- NUNCA execute comandos destrutivos: rm -rf /, mkfs, dd if=/dev/zero, shutdown, reboot.
- Para ver logs: docker logs <container> --tail 50
- Para status dos containers: docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
- Para disco: df -h /
- Para memória: free -h

Data/hora atual: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`;

  const messages: any[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: message },
  ];

  let totalToolCalls = 0;
  const MAX_TOOL_ITERS = 5;

  try {
    for (let iter = 0; iter < MAX_TOOL_ITERS; iter++) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: 'gpt-4.1-mini',
          messages,
          tools: OPENCLAW_TOOLS,
          tool_choice: 'auto',
          max_tokens: 2000,
          temperature: 0.1,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => String(res.status));
        const mapped = res.status === 401 ? 503 : res.status === 429 ? 429 : 502;
        throw makeError(`OpenAI ${res.status}: ${errText.slice(0, 200)}`, mapped);
      }

      const data = await res.json() as any;
      const choice = data.choices?.[0];
      if (!choice) throw makeError('OpenAI não retornou resposta', 502);

      const assistantMsg = choice.message;
      messages.push(assistantMsg);

      // Sem tool_calls → resposta final em texto
      if (!assistantMsg.tool_calls?.length) {
        const reply = assistantMsg.content || '';
        if (!reply) throw makeError('OpenAI não retornou resposta', 502);
        return { reply, toolCalls: totalToolCalls };
      }

      // Executar cada tool call
      for (const tc of assistantMsg.tool_calls) {
        totalToolCalls++;
        let toolResult = '';
        try {
          const args = JSON.parse(tc.function.arguments || '{}');

          if (tc.function.name === 'exec') {
            const cmd = String(args.command || '').trim();
            if (!cmd) {
              toolResult = 'Erro: comando vazio.';
            } else if (isCommandBlocked(cmd)) {
              toolResult = `Comando bloqueado por política de segurança: "${cmd}"`;
            } else {
              console.log(`[OPENCLAW] exec: ${cmd}`);
              toolResult = await runExec(cmd);
            }
          } else if (tc.function.name === 'read_file') {
            const filePath = String(args.path || '').trim();
            if (!filePath) {
              toolResult = 'Erro: caminho vazio.';
            } else {
              toolResult = await runExec(`cat "${filePath.replace(/"/g, '')}"`);
            }
          } else {
            toolResult = `Ferramenta desconhecida: ${tc.function.name}`;
          }
        } catch (toolErr: any) {
          toolResult = `Erro ao executar ferramenta: ${toolErr.message}`;
        }

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: toolResult,
        });
      }
    }

    throw makeError('Loop agêntico atingiu o limite de iterações', 500);
  } finally {
    clearTimeout(timer);
  }
}
