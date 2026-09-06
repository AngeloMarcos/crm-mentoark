import { log } from '../logger';

export interface ResultadoEmbedding {
  embedding: number[];
  tokensEntrada: number;
}

// [AUDITORIA] LÓGICA: Gera um vetor via text-embedding-3-large da OpenAI, truncado para 1536
// dimensões pelo parâmetro `dimensions` (suporte nativo da OpenAI a embeddings Matryoshka) —
// a coluna real (documents.embedding) é vector(1536), não vector(3072) (confirmado contra
// crm_hml). Mantém o modelo mais moderno pedido, só ajusta a dimensão de saída pro schema
// existente em vez de migrar a coluna.
// Implementa AbortController para evitar requisições penduradas infinitamente caso a OpenAI fique lenta.
export async function gerarEmbedding(text: string, apiKey: string): Promise<ResultadoEmbedding | null> {
  const url = 'https://api.openai.com/v1/embeddings';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000); // Timeout de 8 segundos

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: text.replace(/\n/g, ' '),
        model: 'text-embedding-3-large',
        dimensions: 1536, // deve casar com documents.embedding (vector(1536))
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      log.error('EMBEDDINGS', 'Erro ao gerar embedding na OpenAI', { status: res.status, err });
      return null;
    }

    const json: any = await res.json().catch(() => ({}));
    const embedding = json?.data?.[0]?.embedding;
    if (!embedding) return null;
    // [AUDITORIA] FIX APLICADO (Sprint Vistoria de Gasto de IA, 2026-08-14): `usage.total_tokens`
    // sempre veio na resposta e sempre foi descartado — sem isso não dava pra calcular custo_usd
    // nenhum pra essas chamadas (embeddings nunca apareciam no dashboard de custo).
    return { embedding, tokensEntrada: Number(json?.usage?.total_tokens) || 0 };
  } catch (err: any) {
    log.error('EMBEDDINGS', 'Erro de rede/timeout ao gerar embedding', { err: err.message });
    return null;
  }
}
