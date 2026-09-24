import { Pool } from 'pg';
import { log } from '../logger';
import { gerarConsultas } from './consultas';
import { criarProvider } from './providers';
import { coletarLinks, statusDaBusca } from './searchProvider';
import { pausaAtiva, pausar, textoPausa } from './validacao';
import { NICHOS_PADRAO } from './nichosPadrao';

export function configProviderDoAmbiente() {
  return criarProvider({
    provider: process.env.RADAR_SEARCH_PROVIDER,
    serperKey: process.env.SERPER_API_KEY,
    serperNum: Number(process.env.SERPER_NUM) || null,
    googleApiKey: process.env.GOOGLE_CSE_API_KEY,
    googleCx: process.env.GOOGLE_CSE_CX,
  });
}

/** Tetos por tenant. "consultas" aqui são CHAMADAS PAGAS ao provider (cada página do Serper conta). */
export const LIMITES = {
  consultasPorDia: () => Number(process.env.RADAR_MAX_CONSULTAS_DIA) || 200,
  consultasPorBusca: () => Number(process.env.RADAR_MAX_CONSULTAS_BUSCA) || 30,
  custoPorBuscaUsd: () => Number(process.env.RADAR_MAX_CUSTO_USD) || 0.5,
};

/** Cria os nichos padrão na primeira vez que o usuário abre o Radar (idempotente). */
export async function semearNichosSeVazio(pool: Pool, userId: string): Promise<void> {
  const { rows } = await pool.query(`SELECT 1 FROM radar_nichos WHERE user_id = $1 LIMIT 1`, [userId]);
  if (rows.length) return;
  for (const n of NICHOS_PADRAO) {
    await pool.query(
      `INSERT INTO radar_nichos (user_id, nome, termos_busca, palavras_positivas, palavras_negativas, regioes)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (user_id, nome) DO NOTHING`,
      [userId, n.nome, n.termos_busca, n.palavras_positivas, n.palavras_negativas, n.regioes],
    );
  }
}

export async function consultasUsadasHoje(pool: Pool, userId: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(consultas_feitas),0)::int AS n FROM radar_buscas
      WHERE user_id = $1 AND created_at >= date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'`,
    [userId],
  );
  return rows[0].n;
}

/** Processa uma busca já registrada (chamado pelo worker da fila). Idempotente: só roda se estiver 'queued'. */
export async function executarBusca(
  pool: Pool, buscaId: string, aoDescobrir?: (grupoIds: string[]) => Promise<unknown>,
): Promise<void> {
  const claim = await pool.query(
    `UPDATE radar_buscas SET status = 'running' WHERE id = $1 AND status = 'queued' RETURNING *`, [buscaId],
  );
  const busca = claim.rows[0];
  if (!busca) return;

  try {
    const { provider, aviso } = configProviderDoAmbiente();

    // Provedor bloqueou/limitou há pouco: não insiste (insistir agrava o bloqueio).
    const pausa = await pausaAtiva(pool, `busca:${provider.nome}`);
    if (pausa) {
      await pool.query(`UPDATE radar_buscas SET status = 'falhou', provider = $2, erro = $3, finished_at = now() WHERE id = $1`,
        [busca.id, provider.nome, `Busca ${textoPausa(pausa)}`.slice(0, 500)]);
      return;
    }

    const nicho = busca.nicho_id
      ? (await pool.query(`SELECT * FROM radar_nichos WHERE id = $1 AND user_id = $2`, [busca.nicho_id, busca.user_id])).rows[0]
      : null;
    const consultas: string[] = busca.consultas;
    const resumo = await coletarLinks(provider, consultas, {
      maxChamadas: busca.max_consultas,
      maxCustoUsd: LIMITES.custoPorBuscaUsd(),
    });

    // Limite/chave/crédito: pausa o Radar por um tempo (persistido) para não martelar o provedor.
    if (resumo.erroBusca && [401, 402, 403, 429].includes(resumo.erroBusca.status)) {
      const minutos = resumo.erroBusca.status === 429
        ? Number(process.env.RADAR_PAUSA_429_MIN) || 30
        : Number(process.env.RADAR_PAUSA_CHAVE_MIN) || 60;
      await pausar(pool, `busca:${provider.nome}`, minutos, resumo.erroBusca.mensagem);
    }

    let novos = 0;
    let existentes = 0;
    const idsNovos: string[] = [];
    for (const g of resumo.grupos) {
      const ins = await pool.query(
        `INSERT INTO radar_grupos (user_id, plataforma, codigo_convite, url, titulo_origem, nicho_id, fonte, busca_id, consulta)
         VALUES ($1,$2,$3,$4,$5,$6,'busca',$7,$8)
         ON CONFLICT (user_id, plataforma, codigo_convite) DO NOTHING RETURNING id, plataforma`,
        [busca.user_id, g.link.plataforma, g.link.codigo, g.link.url, g.titulo.slice(0, 200) || null, nicho?.id ?? null, busca.id, g.consulta],
      );
      if (ins.rowCount) { novos++; if (ins.rows[0].plataforma === 'whatsapp') idsNovos.push(ins.rows[0].id); } else existentes++;
    }

    await pool.query(
      `UPDATE radar_buscas SET status = $2, provider = $3, consultas_feitas = $4, custo_usd = $5, novos = $6,
              existentes = $7, interrompida_por = $8, aviso = $9, erro = $10, links_vistos = $11, finished_at = now() WHERE id = $1`,
      [busca.id, statusDaBusca(resumo), provider.nome,
       resumo.chamadasFeitas, resumo.custoUsd, novos, existentes, resumo.interrompidaPor, aviso ?? null,
       resumo.erros.length ? resumo.erros.join(' | ').slice(0, 1000) : null, resumo.linksVistos],
    );
    log.info('RADAR', 'busca concluída', { buscaId, provider: provider.nome, novos, existentes, chamadas: resumo.chamadasFeitas });

    // Descarta link morto e grupo fora do nicho já na descoberta, sem ninguém precisar clicar.
    if (idsNovos.length && aoDescobrir) {
      await aoDescobrir(idsNovos).catch(err => log.warn('RADAR', 'falha ao enfileirar verificação', { err: err?.message }));
    }
  } catch (err: any) {
    await pool.query(`UPDATE radar_buscas SET status = 'falhou', erro = $2, finished_at = now() WHERE id = $1`, [buscaId, String(err?.message ?? err).slice(0, 500)]);
    log.error('RADAR', 'busca falhou', { buscaId, err: err?.message });
  }
}

export { gerarConsultas };
