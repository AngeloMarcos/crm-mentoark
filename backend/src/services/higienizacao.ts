// Higienização de listas: normalização, validação no WhatsApp e enriquecimento.
// Roda como job em background numa fila em Postgres (FOR UPDATE SKIP LOCKED): retomável após
// queda (job "running" sem heartbeat volta pra "queued" e o handler é idempotente).
import { Pool } from 'pg';
import { log } from '../logger';
import { evolutionFetch, sanitizeEvolutionUrl } from '../utils/resilientFetch';
import { normalizarTelefone } from '../utils/telefone';
import { resolverNome } from '../utils/nomes';
import { recalcularPropensao, reprocessarRespostas } from './respostas';
import { classificarLead, compilarConfig, ConfigClassificacao, mesclarConfig } from '../utils/classificacao';

export interface HigienizacaoConfig {
  revalidar_dias: number;
  validacoes_por_min: number;      // chamadas de validação por minuto, POR instância
  enriquecimentos_por_min: number; // perfis consultados por minuto, POR instância
}

export interface ParamsHigienizacao {
  lista_ids?: string[];
  contato_ids?: string[];
  validar?: boolean;     // default true
  enriquecer?: boolean;  // default true
  classificar?: boolean; // default true: nicho, B2B/B2C e score
  forcar?: boolean;      // ignora a janela de revalidação
  respostas?: boolean;   // default true: lê as respostas aos disparos (robô, recusa, interesse, opt-out)
  propensao?: boolean;   // default true: recalcula a propensão a responder pelo histórico
}

export interface JobHigienizacao {
  id: string;
  user_id: string;
  tipo: string;
  status: string;
  params: ParamsHigienizacao;
  etapa: string | null;
  total: number;
  processados: number;
  resultado: Record<string, number>;
  erro: string | null;
}

const LOTE_VALIDACAO = 50;
const STALE_HEARTBEAT = '2 minutes';
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export const CONFIG_PADRAO: HigienizacaoConfig = {
  revalidar_dias: 30,
  validacoes_por_min: 6,
  enriquecimentos_por_min: 30,
};

export async function getConfig(pool: Pool, tenantId: string): Promise<HigienizacaoConfig> {
  const r = await pool.query(
    `SELECT revalidar_dias, validacoes_por_min, enriquecimentos_por_min FROM higienizacao_config WHERE user_id = $1`,
    [tenantId],
  );
  return r.rows[0] ? { ...CONFIG_PADRAO, ...r.rows[0] } : { ...CONFIG_PADRAO };
}

// ── Normalização (varredura) ─────────────────────────────────────────────────────────────
// Apanha contatos ainda sem `tipo_telefone` — de qualquer ponto do sistema que os tenha
// inserido — e preenche as colunas derivadas. Nunca altera telefone/nome originais.
export async function normalizarPendentes(pool: Pool, maxLotes = 5, tenantId?: string): Promise<number> {
  let total = 0;
  for (let i = 0; i < maxLotes; i++) {
    const params: any[] = [];
    let filtro = '';
    if (tenantId) { params.push(tenantId); filtro = 'AND user_id = $1'; }
    const { rows } = await pool.query(
      `SELECT id, telefone, nome, push_name FROM contatos
       WHERE tipo_telefone IS NULL AND telefone IS NOT NULL ${filtro}
       ORDER BY id LIMIT 500`,
      params,
    );
    if (!rows.length) break;

    const ids: string[] = [], originais: string[] = [], normas: (string | null)[] = [], tipos: string[] = [];
    const primeiros: (string | null)[] = [], confiaveis: boolean[] = [], status: string[] = [];
    for (const r of rows) {
      const t = normalizarTelefone(r.telefone);
      const n = resolverNome(r.nome, r.push_name, r.telefone);
      ids.push(r.id);
      originais.push(r.telefone);
      normas.push(t.normalizado);
      tipos.push(t.tipo);
      primeiros.push(n.primeiroNome);
      confiaveis.push(n.confiavel);
      // Fixo/inválido nunca tem WhatsApp: já nasce resolvido, sem gastar chamada à Evolution.
      status.push(t.tipo === 'fixo' || t.tipo === 'invalido' ? 'sem_whatsapp' : 'pendente');
    }

    await pool.query(
      `UPDATE contatos c SET
         telefone_original    = COALESCE(c.telefone_original, v.orig),
         telefone_normalizado = v.norm,
         tipo_telefone        = v.tipo,
         primeiro_nome        = v.pn,
         nome_confiavel       = v.conf,
         whatsapp_status      = CASE WHEN c.whatsapp_status = 'pendente' THEN v.st ELSE c.whatsapp_status END
       FROM (
         SELECT unnest($1::uuid[]) AS id, unnest($2::text[]) AS orig, unnest($3::text[]) AS norm,
                unnest($4::text[]) AS tipo, unnest($5::text[]) AS pn, unnest($6::boolean[]) AS conf,
                unnest($7::text[]) AS st
       ) v
       WHERE c.id = v.id`,
      [ids, originais, normas, tipos, primeiros, confiaveis, status],
    );
    total += rows.length;
    if (rows.length < 500) break;
  }
  return total;
}

// ── Instâncias e limitador de taxa ───────────────────────────────────────────────────────
async function instanciasConectadas(pool: Pool, tenantId: string): Promise<string[]> {
  const r = await pool.query(
    `SELECT DISTINCT instancia FROM integracoes_config
     WHERE user_id = $1 AND tipo = 'evolution' AND status = 'conectado'
       AND instancia IS NOT NULL AND instancia <> ''`,
    [tenantId],
  );
  return r.rows.map((x: any) => x.instancia as string);
}

// Distribui as chamadas entre as instâncias: escolhe sempre a que fica livre primeiro, e espera
// até o intervalo mínimo daquela instância. Com N instâncias a vazão total é N vezes a de uma.
class LimitadorInstancias {
  private livreEm = new Map<string, number>();
  constructor(private instancias: string[], private intervaloMs: number) {
    for (const i of instancias) this.livreEm.set(i, 0);
  }
  async proxima(): Promise<string> {
    let melhor = this.instancias[0];
    for (const i of this.instancias) {
      if ((this.livreEm.get(i) ?? 0) < (this.livreEm.get(melhor) ?? 0)) melhor = i;
    }
    const agora = Date.now();
    const livre = this.livreEm.get(melhor) ?? 0;
    this.livreEm.set(melhor, Math.max(agora, livre) + this.intervaloMs);
    if (livre > agora) await sleep(livre - agora);
    return melhor;
  }
}

function credenciaisEvolution(): { base: string; apiKey: string } {
  const base = sanitizeEvolutionUrl(process.env.EVOLUTION_API_URL || 'https://disparo.mentoark.com.br');
  const apiKey = process.env.EVOLUTION_API_KEY || '';
  return { base, apiKey };
}

// ── Alvo (quais contatos) ────────────────────────────────────────────────────────────────
function condicaoAlvo(p: ParamsHigienizacao): { sql: string; values: any[] } {
  // $1 = tenant. Demais parâmetros a partir de $2.
  if (p.contato_ids?.length) return { sql: 'c.id = ANY($2::uuid[])', values: [p.contato_ids] };
  if (p.lista_ids?.length) {
    return {
      sql: `c.id IN (SELECT contato_id FROM contato_listas WHERE user_id = $1 AND lista_id = ANY($2::uuid[]))`,
      values: [p.lista_ids],
    };
  }
  return { sql: 'TRUE', values: [] };
}

class JobCancelado extends Error {}

async function atualizarProgresso(
  pool: Pool, jobId: string, etapa: string, total: number, processados: number, resultado: Record<string, number>,
): Promise<void> {
  const r = await pool.query(
    `UPDATE higienizacao_jobs
     SET etapa = $2, total = $3, processados = $4, resultado = $5::jsonb,
         heartbeat_at = now(), updated_at = now()
     WHERE id = $1 RETURNING cancelar`,
    [jobId, etapa, total, processados, JSON.stringify(resultado)],
  );
  if (r.rows[0]?.cancelar) throw new JobCancelado();
}

// ── Etapa 1: validação de números no WhatsApp ────────────────────────────────────────────
async function etapaValidacao(
  pool: Pool, job: JobHigienizacao, cfg: HigienizacaoConfig, resultado: Record<string, number>,
): Promise<void> {
  const tenantId = job.user_id;
  const alvo = condicaoAlvo(job.params);
  const forcar = !!job.params.forcar;
  const dias = Math.max(1, cfg.revalidar_dias);

  // Só celular/internacional: fixo e inválido já nascem resolvidos. Número verificado dentro da
  // janela de revalidação não gasta chamada; 'erro' é sempre tentado de novo.
  const base = `
    FROM contatos c
    WHERE c.user_id = $1 AND ${alvo.sql}
      AND c.tipo_telefone IN ('celular', 'internacional')
      AND c.telefone_normalizado IS NOT NULL
      AND ($${alvo.values.length + 2}::boolean
           OR c.whatsapp_status IN ('pendente', 'erro')
           OR c.whatsapp_verificado_em IS NULL
           OR c.whatsapp_verificado_em < now() - make_interval(days => $${alvo.values.length + 3}::int))`;
  const valoresBase = [tenantId, ...alvo.values, forcar, dias];

  const cont = await pool.query(`SELECT count(*)::int AS n ${base}`, valoresBase);
  const total: number = cont.rows[0].n;
  resultado.validacao_total = total;
  await atualizarProgresso(pool, job.id, 'validando', total, 0, resultado);
  if (!total) return;

  const instancias = await instanciasConectadas(pool, tenantId);
  if (!instancias.length) throw new Error('Nenhuma instância WhatsApp conectada para validar os números.');
  const { base: evoBase, apiKey } = credenciaisEvolution();
  if (!apiKey) throw new Error('EVOLUTION_API_KEY não configurada no servidor.');

  const limitador = new LimitadorInstancias(instancias, Math.ceil(60_000 / Math.max(1, cfg.validacoes_por_min)));
  const idxKeyset = valoresBase.length + 1;
  let ultimoId = '00000000-0000-0000-0000-000000000000';
  let processados = 0;
  let falhasSeguidas = 0;

  for (;;) {
    const lote = await pool.query(
      `SELECT c.id, c.telefone_normalizado ${base} AND c.id > $${idxKeyset}::uuid
       ORDER BY c.id LIMIT ${LOTE_VALIDACAO}`,
      [...valoresBase, ultimoId],
    );
    if (!lote.rows.length) break;
    ultimoId = lote.rows[lote.rows.length - 1].id;

    const instancia = await limitador.proxima();
    let resposta: any[] | null = null;
    try {
      const r = await evolutionFetch(`${evoBase}/chat/whatsappNumbers/${encodeURIComponent(instancia)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: apiKey },
        body: JSON.stringify({ numbers: lote.rows.map((x: any) => x.telefone_normalizado) }),
      });
      if (r.ok) {
        const json = await r.json().catch(() => null);
        resposta = Array.isArray(json) ? json : null;
      } else {
        log.warn('HIGIENIZACAO', 'whatsappNumbers respondeu erro', { status: r.status, instancia });
      }
    } catch (err: any) {
      log.warn('HIGIENIZACAO', 'Falha ao chamar whatsappNumbers', { err: err?.message, instancia });
    }

    if (!resposta) {
      // Evolution indisponível: NÃO grava status nenhum (não envenena a base) — o lote fica
      // pendente pra próxima execução. Muitas falhas seguidas abortam o job.
      falhasSeguidas++;
      resultado.falhas_lote = (resultado.falhas_lote ?? 0) + 1;
      if (falhasSeguidas >= 3) throw new Error('Evolution API indisponível (3 lotes seguidos falharam). Tente novamente mais tarde.');
      processados += lote.rows.length;
      await atualizarProgresso(pool, job.id, 'validando', total, processados, resultado);
      continue;
    }
    falhasSeguidas = 0;

    const porNumero = new Map<string, { exists: boolean; jid: string | null }>();
    for (const item of resposta) {
      const chave = String(item?.number ?? item?.jid ?? '').split('@')[0].replace(/\D/g, '');
      if (chave) porNumero.set(chave, { exists: !!item?.exists, jid: item?.jid ? String(item.jid) : null });
    }

    const ids: string[] = [], st: string[] = [], jids: (string | null)[] = [], jidNums: (string | null)[] = [];
    for (const row of lote.rows) {
      const achado = porNumero.get(String(row.telefone_normalizado));
      ids.push(row.id);
      if (!achado) {
        st.push('erro'); jids.push(null); jidNums.push(null);
        resultado.erros = (resultado.erros ?? 0) + 1;
      } else if (achado.exists) {
        st.push('valido'); jids.push(achado.jid);
        jidNums.push(achado.jid ? achado.jid.split('@')[0].replace(/\D/g, '') : null);
        resultado.validos = (resultado.validos ?? 0) + 1;
      } else {
        st.push('sem_whatsapp'); jids.push(null); jidNums.push(null);
        resultado.sem_whatsapp = (resultado.sem_whatsapp ?? 0) + 1;
      }
    }

    // O JID devolvido pela Evolution é a verdade sobre o número (resolve o 9º dígito): quando
    // difere do normalizado, ele passa a ser a chave de deduplicação.
    await pool.query(
      `UPDATE contatos c SET
         whatsapp_status = v.st,
         whatsapp_jid = v.jid,
         whatsapp_verificado_em = now(),
         telefone_normalizado = CASE WHEN v.st = 'valido' AND COALESCE(v.jidnum, '') <> '' THEN v.jidnum ELSE c.telefone_normalizado END
       FROM (
         SELECT unnest($1::uuid[]) AS id, unnest($2::text[]) AS st, unnest($3::text[]) AS jid, unnest($4::text[]) AS jidnum
       ) v
       WHERE c.id = v.id AND c.user_id = $5`,
      [ids, st, jids, jidNums, tenantId],
    );

    processados += lote.rows.length;
    await atualizarProgresso(pool, job.id, 'validando', total, processados, resultado);
  }
}

// ── Etapa 2: enriquecimento (perfil e perfil comercial) ──────────────────────────────────
async function etapaEnriquecimento(
  pool: Pool, job: JobHigienizacao, cfg: HigienizacaoConfig, resultado: Record<string, number>,
): Promise<void> {
  const tenantId = job.user_id;
  const alvo = condicaoAlvo(job.params);
  const forcar = !!job.params.forcar;
  const dias = Math.max(1, cfg.revalidar_dias);

  const base = `
    FROM contatos c
    WHERE c.user_id = $1 AND ${alvo.sql}
      AND c.whatsapp_status = 'valido'
      AND c.telefone_normalizado IS NOT NULL
      AND ($${alvo.values.length + 2}::boolean
           OR c.enriquecido_em IS NULL
           OR c.enriquecido_em < now() - make_interval(days => $${alvo.values.length + 3}::int))`;
  const valoresBase = [tenantId, ...alvo.values, forcar, dias];

  const cont = await pool.query(`SELECT count(*)::int AS n ${base}`, valoresBase);
  const total: number = cont.rows[0].n;
  resultado.enriquecimento_total = total;
  await atualizarProgresso(pool, job.id, 'enriquecendo', total, 0, resultado);
  if (!total) return;

  const instancias = await instanciasConectadas(pool, tenantId);
  if (!instancias.length) throw new Error('Nenhuma instância WhatsApp conectada para enriquecer os contatos.');
  const { base: evoBase, apiKey } = credenciaisEvolution();
  if (!apiKey) throw new Error('EVOLUTION_API_KEY não configurada no servidor.');

  const limitador = new LimitadorInstancias(instancias, Math.ceil(60_000 / Math.max(1, cfg.enriquecimentos_por_min)));
  const idxKeyset = valoresBase.length + 1;
  let ultimoId = '00000000-0000-0000-0000-000000000000';
  let processados = 0;
  let falhasSeguidas = 0;
  let ultimoProgresso = Date.now();

  const postJson = async (caminho: string, instancia: string, corpo: unknown): Promise<any | null> => {
    try {
      const r = await evolutionFetch(`${evoBase}${caminho}/${encodeURIComponent(instancia)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: apiKey },
        body: JSON.stringify(corpo),
        timeoutMs: 12_000,
        maxRetries: 1,
      });
      if (!r.ok) return null;
      return await r.json().catch(() => null);
    } catch {
      return null;
    }
  };

  for (;;) {
    const lote = await pool.query(
      `SELECT c.id, c.nome, c.push_name, c.telefone, c.telefone_normalizado ${base} AND c.id > $${idxKeyset}::uuid
       ORDER BY c.id LIMIT 20`,
      [...valoresBase, ultimoId],
    );
    if (!lote.rows.length) break;
    ultimoId = lote.rows[lote.rows.length - 1].id;

    for (const c of lote.rows) {
      const instancia = await limitador.proxima();
      const perfil = await postJson('/chat/fetchProfile', instancia, { number: c.telefone_normalizado });
      if (!perfil) {
        falhasSeguidas++;
        resultado.falhas_perfil = (resultado.falhas_perfil ?? 0) + 1;
        if (falhasSeguidas >= 10) throw new Error('Evolution API não respondeu a 10 consultas de perfil seguidas. Tente novamente mais tarde.');
      } else {
        falhasSeguidas = 0;
        const ehBusiness = perfil.isBusiness === true || perfil.isBusiness === 'true';
        let categoria: string | null = null, descricao: string | null = null, site: string | null = null, email: string | null = null;
        if (ehBusiness) {
          const comercial = await postJson('/chat/fetchBusinessProfile', instancia, { number: c.telefone_normalizado });
          if (comercial) {
            const cat = comercial.category ?? comercial.categories?.[0]?.name ?? comercial.categories?.[0];
            categoria = typeof cat === 'string' ? cat : (cat?.name ?? null);
            descricao = typeof comercial.description === 'string' ? comercial.description.slice(0, 1000) : null;
            const w = Array.isArray(comercial.website) ? comercial.website[0] : comercial.website;
            site = typeof w === 'string' ? w.slice(0, 300) : null;
            email = typeof comercial.email === 'string' ? comercial.email.slice(0, 200) : null;
          }
          resultado.business = (resultado.business ?? 0) + 1;
        }

        const nomePerfil = typeof perfil.name === 'string' ? perfil.name : null;
        const pushFinal = (c.push_name && String(c.push_name).trim()) ? c.push_name : nomePerfil;
        const nome = resolverNome(c.nome, pushFinal, c.telefone);

        await pool.query(
          `UPDATE contatos SET
             enriquecido_em = now(), is_business = $2, business_categoria = $3, business_descricao = $4,
             business_site = $5, business_email = $6,
             push_name = COALESCE(NULLIF(push_name, ''), $7),
             primeiro_nome = $8, nome_confiavel = $9
           WHERE id = $1 AND user_id = $10`,
          [c.id, ehBusiness, categoria, descricao, site, email, nomePerfil, nome.primeiroNome, nome.confiavel, tenantId],
        );
        resultado.enriquecidos = (resultado.enriquecidos ?? 0) + 1;
      }

      processados++;
      if (Date.now() - ultimoProgresso > 3000) {
        ultimoProgresso = Date.now();
        await atualizarProgresso(pool, job.id, 'enriquecendo', total, processados, resultado);
      }
    }
    await atualizarProgresso(pool, job.id, 'enriquecendo', total, processados, resultado);
  }
}

// ── Configuração da classificação (pesos, dicionário de nichos, DDDs) ────────────────────
export async function getConfigClassificacao(pool: Pool, tenantId: string): Promise<ConfigClassificacao> {
  const r = await pool.query(`SELECT classificacao FROM higienizacao_config WHERE user_id = $1`, [tenantId]);
  return mesclarConfig(r.rows[0]?.classificacao ?? undefined);
}

// Lança ConfigInvalida (utils/classificacao) quando o conteúdo é inválido.
export async function salvarConfigClassificacao(pool: Pool, tenantId: string, parcial: unknown): Promise<ConfigClassificacao> {
  const atual = await getConfigClassificacao(pool, tenantId);
  const p: any = parcial && typeof parcial === 'object' ? parcial : {};
  // Campos ausentes no corpo mantêm o valor atual da conta (não voltam ao padrão).
  const novo = mesclarConfig({
    pesos: { ...atual.pesos, ...(p.pesos ?? {}) },
    ddds_interesse: p.ddds_interesse ?? atual.ddds_interesse,
    nichos_alvo: p.nichos_alvo ?? atual.nichos_alvo,
    dicionario: p.dicionario ?? atual.dicionario,
    grupo_b2c_palavras: p.grupo_b2c_palavras ?? atual.grupo_b2c_palavras,
  });
  await pool.query(
    `INSERT INTO higienizacao_config (user_id, classificacao, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (user_id) DO UPDATE SET classificacao = $2::jsonb, updated_at = now()`,
    [tenantId, JSON.stringify(novo)],
  );
  return novo;
}

// ── Etapa 3: classificação (nicho, B2B/B2C) e score ──────────────────────────────────────
// Só regras e pesos, sem IA. Roda por último porque o score usa o resultado da validação e do
// enriquecimento. As tags "nicho:*" e "publico:*" são gerenciadas por esta etapa (as antigas
// dessas duas famílias são trocadas; qualquer outra tag do contato fica intocada).
async function etapaClassificacao(
  pool: Pool, job: JobHigienizacao, resultado: Record<string, number>,
): Promise<void> {
  const tenantId = job.user_id;
  const cc = compilarConfig(await getConfigClassificacao(pool, tenantId));
  const alvo = condicaoAlvo(job.params);
  const base = `FROM contatos c WHERE c.user_id = $1 AND ${alvo.sql}`;
  const valoresBase = [tenantId, ...alvo.values];

  const cont = await pool.query(`SELECT count(*)::int AS n ${base}`, valoresBase);
  const total: number = cont.rows[0].n;
  resultado.classificacao_total = total;
  resultado.publico_b2b = 0;
  resultado.publico_b2c = 0;
  resultado.publico_indefinido = 0;
  await atualizarProgresso(pool, job.id, 'classificando', total, 0, resultado);
  if (!total) return;

  const idxKeyset = valoresBase.length + 1;
  let ultimoId = '00000000-0000-0000-0000-000000000000';
  let processados = 0;

  for (;;) {
    const lote = await pool.query(
      `SELECT c.id, c.nome, c.push_name, c.tipo_telefone, c.telefone_normalizado, c.whatsapp_status,
              c.is_business, c.business_categoria, c.business_descricao, c.nome_confiavel, c.papel_grupo,
              (c.profile_pic_url IS NOT NULL OR c.foto_perfil IS NOT NULL) AS tem_foto,
              COALESCE((SELECT array_agg(l.nome) FROM contato_listas cl JOIN listas l ON l.id = cl.lista_id
                        WHERE cl.contato_id = c.id), '{}') AS listas
       ${base} AND c.id > $${idxKeyset}::uuid
       ORDER BY c.id LIMIT 500`,
      [...valoresBase, ultimoId],
    );
    if (!lote.rows.length) break;
    ultimoId = lote.rows[lote.rows.length - 1].id;

    const ids: string[] = [], nichos: (string | null)[] = [], tipos: string[] = [];
    const scores: number[] = [], detalhes: string[] = [];
    for (const r of lote.rows) {
      const res = classificarLead({
        nome: r.nome, pushName: r.push_name, businessCategoria: r.business_categoria,
        businessDescricao: r.business_descricao, isBusiness: r.is_business, tipoTelefone: r.tipo_telefone,
        telefoneNormalizado: r.telefone_normalizado, whatsappStatus: r.whatsapp_status,
        nomeConfiavel: r.nome_confiavel, temFoto: !!r.tem_foto, papelGrupo: r.papel_grupo, listas: r.listas ?? [],
      }, cc);
      ids.push(r.id);
      nichos.push(res.nicho);
      tipos.push(res.tipoPublico);
      scores.push(res.score);
      detalhes.push(JSON.stringify({ motivos: res.motivos, fontes_nicho: res.fontesNicho }));
      resultado[`publico_${res.tipoPublico}`] = (resultado[`publico_${res.tipoPublico}`] ?? 0) + 1;
    }

    await pool.query(
      `UPDATE contatos c SET
         nicho_detectado = v.nicho, tipo_publico = v.tipo, lead_score = v.score,
         score_detalhe = v.det::jsonb, classificado_em = now(),
         tags = COALESCE((SELECT array_agg(t) FROM unnest(COALESCE(c.tags, '{}'::text[])) t
                          WHERE t NOT LIKE 'nicho:%' AND t NOT LIKE 'publico:%'), '{}'::text[])
                || CASE WHEN v.nicho IS NOT NULL THEN ARRAY['nicho:' || v.nicho] ELSE '{}'::text[] END
                || CASE WHEN v.tipo <> 'indefinido' THEN ARRAY['publico:' || v.tipo] ELSE '{}'::text[] END
       FROM (
         SELECT unnest($1::uuid[]) AS id, unnest($2::text[]) AS nicho, unnest($3::text[]) AS tipo,
                unnest($4::int[]) AS score, unnest($5::text[]) AS det
       ) v
       WHERE c.id = v.id AND c.user_id = $6`,
      [ids, nichos, tipos, scores, detalhes, tenantId],
    );

    processados += lote.rows.length;
    await atualizarProgresso(pool, job.id, 'classificando', total, processados, resultado);
  }
}

// ── Execução do job ──────────────────────────────────────────────────────────────────────
async function executarJob(pool: Pool, job: JobHigienizacao): Promise<void> {
  const cfg = await getConfig(pool, job.user_id);
  const resultado: Record<string, number> = { ...(job.resultado ?? {}) };

  await atualizarProgresso(pool, job.id, 'normalizando', 0, 0, resultado);
  resultado.normalizados = (resultado.normalizados ?? 0) + await normalizarPendentes(pool, 100, job.user_id);

  if (job.params.validar !== false) await etapaValidacao(pool, job, cfg, resultado);
  if (job.params.enriquecer !== false) await etapaEnriquecimento(pool, job, cfg, resultado);
  if (job.params.classificar !== false) await etapaClassificacao(pool, job, resultado);

  // Estas duas etapas usam só o banco (nada do WhatsApp) e valem para a conta inteira.
  if (job.params.respostas !== false) {
    await atualizarProgresso(pool, job.id, 'lendo respostas', 0, 0, resultado);
    const r = await reprocessarRespostas(pool, job.user_id);
    for (const [k, v] of Object.entries(r)) resultado[`respostas_${k}`] = v;
  }
  if (job.params.propensao !== false) {
    await atualizarProgresso(pool, job.id, 'calculando propensão', 0, 0, resultado);
    const p = await recalcularPropensao(pool, job.user_id);
    resultado.propensao_contatos = p.atualizados;
    resultado.propensao_amostras = p.modelo.total;
  }
}

// ── Fila ─────────────────────────────────────────────────────────────────────────────────
export async function enfileirarHigienizacao(
  pool: Pool, tenantId: string, params: ParamsHigienizacao,
): Promise<{ job: JobHigienizacao; jaExistia: boolean }> {
  const ativo = await pool.query(
    `SELECT * FROM higienizacao_jobs WHERE user_id = $1 AND status IN ('queued', 'running') ORDER BY created_at LIMIT 1`,
    [tenantId],
  );
  if (ativo.rows[0]) return { job: ativo.rows[0], jaExistia: true };
  const r = await pool.query(
    `INSERT INTO higienizacao_jobs (user_id, tipo, params) VALUES ($1, 'higienizar', $2::jsonb) RETURNING *`,
    [tenantId, JSON.stringify(params)],
  );
  return { job: r.rows[0], jaExistia: false };
}

let ticando = false;

// Um tick do worker (chamado a cada poucos segundos pelo index.ts).
export async function processarFilaHigienizacao(pool: Pool): Promise<void> {
  if (ticando) return;
  ticando = true;
  try {
    // Retoma jobs cujo processo caiu (sem heartbeat recente).
    await pool.query(
      `UPDATE higienizacao_jobs SET status = 'queued', updated_at = now()
       WHERE status = 'running' AND (heartbeat_at IS NULL OR heartbeat_at < now() - interval '${STALE_HEARTBEAT}')`,
    );

    // Varredura barata: normaliza o que qualquer fluxo tenha inserido sem normalizar.
    await normalizarPendentes(pool, 2);

    const claim = await pool.query(
      `UPDATE higienizacao_jobs
       SET status = 'running', started_at = COALESCE(started_at, now()), heartbeat_at = now(), updated_at = now()
       WHERE id = (SELECT id FROM higienizacao_jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
       RETURNING *`,
    );
    const job: JobHigienizacao | undefined = claim.rows[0];
    if (!job) return;

    log.info('HIGIENIZACAO', 'Job iniciado', { jobId: job.id, tenantId: job.user_id, params: job.params });
    try {
      await executarJob(pool, job);
      await pool.query(
        `UPDATE higienizacao_jobs SET status = 'done', etapa = 'concluido', finished_at = now(), updated_at = now() WHERE id = $1`,
        [job.id],
      );
      log.info('HIGIENIZACAO', 'Job concluído', { jobId: job.id });
    } catch (err: any) {
      if (err instanceof JobCancelado) {
        await pool.query(
          `UPDATE higienizacao_jobs SET status = 'cancelled', finished_at = now(), updated_at = now() WHERE id = $1`,
          [job.id],
        );
        log.info('HIGIENIZACAO', 'Job cancelado', { jobId: job.id });
      } else {
        await pool.query(
          `UPDATE higienizacao_jobs SET status = 'failed', erro = $2, finished_at = now(), updated_at = now() WHERE id = $1`,
          [job.id, String(err?.message ?? err).slice(0, 500)],
        );
        log.error('HIGIENIZACAO', 'Job falhou', { jobId: job.id, err: err?.message, stack: err?.stack });
      }
    }
  } catch (err: any) {
    log.error('HIGIENIZACAO', 'Erro no tick da fila', { err: err?.message });
  } finally {
    ticando = false;
  }
}
