/**
 * Propensão a responder — estatística simples sobre o HISTÓRICO real de disparos da própria conta
 * (sem IA). Taxa suavizada por segmento: (respostas + k × taxa_global) / (n + k), para que um
 * segmento com poucas amostras não ganhe nota extrema por acaso.
 *
 * O alvo é "resposta HUMANA": robô de atendimento não conta como resposta.
 * Só usa o que já se sabe ANTES de enviar (origem e se havia nome real) — nada que só existe depois
 * da resposta (ex.: push_name, que só chega quando a pessoa fala).
 */
export interface AmostraPropensao {
  origem: string | null;
  nomeReal: boolean;
  respondeuHumano: boolean;
}

export interface ModeloPropensao {
  total: number;
  taxaGlobal: number;
  k: number;
  segmentos: Record<string, { n: number; respostas: number; taxa: number }>;
}

/** Amostra mínima para o modelo valer; abaixo disso não se inventa nota. */
export const MINIMO_AMOSTRAS = 30;

export function origemDe(origem: string | null | undefined): 'grupo' | 'importado' | 'outro' {
  const o = (origem ?? '').toLowerCase();
  if (o.includes('grupo')) return 'grupo';
  if (o.includes('import')) return 'importado';
  return 'outro';
}

export function segmentoDe(origem: string | null | undefined, nomeReal: boolean): string {
  return `${origemDe(origem)}|${nomeReal ? 'nome' : 'sem_nome'}`;
}

export function construirModelo(amostras: AmostraPropensao[], k = 20): ModeloPropensao {
  const total = amostras.length;
  const respostas = amostras.filter(a => a.respondeuHumano).length;
  const taxaGlobal = total ? respostas / total : 0;
  const cont: Record<string, { n: number; respostas: number }> = {};
  for (const a of amostras) {
    const s = segmentoDe(a.origem, a.nomeReal);
    cont[s] ??= { n: 0, respostas: 0 };
    cont[s].n++;
    if (a.respondeuHumano) cont[s].respostas++;
  }
  const segmentos: ModeloPropensao['segmentos'] = {};
  for (const [s, v] of Object.entries(cont)) {
    segmentos[s] = { ...v, taxa: (v.respostas + k * taxaGlobal) / (v.n + k) };
  }
  return { total, taxaGlobal, k, segmentos };
}

/** Probabilidade estimada (0–1) de resposta humana; null quando o histórico não basta. */
export function prever(m: ModeloPropensao, origem: string | null | undefined, nomeReal: boolean): number | null {
  if (m.total < MINIMO_AMOSTRAS) return null;
  return m.segmentos[segmentoDe(origem, nomeReal)]?.taxa ?? m.taxaGlobal;
}
