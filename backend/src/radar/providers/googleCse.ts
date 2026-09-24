import { RadarSearchError, RespostaBusca, SearchProvider } from '../searchProvider';

/**
 * LEGADO — Google Custom Search JSON API. Não é o padrão: o Google desliga a API em 01/01/2027 e já
 * restringiu a pesquisa "na web toda" para mecanismos novos. Mantido só como opção via
 * RADAR_SEARCH_PROVIDER=google_cse. GET: só relê em falha de rede/5xx (máx. 1 retry).
 */
export class GoogleCseProvider implements SearchProvider {
  readonly nome = 'google_cse';
  readonly custoPorChamadaUsd = 0.005;

  constructor(private apiKey: string, private cx: string, private fetchImpl: typeof fetch = fetch) {}

  async buscar(consulta: string): Promise<RespostaBusca> {
    const url = new URL('https://www.googleapis.com/customsearch/v1');
    url.searchParams.set('key', this.apiKey);
    url.searchParams.set('cx', this.cx);
    url.searchParams.set('q', consulta);
    url.searchParams.set('num', '10');

    let ultimo: unknown;
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      try {
        const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(15000) });
        if (res.status >= 500) { ultimo = new Error(`HTTP ${res.status}`); continue; }
        if (res.status === 429) throw new RadarSearchError('Cota diária do Google CSE esgotada.', 'busca', 429);
        if (res.status === 400 || res.status === 403) {
          throw new RadarSearchError('Chave ou Search Engine ID do Google CSE inválidos, ou API não habilitada.', 'busca', res.status);
        }
        if (!res.ok) throw new RadarSearchError(`Google CSE indisponível (HTTP ${res.status}).`, 'consulta', res.status);
        const body: any = await res.json();
        return {
          chamadas: 1,
          resultados: (body.items ?? []).map((i: any) => ({
            titulo: String(i.title ?? ''), snippet: String(i.snippet ?? ''), link: String(i.link ?? ''),
          })),
        };
      } catch (err) {
        if (err instanceof RadarSearchError) throw err;
        ultimo = err;
      }
    }
    throw new RadarSearchError(`Falha de rede no Google CSE: ${(ultimo as Error)?.message ?? 'desconhecida'}`, 'consulta');
  }
}
