/**
 * apiPublica.ts — API pública `/v1` (2026-11-02), nas convenções da API do Cubo
 * (diagnosticos/engenharia_reversa_suite/RELATORIO_API_SUITE.md):
 *  - header `X-API-Key: sk_live_...` (chave criada em /api/api-keys), escopo por recurso/ação;
 *  - listagem `{ data, metadata }` com `page`/`perPage`; erro sempre `{ errors: [{ message, code? }] }`;
 *  - `x-request-id` e `x-ratelimit-*` em toda resposta.
 * A chave age como o usuário que a criou: vê e altera o mesmo que ele vê no painel.
 *
 * Diferente do Cubo: aqui não há negociação separada do contato (o lead é um registro só em
 * `contatos`), então não existem `deals`/`pipes` ainda.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import { log } from '../logger';
import { withTenantContext } from '../db';
import {
  Acao, Escopos, RECURSOS, criarLimitador, hashChave, lerIntervaloDatas, lerPaginacao,
  metadataDaPagina, pareceChave, temEscopo, variantesTelefone,
} from '../services/apiKeys';
import { resolverOwnerId } from '../services/subscription';
import { normalizarTelefone } from '../utils/telefone';
import { evolutionFetch, sanitizeEvolutionUrl } from '../utils/resilientFetch';
import { enviarTextoMetaOficial } from '../services/metaCloudApi';
import { BOT_ECHO_TTL_MS, PREFIXO_OFICIAL, botMessageIds } from '../services/agentEngine';
import { montarOpenApi } from './apiPublicaDocs';
import { garantirEtapasPadrao, moverNoFunil } from '../services/funilAuto';

const TIPO_API = { aberta: 'open', ganho: 'won', perdido: 'lost' } as const;

interface ChaveReq extends Request {
  chave?: { id: string; user_id: string; scopes: Escopos; full_access: boolean; titulo: string; prefixo: string };
  userId?: string;
  ownerId?: string;
}

const limiteGeral = criarLimitador(120);
const limiteEnvio = criarLimitador(30);

function erro(res: Response, status: number, message: string, code?: string, extra: Record<string, unknown> = {}) {
  return res.status(status).json({ errors: [{ message, ...(code ? { code } : {}) }], ...(code ? { code } : {}), ...extra });
}

function aplicarLimite(res: Response, r: ReturnType<ReturnType<typeof criarLimitador>>) {
  res.setHeader('x-ratelimit-limit', String(r.limite));
  res.setHeader('x-ratelimit-remaining', String(r.restante));
  res.setHeader('x-ratelimit-reset', String(r.resetEmSeg));
}

function exige(recurso: string, acao: Acao) {
  return (req: ChaveReq, res: Response, next: NextFunction) => {
    if (temEscopo(req.chave!, recurso, acao)) return next();
    return erro(res, 403, `Esta chave não tem a permissão ${recurso}:${acao}.`, 'missing_scope', { scope: `${recurso}:${acao}` });
  };
}

// ── Formatos de saída (camelCase, nomes em inglês como no Cubo) ──────────────
const pessoa = (c: any) => ({
  id: c.id, name: c.nome, phone: c.telefone, email: c.email, company: c.empresa, jobTitle: c.cargo,
  origin: c.origem, status: c.status, temperature: c.temperatura, tags: c.tags || [], notes: c.notas,
  potentialValue: c.valor_potencial != null ? Number(c.valor_potencial) : null,
  city: c.cidade, state: c.estado, optOut: !!c.opt_out, lastMessageAt: c.ultima_mensagem_em,
  stageId: c.funil_estagio_id ?? null, stageEnteredAt: c.funil_entrou_em ?? null,
  createdAt: c.created_at, updatedAt: c.updated_at,
});

/** Campo da API → coluna de `contatos`, para criar/atualizar. */
const CAMPOS_PESSOA: Record<string, string> = {
  name: 'nome', email: 'email', company: 'empresa', jobTitle: 'cargo', origin: 'origem', status: 'status',
  temperature: 'temperatura', notes: 'notas', potentialValue: 'valor_potencial', city: 'cidade', state: 'estado',
};
const ORDENAVEIS: Record<string, string> = { createdAt: 'created_at', updatedAt: 'updated_at', name: 'nome', lastMessageAt: 'ultima_mensagem_em' };

const telefoneDoJid = (jid: string) => String(jid || '').split('@')[0];

// `whatsapp_conversations` é uma view cujo `id` é o da última mensagem (muda a cada mensagem).
// O id público da conversa é estável: instância + contato, em base64url.
export const idConversa = (instancia: string, jid: string) => Buffer.from(`${instancia}|${jid}`).toString('base64url');
export function lerIdConversa(id: string): { instancia: string; jid: string } | null {
  const [instancia, jid, ...resto] = Buffer.from(String(id || ''), 'base64url').toString('utf8').split('|');
  return instancia && jid && !resto.length ? { instancia, jid } : null;
}

export default function apiPublicaRouter(pool: Pool): Router {
  const router = Router();

  // index.ts já gera um x-request-id; se o cliente mandou o dele, devolve o dele.
  router.use((req, res, next) => {
    const doCliente = String(req.headers['x-request-id'] || '').slice(0, 100);
    if (doCliente) res.setHeader('x-request-id', doCliente);
    next();
  });

  // Documentação: pública, sem chave (como /docs/openapi.json do Cubo).
  router.get('/openapi.json', (_req, res) => res.json(montarOpenApi()));

  // ── Autenticação por chave ─────────────────────────────────────────────────
  router.use(async (req: ChaveReq, res: Response, next: NextFunction) => {
    const auth = String(req.headers.authorization || '');
    const valor = req.headers['x-api-key'] || (auth.startsWith('Bearer sk_') ? auth.slice(7).trim() : '');
    if (!pareceChave(valor)) {
      return erro(res, 401, 'Envie a chave no header X-API-Key (crie em Configurações → API Keys).', 'unauthenticated');
    }
    try {
      const r = await pool.query(
        `SELECT k.id, k.user_id, k.scopes, k.full_access, k.titulo, k.prefixo,
                (k.last_used_at IS NULL OR k.last_used_at < NOW() - interval '1 minute') AS marcar_uso
           FROM api_keys k JOIN users u ON u.id = k.user_id
          WHERE k.hash_sha256 = $1 AND k.ativo AND (k.expira_em IS NULL OR k.expira_em > NOW())
            AND COALESCE(u.active, true) AND u.deleted_at IS NULL`,
        [hashChave(valor)]);
      const chave = r.rows[0];
      if (!chave) return erro(res, 401, 'Chave inválida, revogada ou expirada.', 'invalid_api_key');

      const lim = limiteGeral(chave.id);
      aplicarLimite(res, lim);
      if (!lim.ok) return erro(res, 429, 'Muitas requisições. Tente de novo em instantes.', 'rate_limited', { retryAfter: lim.resetEmSeg });

      req.chave = { ...chave, scopes: chave.scopes || {} };
      req.userId = chave.user_id;
      req.ownerId = await resolverOwnerId(pool, chave.user_id);
      if (chave.marcar_uso) pool.query(`UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`, [chave.id]).catch(() => {});
      next();
    } catch (err: any) {
      log.error('API_V1', 'Falha ao validar chave', { err: err?.message });
      return erro(res, 500, 'Erro interno.');
    }
  });

  // ── Conta ──────────────────────────────────────────────────────────────────
  router.get('/whoami', async (req: ChaveReq, res: Response) => {
    try {
      const [u, contagem] = await Promise.all([
        pool.query(`SELECT id, display_name, email, role FROM users WHERE id = $1`, [req.userId]),
        pool.query(
          `SELECT (SELECT count(*) FROM contatos WHERE user_id = $1)::int AS peoples,
                  (SELECT count(*) FROM agentes WHERE user_id = $1 AND COALESCE(evolution_instancia, '') <> '')::int
                    + (SELECT count(*) FROM whatsapp_oficial_config WHERE user_id = $1)::int AS channels,
                  (SELECT count(*) FROM agentes WHERE user_id = $1)::int AS agents`, [req.userId]),
      ]);
      const user = u.rows[0];
      const k = req.chave!;
      return res.json({
        data: {
          user: { id: user.id, name: user.display_name, email: user.email, role: user.role },
          apiKey: { id: k.id, title: k.titulo, prefix: k.prefixo, fullAccess: k.full_access, scopes: k.full_access ? null : k.scopes },
          resources: Object.keys(RECURSOS),
          counts: contagem.rows[0],
        },
      });
    } catch (err: any) {
      return erro(res, 500, err.message);
    }
  });

  // ── Contatos (peoples) ─────────────────────────────────────────────────────
  router.get('/peoples', exige('peoples', 'read'), async (req: ChaveReq, res: Response) => {
    try {
      const { page, perPage, offset } = lerPaginacao(req.query);
      const cond = ['user_id = $1'];
      const vals: any[] = [req.userId];
      const q = req.query as Record<string, string>;

      if (q.name) { vals.push(`%${q.name}%`); cond.push(`nome ILIKE $${vals.length}`); }
      if (q.email) { vals.push(q.email.trim().toLowerCase()); cond.push(`lower(email) = $${vals.length}`); }
      if (q.status) { vals.push(q.status.split(',').map(s => s.trim()).filter(Boolean)); cond.push(`status = ANY($${vals.length})`); }
      if (q.ids) { vals.push(q.ids.split(',').map(s => s.trim()).filter(Boolean)); cond.push(`id::text = ANY($${vals.length})`); }
      if (q.phone) {
        const v = variantesTelefone(q.phone);
        if (!v.length) return erro(res, 422, 'Telefone inválido.', 'invalid_phone');
        vals.push(v);
        cond.push(`(telefone_normalizado = ANY($${vals.length}) OR regexp_replace(COALESCE(telefone, ''), '\\D', '', 'g') = ANY($${vals.length}))`);
      }
      if (q.tags) {
        vals.push(q.tags.split(',').map(s => s.trim()).filter(Boolean));
        cond.push(q.tags_op === 'all' ? `tags @> $${vals.length}::text[]` : `tags && $${vals.length}::text[]`);
      }
      if (q.optOut === 'true' || q.optOut === 'false') cond.push(q.optOut === 'true' ? 'opt_out IS TRUE' : 'opt_out IS NOT TRUE');
      for (const [param, col] of [['created_at', 'created_at'], ['updated_at', 'updated_at']] as const) {
        if (!q[param]) continue;
        const d = lerIntervaloDatas(q[param]);
        if (!d) return erro(res, 422, `${param} deve ser dd/MM/yyyy ou dd/MM/yyyy,dd/MM/yyyy.`, 'invalid_date');
        vals.push(d.de, d.ate);
        cond.push(`${col} BETWEEN $${vals.length - 1} AND $${vals.length}`);
      }
      const ordem = ORDENAVEIS[q.orderColumn] || 'created_at';
      const direcao = String(q.orderDirection).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

      const where = cond.join(' AND ');
      const [lista, total] = await Promise.all([
        pool.query(`SELECT * FROM contatos WHERE ${where} ORDER BY ${ordem} ${direcao} NULLS LAST, id LIMIT ${perPage} OFFSET ${offset}`, vals),
        pool.query(`SELECT count(*)::int AS n FROM contatos WHERE ${where}`, vals),
      ]);
      return res.json({ data: lista.rows.map(pessoa), metadata: metadataDaPagina(total.rows[0].n, page, perPage) });
    } catch (err: any) {
      return erro(res, 500, err.message);
    }
  });

  router.get('/peoples/:id', exige('peoples', 'read'), async (req: ChaveReq, res: Response) => {
    const r = await pool.query(`SELECT * FROM contatos WHERE id::text = $1 AND user_id = $2`, [req.params.id, req.userId]).catch(() => ({ rows: [] as any[] }));
    if (!r.rows.length) return erro(res, 404, 'Contato não encontrado.', 'not_found');
    return res.json({ data: pessoa(r.rows[0]) });
  });

  /** Valida e monta as colunas de criação/edição a partir do corpo. */
  function colunasDaPessoa(body: any): { cols: Record<string, any>; erro?: string } {
    const cols: Record<string, any> = {};
    for (const [campo, col] of Object.entries(CAMPOS_PESSOA)) {
      if (body?.[campo] === undefined) continue;
      const v = body[campo];
      if (campo === 'potentialValue') {
        if (v !== null && !Number.isFinite(Number(v))) return { cols, erro: 'potentialValue deve ser número.' };
        cols[col] = v === null ? null : Number(v);
      } else {
        if (v !== null && typeof v !== 'string') return { cols, erro: `${campo} deve ser texto.` };
        cols[col] = v === null ? null : v.trim().slice(0, campo === 'notes' ? 5000 : 200);
      }
    }
    if (body?.tags !== undefined) {
      if (!Array.isArray(body.tags) || body.tags.some((t: unknown) => typeof t !== 'string')) return { cols, erro: 'tags deve ser uma lista de textos.' };
      cols.tags = [...new Set(body.tags.map((t: string) => t.trim()).filter(Boolean))];
    }
    if (body?.phone !== undefined) {
      const n = normalizarTelefone(body.phone);
      if (!n.normalizado) return { cols, erro: 'Telefone inválido.' };
      cols.telefone = n.normalizado;
      cols.telefone_normalizado = n.normalizado;
      cols.telefone_original = String(body.phone);
    }
    return { cols };
  }

  async function acharPorTelefone(userId: string, telefone: string): Promise<any | null> {
    const v = variantesTelefone(telefone);
    if (!v.length) return null;
    const r = await pool.query(
      `SELECT * FROM contatos WHERE user_id = $1
          AND (telefone_normalizado = ANY($2) OR regexp_replace(COALESCE(telefone, ''), '\\D', '', 'g') = ANY($2))
        ORDER BY created_at LIMIT 1`, [userId, v]);
    return r.rows[0] || null;
  }

  router.post('/peoples', exige('peoples', 'create'), async (req: ChaveReq, res: Response) => {
    try {
      const { cols, erro: msg } = colunasDaPessoa(req.body);
      if (msg) return erro(res, 422, msg, 'validation_error');
      if (!cols.telefone && !cols.email) return erro(res, 422, 'Informe phone ou email.', 'validation_error');

      const existente = cols.telefone ? await acharPorTelefone(req.userId!, cols.telefone) : null;
      if (existente) {
        if (req.body?.upsert !== true) {
          return erro(res, 409, 'Já existe um contato com este telefone.', 'duplicate', { peopleId: existente.id });
        }
        const sets = Object.keys(cols).filter(c => !c.startsWith('telefone'));
        if (!sets.length) return res.json({ data: pessoa(existente), created: false });
        const r = await pool.query(
          `UPDATE contatos SET ${sets.map((c, i) => `${c} = $${i + 3}`).join(', ')}, updated_at = NOW()
            WHERE id = $1 AND user_id = $2 RETURNING *`, [existente.id, req.userId, ...sets.map(c => cols[c])]);
        return res.json({ data: pessoa(r.rows[0]), created: false });
      }

      const final = { status: 'novo', origem: 'api', ...cols, nome: cols.nome || cols.telefone || cols.email };
      const nomes = Object.keys(final);
      const r = await pool.query(
        `INSERT INTO contatos (user_id, ${nomes.join(', ')}) VALUES ($1, ${nomes.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING *`,
        [req.userId, ...nomes.map(c => (final as any)[c])]);
      return res.status(201).json({ data: pessoa(r.rows[0]), created: true });
    } catch (err: any) {
      return erro(res, 500, err.message);
    }
  });

  router.put('/peoples/:id', exige('peoples', 'update'), async (req: ChaveReq, res: Response) => {
    try {
      const { cols, erro: msg } = colunasDaPessoa(req.body);
      if (msg) return erro(res, 422, msg, 'validation_error');
      const nomes = Object.keys(cols);
      if (!nomes.length) return erro(res, 422, 'Nada para atualizar.', 'validation_error');
      if (cols.telefone) {
        const outro = await acharPorTelefone(req.userId!, cols.telefone);
        if (outro && outro.id !== req.params.id) return erro(res, 409, 'Outro contato já usa este telefone.', 'duplicate', { peopleId: outro.id });
      }
      const r = await pool.query(
        `UPDATE contatos SET ${nomes.map((c, i) => `${c} = $${i + 3}`).join(', ')}, updated_at = NOW()
          WHERE id::text = $1 AND user_id = $2 RETURNING *`, [req.params.id, req.userId, ...nomes.map(c => cols[c])]);
      if (!r.rows.length) return erro(res, 404, 'Contato não encontrado.', 'not_found');
      return res.json({ data: pessoa(r.rows[0]) });
    } catch (err: any) {
      return erro(res, 500, err.message);
    }
  });

  router.delete('/peoples/:id', exige('peoples', 'delete'), async (req: ChaveReq, res: Response) => {
    try {
      const r = await pool.query(`DELETE FROM contatos WHERE id::text = $1 AND user_id = $2`, [req.params.id, req.userId]);
      if (!r.rowCount) return erro(res, 404, 'Contato não encontrado.', 'not_found');
      return res.status(204).end();
    } catch (err: any) {
      return erro(res, 500, err.message);
    }
  });

  // ── Etiquetas (tags) — gravadas como texto em contatos.tags ────────────────
  router.get('/tags', exige('tags', 'read'), async (req: ChaveReq, res: Response) => {
    try {
      const r = await pool.query(
        `SELECT nome, max(cor) AS cor, sum(qtd)::int AS qtd FROM (
           SELECT t AS nome, NULL::text AS cor, count(*) AS qtd FROM contatos, unnest(tags) t WHERE user_id = $1 GROUP BY t
           UNION ALL SELECT nome, cor, 0 FROM tags WHERE user_id = $1
         ) x GROUP BY nome ORDER BY nome`, [req.userId]);
      return res.json({ data: r.rows.map(t => ({ name: t.nome, color: t.cor, peoples: t.qtd })) });
    } catch (err: any) {
      return erro(res, 500, err.message);
    }
  });

  router.post('/tags', exige('tags', 'create'), async (req: ChaveReq, res: Response) => {
    const nome = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 60) : '';
    if (!nome) return erro(res, 422, 'Informe name.', 'validation_error');
    const cor = typeof req.body?.color === 'string' ? req.body.color.slice(0, 20) : null;
    try {
      const existe = await pool.query(`SELECT nome, cor FROM tags WHERE user_id = $1 AND lower(nome) = lower($2) LIMIT 1`, [req.userId, nome]);
      if (existe.rows.length) return res.json({ data: { name: existe.rows[0].nome, color: existe.rows[0].cor }, created: false });
      await pool.query(`INSERT INTO tags (user_id, nome, cor) VALUES ($1, $2, $3)`, [req.userId, nome, cor]);
      return res.status(201).json({ data: { name: nome, color: cor }, created: true });
    } catch (err: any) {
      return erro(res, 500, err.message);
    }
  });

  async function mudarTags(req: ChaveReq, res: Response, acao: 'attach' | 'detach') {
    const ids: string[] = Array.isArray(req.body?.peopleIds) ? req.body.peopleIds : req.body?.peopleId ? [req.body.peopleId] : [];
    const tags: string[] = Array.isArray(req.body?.tags) ? req.body.tags.filter((t: unknown) => typeof t === 'string').map((t: string) => t.trim()).filter(Boolean) : [];
    if (!ids.length || ids.length > 500) return erro(res, 422, 'Informe peopleId ou peopleIds (até 500).', 'validation_error');
    if (!tags.length) return erro(res, 422, 'Informe tags (lista de nomes).', 'validation_error');
    try {
      const sql = acao === 'attach'
        ? `UPDATE contatos SET tags = ARRAY(SELECT DISTINCT unnest(COALESCE(tags, '{}') || $3::text[])), updated_at = NOW()
            WHERE user_id = $1 AND id::text = ANY($2)`
        : `UPDATE contatos SET tags = ARRAY(SELECT unnest(COALESCE(tags, '{}')) EXCEPT SELECT unnest($3::text[])), updated_at = NOW()
            WHERE user_id = $1 AND id::text = ANY($2)`;
      const r = await pool.query(sql, [req.userId, ids.map(String), tags]);
      return res.json({ data: { updated: r.rowCount, tags } });
    } catch (err: any) {
      return erro(res, 500, err.message);
    }
  }
  router.post('/tags/attach', exige('tags', 'update'), (req: ChaveReq, res) => mudarTags(req, res, 'attach'));
  router.post('/tags/detach', exige('tags', 'update'), (req: ChaveReq, res) => mudarTags(req, res, 'detach'));

  // ── Funil (2026-11-04): etapas e mover o contato (1 card por contato) ──────
  router.get('/stages', exige('funnel', 'read'), async (req: ChaveReq, res: Response) => {
    try {
      const etapas = await garantirEtapasPadrao(pool, req.userId!);
      const n = new Map((await pool.query(
        `SELECT funil_estagio_id AS id, count(*)::int AS n FROM contatos WHERE user_id = $1 AND funil_estagio_id IS NOT NULL GROUP BY 1`,
        [req.userId])).rows.map(r => [r.id, r.n]));
      return res.json({
        data: etapas.map((e, i) => ({
          id: e.id, name: e.nome, kind: TIPO_API[e.tipo], color: e.cor ?? null, order: e.ordem ?? i, peoples: n.get(e.id) ?? 0,
        })),
      });
    } catch (err: any) {
      return erro(res, 500, err.message);
    }
  });

  router.put('/peoples/:id/stage', exige('funnel', 'update'), async (req: ChaveReq, res: Response) => {
    const stageId = req.body?.stageId;
    if (stageId !== null && typeof stageId !== 'string') {
      return erro(res, 422, 'Informe stageId (id de GET /v1/stages) ou null para tirar do funil.', 'validation_error');
    }
    try {
      const r = await moverNoFunil(pool, {
        userId: req.userId!, contatoId: String(req.params.id), paraEstagioId: stageId, origem: 'api',
        motivo: typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 300) : `API (${req.chave!.titulo})`,
      });
      if (!r.ok && r.motivo === 'sem_contato') return erro(res, 404, 'Contato não encontrado.', 'not_found');
      if (!r.ok && r.motivo === 'etapa_inexistente') return erro(res, 422, 'Etapa não existe (veja GET /v1/stages).', 'unknown_stage');
      const c = (await pool.query(`SELECT * FROM contatos WHERE id = $1 AND user_id = $2`, [req.params.id, req.userId])).rows[0];
      return res.json({
        data: pessoa(c), moved: r.ok,
        automations: r.automacoes.map(a => ({ type: a.tipo, ok: a.ok, ...(a.erro ? { error: a.erro } : {}) })),
      });
    } catch (err: any) {
      return erro(res, 500, err.message);
    }
  });

  // ── Canais (números de WhatsApp) ───────────────────────────────────────────
  async function listarCanais(userId: string) {
    const [qr, oficiais] = await Promise.all([
      pool.query(
        `SELECT id, nome, nome_exibicao, evolution_instancia, numero_conectado, ativo, papel, agente_resposta_id
           FROM agentes WHERE user_id = $1 AND COALESCE(evolution_instancia, '') <> '' ORDER BY created_at`, [userId]),
      pool.query(
        `SELECT id, nome, verified_name, numero_exibicao, phone_number_id, ativo, ia_ativa, agente_id, quality_rating, ultimo_erro
           FROM whatsapp_oficial_config WHERE user_id = $1 ORDER BY created_at`, [userId]),
    ]);
    return [
      ...qr.rows.map((n: any) => ({
        id: n.id, type: 'whatsapp_qrcode', name: n.nome_exibicao || n.nome, phone: n.numero_conectado ? `+${n.numero_conectado}` : null,
        connected: !!n.numero_conectado, personal: n.papel === 'pessoal', aiActive: !!n.ativo,
        agentId: n.agente_resposta_id || n.id,
      })),
      ...oficiais.rows.map((o: any) => ({
        id: o.id, type: 'whatsapp_official', name: o.nome || o.verified_name || o.numero_exibicao, phone: o.numero_exibicao,
        connected: !!o.ativo && !o.ultimo_erro, personal: false, aiActive: !!o.ia_ativa, agentId: o.agente_id || null,
        quality: o.quality_rating || null,
      })),
    ];
  }

  router.get('/channels', exige('channels', 'read'), async (req: ChaveReq, res: Response) => {
    try {
      return res.json({ data: await listarCanais(req.userId!) });
    } catch (err: any) {
      return erro(res, 500, err.message);
    }
  });

  // ── Agentes de IA (leitura) ────────────────────────────────────────────────
  router.get('/agents', exige('agents', 'read'), async (req: ChaveReq, res: Response) => {
    try {
      const r = await pool.query(
        `SELECT id, nome, ativo, modelo, COALESCE(evolution_instancia, '') <> '' AS eh_numero,
                COALESCE(length(trim(prompt_sistema)), 0) > 0 AS tem_prompt, created_at, updated_at
           FROM agentes WHERE user_id = $1 ORDER BY nome`, [req.userId]);
      return res.json({
        data: r.rows.map(a => ({
          id: a.id, name: a.nome, active: !!a.ativo, model: a.modelo || null, isChannel: a.eh_numero,
          hasPrompt: a.tem_prompt, createdAt: a.created_at, updatedAt: a.updated_at,
        })),
      });
    } catch (err: any) {
      return erro(res, 500, err.message);
    }
  });

  // ── Conversas (leitura) ────────────────────────────────────────────────────
  router.get('/conversations', exige('conversations', 'read'), async (req: ChaveReq, res: Response) => {
    try {
      const { page, perPage, offset } = lerPaginacao(req.query);
      const q = req.query as Record<string, string>;
      const cond = ['user_id = $1'];
      const vals: any[] = [req.ownerId];
      if (q.groups !== 'true') cond.push(`remote_jid NOT LIKE '%@g.us'`);
      if (q.phone) {
        const v = variantesTelefone(q.phone);
        if (!v.length) return erro(res, 422, 'Telefone inválido.', 'invalid_phone');
        vals.push(v.map(t => `${t}@s.whatsapp.net`));
        cond.push(`remote_jid = ANY($${vals.length})`);
      }
      if (q.channelId) {
        const canal = (await listarCanais(req.userId!)).find(c => c.id === q.channelId);
        if (!canal) return erro(res, 404, 'Canal não encontrado.', 'not_found');
        const inst = await instanciaDoCanal(req.userId!, canal.id);
        vals.push(inst);
        cond.push(`instance_name = $${vals.length}`);
      }
      const where = cond.join(' AND ');
      const [lista, total] = await Promise.all([
        pool.query(
          `SELECT instance_name, remote_jid, ultima_mensagem, ultima_foi_minha, ultimo_tipo, ultimo_timestamp
             FROM whatsapp_conversations WHERE ${where}
            ORDER BY ultimo_timestamp DESC NULLS LAST LIMIT ${perPage} OFFSET ${offset}`, vals),
        pool.query(`SELECT count(*)::int AS n FROM whatsapp_conversations WHERE ${where}`, vals),
      ]);
      return res.json({
        data: lista.rows.map(c => ({
          id: idConversa(c.instance_name, c.remote_jid), phone: telefoneDoJid(c.remote_jid), isGroup: String(c.remote_jid).endsWith('@g.us'),
          lastMessage: c.ultima_mensagem, lastMessageType: c.ultimo_tipo, lastMessageFromMe: !!c.ultima_foi_minha,
          lastMessageAt: c.ultimo_timestamp,
        })),
        metadata: metadataDaPagina(total.rows[0].n, page, perPage),
      });
    } catch (err: any) {
      return erro(res, 500, err.message);
    }
  });

  router.get('/conversations/:id/messages', exige('conversations', 'read'), async (req: ChaveReq, res: Response) => {
    try {
      const conv = lerIdConversa(req.params.id);
      if (!conv) return erro(res, 404, 'Conversa não encontrada.', 'not_found');
      const { page, perPage, offset } = lerPaginacao({ perPage: '50', ...req.query });
      const vals = [req.ownerId, conv.instancia, conv.jid];
      const where = `user_id = $1 AND instance_name = $2 AND remote_jid = $3 AND deleted_at IS NULL`;
      // whatsapp_messages tem RLS (piloto em homologação): consulta no contexto da conta.
      const [lista, total] = await withTenantContext({ userId: req.ownerId }, async c => [
        await c.query(
          `SELECT id, message_id, from_me, message_type, content, media_url, status, sent_by_user_id, agent_id,
                  COALESCE(timestamp_wa, created_at) AS em
             FROM whatsapp_messages WHERE ${where}
            ORDER BY COALESCE(timestamp_wa, created_at) DESC LIMIT ${perPage} OFFSET ${offset}`, vals),
        await c.query(`SELECT count(*)::int AS n FROM whatsapp_messages WHERE ${where}`, vals),
      ]);
      return res.json({
        data: lista.rows.map(m => ({
          id: m.id, externalId: m.message_id, fromMe: !!m.from_me, type: m.message_type, content: m.content,
          mediaUrl: m.media_url, status: m.status,
          sentBy: !m.from_me ? 'contact' : m.agent_id ? 'bot' : m.sent_by_user_id ? 'human' : 'unknown',
          sentAt: m.em,
        })),
        metadata: metadataDaPagina(total.rows[0].n, page, perPage),
      });
    } catch (err: any) {
      return erro(res, 500, err.message);
    }
  });

  /** instance_name que as mensagens do canal usam em whatsapp_messages. */
  async function instanciaDoCanal(userId: string, canalId: string): Promise<string | null> {
    const qr = await pool.query(`SELECT evolution_instancia FROM agentes WHERE id::text = $1 AND user_id = $2`, [canalId, userId]);
    if (qr.rows[0]?.evolution_instancia) return qr.rows[0].evolution_instancia;
    const of = await pool.query(`SELECT phone_number_id FROM whatsapp_oficial_config WHERE id::text = $1 AND user_id = $2`, [canalId, userId]);
    return of.rows[0]?.phone_number_id ? PREFIXO_OFICIAL + of.rows[0].phone_number_id : null;
  }

  // ── Envio de mensagem ──────────────────────────────────────────────────────
  router.post('/messages/send', exige('messages', 'create'), async (req: ChaveReq, res: Response) => {
    const lim = limiteEnvio(req.chave!.id);
    aplicarLimite(res, lim);
    if (!lim.ok) return erro(res, 429, 'Limite de 30 envios por minuto por chave.', 'rate_limited', { retryAfter: lim.resetEmSeg });

    const b = req.body || {};
    const texto = typeof b.text === 'string' ? b.text.trim() : '';
    if (!texto) return erro(res, 422, 'Informe text.', 'content_required');
    if (texto.length > 4096) return erro(res, 422, 'text passa de 4096 caracteres.', 'validation_error');
    if (!b.channelId) return erro(res, 422, 'Informe channelId (veja GET /v1/channels).', 'validation_error');
    const sentBy = b.sentBy === 'human' ? 'human' : 'bot';

    try {
      // Destinatário: peopleId ou phone.
      let contato: any = null;
      let telefone: string | null = null;
      if (b.peopleId) {
        contato = (await pool.query(`SELECT * FROM contatos WHERE id::text = $1 AND user_id = $2`, [String(b.peopleId), req.userId])).rows[0];
        if (!contato) return erro(res, 404, 'Contato não encontrado.', 'not_found');
        telefone = normalizarTelefone(contato.telefone).normalizado || null;
      } else if (b.phone) {
        telefone = normalizarTelefone(String(b.phone)).normalizado || null;
        if (telefone) contato = await acharPorTelefone(req.userId!, telefone);
      } else {
        return erro(res, 422, 'Informe peopleId ou phone.', 'validation_error');
      }
      if (!telefone) return erro(res, 422, 'Telefone do destinatário inválido.', 'invalid_phone');
      if (contato?.opt_out) return erro(res, 422, 'Este contato pediu para não receber mensagens.', 'opted_out', { peopleId: contato.id });

      const canalId = String(b.channelId);
      const qr = (await pool.query(
        `SELECT id, evolution_instancia, evolution_server_url, evolution_api_key, numero_conectado
           FROM agentes WHERE id::text = $1 AND user_id = $2 AND COALESCE(evolution_instancia, '') <> ''`,
        [canalId, req.userId])).rows[0];
      const oficial = qr ? null : (await pool.query(
        `SELECT * FROM whatsapp_oficial_config WHERE id::text = $1 AND user_id = $2`, [canalId, req.userId])).rows[0];
      if (!qr && !oficial) return erro(res, 404, 'Canal não encontrado.', 'not_found');

      let instancia: string;
      let messageId: string | undefined;
      if (qr) {
        if (!qr.numero_conectado) return erro(res, 422, 'O número deste canal está desconectado.', 'channel_disconnected');
        instancia = qr.evolution_instancia;
        const base = sanitizeEvolutionUrl(qr.evolution_server_url || process.env.EVOLUTION_API_URL || 'https://disparo.mentoark.com.br');
        const r = await evolutionFetch(`${base}/message/sendText/${instancia}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: qr.evolution_api_key || process.env.EVOLUTION_API_KEY || '' },
          body: JSON.stringify({ number: telefone, text: texto, delay: Math.min(4000, 800 + texto.length * 25) }),
        });
        if (!r.ok) {
          const detalhe = (await r.text().catch(() => '')).slice(0, 200);
          log.warn('API_V1', 'Evolution recusou envio', { instancia, status: r.status, detalhe });
          return erro(res, 502, 'O WhatsApp recusou o envio. Confira se o número está conectado.', 'send_failed');
        }
        messageId = ((await r.json().catch(() => ({}))) as any)?.key?.id;
      } else {
        if (!oficial.ativo) return erro(res, 422, 'Este canal oficial está desligado.', 'channel_disconnected');
        const janela = contato?.janela_oficial_ate ? new Date(contato.janela_oficial_ate) : null;
        if (!janela || janela.getTime() <= Date.now()) {
          return erro(res, 422, 'Fora da janela de 24h da Meta: só é possível enviar um template aprovado.', 'window_closed',
            { windowExpiredAt: janela ? janela.toISOString() : null });
        }
        instancia = PREFIXO_OFICIAL + oficial.phone_number_id;
        const r = await enviarTextoMetaOficial(oficial, telefone, texto);
        if (!r.ok) return erro(res, 502, `A Meta recusou o envio: ${r.erro}`, 'send_failed');
        messageId = r.messageId;
      }

      // sentBy=bot: o webhook reconhece o eco e não pausa a IA. human: segue como mensagem de atendente.
      if (messageId && sentBy === 'bot') {
        botMessageIds.add(messageId);
        setTimeout(() => botMessageIds.delete(messageId!), BOT_ECHO_TTL_MS);
      }
      const idFinal = messageId || `api_${Date.now()}`;
      await withTenantContext({ userId: req.ownerId }, c => c.query(
        `INSERT INTO whatsapp_messages
           (user_id, sent_by_user_id, instance_name, remote_jid, message_id, from_me, message_type, content, status, timestamp_wa, metadata)
         VALUES ($1, $2, $3, $4, $5, true, 'text', $6, 'sent', NOW(), $7)
         ON CONFLICT (message_id, instance_name) DO NOTHING`,
        [req.ownerId, sentBy === 'human' ? req.userId : null, instancia, `${telefone}@s.whatsapp.net`, idFinal, texto,
         JSON.stringify({ origem: 'api_v1', api_key_id: req.chave!.id, sent_by: sentBy })]
      )).catch(err => log.warn('API_V1', 'Falha ao gravar mensagem enviada', { err: err.message }));

      return res.status(201).json({ data: { messageId: idFinal, status: 'sent', channelId: canalId, phone: telefone, peopleId: contato?.id || null, sentBy } });
    } catch (err: any) {
      log.error('API_V1', 'Erro ao enviar', { err: err?.message });
      return erro(res, 500, 'Erro interno ao enviar.');
    }
  });

  router.use((_req, res) => erro(res, 404, 'Rota não existe na API v1. Veja /v1/openapi.json.', 'not_found'));

  return router;
}
