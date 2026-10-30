/**
 * indexacao.ts — Base de conhecimento que indexa sozinha (2026-10-30, modelo Cubo: a base mostra
 * "indexando agora / aguardando indexação" e não depende de fluxo externo).
 *
 * Antes: `conhecimento` e `documents` eram gravados sem embedding e a tela mandava "reindexar via
 * n8n" — o n8n está desligado, então NADA era indexado (documents com embedding = 0 em produção).
 *
 * Agora um varredor (cron a cada 2 min + chamada imediata ao salvar) pega o que está pendente:
 *   - item de `conhecimento` novo/editado → vira chunks em `documents` (conhecimento_id, agente_id);
 *   - linha de `documents` sem embedding (aba Documentos/upload) → ganha o embedding.
 * A chave usada é a da integração OpenAI DA CONTA; a do servidor só como reserva.
 */
import { Pool } from 'pg';
import { log } from '../logger';
import { gerarEmbedding } from '../utils/embeddings';
import { registrarUsoIA, estimarCustoUsd } from '../utils/aiCusto';
import { decifrarChaveIA } from './providers/index';

const MODELO_EMBEDDING = 'text-embedding-3-large';
export const TAMANHO_CHUNK = 1500;

const ROTULO_TIPO: Record<string, string> = {
  personalidade: 'Persona', negocio: 'Negócio', faq: 'Pergunta frequente',
  objecao: 'Objeção', script: 'Script',
};

/** Texto que vai para o embedding: tipo + campo + conteúdo, para a busca achar pelo assunto. */
export function textoDoConhecimento(item: { tipo: string; campo?: string | null; categoria?: string | null; conteudo: string; contexto?: string | null }): string {
  const cabecalho = [ROTULO_TIPO[item.tipo] || item.tipo, item.categoria, item.campo].filter(Boolean).join(' · ');
  return [cabecalho, item.conteudo, item.contexto].filter(s => s && String(s).trim()).join('\n').trim();
}

/** Corta em pedaços de até `max` caracteres, preferindo parágrafo e depois frase. */
export function dividirEmChunks(texto: string, max = TAMANHO_CHUNK): string[] {
  const limpo = texto.replace(/\r/g, '').trim();
  if (!limpo) return [];
  if (limpo.length <= max) return [limpo];
  const pedacos: string[] = [];
  let atual = '';
  const empurrar = () => { if (atual.trim()) pedacos.push(atual.trim()); atual = ''; };
  for (const paragrafo of limpo.split(/\n{2,}/)) {
    const partes = paragrafo.length > max ? paragrafo.split(/(?<=[.!?])\s+/) : [paragrafo];
    for (const parte of partes) {
      if (parte.length > max) {               // frase gigante: corte duro
        empurrar();
        for (let i = 0; i < parte.length; i += max) pedacos.push(parte.slice(i, i + max).trim());
        continue;
      }
      if ((atual + '\n\n' + parte).length > max) empurrar();
      atual = atual ? `${atual}\n\n${parte}` : parte;
    }
  }
  empurrar();
  return pedacos;
}

/** Chave OpenAI para embeddings: a integração ativa da conta; senão a do servidor. */
export async function chaveEmbedding(pool: Pool, userId: string): Promise<string | null> {
  const r = await pool.query(
    `SELECT api_key_enc FROM ai_providers WHERE user_id = $1 AND slug = 'openai' AND ativo = true
      ORDER BY (ultimo_status = 'ok') DESC NULLS LAST, created_at LIMIT 1`, [userId]
  ).catch(() => ({ rows: [] as any[] }));
  if (r.rows[0]?.api_key_enc) {
    try { return decifrarChaveIA(r.rows[0].api_key_enc); } catch { /* cai para a do servidor */ }
  }
  return process.env.OPENAI_API_KEY || null;
}

async function embedar(pool: Pool, userId: string, chave: string, texto: string): Promise<number[] | null> {
  const r = await gerarEmbedding(texto, chave);
  if (!r) return null;
  await registrarUsoIA(pool, {
    userId, providerSlug: 'openai', modelo: MODELO_EMBEDDING,
    tokensEntrada: r.tokensEntrada, tokensSaida: 0, custoUsd: estimarCustoUsd(MODELO_EMBEDDING, r.tokensEntrada, 0),
  }).catch(() => {});
  return r.embedding;
}

const vetor = (e: number[]) => `[${e.join(',')}]`;

/** Indexa um item de `conhecimento`: troca os chunks antigos pelos novos. */
async function indexarConhecimento(pool: Pool, item: any, chave: string): Promise<void> {
  await pool.query(`UPDATE conhecimento SET status_indexacao = 'indexando', erro_indexacao = NULL WHERE id = $1`, [item.id]);
  const chunks = dividirEmChunks(textoDoConhecimento(item));
  const vetores: number[][] = [];
  for (const c of chunks) {
    const e = await embedar(pool, item.user_id, chave, c);
    if (!e) throw new Error('A OpenAI recusou o pedido (chave inválida, sem crédito ou fora do ar).');
    vetores.push(e);
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM documents WHERE conhecimento_id = $1`, [item.id]);
    for (let i = 0; i < chunks.length; i++) {
      await client.query(
        `INSERT INTO documents (user_id, content, metadata, embedding, conhecimento_id, agente_id, status_indexacao)
         VALUES ($1, $2, $3, $4::vector, $5, $6, 'indexado')`,
        [item.user_id, chunks[i], JSON.stringify({ origem: 'conhecimento', tipo: item.tipo, campo: item.campo ?? null, parte: i + 1 }),
         vetor(vetores[i]), item.id, item.agente_id ?? null]
      );
    }
    await client.query(
      `UPDATE conhecimento SET status_indexacao = 'indexado', indexado = true, indexado_em = NOW(), erro_indexacao = NULL WHERE id = $1`,
      [item.id]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function indexarDocumento(pool: Pool, doc: any, chave: string): Promise<void> {
  const e = await embedar(pool, doc.user_id, chave, String(doc.content || '').slice(0, 8000));
  if (!e) throw new Error('A OpenAI recusou o pedido (chave inválida, sem crédito ou fora do ar).');
  await pool.query(
    `UPDATE documents SET embedding = $2::vector, status_indexacao = 'indexado', erro_indexacao = NULL WHERE id = $1`,
    [doc.id, vetor(e)]
  );
}

let rodando = false;

/**
 * Indexa o que estiver pendente (no máximo `limite` itens por rodada). Item com erro só volta a
 * ser tentado quando for editado ou pedirem "Reindexar" — não fica gastando token em chave recusada.
 */
export async function varrerIndexacao(pool: Pool, opcoes: { userId?: string; limite?: number } = {}): Promise<{ indexados: number; erros: number }> {
  if (rodando) return { indexados: 0, erros: 0 };
  rodando = true;
  const limite = opcoes.limite ?? 25;
  let indexados = 0, erros = 0;
  const chaves = new Map<string, string | null>();
  const chaveDe = async (userId: string) => {
    if (!chaves.has(userId)) chaves.set(userId, await chaveEmbedding(pool, userId));
    return chaves.get(userId)!;
  };
  // Chave recusada numa conta → não tenta de novo nesta rodada: os demais itens dela recebem o
  // mesmo erro sem chamar a OpenAI (antes: 25 chamadas seguidas com a mesma chave inválida).
  const falhou = new Map<string, string>();
  const tentar = async (userId: string, fn: (chave: string) => Promise<void>) => {
    if (falhou.has(userId)) throw new Error(falhou.get(userId));
    const chave = await chaveDe(userId);
    if (!chave) throw new Error('Conecte uma integração OpenAI em Integrações para indexar a base.');
    try {
      await fn(chave);
    } catch (err: any) {
      if (/OpenAI recusou/.test(String(err?.message))) falhou.set(userId, err.message);
      throw err;
    }
  };
  try {
    const filtroUser = opcoes.userId ? 'AND user_id = $2' : '';
    const params: any[] = [limite, ...(opcoes.userId ? [opcoes.userId] : [])];
    const itens = (await pool.query(
      `SELECT * FROM conhecimento
        WHERE COALESCE(trim(conteudo), '') <> ''
          AND (status_indexacao IS NULL OR status_indexacao IN ('pendente', 'indexando')
               OR (status_indexacao = 'indexado' AND updated_at > indexado_em + INTERVAL '1 second'))
          ${filtroUser}
        ORDER BY updated_at LIMIT $1`, params)).rows;
    const docs = (await pool.query(
      `SELECT id, user_id, content FROM documents
        WHERE embedding IS NULL AND COALESCE(status_indexacao, 'pendente') <> 'erro' ${filtroUser}
        ORDER BY id LIMIT $1`, params)).rows;

    for (const item of itens) {
      try {
        await tentar(item.user_id, chave => indexarConhecimento(pool, item, chave));
        indexados++;
      } catch (err: any) {
        erros++;
        await pool.query(`UPDATE conhecimento SET status_indexacao = 'erro', erro_indexacao = $2, indexado_em = NOW() WHERE id = $1`,
          [item.id, String(err?.message || err).slice(0, 300)]).catch(() => {});
      }
    }
    for (const doc of docs) {
      try {
        await tentar(doc.user_id, chave => indexarDocumento(pool, doc, chave));
        indexados++;
      } catch (err: any) {
        erros++;
        await pool.query(`UPDATE documents SET status_indexacao = 'erro', erro_indexacao = $2 WHERE id = $1`,
          [doc.id, String(err?.message || err).slice(0, 300)]).catch(() => {});
      }
    }
    if (indexados || erros) log.info('INDEXACAO', 'Varredura da base de conhecimento', { indexados, erros, userId: opcoes.userId ?? null });
  } finally {
    rodando = false;
  }
  return { indexados, erros };
}

/** Marca para reindexar (tudo da conta, um item ou só os com erro). */
export async function marcarParaReindexar(pool: Pool, userId: string, alvo: { conhecimentoId?: string; soErros?: boolean } = {}): Promise<number> {
  const cond = alvo.conhecimentoId ? 'AND id = $2' : alvo.soErros ? `AND status_indexacao = 'erro'` : '';
  const r = await pool.query(
    `UPDATE conhecimento SET status_indexacao = 'pendente', erro_indexacao = NULL WHERE user_id = $1 ${cond}`,
    alvo.conhecimentoId ? [userId, alvo.conhecimentoId] : [userId]);
  if (!alvo.conhecimentoId) {
    await pool.query(
      `UPDATE documents SET status_indexacao = 'pendente', erro_indexacao = NULL
        WHERE user_id = $1 AND embedding IS NULL AND conhecimento_id IS NULL`, [userId]);
  }
  return r.rowCount ?? 0;
}
