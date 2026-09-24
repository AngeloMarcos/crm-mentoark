/**
 * Contrato dos provedores de busca do Radar. Padrão inspirado no provider.ts do DeskcommCRM (MIT,
 * Copyright (c) 2026 Rafael Melgaço): request_id idempotente, teto por execução e NUNCA repetir uma
 * chamada paga cuja resposta ficou ambígua (timeout) — repetir pode cobrar de novo.
 */
import { extrairLinks, LinkGrupo } from './extrairLinks';

export interface ResultadoBusca { titulo: string; snippet: string; link: string }

/** Uma consulta pode virar várias chamadas pagas (paginação); `chamadas` é o que foi de fato gasto. */
export interface RespostaBusca { resultados: ResultadoBusca[]; chamadas: number }

export interface SearchProvider {
  readonly nome: string;
  /** Custo estimado por chamada em USD (0 para simulado). */
  readonly custoPorChamadaUsd: number;
  /** `maxChamadas` é o que ainda cabe no teto da execução; o provider nunca pode passar disso. */
  buscar(consulta: string, maxChamadas: number): Promise<RespostaBusca>;
}

/** Falha de provider. `escopo: 'busca'` derruba a execução inteira (chave inválida, crédito); `'consulta'` só pula aquela. */
export class RadarSearchError extends Error {
  constructor(
    message: string,
    public escopo: 'busca' | 'consulta' = 'busca',
    public status = 502,
    /** Chamadas pagas já contabilizadas antes do erro (páginas anteriores da mesma consulta). */
    public chamadas = 0,
    public resultadosParciais: ResultadoBusca[] = [],
  ) {
    super(message);
  }
}

export interface LimitesExecucao { maxChamadas: number; maxCustoUsd?: number }

export interface GrupoEncontrado {
  link: LinkGrupo;
  titulo: string;
  snippet: string;
  consulta: string;
}

export interface ResumoExecucao {
  grupos: GrupoEncontrado[];
  consultasFeitas: number;      // consultas iniciadas
  chamadasFeitas: number;       // chamadas pagas (páginas)
  linksVistos: number;          // links de convite achados, contando repetidos entre consultas
  custoUsd: number;
  interrompidaPor: 'teto_chamadas' | 'teto_custo' | 'erro_provider' | null;
  erros: string[];
  /** Erro que derrubou a execução inteira (chave, crédito, limite): quem chama decide pausar o Radar. */
  erroBusca?: { status: number; mensagem: string };
}

/** Executa as consultas respeitando o teto de chamadas/custo; deduplica pelo código de convite. */
export async function coletarLinks(
  provider: SearchProvider,
  consultas: string[],
  limites: LimitesExecucao,
): Promise<ResumoExecucao> {
  const r: ResumoExecucao = {
    grupos: [], consultasFeitas: 0, chamadasFeitas: 0, linksVistos: 0, custoUsd: 0, interrompidaPor: null, erros: [],
  };
  const vistos = new Set<string>();

  const absorver = (consulta: string, resultados: ResultadoBusca[]) => {
    for (const res of resultados) {
      for (const link of extrairLinks(`${res.link} ${res.titulo} ${res.snippet}`)) {
        r.linksVistos++;
        const chave = `${link.plataforma}:${link.codigo}`;
        if (vistos.has(chave)) continue;
        vistos.add(chave);
        r.grupos.push({ link, titulo: res.titulo, snippet: res.snippet, consulta });
      }
    }
  };

  for (const consulta of consultas) {
    let restante = limites.maxChamadas - r.chamadasFeitas;
    if (limites.maxCustoUsd !== undefined) {
      const porCusto = provider.custoPorChamadaUsd > 0
        ? Math.floor((limites.maxCustoUsd - r.custoUsd + 1e-9) / provider.custoPorChamadaUsd)
        : Infinity;
      if (porCusto < restante) restante = porCusto;
      if (restante <= 0) { r.interrompidaPor = 'teto_custo'; break; }
    }
    if (restante <= 0) { r.interrompidaPor = 'teto_chamadas'; break; }

    r.consultasFeitas++;
    try {
      const resp = await provider.buscar(consulta, restante);
      r.chamadasFeitas += resp.chamadas;
      r.custoUsd += resp.chamadas * provider.custoPorChamadaUsd;
      absorver(consulta, resp.resultados);
    } catch (err: any) {
      const chamadas = err instanceof RadarSearchError ? err.chamadas : 0;
      r.chamadasFeitas += chamadas;
      r.custoUsd += chamadas * provider.custoPorChamadaUsd;
      if (err instanceof RadarSearchError) absorver(consulta, err.resultadosParciais);
      r.erros.push(`${consulta}: ${err?.message ?? 'erro'}`);
      if (!(err instanceof RadarSearchError) || err.escopo === 'busca') {
        r.interrompidaPor = 'erro_provider';
        if (err instanceof RadarSearchError) r.erroBusca = { status: err.status, mensagem: err.message };
        break;
      }
    }
  }
  return r;
}

/** Provider simulado: usado quando não há chave (desenvolvimento, testes, busca real desligada). */
export class SimulatedProvider implements SearchProvider {
  readonly nome = 'simulado';
  readonly custoPorChamadaUsd = 0;
  constructor(private respostas: Record<string, ResultadoBusca[]> = {}) {}
  async buscar(consulta: string): Promise<RespostaBusca> {
    return { resultados: this.respostas[consulta] ?? [], chamadas: 1 };
  }
}

/**
 * Situação final de uma busca. 'falhou' quando o provedor derrubou a execução OU quando toda consulta
 * iniciada deu erro (ex.: todas recusadas com 400) — antes esse caso aparecia como "concluída" com 0 grupos.
 */
export function statusDaBusca(r: ResumoExecucao): 'concluida' | 'falhou' {
  if (r.interrompidaPor === 'erro_provider') return 'falhou';
  if (r.consultasFeitas > 0 && r.erros.length >= r.consultasFeitas) return 'falhou';
  return 'concluida';
}
