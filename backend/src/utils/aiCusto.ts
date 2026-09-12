/**
 * aiCusto.ts — ponto único de preço/registro de custo de IA (extraído de agentEngine.ts,
 * Sprint Vistoria de Gasto de IA, 2026-08-14 — achado do próprio levantamento: até essa sprint,
 * `ai_uso_diario`/`custo_usd` só era gravado no motor de conversa 1:1 — Vision, Whisper,
 * embeddings (RAG) e a chamada de "criar tarefa da conversa" (Kanban, Anthropic) nunca
 * apareciam no dashboard de custo (`GET /api/ai/uso/resumo`), mesmo pagando de verdade. Isso é
 * exatamente o que deixou o desperdício de mídia de grupo (ver fix no mesmo dia, webhook.ts)
 * invisível até o saldo zerar. Extraído pra módulo compartilhado — evita duplicar a tabela de
 * preço numa 2ª cópia (mesmo anti-padrão já achado nesta sessão em `services/suporte.ts` vs
 * `routes/suporte_copiloto.ts`).
 */
import { Pool } from 'pg';
import { log } from '../logger';

// [AUDITORIA] LÓGICA: tabela de preço por 1M tokens, hardcoded (preços mudam; referência:
// 2026-08-07/14, conferir contra a página oficial de pricing do provider antes de confiar
// cegamente daqui a alguns meses). Match por prefixo (`startsWith`) cobre variantes com sufixo
// de data (ex: `gpt-4o-mini-2024-07-18`) sem precisar listar cada uma. Modelo não reconhecido
// cai no preço do gpt-4o-mini (mais barato conhecido, subestima em vez de superestimar) e loga
// aviso — nunca lança erro nem bloqueia o registro de uso por causa de preço desconhecido.
export const PRECO_POR_1M_TOKENS: { prefixo: string; input: number; output: number }[] = [
  { prefixo: 'gpt-4.1',                input: 2.00,  output: 8.00  },
  { prefixo: 'gpt-4o-mini',            input: 0.15,  output: 0.60  },
  { prefixo: 'gpt-4o',                 input: 2.50,  output: 10.00 },
  { prefixo: 'text-embedding-3-large', input: 0.13,  output: 0     },
  { prefixo: 'claude-3-haiku',         input: 0.25,  output: 1.25  },
  { prefixo: 'claude-3-5-haiku',       input: 0.80,  output: 4.00  },
  { prefixo: 'claude-3-5-sonnet',      input: 3.00,  output: 15.00 },
  { prefixo: 'claude-3-opus',          input: 15.00, output: 75.00 },
];

export function estimarCustoUsd(modelo: string, tokensIn: number, tokensOut: number): number {
  const preco = PRECO_POR_1M_TOKENS.find(p => modelo?.startsWith(p.prefixo));
  if (!preco) {
    log.warn('AI_CUSTO', 'Modelo sem preço conhecido para custo_usd — usando preço de gpt-4o-mini como estimativa mínima', { modelo });
  }
  const { input, output } = preco || PRECO_POR_1M_TOKENS.find(p => p.prefixo === 'gpt-4o-mini')!;
  return (tokensIn / 1_000_000) * input + (tokensOut / 1_000_000) * output;
}

// [AUDITORIA] LÓGICA: Whisper cobra por MINUTO de áudio, não por token — preço fixo
// $0,006/minuto (referência 2026-08-14), arredondado pra cima no segundo (mesma unidade que a
// própria OpenAI usa pra faturar).
const PRECO_WHISPER_USD_POR_MINUTO = 0.006;
export function estimarCustoWhisperUsd(duracaoSegundos: number): number {
  const minutos = Math.max(duracaoSegundos, 0) / 60;
  return minutos * PRECO_WHISPER_USD_POR_MINUTO;
}

// [AUDITORIA] LÓGICA: upsert único pra `ai_uso_diario`, extraído do que já existia inline em
// agentEngine.ts (comportamento idêntico, mesma tabela/chave de conflito) — todo call-site novo
// (Vision, Whisper, embeddings, Kanban) chama isto em vez de reimplementar o INSERT.
// [AUDITORIA] LÓGICA (achado 2026-09-02, pedido explícito do usuário antes de reconectar a
// chave da OpenAI: "preciso que não ocorra mais os gastos absurdos de IA"): até esta sprint,
// cada vazamento de gasto (mídia de grupo, `buscar_documentos` numa base vazia, classificador de
// grupo, humanização de Disparos, scoring de leads) foi tapado individualmente conforme
// descoberto — nunca existiu um freio GERAL, então um vazamento ainda não descoberto teria o
// mesmo desfecho do incidente de 14/08 (saldo zerando sem aviso). `AI_LIMITE_DIARIO_USD` (env,
// GLOBAL — soma de todos os tenants, porque hoje `0 contas têm provider próprio`, ver
// AUDITORIA_LOG.md — todo mundo consome da mesma chave/saldo compartilhado) é o freio de
// emergência: se configurada e o gasto do dia (`ai_uso_diario`, mesma tabela que já registra
// tudo) atingir o teto, os pontos de entrada mais caros (conversa 1:1 — `webhook.ts` — e
// classificador de grupo — `grupoTarefaEngine.ts`) param de chamar IA pro resto do dia, sem
// derrubar nada (mensagem continua sendo recebida/salva normalmente, só sem resposta automática —
// mesmo comportamento gracioso já usado quando um agente não tem prompt configurado). Sem a env
// var definida (ou `<= 0`), o gate fica OFF — comportamento idêntico ao de antes desta sprint,
// não muda nada em quem não configurar. Reseta sozinho à meia-noite (`data = CURRENT_DATE`), sem
// precisar de nenhuma ação manual pra reativar no dia seguinte.
export async function orcamentoDiarioExcedido(pool: Pool): Promise<{ excedido: boolean; gastoHojeUsd: number; limiteUsd: number }> {
  const limiteUsd = Number(process.env.AI_LIMITE_DIARIO_USD || 0);
  if (!limiteUsd || limiteUsd <= 0) return { excedido: false, gastoHojeUsd: 0, limiteUsd: 0 };
  try {
    const r = await pool.query(`SELECT COALESCE(SUM(custo_usd), 0) AS total FROM ai_uso_diario WHERE data = CURRENT_DATE`);
    const gastoHojeUsd = Number(r.rows[0]?.total || 0);
    return { excedido: gastoHojeUsd >= limiteUsd, gastoHojeUsd, limiteUsd };
  } catch (err: any) {
    // Falha ao consultar o próprio freio não pode travar a IA pra todo mundo — abre o gate
    // (mesmo espírito de "falha de infra não deve ser pior que o problema que ela previne").
    log.error('AI_CUSTO', 'Falha ao checar orçamento diário — abrindo o gate por precaução', { err: err?.message });
    return { excedido: false, gastoHojeUsd: 0, limiteUsd };
  }
}

export async function registrarUsoIA(pool: Pool, params: {
  userId: string;
  providerSlug: string;
  modelo: string;
  tokensEntrada: number;
  tokensSaida: number;
  custoUsd: number;
}): Promise<void> {
  const { userId, providerSlug, modelo, tokensEntrada, tokensSaida, custoUsd } = params;
  if (!tokensEntrada && !tokensSaida && !custoUsd) return;
  await pool.query(
    `INSERT INTO ai_uso_diario
       (user_id, data, provider_slug, modelo, total_mensagens, tokens_entrada, tokens_saida, custo_usd)
     VALUES ($1, CURRENT_DATE, $2, $3, 1, $4, $5, $6)
     ON CONFLICT (user_id, data, provider_slug, modelo) DO UPDATE
     SET total_mensagens = ai_uso_diario.total_mensagens + 1,
         tokens_entrada  = ai_uso_diario.tokens_entrada  + $4,
         tokens_saida    = ai_uso_diario.tokens_saida    + $5,
         custo_usd       = ai_uso_diario.custo_usd       + $6,
         updated_at = now()`,
    [userId, providerSlug, modelo, tokensEntrada, tokensSaida, custoUsd]
  ).catch(err => log.error('AI_CUSTO', 'Falha ao registrar uso de IA em ai_uso_diario', { err: err?.message, providerSlug, modelo }));
}
