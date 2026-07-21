/**
 * suporte.ts — Copiloto Ativo de Infraestrutura (Auto-Cura)
 *
 * Endpoint: POST /api/suporte/diagnostico
 * Acesso:   Admin apenas (authMiddleware + adminMiddleware já aplicados no index.ts)
 *
 * Arquitetura: OpenAI Function Calling em loop agentico controlado.
 *   1. Envia mensagem + ferramentas para o modelo.
 *   2. Intercepta tool_calls, valida e executa as queries no Postgres de forma segura.
 *   3. Devolve resultados para o modelo completar a resposta.
 *   4. Retorna ao cliente com a resposta final + log de ferramentas usadas.
 *
 * Segurança:
 *   - userId vem SEMPRE do JWT (nunca do body).
 *   - Parâmetros de ferramentas são validados antes de qualquer execução.
 *   - Queries usam exclusivamente placeholders paramétricos ($1, $2…).
 *   - Whitelist estrita de tipos e nomes de ferramentas.
 *   - Bloqueia IPs privados/localhost em URLs para prevenir SSRF.
 *   - Limite de 5 iterações por chamada para prevenir loop infinito.
 */

import { Router, Response } from 'express';
import { Pool } from 'pg';
import OpenAI from 'openai';
import type { AuthRequest } from '../middleware';
import { log } from '../logger';
import {
  validateUserIdIsolation,
  validateNoDestructiveSql,
  createSuccessResult,
  createErrorResult,
  VerificarStatusSistemaArgsSchema,
  AtualizarUrlIntegracaoArgsSchema,
  ReativarIaContatoArgsSchema,
} from '../services/functionCallingSecurity';

// ────────────────────────────────────────────────────────────────────────────
// Constantes de validação
// ────────────────────────────────────────────────────────────────────────────

const MAX_ITERACOES = 5;
const MAX_MSG_CHARS = 2000;

/** Tipos de integração que o copiloto pode corrigir. */
const TIPOS_INTEGRACAO: ReadonlySet<string> = new Set([
  'evolution', 'n8n', 'openai', 'anthropic',
]);

/** Nomes de ferramentas permitidos (previne execução arbitrária). */
const FERRAMENTAS_PERMITIDAS: ReadonlySet<string> = new Set([
  'verificar_status_sistema',
  'atualizar_url_integracao',
  'reativar_ia_contato',
]);

const RE_UUID     = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_TELEFONE = /^\d{10,15}$/;

/** URL deve ser HTTPS com domínio público — bloqueia IPs privados (anti-SSRF). */
const RE_URL_PUBLICA = /^https:\/\/(?!(?:localhost|127\.|0\.0\.0\.0|10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.))[a-zA-Z0-9][a-zA-Z0-9\-._]{1,249}(?::\d{2,5})?(?:\/[^\s]*)?$/;

// ────────────────────────────────────────────────────────────────────────────
// Funções auxiliares de validação
// ────────────────────────────────────────────────────────────────────────────

function isValidUuid(v: string): boolean {
  return RE_UUID.test(v);
}

function isValidTelefone(v: string): boolean {
  return RE_TELEFONE.test(v.replace(/\D/g, ''));
}

function isValidPublicUrl(v: string): boolean {
  return RE_URL_PUBLICA.test(v);
}

// ────────────────────────────────────────────────────────────────────────────
// Definição das ferramentas para a OpenAI
// ────────────────────────────────────────────────────────────────────────────

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'verificar_status_sistema',
      description:
        'Verifica o estado atual do sistema CRM: agentes ativos, provedores de IA ' +
        'configurados, instâncias WhatsApp, últimas 5 mensagens e configurações de ' +
        'integração (Evolution, n8n). Use como primeiro passo de qualquer diagnóstico.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'atualizar_url_integracao',
      description:
        'Corrige a URL de uma integração existente em integracoes_config, agentes e ' +
        'agent_configs. Use quando detectar que a URL aponta para servidor antigo, ' +
        'offline ou bloqueado por Cloudflare.',
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
            description:
              'Nova URL pública (deve começar com https:// e usar domínio público válido).',
          },
        },
        required: ['tipo', 'url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reativar_ia_contato',
      description:
        'Reativa a IA para um contato cujo atendimento foi pausado manualmente por um ' +
        'atendente humano. Define atendente_pausou_ia = false e atendimento_ia = ativo.',
      parameters: {
        type: 'object',
        properties: {
          telefone: {
            type: 'string',
            description:
              'Número do contato — somente dígitos, formato internacional ' +
              '(ex: 5511912345678). Aceita DDI+DDD+número.',
          },
        },
        required: ['telefone'],
      },
    },
  },
];

// ────────────────────────────────────────────────────────────────────────────
// Execução segura das ferramentas
// ────────────────────────────────────────────────────────────────────────────

interface ToolResult {
  ok: boolean;
  data: unknown;
  error?: string;
}


async function executarFerramenta(
  pool: Pool,
  userId: string,
  nomeFerramenta: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    // Guarda dupla: userId obrigatoriamente UUID válido (isolamento multi-tenant)
    validateUserIdIsolation(userId);

    // Whitelist de nomes de ferramentas
    if (!FERRAMENTAS_PERMITIDAS.has(nomeFerramenta)) {
      return createErrorResult(`Ferramenta desconhecida: "${nomeFerramenta}"`);
    }

    // Validação de segurança: bloqueia comandos SQL destrutivos nos argumentos
    validateNoDestructiveSql(args);

  switch (nomeFerramenta) {
    // ── verificar_status_sistema ──────────────────────────────────────────────
    case 'verificar_status_sistema': {
      // Valida argumentos com schema estrito (nesse caso, sem argumentos)
      try {
        VerificarStatusSistemaArgsSchema.parse(args);
      } catch (err: any) {
        return createErrorResult(`Argumentos inválidos: ${err.message}`);
      }
      const [agentes, providers, integracoes, mensagens, agentCfg, pausados] =
        await Promise.all([
          pool.query(
            `SELECT nome, ativo, evolution_instancia,
                    evolution_server_url, modelo,
                    (evolution_api_key IS NOT NULL AND evolution_api_key <> '') AS tem_key
             FROM agentes
             WHERE user_id = $1
             ORDER BY updated_at DESC LIMIT 5`,
            [userId],
          ),
          pool.query(
            `SELECT slug, nome, ativo FROM ai_providers WHERE user_id = $1`,
            [userId],
          ),
          pool.query(
            `SELECT tipo, url, instancia, status, updated_at
             FROM integracoes_config WHERE user_id = $1`,
            [userId],
          ),
          pool.query(
            `SELECT content, from_me, instance_name,
                    created_at, message_type
             FROM whatsapp_messages
             WHERE user_id = $1 AND deleted_at IS NULL
             ORDER BY created_at DESC LIMIT 5`,
            [userId],
          ),
          pool.query(
            `SELECT nome_agente, modelo_llm, ativo,
                    evolution_instancia, evolution_server_url,
                    (prompt_sistema IS NOT NULL AND prompt_sistema <> '') AS tem_prompt
             FROM agent_configs
             WHERE user_id = $1 AND ativo = true LIMIT 1`,
            [userId],
          ),
          pool.query(
            `SELECT COUNT(*) AS total
             FROM contatos
             WHERE user_id = $1 AND atendente_pausou_ia = true`,
            [userId],
          ),
        ]);

      return createSuccessResult({
        agentes: agentes.rows,
        ai_providers: providers.rows,
        integracoes: integracoes.rows,
        ultimas_mensagens: mensagens.rows,
        agent_config: agentCfg.rows[0] ?? null,
        contatos_com_ia_pausada: Number(pausados.rows[0]?.total ?? 0),
      });
    }

    // ── atualizar_url_integracao ──────────────────────────────────────────────
    case 'atualizar_url_integracao': {
      // Validação rigorosa com zod schema
      let validatedArgs: any;
      try {
        validatedArgs = AtualizarUrlIntegracaoArgsSchema.parse(args);
      } catch (err: any) {
        return createErrorResult(`Argumentos inválidos para atualizar_url_integracao: ${err.message}`);
      }

      const tipo = validatedArgs.tipo.toLowerCase().trim();
      const url  = validatedArgs.url.trim();

      // Validações já feitas pelo schema, mas log para auditoria
      if (!isValidPublicUrl(url)) {
        return createErrorResult(
          'URL inválida. Requisitos: https://, domínio público (sem IPs privados), sem espaços.'
        );
      }

      // Atualiza integracoes_config (fonte de verdade principal)
      const rIc = await pool.query(
        `UPDATE integracoes_config
         SET url = $1, updated_at = NOW()
         WHERE user_id = $2 AND tipo = $3
         RETURNING id, tipo, url, instancia, status`,
        [url, userId, tipo],
      );

      let rAgentes = { rowCount: 0 };
      let rAgentCfg = { rowCount: 0 };

      // Para Evolution e n8n, sincroniza também nas tabelas de agentes
      if (tipo === 'evolution') {
        rAgentes = await pool.query(
          `UPDATE agentes
           SET evolution_server_url = $1, updated_at = NOW()
           WHERE user_id = $2`,
          [url, userId],
        );
        rAgentCfg = await pool.query(
          `UPDATE agent_configs
           SET evolution_server_url = $1, updated_at = NOW()
           WHERE user_id = $2`,
          [url, userId],
        );
      }

      if (!rIc.rowCount && !rAgentes.rowCount && !rAgentCfg.rowCount) {
        return createErrorResult(
          `Nenhuma integração do tipo "${tipo}" encontrada para este usuário.`
        );
      }

      return createSuccessResult({
        mensagem: `URL do tipo "${tipo}" atualizada com sucesso.`,
        integracoes_config: rIc.rows[0] ?? null,
        agentes_atualizados: rAgentes.rowCount ?? 0,
        agent_configs_atualizados: rAgentCfg.rowCount ?? 0,
      });
    }

    // ── reativar_ia_contato ───────────────────────────────────────────────────
    case 'reativar_ia_contato': {
      // Validação rigorosa com zod schema
      let validatedArgs: any;
      try {
        validatedArgs = ReativarIaContatoArgsSchema.parse(args);
      } catch (err: any) {
        return createErrorResult(`Argumentos inválidos para reativar_ia_contato: ${err.message}`);
      }

      const telefoneRaw = validatedArgs.telefone.replace(/\D/g, '');

      if (!isValidTelefone(telefoneRaw)) {
        return createErrorResult(
          `Telefone inválido: "${validatedArgs.telefone}". Use somente dígitos, entre 10 e 15.`
        );
      }

      const sufixo = `%${telefoneRaw.slice(-11)}`;

      const [rContato, rDados] = await Promise.all([
        pool.query(
          `UPDATE contatos
           SET atendente_pausou_ia = false,
               updated_at = NOW()
           WHERE user_id = $1 AND telefone ILIKE $2
           RETURNING id, nome, telefone, push_name`,
          [userId, sufixo],
        ),
        pool.query(
          `UPDATE dados_cliente
           SET atendimento_ia    = 'ativo',
               pausa_timestamp   = NULL
           WHERE user_id = $1 AND telefone ILIKE $2
           RETURNING id`,
          [userId, sufixo],
        ),
      ]);

      if (!rContato.rowCount && !rDados.rowCount) {
        return createErrorResult(
          `Nenhum contato encontrado com telefone "${telefoneRaw}".`
        );
      }

      return createSuccessResult({
        mensagem: `IA reativada para ${rContato.rows[0]?.nome ?? telefoneRaw}.`,
        contatos_atualizados: rContato.rowCount ?? 0,
        dados_cliente_atualizados: rDados.rowCount ?? 0,
        contato: rContato.rows[0] ?? null,
      });
    }

    default:
      return createErrorResult(`Ferramenta não implementada: "${nomeFerramenta}"`);
  }
  } catch (err: any) {
    log.error('SUPORTE FERRAMENTA ERROR', 'Erro ao executar ferramenta', { err: err?.message, stack: err?.stack });
    return createErrorResult(`Erro ao executar ferramenta: ${err.message}`);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Prompt de sistema do copiloto
// ────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Você é o Copiloto de Infraestrutura da Mentoark — especialista em diagnosticar e corrigir problemas no sistema CRM.

CAPACIDADES:
1. verificar_status_sistema → fotografia completa do estado atual (sempre execute primeiro)
2. atualizar_url_integracao → corrige URLs de Evolution/n8n apontando para servidores errados
3. reativar_ia_contato → despausa a IA para contatos bloqueados por atendentes

PROTOCOLO:
- Sempre verifique o status antes de aplicar qualquer correção.
- Explique o que encontrou, o que foi corrigido e o que ainda precisa de ação manual.
- Se o problema não puder ser resolvido com as ferramentas disponíveis, documente-o claramente.
- Seja técnico, preciso e objetivo. Responda sempre em português brasileiro.
- Nunca invente informações — baseie-se apenas no que as ferramentas retornaram.`;

// ────────────────────────────────────────────────────────────────────────────
// Rota principal
// ────────────────────────────────────────────────────────────────────────────

export default function suporteRouter(pool: Pool): Router {
  const router = Router();

  /**
   * POST /api/suporte/diagnostico
   * Body: { mensagem: string }
   * Retorna: { resposta, ferramentas_executadas, iteracoes }
   */
  router.post('/diagnostico', async (req: AuthRequest, res: Response) => {
    const userId = req.userId!;
    const mensagem = String(req.body?.mensagem ?? '').trim();

    if (!mensagem) {
      return res.status(400).json({ message: 'Campo "mensagem" é obrigatório.' });
    }
    if (mensagem.length > MAX_MSG_CHARS) {
      return res.status(400).json({
        message: `Mensagem muito longa. Máximo: ${MAX_MSG_CHARS} caracteres.`,
      });
    }

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return res.status(503).json({ message: 'OPENAI_API_KEY não configurada no servidor.' });
    }

    const openai = new OpenAI({ apiKey });

    const historico: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: mensagem },
    ];

    const ferramentasExecutadas: Array<{
      nome: string;
      args: unknown;
      resultado: unknown;
      ok: boolean;
    }> = [];

    try {
      for (let iter = 0; iter < MAX_ITERACOES; iter++) {
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

        // Adiciona resposta ao histórico (incluindo tool_calls se existirem)
        historico.push(msg);

        // Sem tool_calls → resposta final do modelo
        if (!msg.tool_calls || msg.tool_calls.length === 0) {
          log.info('SUPORTE COPILOT', 'resposta final', {
            userId,
            iteracoes: iter + 1,
            ferramentas: ferramentasExecutadas.length,
          });
          return res.json({
            resposta:              msg.content ?? '',
            ferramentas_executadas: ferramentasExecutadas,
            iteracoes:             iter + 1,
          });
        }

        // Processa cada tool_call sequencialmente
        for (const tc of msg.tool_calls) {
          // Parse defensivo dos argumentos
          let args: Record<string, unknown> = {};
          try {
            const parsed = JSON.parse(tc.function.arguments);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              args = parsed;
            }
          } catch {
            args = {};
          }

          log.info('SUPORTE COPILOT', 'executando ferramenta', {
            tool: tc.function.name,
            userId,
            args,
          });

          // Logs adicionais de auditoria de segurança
          if (FERRAMENTAS_PERMITIDAS.has(tc.function.name)) {
            log.info('SUPORTE COPILOT SEC', 'destructive_check=starting', {
              tool: tc.function.name,
              argsKeys: Object.keys(args).join(','),
            });
          }

          const resultado = await executarFerramenta(
            pool, userId, tc.function.name, args,
          );

          ferramentasExecutadas.push({
            nome:      tc.function.name,
            args,
            resultado: resultado.data,
            ok:        resultado.ok,
          });

          // Devolve resultado para o modelo continuar o raciocínio
          historico.push({
            role:         'tool',
            tool_call_id: tc.id,
            content:      JSON.stringify(resultado.data),
          });
        }
      }

      // Ultrapassou o limite de iterações
      log.warn('SUPORTE COPILOT', 'Limite de iterações atingido', {
        maxIteracoes: MAX_ITERACOES,
        userId,
      });
      return res.status(200).json({
        resposta:              'Operação encerrada: limite de iterações atingido.',
        ferramentas_executadas: ferramentasExecutadas,
        iteracoes:             MAX_ITERACOES,
      });

    } catch (err: any) {
      const errMsg = err?.message ?? String(err);
      log.error('SUPORTE COPILOT', 'Erro', { err: errMsg, stack: err?.stack });

      if (err?.status === 401 || err?.code === 'invalid_api_key') {
        return res.status(503).json({
          message: 'OPENAI_API_KEY inválida. Atualize a chave no servidor.',
        });
      }
      if (err?.status === 429) {
        return res.status(429).json({
          message: 'Limite de requisições OpenAI atingido. Tente novamente em instantes.',
        });
      }
      return res.status(500).json({ message: `Erro interno do copiloto: ${errMsg}` });
    }
  });

  return router;
}
