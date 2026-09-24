import { Router } from 'express';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { AuthRequest } from '../middleware';
import { log } from '../logger';
import { configProviderDoAmbiente, consultasDoNicho, consultasUsadasHoje, LIMITES, paginasRaspadasHoje, RASPAGEM, semearNichosSeVazio } from '../radar/busca';
import { enfileirarBusca, enfileirarLinkPublico, enfileirarValidacao, memoriaRedis, redisConfigurado } from '../radar/fila';
import { carregarPesos, configLeitura, pausaAtiva, pontuarTodos, textoPausa } from '../radar/validacao';
import { mesclarPesos } from '../radar/scoring';
import { importarCsv } from '../radar/importarPlanilha';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const lista = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean).slice(0, 100) : [];

export default function radarRouter(pool: Pool): Router {
  const router = Router();

  // ── Status do módulo: provider real ou simulado, uso de cota, memória do Redis ─────────────────
  router.get('/status', async (req: AuthRequest, res) => {
    try {
      const { real, provider, aviso } = configProviderDoAmbiente();
      const usadas = await consultasUsadasHoje(pool, req.userId!);
      res.json({
        provider: provider.nome, busca_real: real, aviso: aviso ?? null,
        fila: redisConfigurado() ? 'redis' : 'inline',
        consultas_hoje: usadas, limite_consultas_dia: LIMITES.consultasPorDia(),
        redis: await memoriaRedis(),
        // Crawler de diretórios fica desligado por padrão; uso depende dos termos de cada site.
        pausas: {
          busca: await pausaAtiva(pool, `busca:${provider.nome}`).then(p => (p ? textoPausa(p) : null)),
          verificacao_links: await pausaAtiva(pool, 'link_publico').then(p => (p ? textoPausa(p) : null)),
        },
        leitura_convites: { configurada: !!configLeitura(), instancia: configLeitura()?.instancia ?? null },
        raspagem: { ativa: RASPAGEM.ativa(), diretorios: RASPAGEM.diretorios(), paginas_hoje: await paginasRaspadasHoje(pool, req.userId!), limite_dia: RASPAGEM.porDia() },
      });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Nichos ───────────────────────────────────────────────────────────────────────────────────
  router.get('/nichos', async (req: AuthRequest, res) => {
    try {
      await semearNichosSeVazio(pool, req.userId!);
      const r = await pool.query(`SELECT * FROM radar_nichos WHERE user_id = $1 ORDER BY nome`, [req.userId]);
      res.json(r.rows);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.post('/nichos', async (req: AuthRequest, res) => {
    try {
      const nome = String(req.body?.nome ?? '').trim();
      if (nome.length < 2) return res.status(400).json({ error: 'Nome do nicho obrigatório' });
      const r = await pool.query(
        `INSERT INTO radar_nichos (user_id, nome, termos_busca, palavras_positivas, palavras_negativas, regioes)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (user_id, nome) DO NOTHING RETURNING *`,
        [req.userId, nome, lista(req.body.termos_busca), lista(req.body.palavras_positivas), lista(req.body.palavras_negativas), lista(req.body.regioes)],
      );
      if (!r.rows[0]) return res.status(409).json({ error: 'Já existe um nicho com esse nome' });
      res.status(201).json(r.rows[0]);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.patch('/nichos/:id', async (req: AuthRequest, res) => {
    try {
      if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'id inválido' });
      const b = req.body ?? {};
      const r = await pool.query(
        `UPDATE radar_nichos SET
           nome = COALESCE($3, nome),
           termos_busca = COALESCE($4, termos_busca),
           palavras_positivas = COALESCE($5, palavras_positivas),
           palavras_negativas = COALESCE($6, palavras_negativas),
           regioes = COALESCE($7, regioes),
           ativo = COALESCE($8, ativo),
           agendar = COALESCE($9, agendar),
           ddds = COALESCE($10, ddds),
           updated_at = now()
         WHERE id = $1 AND user_id = $2 RETURNING *`,
        [req.params.id, req.userId, b.nome ? String(b.nome).trim() : null,
         b.termos_busca ? lista(b.termos_busca) : null, b.palavras_positivas ? lista(b.palavras_positivas) : null,
         b.palavras_negativas ? lista(b.palavras_negativas) : null, b.regioes ? lista(b.regioes) : null,
         typeof b.ativo === 'boolean' ? b.ativo : null,
         typeof b.agendar === 'boolean' ? b.agendar : null,
         b.ddds ? lista(b.ddds).map((d: string) => d.replace(/\D/g, '')).filter((d: string) => /^\d{2}$/.test(d)) : null],
      );
      if (!r.rows[0]) return res.status(404).json({ error: 'Nicho não encontrado' });
      res.json(r.rows[0]);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.delete('/nichos/:id', async (req: AuthRequest, res) => {
    try {
      if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'id inválido' });
      await pool.query(`DELETE FROM radar_nichos WHERE id = $1 AND user_id = $2`, [req.params.id, req.userId]);
      res.status(204).end();
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Buscas ───────────────────────────────────────────────────────────────────────────────────
  // request_id idempotente: repetir o POST com o mesmo id devolve a mesma busca e NÃO consulta de novo.
  router.post('/buscas', async (req: AuthRequest, res) => {
    try {
      const userId = req.userId!;
      const { nicho_id, incluir_telegram } = req.body ?? {};
      const requestId = UUID_RE.test(String(req.body?.request_id ?? '')) ? String(req.body.request_id) : randomUUID();
      if (!UUID_RE.test(String(nicho_id ?? ''))) return res.status(400).json({ error: 'nicho_id obrigatório' });

      const existente = await pool.query(`SELECT * FROM radar_buscas WHERE user_id = $1 AND request_id = $2`, [userId, requestId]);
      if (existente.rows[0]) return res.status(200).json({ ...existente.rows[0], repetida: true });

      const nicho = (await pool.query(`SELECT * FROM radar_nichos WHERE id = $1 AND user_id = $2`, [nicho_id, userId])).rows[0];
      if (!nicho) return res.status(404).json({ error: 'Nicho não encontrado' });

      const pausa = await pausaAtiva(pool, `busca:${configProviderDoAmbiente().provider.nome}`);
      if (pausa) return res.status(429).json({ error: `Buscas ${textoPausa(pausa)}` });

      const restante = LIMITES.consultasPorDia() - (await consultasUsadasHoje(pool, userId));
      if (restante <= 0) return res.status(429).json({ error: 'Limite diário de consultas do Radar atingido.' });
      const pedido = Math.max(1, Math.min(Number(req.body?.max_consultas) || 10, LIMITES.consultasPorBusca()));
      const maxConsultas = Math.min(pedido, restante);

      // Termo customizado substitui os termos do nicho (mantém as regiões do nicho).
      const termo = String(req.body?.termo ?? '').replace(/"/g, '').trim().slice(0, 120);
      const consultas = consultasDoNicho(nicho, { termo: termo || undefined, incluirTelegram: !!incluir_telegram, max: maxConsultas });
      if (!consultas.length) return res.status(400).json({ error: 'O nicho não tem termos de busca' });

      const ins = await pool.query(
        `INSERT INTO radar_buscas (user_id, request_id, nicho_id, consultas, max_consultas)
         VALUES ($1,$2,$3,$4::jsonb,$5) ON CONFLICT (user_id, request_id) DO NOTHING RETURNING *`,
        [userId, requestId, nicho.id, JSON.stringify(consultas), maxConsultas],
      );
      if (!ins.rows[0]) return res.status(200).json({ repetida: true });
      const modo = await enfileirarBusca(pool, ins.rows[0].id);
      res.status(202).json({ ...ins.rows[0], modo });
    } catch (err: any) {
      log.error('RADAR', 'erro ao criar busca', { err: err?.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/buscas', async (req: AuthRequest, res) => {
    try {
      const r = await pool.query(
        `SELECT b.*, n.nome AS nicho_nome FROM radar_buscas b LEFT JOIN radar_nichos n ON n.id = b.nicho_id
          WHERE b.user_id = $1 ORDER BY b.created_at DESC LIMIT 50`, [req.userId]);
      res.json(r.rows);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Catálogo de grupos ───────────────────────────────────────────────────────────────────────
  router.get('/grupos', async (req: AuthRequest, res) => {
    try {
      const { status, nicho_id, plataforma, order, min_score, q, aderencia, importado, fonte } = req.query as Record<string, string>;
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const offset = Math.max(Number(req.query.offset) || 0, 0);
      const w = ['g.user_id = $1'];
      const v: any[] = [req.userId];
      if (status) { v.push(status); w.push(`g.status = $${v.length}`); }
      if (plataforma) { v.push(plataforma); w.push(`g.plataforma = $${v.length}`); }
      if (nicho_id && UUID_RE.test(nicho_id)) { v.push(nicho_id); w.push(`g.nicho_id = $${v.length}`); }
      if (aderencia && ['alta', 'media', 'baixa', 'sem_dados'].includes(aderencia)) { v.push(aderencia); w.push(`g.aderencia = ${v.length}`); }
      if (importado === 'sim') w.push('g.importado_lista_id IS NOT NULL');
      if (importado === 'nao') w.push('g.importado_lista_id IS NULL');
      if (fonte && ['busca', 'diretorio', 'planilha'].includes(fonte)) { v.push(fonte); w.push(`g.fonte = $${v.length}`); }
      if (q && q.trim()) { v.push(`%${q.trim().slice(0, 80)}%`); w.push(`(g.nome ILIKE ${v.length} OR g.titulo_origem ILIKE ${v.length} OR g.descricao ILIKE ${v.length})`); }
      if (min_score && Number.isFinite(Number(min_score))) { v.push(Number(min_score)); w.push(`g.score >= ${v.length}`); }
      v.push(limit, offset);
      const r = await pool.query(
        `SELECT g.*, n.nome AS nicho_nome, COUNT(*) OVER()::int AS total
           FROM radar_grupos g LEFT JOIN radar_nichos n ON n.id = g.nicho_id
          WHERE ${w.join(' AND ')} ORDER BY ${order === 'score' ? 'g.score DESC NULLS LAST, g.created_at DESC' : 'g.created_at DESC'} LIMIT $${v.length - 1} OFFSET $${v.length}`, v);
      res.json({ total: r.rows[0]?.total ?? 0, itens: r.rows });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });


  // ── Verificação de link pela página pública (sem instância, sem entrar): descarta link morto ─────────
  router.post('/grupos/verificar-links', async (req: AuthRequest, res) => {
    try {
      const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.filter((x: unknown) => UUID_RE.test(String(x))) : [];
      const limite = Math.max(1, Math.min(Number(req.body?.limite) || 50, 200));
      const r = ids.length
        ? await pool.query(`SELECT id FROM radar_grupos WHERE user_id = $1 AND id = ANY($2::uuid[]) AND plataforma = 'whatsapp' AND status <> 'rejeitado'`, [req.userId, ids])
        : await pool.query(
            `SELECT id FROM radar_grupos WHERE user_id = $1 AND plataforma = 'whatsapp' AND link_verificado_em IS NULL
               AND status IN ('descoberto','aprovado') ORDER BY created_at LIMIT $2`, [req.userId, limite]);
      if (!r.rows.length) return res.json({ enfileirados: 0 });
      const pausa = await pausaAtiva(pool, 'link_publico');
      const modo = await enfileirarLinkPublico(r.rows.map((x: any) => x.id));
      res.status(202).json({ enfileirados: r.rows.length, modo, aviso: pausa ? `Verificação ${textoPausa(pausa)}; os links entram na fila e são checados depois.` : null });
    } catch (err: any) {
      log.error('RADAR', 'erro ao enfileirar verificação de links', { err: err?.message });
      res.status(500).json({ error: err.message });
    }
  });

  // ── Pré-visualização do convite (sem entrar): nome, descrição, participantes, link ativo + score ──
  router.post('/grupos/validar', async (req: AuthRequest, res) => {
    try {
      if (!configLeitura()) {
        return res.status(409).json({ error: 'Nenhuma instância configurada para ler convites (RADAR_EVOLUTION_INSTANCE, EVOLUTION_API_URL, EVOLUTION_API_KEY).' });
      }
      const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.filter((x: unknown) => UUID_RE.test(String(x))) : [];
      const limite = Math.max(1, Math.min(Number(req.body?.limite) || 20, 100));
      const r = ids.length
        ? await pool.query(`SELECT id FROM radar_grupos WHERE user_id = $1 AND id = ANY($2::uuid[]) AND plataforma = 'whatsapp' AND status <> 'rejeitado'`, [req.userId, ids])
        : await pool.query(
            `SELECT id FROM radar_grupos WHERE user_id = $1 AND plataforma = 'whatsapp' AND validado_em IS NULL AND status IN ('descoberto','aprovado')
              ORDER BY created_at LIMIT $2`, [req.userId, limite]);
      if (!r.rows.length) return res.json({ enfileirados: 0 });
      const modo = await enfileirarValidacao(r.rows.map((x: any) => x.id));
      res.status(202).json({ enfileirados: r.rows.length, modo });
    } catch (err: any) {
      log.error('RADAR', 'erro ao enfileirar validação', { err: err?.message });
      res.status(500).json({ error: err.message });
    }
  });

  // Recalcula o score de todos os grupos já lidos (após editar nichos/pesos). Não chama a Evolution.
  router.post('/grupos/pontuar', async (req: AuthRequest, res) => {
    try { res.json({ recalculados: await pontuarTodos(pool, req.userId!) }); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.get('/pesos', async (req: AuthRequest, res) => {
    try { res.json(await carregarPesos(pool, req.userId!)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.put('/pesos', async (req: AuthRequest, res) => {
    try {
      const pesos = mesclarPesos(req.body);
      await pool.query(
        `INSERT INTO radar_score_config (user_id, pesos) VALUES ($1,$2::jsonb)
         ON CONFLICT (user_id) DO UPDATE SET pesos = EXCLUDED.pesos, updated_at = now()`, [req.userId, JSON.stringify(pesos)]);
      res.json(pesos);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Nesta etapa só há decisão de catálogo (aprovar/rejeitar). Entrar em grupo é de outra fase.
  router.patch('/grupos/:id', async (req: AuthRequest, res) => {
    try {
      if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'id inválido' });
      const status = String(req.body?.status ?? '');
      if (!['descoberto', 'aprovado', 'rejeitado'].includes(status)) return res.status(400).json({ error: 'status inválido' });
      const r = await pool.query(
        `UPDATE radar_grupos SET status = $3, updated_at = now()
          WHERE id = $1 AND user_id = $2 AND status IN ('descoberto','aprovado','rejeitado') RETURNING *`,
        [req.params.id, req.userId, status]);
      if (!r.rows[0]) return res.status(404).json({ error: 'Grupo não encontrado ou em estado que não aceita a mudança' });
      res.json(r.rows[0]);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Importar planilha (CSV/texto com links) ──────────────────────────────────────────────────
  router.post('/importar', async (req: AuthRequest, res) => {
    try {
      const csv = String(req.body?.csv ?? '');
      if (!csv.trim()) return res.status(400).json({ error: 'Envie o conteúdo do CSV em "csv"' });
      const r = importarCsv(csv);
      let novos = 0;
      for (const it of r.itens) {
        const nicho = it.nicho
          ? (await pool.query(`SELECT id FROM radar_nichos WHERE user_id = $1 AND lower(nome) = lower($2)`, [req.userId, it.nicho])).rows[0]
          : null;
        const ins = await pool.query(
          `INSERT INTO radar_grupos (user_id, plataforma, codigo_convite, url, nome, nicho_id, regiao, fonte)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'planilha') ON CONFLICT (user_id, plataforma, codigo_convite) DO NOTHING`,
          [req.userId, it.link.plataforma, it.link.codigo, it.link.url, it.nome, nicho?.id ?? null, it.regiao]);
        if (ins.rowCount) novos++;
      }
      res.json({ lidos: r.itens.length, novos, ja_existiam: r.itens.length - novos, duplicados_na_planilha: r.duplicados, linhas_sem_link: r.semLink });
    } catch (err: any) {
      log.error('RADAR', 'erro ao importar', { err: err?.message });
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
