/**
 * suporte_copiloto.ts — Copiloto de Infraestrutura (Auto-Cura)
 *
 * POST /api/suporte/diagnostico
 * Acesso: admin only
 *
 * Fluxo OpenAI Function Calling:
 *  1. Recebe mensagem do usuário.
 *  2. Envia para gpt-4o-mini com 3 ferramentas disponíveis.
 *  3. Se a IA emitir tool_calls, executa a query correspondente no Postgres.
 *  4. Devolve o resultado para a IA continuar o raciocínio.
 *  5. Retorna { resposta, ferramentas_executadas, iteracoes }.
 *
 * Ferramentas disponíveis:
 *  - verificar_status_sistema   → fotografia completa do estado atual
 *  - atualizar_url_integracao   → corrige URL de Evolution/n8n no banco
 *  - contar_ia_pausada          → retorna contagem de contatos com IA pausada
 *
 * Segurança:
 *  - userId sempre do JWT (nunca do body).
 *  - Queries 100% paramétricos ($1, $2…).
 *  - Whitelist estrita de nomes de ferramentas.
 *  - URL validada contra IPs privados (anti-SSRF).
 *  - Máx. 5 iterações por chamada.
 */

import { Router, Response } from 'express';
import { Pool } from 'pg';
import OpenAI from 'openai';
import type { AuthRequest } from '../middleware';
import { log } from '../logger';

// ── Constantes ────────────────────────────────────────────────────────────────

const MAX_ITER    = 5;
const MAX_CHARS   = 2000;
const TOOLS_ALLOW = new Set(['verificar_status_sistema', 'atualizar_url_integracao', 'contar_ia_pausada']);

const TIPOS_INTEGRACAO = new Set(['evolution', 'n8n', 'openai', 'anthropic']);

// UUID v4 pattern
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// HTTPS público — bloqueia IPs privados (anti-SSRF)
const RE_URL  = /^https:\/\/(?!(?:localhost|127\.|0\.0\.0\.0|10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.))[a-zA-Z0-9][a-zA-Z0-9\-._]{1,249}(?::\d{2,5})?(?:\/[^\s]*)?$/;

function isUuid(v: string)  { return RE_UUID.test(v); }
function isHttpsUrl(v: string) { return RE_URL.test(v); }

// ── Definição das ferramentas para a OpenAI ───────────────────────────────────

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'verificar_status_sistema',
      description:
        'Verifica o estado atual do sistema CRM: agentes, provedores de IA, instâncias ' +
        'WhatsApp conectadas, últimas mensagens e configurações de integração (Evolution/n8n). ' +
        'Use como primeiro passo de qualquer diagnóstico.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'atualizar_url_integracao',
      description:
        'Corrige a URL de uma integração na tabela integracoes_config, agentes e agent_configs. ' +
        'Use quando a URL estiver apontando para servidor antigo, offline ou bloqueado.',
      parameters: {
        type: 'object',
        properties: {
          tipo: {
            type: 'string',
            enum: [...TIPOS_INTEGRACAO],
            description: 'Tipo da integração a corrigir.',
          },
          url: {
            type: 'string',
            description: 'Nova URL pública (deve começar com https://, sem IPs privados).',
          },
        },
        required: ['tipo', 'url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'contar_ia_pausada',
      description:
        'Conta quantos contatos estão com a IA pausada manualmente por atendentes ' +
        '(atendente_pausou_ia = true). Também lista os 5 mais recentes.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];

// ── Execução segura das ferramentas ──────────────────────────────────────────

async function executar(
  pool: Pool,
  userId: string,
  nome: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; data: unknown }> {
  // Dupla guarda: userId sempre UUID válido
  if (!isUuid(userId)) return { ok: false, data: { erro: 'userId inválido.' } };

  // Whitelist estrita
  if (!TOOLS_ALLOW.has(nome)) return { ok: false, data: { erro: `Ferramenta desconhecida: "${nome}"` } };

  try {
    switch (nome) {

      // ── verificar_status_sistema ──────────────────────────────────────────
      case 'verificar_status_sistema': {
        const [ag, prov, integ, msgs, agCfg] = await Promise.all([
          pool.query(
            `SELECT nome, ativo, evolution_instancia, evolution_server_url, modelo,
                    (evolution_api_key IS NOT NULL AND evolution_api_key <> '') AS tem_key
             FROM agentes WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 5`,
            [userId],
          ),
          pool.query('SELECT slug, nome, ativo FROM ai_providers WHERE user_id = $1', [userId]),
          pool.query(
            'SELECT tipo, url, instancia, status, updated_at FROM integracoes_config WHERE user_id = $1',
            [userId],
          ),
          pool.query(
            `SELECT content, from_me, instance_name, created_at
             FROM whatsapp_messages WHERE user_id = $1
             ORDER BY created_at DESC LIMIT 5`,
            [userId],
          ),
          pool.query(
            `SELECT nome_agente, modelo_llm, ativo, evolution_instancia, evolution_server_url,
                    (prompt_sistema IS NOT NULL AND prompt_sistema <> '') AS tem_prompt
             FROM agent_configs WHERE user_id = $1 AND ativo = true LIMIT 1`,
            [userId],
          ),
        ]);
        return {
          ok: true,
          data: {
            agentes:           ag.rows,
            ai_providers:      prov.rows,
            integracoes:       integ.rows,
            ultimas_mensagens: msgs.rows,
            agent_config:      agCfg.rows[0] ?? null,
          },
        };
      }

      // ── atualizar_url_integracao ──────────────────────────────────────────
      case 'atualizar_url_integracao': {
        const tipo = String(args.tipo ?? '').toLowerCase().trim();
        const url  = String(args.url  ?? '').trim();

        if (!TIPOS_INTEGRACAO.has(tipo))
          return { ok: false, data: { erro: `tipo "${tipo}" inválido. Use: ${[...TIPOS_INTEGRACAO].join(', ')}.` } };
        if (!isHttpsUrl(url))
          return { ok: false, data: { erro: 'URL inválida. Deve ser https:// com domínio público.' } };

        const rIc = await pool.query(
          `UPDATE integracoes_config SET url = $1, updated_at = NOW()
           WHERE user_id = $2 AND tipo = $3 RETURNING id, tipo, url, instancia, status`,
          [url, userId, tipo],
        );

        let rAg = { rowCount: 0 as number | null };
        let rAcfg = { rowCount: 0 as number | null };
        if (tipo === 'evolution') {
          rAg   = await pool.query(
            'UPDATE agentes SET evolution_server_url = $1, updated_at = NOW() WHERE user_id = $2', [url, userId],
          );
          rAcfg = await pool.query(
            'UPDATE agent_configs SET evolution_server_url = $1, updated_at = NOW() WHERE user_id = $2', [url, userId],
          );
        }

        if (!rIc.rowCount && !rAg.rowCount && !rAcfg.rowCount)
          return { ok: false, data: { aviso: `Nenhuma integração "${tipo}" encontrada.` } };

        return {
          ok: true,
          data: {
            mensagem: `URL do tipo "${tipo}" atualizada.`,
            integracoes_config:        rIc.rows[0] ?? null,
            agentes_atualizados:       rAg.rowCount ?? 0,
            agent_configs_atualizados: rAcfg.rowCount ?? 0,
          },
        };
      }

      // ── contar_ia_pausada ─────────────────────────────────────────────────
      case 'contar_ia_pausada': {
        const [total, recentes] = await Promise.all([
          pool.query(
            `SELECT COUNT(*) AS total FROM contatos
             WHERE user_id = $1 AND atendente_pausou_ia = true`,
            [userId],
          ),
          pool.query(
            `SELECT id, nome, telefone, push_name, updated_at
             FROM contatos
             WHERE user_id = $1 AND atendente_pausou_ia = true
             ORDER BY updated_at DESC LIMIT 5`,
            [userId],
          ),
        ]);
        return {
          ok: true,
          data: {
            total_pausados: Number(total.rows[0]?.total ?? 0),
            recentes:       recentes.rows,
          },
        };
      }

      default:
        return { ok: false, data: { erro: `Ferramenta não mapeada: "${nome}"` } };
    }
  } catch (err: any) {
    log.error('COPILOTO', 'Erro em ferramenta', { nome, err: err?.message, stack: err?.stack });
    return { ok: false, data: { erro: `Erro interno: ${err.message}` } };
  }
}

// ── Prompt do sistema ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Você é o Copiloto de Infraestrutura da Mentoark — especialista em diagnosticar e corrigir problemas no CRM.

CAPACIDADES:
1. verificar_status_sistema → executa primeiro em qualquer diagnóstico
2. atualizar_url_integracao → corrige URLs de Evolution/n8n desatualizadas
3. contar_ia_pausada → verifica contatos bloqueados pela IA

PROTOCOLO:
- Sempre execute verificar_status_sistema antes de sugerir correções.
- Explique o que encontrou e o que foi corrigido de forma clara.
- Se o problema não tiver solução via ferramentas, documente-o.
- Responda sempre em português brasileiro, de forma técnica e objetiva.`;

// ── Router ────────────────────────────────────────────────────────────────────

export default function suporteCopilotoRouter(pool: Pool): Router {
  const router = Router();

  // Verificação de admin inline (já tem authMiddleware no app.use('/api'))
  router.use((req: AuthRequest, res: Response, next) => {
    if (req.userRole !== 'admin')
      return res.status(403).json({ message: 'Acesso restrito a administradores.' });
    next();
  });

  /**
   * POST /api/suporte/diagnostico
   * Body: { mensagem: string }
   */
  router.post('/diagnostico', async (req: AuthRequest, res: Response) => {
    const userId   = req.userId!;
    const mensagem = String(req.body?.mensagem ?? '').trim();

    if (!mensagem)
      return res.status(400).json({ message: 'Campo "mensagem" é obrigatório.' });
    if (mensagem.length > MAX_CHARS)
      return res.status(400).json({ message: `Mensagem muito longa. Máx. ${MAX_CHARS} caracteres.` });

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey)
      return res.status(503).json({ message: 'OPENAI_API_KEY não configurada no servidor.' });

    const openai = new OpenAI({ apiKey });
    const historico: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: mensagem },
    ];

    const ferramentasExecutadas: Array<{
      nome: string; args: unknown; resultado: unknown; ok: boolean;
    }> = [];

    try {
      for (let iter = 0; iter < MAX_ITER; iter++) {
        const completion = await openai.chat.completions.create({
          model:       'gpt-4o-mini',
          messages:    historico,
          tools:       TOOLS,
          tool_choice: 'auto',
          temperature: 0.1,
          max_tokens:  1500,
        });

        const choice = completion.choices[0];
        const msg    = choice.message;

        historico.push(msg); // inclui tool_calls no histórico

        // Sem tool_calls → resposta final
        if (!msg.tool_calls?.length) {
          log.info('COPILOTO', 'resposta final', {
            userId,
            iter: iter + 1,
            tools: ferramentasExecutadas.length,
          });
          return res.json({
            resposta:               msg.content ?? '',
            ferramentas_executadas: ferramentasExecutadas,
            iteracoes:              iter + 1,
          });
        }

        // Processa cada tool_call em sequência
        for (const tc of msg.tool_calls) {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(tc.function.arguments) ?? {}; } catch { args = {}; }

          log.info('COPILOTO', 'executando ferramenta', { tool: tc.function.name, userId });

          const resultado = await executar(pool, userId, tc.function.name, args);

          ferramentasExecutadas.push({ nome: tc.function.name, args, resultado: resultado.data, ok: resultado.ok });

          historico.push({
            role:         'tool',
            tool_call_id: tc.id,
            content:      JSON.stringify(resultado.data),
          });
        }
      }

      // Limite de iterações atingido
      return res.json({
        resposta:               'Limite de iterações atingido. Confira os resultados parciais.',
        ferramentas_executadas: ferramentasExecutadas,
        iteracoes:              MAX_ITER,
      });

    } catch (err: any) {
      log.error('COPILOTO', 'Erro', { err: err?.message, stack: err?.stack });
      if (err?.status === 401) return res.status(503).json({ message: 'OPENAI_API_KEY inválida.' });
      if (err?.status === 429) return res.status(429).json({ message: 'Rate limit OpenAI. Tente em instantes.' });
      return res.status(500).json({ message: err.message });
    }
  });

  return router;
}
