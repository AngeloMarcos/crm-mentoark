import { Router, Response } from 'express';
import { Pool } from 'pg';
import { AuthRequest } from '../middleware';
import { log } from '../logger';
import { resolverOwnerId } from '../services/subscription';
import {
  CONFIG_PADRAO, enfileirarHigienizacao, getConfig, getConfigClassificacao, normalizarPendentes, ParamsHigienizacao,
  salvarConfigClassificacao,
} from '../services/higienizacao';
import { CONFIG_PADRAO as CLASSIFICACAO_PADRAO, ConfigInvalida, notaDaLista } from '../utils/classificacao';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function listaDeUuids(v: unknown, max: number): string[] | null {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > max) return null;
  const ids = v.map(String);
  return ids.every(i => UUID.test(i)) ? Array.from(new Set(ids)) : null;
}

export default function higienizacaoRouter(pool: Pool): Router {
  const router = Router();

  // Membros de equipe só leem; iniciar/cancelar/configurar é do dono/admin da conta.
  async function ehMembro(userId: string): Promise<boolean> {
    const r = await pool.query(`SELECT role FROM equipe_membros WHERE user_id = $1 LIMIT 1`, [userId]);
    return (r.rowCount ?? 0) > 0 && r.rows[0].role === 'membro';
  }

  // POST /api/higienizacao/executar
  router.post('/executar', async (req: AuthRequest, res: Response) => {
    try {
      if (await ehMembro(req.userId!)) return res.status(403).json({ message: 'Sem permissão para higienizar listas.' });
      const tenantId = await resolverOwnerId(pool, req.userId!);

      const listaIds = listaDeUuids(req.body?.lista_ids, 200);
      const contatoIds = listaDeUuids(req.body?.contato_ids, 20000);
      if (listaIds === null || contatoIds === null) return res.status(400).json({ message: 'Identificadores inválidos.' });

      const params: ParamsHigienizacao = {
        validar: req.body?.validar !== false,
        enriquecer: req.body?.enriquecer !== false,
        classificar: req.body?.classificar !== false,
        forcar: req.body?.forcar === true,
      };
      if (contatoIds.length) params.contato_ids = contatoIds;
      else if (listaIds.length) {
        const donas = await pool.query(`SELECT id FROM listas WHERE user_id = $1 AND id = ANY($2::uuid[])`, [tenantId, listaIds]);
        if (!donas.rows.length) return res.status(404).json({ message: 'Lista não encontrada.' });
        params.lista_ids = donas.rows.map((r: any) => r.id);
      }

      const { job, jaExistia } = await enfileirarHigienizacao(pool, tenantId, params);
      return res.status(jaExistia ? 409 : 202).json({
        job,
        message: jaExistia ? 'Já existe uma higienização em andamento para esta conta.' : 'Higienização enfileirada.',
      });
    } catch (err: any) {
      log.error('HIGIENIZACAO', 'Erro em POST /executar', { err: err?.message, stack: err?.stack });
      return res.status(500).json({ message: err.message });
    }
  });

  // GET /api/higienizacao/jobs
  router.get('/jobs', async (req: AuthRequest, res: Response) => {
    try {
      const tenantId = await resolverOwnerId(pool, req.userId!);
      const r = await pool.query(
        `SELECT id, tipo, status, params, etapa, total, processados, resultado, erro, created_at, started_at, finished_at
         FROM higienizacao_jobs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
        [tenantId],
      );
      return res.json(r.rows);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // GET /api/higienizacao/jobs/:id
  router.get('/jobs/:id', async (req: AuthRequest, res: Response) => {
    try {
      if (!UUID.test(req.params.id)) return res.status(400).json({ message: 'Identificador inválido.' });
      const tenantId = await resolverOwnerId(pool, req.userId!);
      const r = await pool.query(
        `SELECT id, tipo, status, params, etapa, total, processados, resultado, erro, created_at, started_at, finished_at
         FROM higienizacao_jobs WHERE id = $1 AND user_id = $2`,
        [req.params.id, tenantId],
      );
      if (!r.rows.length) return res.status(404).json({ message: 'Job não encontrado.' });
      return res.json(r.rows[0]);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // POST /api/higienizacao/jobs/:id/cancelar
  router.post('/jobs/:id/cancelar', async (req: AuthRequest, res: Response) => {
    try {
      if (await ehMembro(req.userId!)) return res.status(403).json({ message: 'Sem permissão.' });
      if (!UUID.test(req.params.id)) return res.status(400).json({ message: 'Identificador inválido.' });
      const tenantId = await resolverOwnerId(pool, req.userId!);
      // Na fila: cancela na hora. Rodando: sinaliza, e o worker para no próximo lote.
      const r = await pool.query(
        `UPDATE higienizacao_jobs SET
           cancelar = true,
           status = CASE WHEN status = 'queued' THEN 'cancelled' ELSE status END,
           finished_at = CASE WHEN status = 'queued' THEN now() ELSE finished_at END,
           updated_at = now()
         WHERE id = $1 AND user_id = $2 AND status IN ('queued', 'running')
         RETURNING id, status`,
        [req.params.id, tenantId],
      );
      if (!r.rows.length) return res.status(404).json({ message: 'Job não encontrado ou já finalizado.' });
      return res.json(r.rows[0]);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // GET/PUT /api/higienizacao/config
  router.get('/config', async (req: AuthRequest, res: Response) => {
    try {
      const tenantId = await resolverOwnerId(pool, req.userId!);
      return res.json(await getConfig(pool, tenantId));
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  router.put('/config', async (req: AuthRequest, res: Response) => {
    try {
      if (await ehMembro(req.userId!)) return res.status(403).json({ message: 'Sem permissão.' });
      const tenantId = await resolverOwnerId(pool, req.userId!);
      const atual = await getConfig(pool, tenantId);
      const num = (v: unknown, min: number, max: number, padrao: number): number | null => {
        if (v === undefined) return padrao;
        const n = Math.trunc(Number(v));
        return Number.isFinite(n) && n >= min && n <= max ? n : null;
      };
      const revalidar = num(req.body?.revalidar_dias, 1, 365, atual.revalidar_dias);
      const validacoes = num(req.body?.validacoes_por_min, 1, 60, atual.validacoes_por_min);
      const enriquecimentos = num(req.body?.enriquecimentos_por_min, 1, 120, atual.enriquecimentos_por_min);
      if (revalidar === null || validacoes === null || enriquecimentos === null) {
        return res.status(400).json({ message: 'Valores fora do intervalo permitido.' });
      }
      await pool.query(
        `INSERT INTO higienizacao_config (user_id, revalidar_dias, validacoes_por_min, enriquecimentos_por_min, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (user_id) DO UPDATE SET revalidar_dias = $2, validacoes_por_min = $3,
           enriquecimentos_por_min = $4, updated_at = now()`,
        [tenantId, revalidar, validacoes, enriquecimentos],
      );
      return res.json({ revalidar_dias: revalidar, validacoes_por_min: validacoes, enriquecimentos_por_min: enriquecimentos });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // GET/PUT /api/higienizacao/score-config — pesos do score, DDDs, nichos-alvo e dicionário de
  // nichos (palavras) editáveis por conta. `padrao` devolve os valores de fábrica pro botão "Restaurar".
  router.get('/score-config', async (req: AuthRequest, res: Response) => {
    try {
      const tenantId = await resolverOwnerId(pool, req.userId!);
      return res.json({ config: await getConfigClassificacao(pool, tenantId), padrao: CLASSIFICACAO_PADRAO });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  router.put('/score-config', async (req: AuthRequest, res: Response) => {
    try {
      if (await ehMembro(req.userId!)) return res.status(403).json({ message: 'Sem permissão.' });
      const tenantId = await resolverOwnerId(pool, req.userId!);
      const config = await salvarConfigClassificacao(pool, tenantId, req.body);
      return res.json({ config });
    } catch (err: any) {
      if (err instanceof ConfigInvalida) return res.status(400).json({ message: err.message });
      log.error('HIGIENIZACAO', 'Erro em PUT /score-config', { err: err?.message, stack: err?.stack });
      return res.status(500).json({ message: err.message });
    }
  });

  // GET /api/higienizacao/contatos/:id/score — o "por quê" do score de um contato.
  router.get('/contatos/:id/score', async (req: AuthRequest, res: Response) => {
    try {
      if (!UUID.test(req.params.id)) return res.status(400).json({ message: 'Identificador inválido.' });
      const tenantId = await resolverOwnerId(pool, req.userId!);
      const r = await pool.query(
        `SELECT lead_score, nicho_detectado, tipo_publico, score_detalhe, classificado_em
         FROM contatos WHERE id = $1 AND user_id = $2`,
        [req.params.id, tenantId],
      );
      if (!r.rows.length) return res.status(404).json({ message: 'Contato não encontrado.' });
      return res.json(r.rows[0]);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // GET /api/higienizacao/listas-resumo — contagem REAL por lista (via contato_listas).
  router.get('/listas-resumo', async (req: AuthRequest, res: Response) => {
    try {
      const tenantId = await resolverOwnerId(pool, req.userId!);
      const listas = await pool.query(
        `SELECT l.id, l.nome,
                count(cl.contato_id)::int                                  AS total,
                count(*) FILTER (WHERE c.whatsapp_status = 'valido')::int   AS validos,
                count(*) FILTER (WHERE c.whatsapp_status = 'sem_whatsapp')::int AS sem_whatsapp,
                count(*) FILTER (WHERE c.whatsapp_status = 'pendente')::int AS pendentes,
                count(*) FILTER (WHERE c.whatsapp_status = 'erro')::int     AS erros,
                count(*) FILTER (WHERE c.is_business)::int                  AS business,
                count(*) FILTER (WHERE c.nome_confiavel)::int               AS com_nome,
                count(*) FILTER (WHERE c.whatsapp_status IS NOT NULL AND c.whatsapp_status <> 'pendente')::int AS verificados,
                round(avg(c.lead_score))::int                               AS score_medio,
                max(c.whatsapp_verificado_em)                               AS ultima_verificacao
         FROM listas l
         LEFT JOIN contato_listas cl ON cl.lista_id = l.id
         LEFT JOIN contatos c ON c.id = cl.contato_id
         WHERE l.user_id = $1
         GROUP BY l.id, l.nome, l.created_at
         ORDER BY l.created_at DESC`,
        [tenantId],
      );
      const totais = await pool.query(
        `SELECT count(*)::int AS contatos,
                count(*) FILTER (WHERE tipo_telefone IS NULL AND telefone IS NOT NULL)::int AS a_normalizar
         FROM contatos WHERE user_id = $1`,
        [tenantId],
      );
      const comNota = listas.rows.map((l: any) => ({ ...l, nota: notaDaLista(l) }));
      return res.json({ listas: comNota, totais: totais.rows[0] });
    } catch (err: any) {
      log.error('HIGIENIZACAO', 'Erro em GET /listas-resumo', { err: err?.message, stack: err?.stack });
      return res.status(500).json({ message: err.message });
    }
  });

  // GET /api/higienizacao/vinculos — { lista_id: [contato_id, ...] } (N:N).
  router.get('/vinculos', async (req: AuthRequest, res: Response) => {
    try {
      const tenantId = await resolverOwnerId(pool, req.userId!);
      const r = await pool.query(
        `SELECT lista_id, array_agg(contato_id) AS contatos FROM contato_listas WHERE user_id = $1 GROUP BY lista_id`,
        [tenantId],
      );
      const mapa: Record<string, string[]> = {};
      for (const row of r.rows) mapa[row.lista_id] = row.contatos;
      return res.json(mapa);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // GET /api/higienizacao/contatos-das-listas?lista_ids=a,b&page=1&limit=500
  // Contatos de uma ou mais listas considerando o N:N (contato em várias listas aparece 1 vez).
  router.get('/contatos-das-listas', async (req: AuthRequest, res: Response) => {
    try {
      const tenantId = await resolverOwnerId(pool, req.userId!);
      const ids = String(req.query.lista_ids || '').split(',').map(s => s.trim()).filter(Boolean);
      if (!ids.length || ids.length > 200 || !ids.every(i => UUID.test(i))) {
        return res.status(400).json({ message: 'lista_ids inválido.' });
      }
      const limit = Math.min(Math.max(parseInt(String(req.query.limit || '500'), 10) || 500, 1), 500);
      const page = Math.max(parseInt(String(req.query.page || '1'), 10) || 1, 1);
      const r = await pool.query(
        `SELECT DISTINCT ON (c.id)
                c.id, c.nome, c.telefone, c.empresa, c.email, c.cargo, c.cidade, c.estado, c.interesse,
                c.data_nascimento, c.tags, c.lista_id, c.opt_out, c.ultimo_disparo_em, c.funil_estagio_id,
                c.primeiro_nome, c.nome_confiavel, c.whatsapp_status, c.tipo_telefone, c.telefone_normalizado
         FROM contatos c
         JOIN contato_listas cl ON cl.contato_id = c.id
         WHERE c.user_id = $1 AND cl.lista_id = ANY($2::uuid[])
         ORDER BY c.id
         LIMIT $3 OFFSET $4`,
        [tenantId, ids, limit, (page - 1) * limit],
      );
      return res.json(r.rows);
    } catch (err: any) {
      log.error('HIGIENIZACAO', 'Erro em GET /contatos-das-listas', { err: err?.message, stack: err?.stack });
      return res.status(500).json({ message: err.message });
    }
  });

  // POST /api/higienizacao/normalizar — força a varredura agora (útil após importar/backfill).
  router.post('/normalizar', async (req: AuthRequest, res: Response) => {
    try {
      const tenantId = await resolverOwnerId(pool, req.userId!);
      const n = await normalizarPendentes(pool, 20, tenantId);
      return res.json({ normalizados: n });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  return router;
}

export { CONFIG_PADRAO };
