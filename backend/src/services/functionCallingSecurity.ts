/**
 * functionCallingSecurity.ts — Tipos estritos e proteções para Function Calling
 *
 * Objetivo:
 *   1. Garantir isolamento multi-tenant (user_id sempre validado como UUID)
 *   2. Bloqueiar operações destructivas (DROP TABLE, DELETE, TRUNCATE, etc.)
 *   3. Tipagem TypeScript rigorosa para argumentos de função
 *   4. Validações centralizadas reutilizáveis
 *
 * Uso:
 *   - Importe tipos e validadores
 *   - Use nos handlers de Function Calling (suporte.ts, mcp.ts, etc.)
 */

import { z } from 'zod';

// ────────────────────────────────────────────────────────────────────────────
// Tipos de base para validação
// ────────────────────────────────────────────────────────────────────────────

const UuidSchema = z.string().uuid('UUID inválido');
const TelefoneSchema = z.string().regex(/^\d{10,15}$/, 'Telefone deve ter 10-15 dígitos');
const UrlSchema = z.string().url('URL inválida');
const EmailSchema = z.string().email('Email inválido');

// Validadores customizados
const UrlPublicaSchema = z.string()
  .regex(/^https:\/\//, 'URL deve começar com https://')
  .regex(/^https:\/\/(?!(?:localhost|127\.|0\.0\.0\.0|10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.))/, 'URL não pode apontar para IPs privados ou localhost');

// ────────────────────────────────────────────────────────────────────────────
// Proteção contra comandos destructivos
// ────────────────────────────────────────────────────────────────────────────

/**
 * Palavras-chave SQL perigosas que NÃO devem aparecer em queries executadas via Function Calling.
 * Nota: Queries legítimas usam parâmetros placeholders ($1, $2...), nunca string interpolation.
 */
const DESTRUCTIVE_SQL_KEYWORDS = [
  'DROP TABLE',
  'DROP DATABASE',
  'DROP SCHEMA',
  'TRUNCATE',
  'DELETE FROM',
  'DELETE ',
  'ALTER TABLE DROP',
  'GRANT',
  'REVOKE',
  'VACUUM',
  'REINDEX',
  'SECURITY DEFINER',
  '--',  // SQL comments (could hide malicious code)
  '/*',  // Block comments
  'COPY',
  'CURSOR',
];

/**
 * Verifica se uma string contém palavras-chave SQL perigosas.
 * Use como validação defensiva adicional — NUNCA confie nisso como única proteção.
 * A proteção real é usar sempre parâmetros placeholders ($1, $2...) nas queries.
 *
 * @param input String a validar
 * @returns true se contiver palavras-chave perigosas
 */
export function containsDestructiveSql(input: string): boolean {
  const upper = input.toUpperCase();
  return DESTRUCTIVE_SQL_KEYWORDS.some(keyword => upper.includes(keyword));
}

/**
 * Valida se um input seguro for ser usados em queries.
 * Rejeita se contiver SQL malicioso.
 */
export function validateSqlSafeInput(input: string, fieldName: string = 'input'): void {
  if (containsDestructiveSql(input)) {
    throw new Error(`${fieldName} contém comandos SQL perigosos e foi rejeitado.`);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Schemas de argumentos para Function Calling
// ────────────────────────────────────────────────────────────────────────────

/**
 * SUPORTE.TS — Ferramentas do Copiloto de Infraestrutura
 */

export const VerificarStatusSistemaArgsSchema = z.object({
  // Nenhum argumento — sempre faz leitura do status do usuário atual
}).strict();

export type VerificarStatusSistemaArgs = z.infer<typeof VerificarStatusSistemaArgsSchema>;

export const AtualizarUrlIntegracaoArgsSchema = z.object({
  tipo: z.enum(['evolution', 'n8n', 'openai', 'anthropic']).describe('Tipo de integração'),
  url: UrlPublicaSchema.describe('Nova URL pública (HTTPS, sem IPs privados)'),
}).strict();

export type AtualizarUrlIntegracaoArgs = z.infer<typeof AtualizarUrlIntegracaoArgsSchema>;

export const ReativarIaContatoArgsSchema = z.object({
  telefone: TelefoneSchema.describe('Número do contato (10-15 dígitos)'),
}).strict();

export type ReativarIaContatoArgs = z.infer<typeof ReativarIaContatoArgsSchema>;

/**
 * MCP/TOOLS.TS — Ferramentas para agentes de IA
 */

export const BuscarContatoArgsSchema = z.object({
  telefone: TelefoneSchema.optional().describe('Telefone para busca exata'),
  nome: z.string().max(100).optional().describe('Nome para busca parcial'),
}).refine(
  obj => obj.telefone || obj.nome,
  'Pelo menos telefone ou nome é obrigatório'
);

export type BuscarContatoArgs = z.infer<typeof BuscarContatoArgsSchema>;

export const CriarOuAtualizarContatoArgsSchema = z.object({
  telefone: TelefoneSchema.describe('Telefone obrigatório (10-15 dígitos)'),
  nome: z.string().max(200).optional().describe('Nome completo do contato'),
  email: EmailSchema.optional().describe('Email do contato'),
  observacao: z.string().max(1000).optional().describe('Observações sobre o contato'),
  estagio: z.enum(['novo', 'contatado', 'qualificado', 'agendado', 'fechado', 'perdido'])
    .optional().default('novo').describe('Estágio no funil de vendas'),
}).strict();

export type CriarOuAtualizarContatoArgs = z.infer<typeof CriarOuAtualizarContatoArgsSchema>;

export const BuscarHistoricoArgsSchema = z.object({
  telefone: TelefoneSchema.describe('Telefone do contato (10-15 dígitos)'),
  limite: z.number().int().min(1).max(50).default(10).describe('Número de mensagens (1-50)'),
}).strict();

export type BuscarHistoricoArgs = z.infer<typeof BuscarHistoricoArgsSchema>;

export const RegistrarPausaArgsSchema = z.object({
  telefone: TelefoneSchema.describe('Telefone do contato'),
  motivo: z.enum(['qualificado', 'pedido_humano', 'negociacao', 'encerramento'])
    .describe('Motivo da pausa'),
  resumo: z.string().max(500).optional().describe('Resumo da conversa para atendente'),
}).strict();

export type RegistrarPausaArgs = z.infer<typeof RegistrarPausaArgsSchema>;

export const BuscarProdutosArgsSchema = z.object({
  busca: z.string().max(100).optional().describe('Termo de busca'),
  preco_min: z.number().min(0).optional().describe('Preço mínimo em reais'),
  preco_max: z.number().min(0).optional().describe('Preço máximo em reais'),
}).refine(
  obj => !obj.preco_min || !obj.preco_max || obj.preco_min <= obj.preco_max,
  'preco_min deve ser menor ou igual a preco_max'
);

export type BuscarProdutosArgs = z.infer<typeof BuscarProdutosArgsSchema>;

export const CriarAgendamentoArgsSchema = z.object({
  telefone: TelefoneSchema.describe('Telefone do contato'),
  tipo: z.enum(['visita', 'reuniao', 'ligacao']).describe('Tipo de agendamento'),
  data_hora: z.string().datetime().describe('Data/hora no formato ISO 8601'),
  observacao: z.string().max(500).optional().describe('Detalhes adicionais'),
}).strict();

export type CriarAgendamentoArgs = z.infer<typeof CriarAgendamentoArgsSchema>;

export const ConsultarFaqArgsSchema = z.object({
  pergunta: z.string().max(300).describe('Pergunta para buscar na FAQ'),
}).strict();

export type ConsultarFaqArgs = z.infer<typeof ConsultarFaqArgsSchema>;

/**
 * MCP.TS — Ferramentas genéricas do MCP Server
 */

export const BuscarContatosMcpArgsSchema = z.object({
  user_id: UuidSchema.describe('UUID do usuário'),
  query: z.string().max(100).describe('Termo de busca'),
  limit: z.number().int().min(1).max(50).default(10),
}).strict();

export type BuscarContatosMcpArgs = z.infer<typeof BuscarContatosMcpArgsSchema>;

export const ObterHistoricoConversaMcpArgsSchema = z.object({
  user_id: UuidSchema.describe('UUID do usuário (isolamento multi-tenant)'),
  session_id: z.string().describe('Telefone ou session_id'),
  limit: z.number().int().min(1).max(100).default(20),
}).strict();

export type ObterHistoricoConversaMcpArgs = z.infer<typeof ObterHistoricoConversaMcpArgsSchema>;

export const CriarContatoMcpArgsSchema = z.object({
  user_id: UuidSchema.describe('UUID do usuário'),
  nome: z.string().max(200).describe('Nome completo'),
  telefone: TelefoneSchema.describe('Telefone no formato 5511999999999'),
  email: EmailSchema.optional(),
  origem: z.string().max(50).default('MCP').describe('Origem do contato'),
}).strict();

export type CriarContatoMcpArgs = z.infer<typeof CriarContatoMcpArgsSchema>;

// ────────────────────────────────────────────────────────────────────────────
// Utilitários para execução segura
// ────────────────────────────────────────────────────────────────────────────

/**
 * Parse e validação de argumentos JSON com tratamento de erro robusto.
 * @param jsonString String JSON do cliente
 * @param schema Zod schema para validação
 * @returns Objeto validado ou lança erro com mensagem clara
 */
export function parseAndValidateArgs<T>(
  jsonString: string,
  schema: z.ZodSchema<T>,
  fieldName: string = 'arguments'
): T {
  try {
    const parsed = JSON.parse(jsonString);
    return schema.parse(parsed);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      const issues = err.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
      throw new Error(`Validação de ${fieldName} falhou: ${issues}`);
    }
    throw new Error(`Parse JSON de ${fieldName} falhou: ${err.message}`);
  }
}

/**
 * Valida isolamento multi-tenant: garante que o userId é UUID válido.
 * Use SEMPRE antes de qualquer query que acesse dados do usuário.
 * @param userId ID do usuário
 * @throws Se userId não for UUID válido
 */
export function validateUserIdIsolation(userId: string | undefined | null): asserts userId is string {
  if (!userId) {
    throw new Error('userId não fornecido — operação bloqueada (isolamento multi-tenant).');
  }
  try {
    UuidSchema.parse(userId);
  } catch {
    throw new Error(`userId inválido (${userId}) — operação bloqueada.`);
  }
}

/**
 * Rejeita argumentos que possam conter comandos SQL malicioso.
 * NOTA: Use junto com parâmetros placeholders ($1, $2...) — isso é apenas camada extra de defesa.
 * @param args Record de argumentos
 * @throws Se algum valor contiver SQL perigoso
 */
export function validateNoDestructiveSql(args: Record<string, any>): void {
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string' && containsDestructiveSql(value)) {
      throw new Error(
        `Argumento "${key}" contém comandos SQL potencialmente destrutivos ` +
        `e foi rejeitado por política de segurança.`
      );
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Types para resultado de execução
// ────────────────────────────────────────────────────────────────────────────

export interface ToolExecutionResult {
  ok: boolean;
  data: unknown;
  error?: string;
}

/**
 * Factory para criar resultado de sucesso.
 */
export function createSuccessResult(data: unknown): ToolExecutionResult {
  return { ok: true, data };
}

/**
 * Factory para criar resultado de erro.
 */
export function createErrorResult(error: string, details?: unknown): ToolExecutionResult {
  return { ok: false, data: details ?? null, error };
}

export default {
  UuidSchema,
  TelefoneSchema,
  UrlPublicaSchema,
  EmailSchema,
  containsDestructiveSql,
  validateSqlSafeInput,
  parseAndValidateArgs,
  validateUserIdIsolation,
  validateNoDestructiveSql,
  createSuccessResult,
  createErrorResult,
};
