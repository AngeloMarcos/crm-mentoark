import { Router } from 'express';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { AuthRequest } from '../middleware';
import { log } from '../logger';
import { configProviderDoAmbiente, consultasDoNicho, diretoriosUteis, consultasUsadasHoje, LIMITES, paginasRaspadasHoje, RASPAGEM, semearNichosSeVazio } from '../radar/busca';
import { enfileirarBusca, enfileirarEntrada, enfileirarLinkPublico, enfileirarValidacao, memoriaRedis, redisConfigurado } from '../radar/fila';
import { carregarPesos, configLeitura, pausar, pausaAtiva, pontuarTodos, retomar, textoPausa, consultasConviteHoje } from '../radar/validacao';
import { mesclarPesos } from '../radar/scoring';
import { importarCsv } from '../radar/importarPlanilha';
import { entradasHoje, instanciaApta, instanciaDeProspeccao, podeEntrar, transicaoValida } from '../radar/entrar';
import { resolverOwnerId } from '../services/subscription';

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
      const cfgLeitura = await configLeitura(pool, req.userId!);
      res.json({
        provider: provider.nome, busca_real: real, aviso: aviso ?? null,
        fila: redisConfigurado() ? 'redis' : 'inline',
        consultas_hoje: usadas, limite_consultas_dia: LIMITES.consultasPorDia(),
        redis: await memoriaRedis(),
        // Crawler de diretórios fica desligado por padrão; uso depende dos termos de cada site.
        pausas: {
          busca: await pausaAtiva(pool, `busca:${provider.nome}`).then(p => (p ? textoPausa(p) : null)),
          verificacao_links: await pausaAtiva(pool, 'link_publico').then(p => (p ? textoPausa(p) : null)),
          entrada: await pausaAtiva(pool, 'entrada').then(p => (p ? textoPausa(p) : null)),
        },
        leitura_convites: { configurada: !!cfgLeitura, instancia: cfgLeitura?.instancia ?? null },
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
      const consultas = consultasDoNicho(nicho, { termo: termo || undefined, incluirTelegram: !!incluir_telegram, max: maxConsultas, diretorios: await diretoriosUteis(pool, userId) });
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
      if (aderencia && ['alta', 'media', 'baixa', 'sem_dados'].includes(aderencia)) { v.push(aderencia); w.push(`g.aderencia = $${v.length}`); }
      if (importado === 'sim') w.push('g.importado_lista_id IS NOT NULL');
      if (importado === 'nao') w.push('g.importado_lista_id IS NULL');
      if (fonte && ['busca', 'diretorio', 'planilha'].includes(fonte)) { v.push(fonte); w.push(`g.fonte = $${v.length}`); }
      if (q && q.trim()) { v.push(`%${q.trim().slice(0, 80)}%`); w.push(`(g.nome ILIKE $${v.length} OR g.titulo_origem ILIKE $${v.length} OR g.descricao ILIKE $${v.length})`); }
      if (min_score && Number.isFinite(Number(min_score))) { v.push(Number(min_score)); w.push(`g.score >= $${v.length}`); }
      v.push(limit, offset);
      const r = await pool.query(
        `SELECT g.*, n.nome AS nicho_nome, COUNT(*) OVER()::int AS total
           FROM radar_grupos g LEFT JOIN radar_nichos n ON n.id = g.nicho_id
          WHERE ${w.join(' AND ')} ORDER BY ${
           order === 'score' ? 'g.score DESC NULLS LAST, g.created_at DESC'
           : order === 'membros' ? 'g.participantes DESC NULLS LAST, g.created_at DESC'
           : 'g.created_at DESC'
         } LIMIT $${v.length - 1} OFFSET $${v.length}`, v);
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
      if (!(await configLeitura(pool, req.userId!))) {
        return res.status(409).json({ error: 'Nenhuma instância configurada para ler convites (defina a instância de prospecção em Radar → Configurações, ou RADAR_EVOLUTION_INSTANCE).' });
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

  // Decisão manual de catálogo (aprovar/rejeitar/reabrir). Entrar em grupo tem endpoint próprio
  // (POST /grupos/entrar) — o estado `na_fila`/`entrou`/`aguardando_aprovacao`/`cheio` é gerido
  // pela fila de entrada, não por este PATCH (máquina de estado em `backend/src/radar/entrar.ts`).
  router.patch('/grupos/:id', async (req: AuthRequest, res) => {
    try {
      if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'id inválido' });
      const status = String(req.body?.status ?? '');
      if (!['descoberto', 'aprovado', 'rejeitado'].includes(status)) return res.status(400).json({ error: 'status inválido' });
      const atual = await pool.query(`SELECT status FROM radar_grupos WHERE id = $1 AND user_id = $2`, [req.params.id, req.userId]);
      if (!atual.rows[0]) return res.status(404).json({ error: 'Grupo não encontrado' });
      if (!transicaoValida(atual.rows[0].status, status)) {
        return res.status(409).json({ error: `Não é possível mudar de "${atual.rows[0].status}" para "${status}"` });
      }
      const r = await pool.query(
        `UPDATE radar_grupos SET status = $3, updated_at = now() WHERE id = $1 AND user_id = $2 RETURNING *`,
        [req.params.id, req.userId, status]);
      if (!r.rows[0]) return res.status(404).json({ error: 'Grupo não encontrado ou em estado que não aceita a mudança' });
      res.json(r.rows[0]);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Etapa 3: entrar em grupo pelo sistema ───────────────────────────────────────────────────────
  // Instâncias WhatsApp (`agentes`) são recurso da CONTA RAIZ (compartilhado entre membros de
  // equipe) — sempre resolver o dono antes de consultar `agentes`, senão um membro de equipe nunca
  // vê/edita as instâncias que a conta já tem (mesmo padrão já usado em whatsapp.ts/webhook.ts).
  router.get('/instancias', async (req: AuthRequest, res) => {
    try {
      const ownerId = await resolverOwnerId(pool, req.userId!);
      const r = await pool.query(
        `SELECT id, nome, evolution_instancia, papel, ativo, health_score, evolution_conectado_em
           FROM agentes WHERE user_id = $1 AND evolution_instancia IS NOT NULL ORDER BY nome`, [ownerId]);
      res.json(r.rows);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.put('/instancias/:id/papel', async (req: AuthRequest, res) => {
    try {
      if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'id inválido' });
      const papel = String(req.body?.papel ?? '');
      // Sprint 8 (Sprint 4 / H8): + pessoal (sem IA e sem disparo) e maturacao.
      if (!['atendimento', 'disparo', 'prospeccao', 'pessoal', 'maturacao'].includes(papel)) return res.status(400).json({ error: 'papel inválido' });
      const ownerId = await resolverOwnerId(pool, req.userId!);
      const r = await pool.query(
        `UPDATE agentes SET papel = $3, updated_at = now() WHERE id = $1 AND user_id = $2 RETURNING id, nome, evolution_instancia, papel`,
        [req.params.id, ownerId, papel]);
      if (!r.rows[0]) return res.status(404).json({ error: 'Instância não encontrada' });
      res.json(r.rows[0]);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.get('/entrada-config', async (req: AuthRequest, res) => {
    try {
      const userId = req.userId!;
      const ownerId = await resolverOwnerId(pool, userId);
      await pool.query(`INSERT INTO radar_entrada_config (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [userId]);
      const cfg = (await pool.query(`SELECT * FROM radar_entrada_config WHERE user_id = $1`, [userId])).rows[0];
      const instancias = await pool.query(
        `SELECT id, nome, evolution_instancia, health_score, evolution_conectado_em
           FROM agentes WHERE user_id = $1 AND papel = 'prospeccao' AND ativo = true ORDER BY nome`, [ownerId]);
      const instancia = await instanciaDeProspeccao(pool, userId);
      res.json({
        ...cfg,
        instancias_disponiveis: instancias.rows,
        instancia_selecionada_apta: instancia ? instanciaApta(instancia, { corteDiasConectado: cfg.corte_dias_conectado, corteHealthScore: cfg.corte_health_score }) : null,
        entradas_hoje: await entradasHoje(pool, userId),
        consultas_hoje: await consultasConviteHoje(pool, userId),
      });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.put('/entrada-config', async (req: AuthRequest, res) => {
    try {
      const userId = req.userId!;
      const b = req.body ?? {};
      const numOuNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
      await pool.query(`INSERT INTO radar_entrada_config (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [userId]);
      const r = await pool.query(
        `UPDATE radar_entrada_config SET
           agente_id            = COALESCE($2, agente_id),
           limite_dia           = COALESCE($3, limite_dia),
           pausa_min_seg        = COALESCE($4, pausa_min_seg),
           pausa_max_seg        = COALESCE($5, pausa_max_seg),
           janela_inicio        = COALESCE($6, janela_inicio),
           janela_fim           = COALESCE($7, janela_fim),
           corte_score          = COALESCE($8, corte_score),
           corte_membros        = COALESCE($9, corte_membros),
           corte_dias_conectado = COALESCE($10, corte_dias_conectado),
           corte_health_score   = COALESCE($11, corte_health_score),
           extracao_apos_horas  = COALESCE($12, extracao_apos_horas),
           sair_apos_extrair    = COALESCE($13, sair_apos_extrair),
           limite_consultas_dia = COALESCE($14, limite_consultas_dia),
           updated_at = now()
         WHERE user_id = $1 RETURNING *`,
        [userId, UUID_RE.test(String(b.agente_id ?? '')) ? b.agente_id : null,
         numOuNull(b.limite_dia), numOuNull(b.pausa_min_seg), numOuNull(b.pausa_max_seg),
         /^\d{2}:\d{2}$/.test(b.janela_inicio ?? '') ? b.janela_inicio : null,
         /^\d{2}:\d{2}$/.test(b.janela_fim ?? '') ? b.janela_fim : null,
         numOuNull(b.corte_score), numOuNull(b.corte_membros), numOuNull(b.corte_dias_conectado), numOuNull(b.corte_health_score),
         numOuNull(b.extracao_apos_horas), typeof b.sair_apos_extrair === 'boolean' ? b.sair_apos_extrair : null,
         // Sprint 8 / H7: consultas de convite por dia (1 a 500).
         numOuNull(b.limite_consultas_dia) === null ? null : Math.max(1, Math.min(500, Math.round(b.limite_consultas_dia)))],
      );
      res.json(r.rows[0]);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Só um clique: para (ou retoma) a fila de entrada — chave de emergência do pedido.
  router.post('/pausas/entrada', async (req: AuthRequest, res) => {
    try {
      const motivo = String(req.body?.motivo ?? 'Pausada manualmente pelo usuário').slice(0, 300);
      await pausar(pool, 'entrada', Math.max(1, Number(req.body?.minutos) || 24 * 60), motivo);
      res.json({ pausado: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });
  router.delete('/pausas/entrada', async (req: AuthRequest, res) => {
    try { await retomar(pool, 'entrada'); res.json({ pausado: false }); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Botão "Entrar" (um grupo) e ação em massa "Entrar nos aprovados" — enfileira, nunca entra na hora.
  router.post('/grupos/entrar', async (req: AuthRequest, res) => {
    try {
      const userId = req.userId!;
      const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.filter((x: unknown) => UUID_RE.test(String(x))) : [];
      const cfgRes = await pool.query(`SELECT * FROM radar_entrada_config WHERE user_id = $1`, [userId]);
      const cfg = cfgRes.rows[0];
      if (!cfg) {
        const msg = 'Configure a entrada em grupo antes (Radar → Configurações → Entrada em grupo).';
        return res.status(409).json({ error: msg, message: msg });
      }

      const restante = Math.max(0, cfg.limite_dia - (await entradasHoje(pool, userId)));
      if (restante <= 0) {
        // 409, não 429: o frontend trata QUALQUER 429 como "rate limit" genérico ("Muitas
        // requisições, aguarde") — aqui é o teto DIÁRIO configurado, não um limite de tráfego;
        // achado real (2026-09-28): o texto genérico escondia a causa de verdade do usuário.
        const msg = `Limite diário de entradas (${cfg.limite_dia}) já atingido hoje. Volta amanhã ou aumenta o limite em Configurações.`;
        return res.status(409).json({ error: msg, message: msg });
      }

      const r = ids.length
        ? await pool.query(`SELECT * FROM radar_grupos WHERE user_id = $1 AND id = ANY($2::uuid[]) AND plataforma = 'whatsapp'`, [userId, ids])
        : await pool.query(
            `SELECT * FROM radar_grupos WHERE user_id = $1 AND plataforma = 'whatsapp' AND status = 'aprovado'
              ORDER BY score DESC NULLS LAST LIMIT $2`, [userId, restante]);

      const elegiveis = r.rows.filter((g: any) => podeEntrar({ status: g.status, score: g.score, participantes: g.participantes }, { corteScore: cfg.corte_score, corteMembros: cfg.corte_membros }).ok);
      const recusados = r.rows.length - elegiveis.length;
      if (!elegiveis.length) return res.json({ enfileirados: 0, recusados });

      const selecionados = elegiveis.slice(0, restante);
      const modo = await enfileirarEntrada(selecionados.map((g: any) => g.id));
      res.status(202).json({ enfileirados: selecionados.length, recusados: recusados + (elegiveis.length - selecionados.length), modo });
    } catch (err: any) {
      log.error('RADAR', 'erro ao enfileirar entrada em grupo', { err: err?.message });
      res.status(500).json({ error: err.message });
    }
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
