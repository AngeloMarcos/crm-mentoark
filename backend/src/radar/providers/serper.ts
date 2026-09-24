import { RadarSearchError, RespostaBusca, ResultadoBusca, SearchProvider } from '../searchProvider';

const URL_SERPER = 'https://google.serper.dev/search';
const espera = (ms: number) => new Promise(r => setTimeout(r, ms));

export interface OpcoesSerper {
  fetchImpl?: typeof fetch;
  /** Páginas por consulta (cada página é uma chamada paga). */
  maxPaginas?: number;
  /** Resultados por página. O plano gratuito do Serper só aceita 10 (100 dá HTTP 400 enganoso); planos pagos aceitam até 100. */
  num?: number;
  /** Backoff base para 429/5xx (ms). Testes passam 0. */
  backoffMs?: number;
}

/**
 * Serper.dev — provider PADRÃO do Radar.
 *
 * POST pago, então a regra é: só se repete uma chamada quando o servidor RESPONDEU rejeitando
 * (429 ou 5xx: não houve resultado entregue). Timeout/queda de rede é ambíguo — a chamada pode já ter
 * sido cobrada — e nunca é repetida. Uma chamada que devolveu 200 nunca é refeita.
 */
export class SerperProvider implements SearchProvider {
  readonly nome = 'serper';
  readonly custoPorChamadaUsd = 0.001;
  private fetchImpl: typeof fetch;
  private maxPaginas: number;
  private backoffMs: number;
  private num: number;

  constructor(private apiKey: string, opts: OpcoesSerper = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.maxPaginas = opts.maxPaginas ?? 3;
    this.backoffMs = opts.backoffMs ?? 1500;
    this.num = opts.num ?? 10;
  }

  async buscar(consulta: string, maxChamadas: number): Promise<RespostaBusca> {
    const resultados: ResultadoBusca[] = [];
    let chamadas = 0;
    const paginas = Math.max(1, Math.min(this.maxPaginas, maxChamadas));

    for (let page = 1; page <= paginas; page++) {
      let lote: ResultadoBusca[];
      try {
        lote = await this.pagina(consulta, page);
      } catch (err) {
        // Já contabilizadas as páginas anteriores; a que falhou só conta se foi enviada (ambíguo).
        if (err instanceof RadarSearchError) {
          err.chamadas += chamadas + (err.status === 0 ? 1 : 0);
          err.resultadosParciais = resultados;
        }
        throw err;
      }
      chamadas++;
      resultados.push(...lote);
      if (lote.length === 0) break; // acabou antes do limite
    }
    return { resultados, chamadas };
  }

  private async pagina(consulta: string, page: number): Promise<ResultadoBusca[]> {
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      let res: Response;
      try {
        res = await this.fetchImpl(URL_SERPER, {
          method: 'POST',
          headers: { 'X-API-KEY': this.apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: consulta, gl: 'br', hl: 'pt-br', num: this.num, page }),
          signal: AbortSignal.timeout(20000),
        });
      } catch {
        // Ambíguo: pode ter sido cobrado. Não repete. status 0 sinaliza "conta como chamada".
        throw new RadarSearchError('O Serper não confirmou a consulta; ela não foi repetida.', 'consulta', 0);
      }

      if (res.status === 401 || res.status === 403) {
        throw new RadarSearchError('Chave do Serper inválida ou sem permissão. Verifique SERPER_API_KEY.', 'busca', res.status);
      }
      if (res.status === 402) {
        throw new RadarSearchError('Créditos do Serper esgotados. Recarregue para continuar.', 'busca', res.status);
      }
      if (res.status === 429 || res.status >= 500) {
        // Resposta de rejeição, sem resultado entregue: seguro tentar de novo com backoff.
        if (tentativa < 2) { await espera(this.backoffMs * 2 ** tentativa); continue; }
        if (res.status === 429) {
          throw new RadarSearchError('Limite de requisições ou crédito do Serper atingido (429). Busca pausada.', 'busca', 429);
        }
        throw new RadarSearchError(`Serper indisponível (HTTP ${res.status}).`, 'consulta', res.status);
      }
      if (!res.ok) {
        const motivo = await res.json().then((j: any) => String(j?.message ?? '')).catch(() => '');
        throw new RadarSearchError(`Serper recusou a consulta (HTTP ${res.status})${motivo ? `: ${motivo}` : ''}.`, 'consulta', res.status);
      }

      const body: any = await res.json();
      const out: ResultadoBusca[] = [];
      for (const o of body.organic ?? []) {
        const titulo = String(o.title ?? '');
        const snippet = String(o.snippet ?? '');
        out.push({ titulo, snippet, link: String(o.link ?? '') });
        for (const s of o.sitelinks ?? []) {
          out.push({ titulo: String(s.title ?? titulo), snippet, link: String(s.link ?? '') });
        }
      }
      return out;
    }
    throw new RadarSearchError('Serper indisponível.', 'consulta');
  }
}
