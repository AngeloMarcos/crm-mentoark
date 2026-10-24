/**
 * routes/maturador.ts — CRUD do Maturador de Números (Sprint Score Real + Maturador, 2026-08-09,
 * item 2): listar pares, criar par, ativar/desativar, marcar como banido, excluir.
 *
 * [AUDITORIA] HISTÓRICO: as versões de 2026-08-09 e 2026-09-13 protegiam contra a IA responder
 * uma mensagem do maturador recusando ATIVAR o par se a conta tivesse agente/prompt capaz de
 * responder (inclusive o prompt legado `agent_prompts`). Achado real do usuário (2026-10-04):
 * isso obrigava a desligar a IA da conta inteira pra usar o maturador, e não protegia contra uma
 * IA ligada DEPOIS da ativação.
 * [AUDITORIA] FIX APLICADO (Maturador v2): a proteção saiu da ativação e foi pra ORIGEM — o
 * webhook reconhece tráfego do maturador (`services/maturadorFiltro.ts`) e nunca o entrega pra
 * IA/contatos/leads. A ativação agora exige o que esse filtro precisa pra funcionar: as 2
 * instâncias conectadas e com o número real identificado.
 */
import { Router, Response } from 'express';
import { Pool } from 'pg';
import { AuthRequest } from '../middleware';
import { log } from '../logger';
import { SELECT_PARES_COM_CREDENCIAIS, instanciaConectada, resolverNumerosPar } from '../services/maturadorProcessor';
import { invalidarNumerosMaturador } from '../services/maturadorFiltro';
import { registrarEvento, mudarFase, normalizar as normalizarNumeroSaude, saudeDoUsuario } from '../services/saudeNumero';
import {
  controlesPorAgente, salvarControles, estadoControles, velocidadeEfetiva, progressoAquecimento,
  CONTROLES_PADRAO, VELOCIDADES, VISIBILIDADES, TOTAL_DIAS_AQUECIMENTO,
} from '../services/maturadorControles';
import {
  proximoItem, adicionarTexto, adicionarImagem, removerItem, urlImagemStatus,
  MAX_ITENS_POR_TIPO, MAX_CARACTERES_TEXTO, MAX_CARACTERES_LEGENDA,
} from '../services/maturadorStatus';
import {
  listarGrupos, adicionarGrupo, removerGrupo, MAX_GRUPOS_POR_CONTA, MAX_ENTRADAS_DIA_CHIP, HORAS_ENTRE_ENTRADAS,
} from '../services/maturadorGrupos';
import { recalcularScoreAgente } from '../services/instanceScore';
import { resolverOwnerId } from '../services/subscription';
import { avaliarParticipantes, globalLigado, montarRedeGlobal, TERMO_GLOBAL_VERSAO, bloqueioEnvio } from '../services/maturadorGlobal';
import { validarProxy, aplicarProxy, removerProxy, testarProxy } from '../services/proxyInstancia';

export const TERMO_GLOBAL_TEXTO =
  'Ao participar do Aquecimento Global, os números desta conta trocam mensagens curtas e neutras ' +
  '(sem propaganda e sem dados dos seus clientes) com números de outras contas da MentoArk, para ' +
  'criar histórico de uso e melhorar o score. Os números das outras contas aparecem nas conversas ' +
  'do seu WhatsApp no celular (não aparecem na caixa de entrada do CRM). Números novos só recebem ' +
  'mensagens até a liberação. Cada número precisa de um proxy próprio. Você pode sair a qualquer momento.';

export default function maturadorRouter(pool: Pool): Router {
  const router = Router();

  // ── Sprint 7 do maturador v5 (2026-10-18, modelo ChipFlow): controles por chip ──────────────
  router.get('/controles', async (req: AuthRequest, res: Response) => {
    const ownerId = await resolverOwnerId(pool, req.userId!);
    const saude = await saudeDoUsuario(pool, ownerId);
    const ctrls = await controlesPorAgente(pool);
    const nomes = new Map((await pool.query(`SELECT id, nome FROM agentes WHERE user_id = $1`, [ownerId])).rows.map((x: any) => [x.id, x.nome]));
    const cont = new Map((await pool.query(
      `SELECT a.id,
              (SELECT COUNT(*)::int FROM maturador_mensagens m WHERE m.de_agente_id = a.id AND m.tipo IN ('texto', 'audio', 'foto', 'figurinha')) AS enviadas,
              (SELECT COUNT(*)::int FROM maturador_mensagens m WHERE m.para_agente_id = a.id AND m.tipo IN ('texto', 'audio', 'foto', 'figurinha')) AS recebidas,
              (SELECT COUNT(*)::int FROM maturador_mensagens m WHERE m.de_agente_id = a.id AND m.tipo = 'status' AND m.texto NOT LIKE '[falhou]%') AS status,
              (SELECT COUNT(*)::int FROM maturador_status_itens i WHERE i.agente_id = a.id AND i.tipo = 'imagem') AS status_imagens,
              (SELECT COUNT(*)::int FROM maturador_status_itens i WHERE i.agente_id = a.id AND i.tipo = 'texto') AS status_textos,
              (SELECT COUNT(*)::int FROM maturador_mensagens m WHERE (m.de_agente_id = a.id OR m.para_agente_id = a.id) AND m.created_at >= NOW() - INTERVAL '24 hours') AS ultimas_24h
       FROM agentes a WHERE a.user_id = $1`, [ownerId])).rows.map((x: any) => [x.id, x]));
    const chips = [];
    for (const s of saude) {
      const c = ctrls.get(s.agente_id) ?? CONTROLES_PADRAO;
      const soRecebe = await bloqueioEnvio(pool, s.instancia);
      chips.push({
        agente_id: s.agente_id, nome: nomes.get(s.agente_id) ?? s.instancia, instancia: s.instancia, numero: s.numero,
        fase: s.fase, fase_rotulo: s.fase_rotulo, so_recebe: soRecebe,
        controles: c,
        estado: estadoControles(c, { fase: s.fase, so_recebe: soRecebe }),
        velocidade: { escolhido: c.velocidade, ...velocidadeEfetiva(c.velocidade, { fase: s.fase, primeira_conexao_em: s.primeira_conexao_em }) },
        progresso: { ...progressoAquecimento(s.fase, s.fase_desde), total_dias: TOTAL_DIAS_AQUECIMENTO },
        contadores: cont.get(s.agente_id) ?? { enviadas: 0, recebidas: 0, status: 0, status_imagens: 0, status_textos: 0, ultimas_24h: 0 },
      });
    }
    return res.json({ rotina: { dorme: '00:00–07:00', conversa: '07:00–24:00', status: '14:00–20:00 (1 por dia)' }, chips });
  });

  router.put('/controles/:agenteId', async (req: AuthRequest, res: Response) => {
    const ownerId = await resolverOwnerId(pool, req.userId!);
    const ag = await pool.query(`SELECT id FROM agentes WHERE id = $1 AND user_id = $2`, [req.params.agenteId, ownerId]);
    if (!ag.rowCount) return res.status(404).json({ message: 'Número não encontrado nesta conta' });
    const b = req.body || {};
    if (b.velocidade !== undefined && !VELOCIDADES.includes(b.velocidade)) return res.status(400).json({ message: 'Velocidade inválida' });
    if (b.status_visibilidade !== undefined && !VISIBILIDADES.includes(b.status_visibilidade)) return res.status(400).json({ message: 'Visibilidade inválida' });
    const novo = await salvarControles(pool, req.params.agenteId, ownerId, b);
    log.info('MATURADOR', 'Controles do chip alterados', { agenteId: req.params.agenteId, ...novo });
    return res.json(novo);
  });

  // ── Sprint 10 do maturador v5 (2026-10-20): status rico — fila de imagens e textos por chip ──
  const agenteDaConta = async (agenteId: string, ownerId: string) =>
    (await pool.query(`SELECT id FROM agentes WHERE id = $1 AND user_id = $2`, [agenteId, ownerId])).rowCount! > 0;

  router.get('/status/:agenteId', async (req: AuthRequest, res: Response) => {
    const ownerId = await resolverOwnerId(pool, req.userId!);
    if (!(await agenteDaConta(req.params.agenteId, ownerId))) return res.status(404).json({ message: 'Número não encontrado nesta conta' });
    const r = await pool.query(
      `SELECT id, tipo, conteudo, legenda, ordem, publicado_em, vezes FROM maturador_status_itens
       WHERE agente_id = $1 ORDER BY ordem, created_at`, [req.params.agenteId]);
    const ctrl = (await controlesPorAgente(pool)).get(req.params.agenteId) ?? CONTROLES_PADRAO;
    const proximo = await proximoItem(pool, req.params.agenteId);
    return res.json({
      visibilidade: ctrl.status_visibilidade,
      limites: { por_tipo: MAX_ITENS_POR_TIPO, caracteres_texto: MAX_CARACTERES_TEXTO, caracteres_legenda: MAX_CARACTERES_LEGENDA },
      proximo_id: proximo?.id ?? null,
      itens: r.rows.map((x: any) => ({ ...x, url: x.tipo === 'imagem' ? urlImagemStatus(x.conteudo) : null })),
    });
  });

  router.post('/status/:agenteId/itens', async (req: AuthRequest, res: Response) => {
    const ownerId = await resolverOwnerId(pool, req.userId!);
    if (!(await agenteDaConta(req.params.agenteId, ownerId))) return res.status(404).json({ message: 'Número não encontrado nesta conta' });
    const b = req.body || {};
    if (b.tipo === 'imagem' && String(b.imagem || '').length > 15_000_000) return res.status(413).json({ message: 'Imagem grande demais (máx. ~10 MB)' });
    const r = b.tipo === 'imagem'
      ? await adicionarImagem(pool, ownerId, req.params.agenteId, b.imagem, b.legenda)
      : b.tipo === 'texto' ? await adicionarTexto(pool, ownerId, req.params.agenteId, b.texto) : { erro: 'Tipo inválido' };
    if (r.erro) return res.status(400).json({ message: r.erro });
    return res.status(201).json(r.item);
  });

  router.delete('/status/itens/:itemId', async (req: AuthRequest, res: Response) => {
    const ownerId = await resolverOwnerId(pool, req.userId!);
    if (!(await removerItem(pool, ownerId, req.params.itemId))) return res.status(404).json({ message: 'Item não encontrado' });
    return res.json({ ok: true });
  });

  // ── Sprint 11 do maturador v5 (2026-10-23): grupos do aquecimento ────────────────────────────
  router.get('/grupos', async (req: AuthRequest, res: Response) => {
    const ownerId = await resolverOwnerId(pool, req.userId!);
    return res.json({
      limites: { grupos: MAX_GRUPOS_POR_CONTA, entradas_dia_chip: MAX_ENTRADAS_DIA_CHIP, horas_entre_entradas: HORAS_ENTRE_ENTRADAS },
      grupos: await listarGrupos(pool, ownerId),
    });
  });

  router.post('/grupos', async (req: AuthRequest, res: Response) => {
    const ownerId = await resolverOwnerId(pool, req.userId!);
    const r = await adicionarGrupo(pool, ownerId, req.body?.link);
    if (r.erro) return res.status(400).json({ message: r.erro });
    return res.status(201).json(r.grupo);
  });

  // ── Sprint 12 do maturador v5 (2026-10-24): pulso do dia + visualizador de conversas (só leitura) ──
  const HOJE_BR = `(created_at AT TIME ZONE 'America/Sao_Paulo')::date = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date`;
  const paresDaConta = `SELECT mp.id FROM maturador_pares mp
    JOIN agentes a ON a.id = mp.agente_a_id JOIN agentes b ON b.id = mp.agente_b_id
    WHERE mp.user_id = $1 OR a.user_id = $1 OR b.user_id = $1`;

  router.get('/conversas', async (req: AuthRequest, res: Response) => {
    const ownerId = await resolverOwnerId(pool, req.userId!);
    const [pulso, p2p, grupos] = await Promise.all([
      pool.query(
        `WITH meus AS (SELECT id FROM agentes WHERE user_id = $1),
              p AS (SELECT de_agente_id, tipo, texto FROM maturador_mensagens WHERE ${HOJE_BR} AND de_agente_id IN (SELECT id FROM meus)),
              g AS (SELECT agente_id FROM maturador_grupo_mensagens WHERE ${HOJE_BR} AND agente_id IN (SELECT id FROM meus))
         SELECT (SELECT COUNT(*) FROM p WHERE tipo IN ('texto', 'audio', 'foto', 'figurinha'))::int AS conversa,
                (SELECT COUNT(*) FROM g)::int AS grupo,
                (SELECT COUNT(*) FROM p WHERE tipo = 'audio')::int AS audios,
                (SELECT COUNT(*) FROM p WHERE tipo = 'foto')::int AS fotos,
                (SELECT COUNT(*) FROM p WHERE tipo = 'status' AND texto NOT LIKE '[falhou]%')::int AS status,
                (SELECT COUNT(DISTINCT x) FROM (SELECT de_agente_id AS x FROM p UNION SELECT agente_id FROM g) u)::int AS chips_ativos,
                (SELECT COUNT(*) FROM agentes WHERE user_id = $1 AND evolution_instancia IS NOT NULL)::int AS chips_total`, [ownerId]),
      pool.query(
        `SELECT mp.id, a.nome AS nome_a, b.nome AS nome_b, mp.global, mp.ativo,
                (SELECT texto FROM maturador_mensagens m WHERE m.par_id = mp.id AND m.tipo <> 'status' ORDER BY created_at DESC LIMIT 1) AS ultima,
                (SELECT MAX(created_at) FROM maturador_mensagens m WHERE m.par_id = mp.id) AS ultima_em,
                (SELECT COUNT(*)::int FROM maturador_mensagens m WHERE m.par_id = mp.id AND ${HOJE_BR.replace(/created_at/g, 'm.created_at')}) AS hoje
         FROM maturador_pares mp JOIN agentes a ON a.id = mp.agente_a_id JOIN agentes b ON b.id = mp.agente_b_id
         WHERE mp.id IN (${paresDaConta})`, [ownerId]),
      pool.query(
        `SELECT g.id, g.nome, g.estado,
                (SELECT texto FROM maturador_grupo_mensagens m WHERE m.grupo_id = g.id ORDER BY created_at DESC LIMIT 1) AS ultima,
                (SELECT MAX(created_at) FROM maturador_grupo_mensagens m WHERE m.grupo_id = g.id) AS ultima_em,
                (SELECT COUNT(*)::int FROM maturador_grupo_mensagens m WHERE m.grupo_id = g.id AND ${HOJE_BR.replace(/created_at/g, 'm.created_at')}) AS hoje
         FROM maturador_grupos g WHERE g.user_id = $1`, [ownerId]),
    ]);
    const conversas = [
      ...p2p.rows.map((x: any) => ({ tipo: 'p2p', id: x.id, titulo: `${x.nome_a} ↔ ${x.nome_b}`, global: x.global, ativo: x.ativo, ultima: x.ultima, ultima_em: x.ultima_em, hoje: x.hoje })),
      ...grupos.rows.map((x: any) => ({ tipo: 'grupo', id: x.id, titulo: x.nome || 'Grupo', ativo: x.estado === 'ativo', ultima: x.ultima, ultima_em: x.ultima_em, hoje: x.hoje })),
    ].sort((a, b) => (b.ultima_em ? new Date(b.ultima_em).getTime() : 0) - (a.ultima_em ? new Date(a.ultima_em).getTime() : 0));
    return res.json({ pulso: pulso.rows[0], conversas });
  });

  router.get('/conversas/:tipo/:id', async (req: AuthRequest, res: Response) => {
    const ownerId = await resolverOwnerId(pool, req.userId!);
    const { tipo, id } = req.params;
    if (tipo === 'p2p') {
      const ok = await pool.query(`SELECT 1 FROM (${paresDaConta}) x WHERE x.id = $2`, [ownerId, id]);
      if (!ok.rowCount) return res.status(404).json({ message: 'Conversa não encontrada' });
      const r = await pool.query(
        `SELECT * FROM (SELECT m.de_agente_id, a.nome AS de_nome, m.tipo, m.texto, m.mentoria, m.created_at
           FROM maturador_mensagens m JOIN agentes a ON a.id = m.de_agente_id
           WHERE m.par_id = $1 ORDER BY m.created_at DESC LIMIT 150) t ORDER BY created_at`, [id]);
      return res.json({ mensagens: r.rows });
    }
    if (tipo === 'grupo') {
      const ok = await pool.query(`SELECT 1 FROM maturador_grupos WHERE id = $1 AND user_id = $2`, [id, ownerId]);
      if (!ok.rowCount) return res.status(404).json({ message: 'Conversa não encontrada' });
      const r = await pool.query(
        `SELECT * FROM (SELECT m.agente_id AS de_agente_id, a.nome AS de_nome, m.tipo, m.texto, false AS mentoria, m.created_at
           FROM maturador_grupo_mensagens m JOIN agentes a ON a.id = m.agente_id
           WHERE m.grupo_id = $1 ORDER BY m.created_at DESC LIMIT 150) t ORDER BY created_at`, [id]);
      return res.json({ mensagens: r.rows });
    }
    return res.status(400).json({ message: 'Tipo inválido' });
  });

  router.delete('/grupos/:grupoId', async (req: AuthRequest, res: Response) => {
    const ownerId = await resolverOwnerId(pool, req.userId!);
    if (!(await removerGrupo(pool, ownerId, req.params.grupoId))) return res.status(404).json({ message: 'Grupo não encontrado' });
    return res.json({ ok: true });
  });

  // ── Sprint 9 (2026-10-06): Maturador Global — adesão da conta, situação de cada número, proxy ──
  // Registradas antes das rotas `/:id` de propósito.
  router.get('/global', async (req: AuthRequest, res: Response) => {
    const ownerId = await resolverOwnerId(pool, req.userId!);
    const [ligado, ad, numeros, proxies, vinc] = await Promise.all([
      globalLigado(pool),
      pool.query(`SELECT ativo, aceito_em, aceito_por, termo_versao FROM maturador_global_adesao WHERE user_id = $1`, [ownerId]),
      avaliarParticipantes(pool, ownerId),
      pool.query(`SELECT id, proxy_host, proxy_port, proxy_protocolo, proxy_usuario, proxy_aplicado_em, proxy_ip_saida, proxy_pais,
                         proxy_org, proxy_movel, proxy_testado_em FROM agentes WHERE user_id = $1`, [ownerId]),
      pool.query(
        `SELECT a.id, COUNT(mp.id) FILTER (WHERE mp.ativo)::int AS vinculos,
                (SELECT COUNT(*)::int FROM maturador_mensagens m JOIN maturador_pares p ON p.id = m.par_id AND p.global
                  WHERE m.de_agente_id = a.id AND m.tipo = 'texto' AND m.created_at >= NOW() - INTERVAL '24 hours') AS enviadas_24h,
                (SELECT COUNT(*)::int FROM maturador_mensagens m JOIN maturador_pares p ON p.id = m.par_id AND p.global
                  WHERE m.para_agente_id = a.id AND m.tipo = 'texto' AND m.created_at >= NOW() - INTERVAL '24 hours') AS recebidas_24h
         FROM agentes a LEFT JOIN maturador_pares mp ON mp.global AND a.id IN (mp.agente_a_id, mp.agente_b_id)
         WHERE a.user_id = $1 GROUP BY a.id`, [ownerId]),
    ]);
    const px = new Map(proxies.rows.map((x: any) => [x.id, x]));
    const vv = new Map(vinc.rows.map((x: any) => [x.id, x]));
    return res.json({
      ligado,
      adesao: ad.rows[0] ?? { ativo: false },
      termo: { versao: TERMO_GLOBAL_VERSAO, texto: TERMO_GLOBAL_TEXTO },
      numeros: numeros.map(n => {
        const p: any = px.get(n.agenteId) || {};
        const v: any = vv.get(n.agenteId) || {};
        return { ...n, userId: undefined,
          // Sprint 2: proxy salvo mas ainda não em uso (número não pareado) aparece como "pendente".
          proxy: p.proxy_host ? {
            host: p.proxy_host, port: p.proxy_port, protocolo: p.proxy_protocolo, usuario: p.proxy_usuario,
            aplicado_em: p.proxy_aplicado_em, pendente: !p.proxy_aplicado_em,
            ip_saida: p.proxy_ip_saida, pais: p.proxy_pais, org: p.proxy_org, movel: p.proxy_movel, testado_em: p.proxy_testado_em,
          } : null,
          vinculos: v.vinculos ?? 0, enviadas_24h: v.enviadas_24h ?? 0, recebidas_24h: v.recebidas_24h ?? 0 };
      }),
    });
  });

  router.put('/global/adesao', async (req: AuthRequest, res: Response) => {
    const ownerId = await resolverOwnerId(pool, req.userId!);
    const ativo = req.body?.ativo === true;
    if (ativo && req.body?.aceito !== true) return res.status(400).json({ message: 'Para participar, aceite o termo do Aquecimento Global.' });
    await pool.query(
      `INSERT INTO maturador_global_adesao (user_id, ativo, aceito_em, aceito_por, termo_versao, atualizado_em)
       VALUES ($1, $2, CASE WHEN $2 THEN NOW() END, CASE WHEN $2 THEN $3 END, CASE WHEN $2 THEN $4 END, NOW())
       ON CONFLICT (user_id) DO UPDATE SET ativo = $2, atualizado_em = NOW(),
         aceito_em = CASE WHEN $2 THEN NOW() ELSE maturador_global_adesao.aceito_em END,
         aceito_por = CASE WHEN $2 THEN $3 ELSE maturador_global_adesao.aceito_por END,
         termo_versao = CASE WHEN $2 THEN $4 ELSE maturador_global_adesao.termo_versao END`,
      [ownerId, ativo, req.userEmail || req.userId, TERMO_GLOBAL_VERSAO]
    );
    log.info('MATURADOR_GLOBAL', ativo ? 'Conta aderiu' : 'Conta saiu', { ownerId });
    // Sair desliga na hora os vínculos globais dos números desta conta.
    if (!ativo) {
      await pool.query(
        `UPDATE maturador_pares mp SET ativo = false, pausado_motivo = 'Conta saiu do Aquecimento Global', updated_at = NOW()
         FROM agentes a WHERE mp.global AND mp.ativo AND a.user_id = $1 AND a.id IN (mp.agente_a_id, mp.agente_b_id)`, [ownerId]);
    } else {
      void montarRedeGlobal(pool).catch(() => {});
    }
    return res.json({ ativo });
  });

  // Sprint 2 (2026-10-17): só testa — mostra IP de saída, país, operadora e se seria aceito.
  router.post('/proxy/:agenteId/testar', async (req: AuthRequest, res: Response) => {
    const v = validarProxy(req.body);
    if (v.erro) return res.status(400).json({ message: v.erro });
    const t = await testarProxy(v.proxy!);
    if (t.erro) return res.status(422).json({ message: t.erro });
    return res.json({ saida: t.saida, aceito: !t.recusa, motivo: t.recusa ?? null });
  });

  router.put('/proxy/:agenteId', async (req: AuthRequest, res: Response) => {
    const ownerId = await resolverOwnerId(pool, req.userId!);
    const v = validarProxy(req.body);
    if (v.erro) return res.status(400).json({ message: v.erro });
    const r = await aplicarProxy(pool, req.params.agenteId, ownerId, v.proxy!, req.body?.confirmar_troca === true);
    if (r.precisaConfirmar) return res.status(409).json({ code: 'CONFIRMAR_TROCA_IP', message: r.erro, saida: r.saida ?? null });
    if (r.erro) return res.status(422).json({ message: r.erro, saida: r.saida ?? null });
    void montarRedeGlobal(pool).catch(() => {});
    return res.json({ ok: true, situacao: r.situacao, saida: r.saida });
  });

  router.delete('/proxy/:agenteId', async (req: AuthRequest, res: Response) => {
    const ownerId = await resolverOwnerId(pool, req.userId!);
    const erro = await removerProxy(pool, req.params.agenteId, ownerId);
    if (erro) return res.status(404).json({ message: erro });
    void montarRedeGlobal(pool).catch(() => {});
    return res.json({ ok: true });
  });

  // GET / — lista pares do usuário, com nome/instância/score das 2 pontas, quanto cada ponta já
  // mandou hoje (teto é por instância) e as últimas mensagens trocadas (evita N+1 no frontend).
  router.get('/', async (req: AuthRequest, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: 'Usuário não autenticado' });
    const r = await pool.query(
      `SELECT mp.id, mp.agente_a_id, mp.agente_b_id, mp.ativo, mp.data_inicio, mp.contador_dia,
              mp.banido_em, mp.banido_agente_id, mp.ultima_mensagem_em, mp.proxima_mensagem_em,
              mp.hora_inicio, mp.hora_fim, mp.pausado_motivo, mp.numero_a, mp.numero_b,
              a.nome AS agente_a_nome, a.evolution_instancia AS agente_a_instancia, a.whatsapp_score AS agente_a_score,
              b.nome AS agente_b_nome, b.evolution_instancia AS agente_b_instancia, b.whatsapp_score AS agente_b_score,
              (SELECT COUNT(*)::int FROM maturador_mensagens m WHERE m.de_agente_id = mp.agente_a_id AND m.tipo = 'texto'
                 AND (m.created_at AT TIME ZONE 'America/Sao_Paulo')::date = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date) AS enviados_hoje_a,
              (SELECT COUNT(*)::int FROM maturador_mensagens m WHERE m.de_agente_id = mp.agente_b_id AND m.tipo = 'texto'
                 AND (m.created_at AT TIME ZONE 'America/Sao_Paulo')::date = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date) AS enviados_hoje_b,
              (SELECT COUNT(*)::int FROM maturador_mensagens m WHERE m.par_id = mp.id AND m.tipo = 'texto') AS total_mensagens,
              COALESCE((SELECT json_agg(u ORDER BY u.created_at DESC) FROM (
                 SELECT m.de_agente_id, m.tipo, m.texto, m.created_at FROM maturador_mensagens m
                 WHERE m.par_id = mp.id ORDER BY m.created_at DESC LIMIT 6) u), '[]'::json) AS ultimas_mensagens
       FROM maturador_pares mp
       JOIN agentes a ON a.id = mp.agente_a_id
       JOIN agentes b ON b.id = mp.agente_b_id
       WHERE mp.user_id = $1 AND NOT mp.global -- Sprint 9: par global é gerido pelo sistema
       ORDER BY mp.created_at DESC`,
      [userId]
    );
    return res.json(r.rows);
  });

  // Pré-requisito pra ligar um par: as 2 pontas conectadas e com número identificado (o filtro
  // do webhook depende do número pra reconhecer o tráfego do maturador). Devolve o motivo da
  // recusa, ou null se estiver tudo certo.
  async function motivoParaNaoAtivar(parId: string, userId: string): Promise<string | null> {
    const r = await pool.query(`${SELECT_PARES_COM_CREDENCIAIS} WHERE mp.id = $1 AND mp.user_id = $2 AND NOT mp.global`, [parId, userId]);
    const par = r.rows[0];
    if (!par) return 'Par não encontrado';
    if (!par.a_url || !par.a_instancia || !par.b_url || !par.b_instancia) {
      return 'Uma das instâncias do par está sem conexão configurada com o WhatsApp.';
    }
    const [aOk, bOk] = await Promise.all([
      instanciaConectada(par.a_url, par.a_key, par.a_instancia),
      instanciaConectada(par.b_url, par.b_key, par.b_instancia),
    ]);
    if (!aOk || !bOk) {
      return `A instância "${!aOk ? par.a_instancia : par.b_instancia}" não está conectada. Conecte as 2 instâncias antes de ligar o Maturador.`;
    }
    const { numeroA, numeroB } = await resolverNumerosPar(pool, par);
    if (!numeroA || !numeroB) {
      return 'Não foi possível descobrir o número de uma das instâncias. Tente de novo em alguns segundos.';
    }
    if (numeroA.slice(-8) === numeroB.slice(-8)) {
      return 'As 2 instâncias estão conectadas no MESMO número de WhatsApp — o par precisa de 2 números diferentes.';
    }
    return null;
  }

  // POST / — cria par novo (sempre nasce ativo=false, ver migrations.ts)
  router.post('/', async (req: AuthRequest, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: 'Usuário não autenticado' });
    const { agente_a_id, agente_b_id } = req.body;
    if (!agente_a_id || !agente_b_id) {
      return res.status(400).json({ message: 'agente_a_id e agente_b_id são obrigatórios' });
    }
    if (agente_a_id === agente_b_id) {
      return res.status(400).json({ message: 'As duas instâncias do par precisam ser diferentes' });
    }
    // Ownership: as 2 instâncias precisam pertencer ao usuário autenticado.
    const owned = await pool.query(
      `SELECT id FROM agentes WHERE id = ANY($1::uuid[]) AND user_id = $2`,
      [[agente_a_id, agente_b_id], userId]
    );
    if (owned.rows.length !== 2) {
      return res.status(403).json({ message: 'Uma ou ambas as instâncias não pertencem a este usuário' });
    }
    try {
      // 2026-10-18: o Aquecimento Global (modo teste) pode já ter criado um par GLOBAL entre essas 2
      // instâncias — invisível na lista da conta, mas ocupando a chave única (a, b). Antes isso
      // virava "Já existe um par" sem par nenhum na tela. Agora o par global vira par da conta
      // (desligado, como um par novo); montarRedeGlobal nunca converte par da conta de volta.
      const convertido = await pool.query(
        `UPDATE maturador_pares SET global = false, tipo = 'conversa', ativo = false, user_id = $1, pausado_motivo = NULL,
                falhas_consecutivas = 0, data_inicio = NOW(), proxima_mensagem_em = NULL, updated_at = NOW()
         WHERE agente_a_id = $2 AND agente_b_id = $3 AND global AND banido_em IS NULL RETURNING *`,
        [userId, agente_a_id, agente_b_id]
      );
      if (convertido.rowCount) {
        invalidarNumerosMaturador(userId);
        log.info('MATURADOR', 'Par global convertido em par da conta', { parId: convertido.rows[0].id });
        return res.status(201).json(convertido.rows[0]);
      }
      const r = await pool.query(
        `INSERT INTO maturador_pares (user_id, agente_a_id, agente_b_id) VALUES ($1, $2, $3) RETURNING *`,
        [userId, agente_a_id, agente_b_id]
      );
      invalidarNumerosMaturador(userId);
      return res.status(201).json(r.rows[0]);
    } catch (err: any) {
      if (err?.code === '23505') { // unique violation — par já existe
        return res.status(409).json({ message: 'Já existe um par cadastrado com essas 2 instâncias' });
      }
      log.error('MATURADOR', 'Falha ao criar par', { err: err?.message });
      return res.status(500).json({ message: err?.message || 'Falha ao criar par' });
    }
  });

  // PATCH /:id/ativo — liga/desliga um par (pré-requisitos checados a cada ativação)
  router.patch('/:id/ativo', async (req: AuthRequest, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: 'Usuário não autenticado' });
    const { ativo } = req.body;
    if (typeof ativo !== 'boolean') return res.status(400).json({ message: '"ativo" precisa ser true/false' });

    if (ativo) {
      const motivo = await motivoParaNaoAtivar(req.params.id, userId);
      if (motivo === 'Par não encontrado') return res.status(404).json({ message: motivo });
      if (motivo) return res.status(409).json({ message: motivo });
      invalidarNumerosMaturador(userId);
    }

    // Ligar zera o estado de falha/pausa automática e libera a 1ª troca na hora. Sprint 9: se uma
    // das pontas é número novo (só recebe), a 1ª mensagem fica para o dia seguinte entre 9h e 10h
    // (guia de aquecimento: o número novo começa a receber a partir do 2º dia).
    let comNumeroNovo = false;
    if (ativo) {
      const inst = (await pool.query(
        `SELECT a.evolution_instancia AS ia, b.evolution_instancia AS ib FROM maturador_pares mp
         JOIN agentes a ON a.id = mp.agente_a_id JOIN agentes b ON b.id = mp.agente_b_id WHERE mp.id = $1`, [req.params.id]
      )).rows[0];
      if (inst) comNumeroNovo = !!((await bloqueioEnvio(pool, inst.ia)) || (await bloqueioEnvio(pool, inst.ib)));
    }
    const r = await pool.query(
      `UPDATE maturador_pares
       SET ativo = $1, updated_at = NOW(),
           falhas_consecutivas = CASE WHEN $1 THEN 0 ELSE falhas_consecutivas END,
           pausado_motivo      = CASE WHEN $1 THEN NULL ELSE pausado_motivo END,
           proxima_mensagem_em = CASE WHEN $1 AND $4 THEN ((NOW() AT TIME ZONE 'America/Sao_Paulo')::date + 1 + TIME '09:00'
                                        + (floor(random() * 60)::int || ' minutes')::interval) AT TIME ZONE 'America/Sao_Paulo'
                                      WHEN $1 THEN NOW() ELSE proxima_mensagem_em END,
           msgs_restantes_sessao = CASE WHEN $1 THEN 0 ELSE msgs_restantes_sessao END
       WHERE id = $2 AND user_id = $3 AND NOT global RETURNING id, ativo, proxima_mensagem_em`,
      [ativo, req.params.id, userId, comNumeroNovo]
    );
    if (!r.rows.length) return res.status(404).json({ message: 'Par não encontrado' });
    return res.json(r.rows[0]);
  });

  // PATCH /:id/config — janela de horário em que o par conversa (horário de Brasília)
  router.patch('/:id/config', async (req: AuthRequest, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: 'Usuário não autenticado' });
    const inicio = Number(req.body?.hora_inicio);
    const fim = Number(req.body?.hora_fim);
    const valida = (h: number) => Number.isInteger(h) && h >= 0 && h <= 23;
    if (!valida(inicio) || !valida(fim) || inicio === fim) {
      return res.status(400).json({ message: 'Horário inválido — use horas inteiras de 0 a 23, início diferente do fim' });
    }
    const r = await pool.query(
      `UPDATE maturador_pares SET hora_inicio = $1, hora_fim = $2, updated_at = NOW()
       WHERE id = $3 AND user_id = $4 AND NOT global RETURNING id, hora_inicio, hora_fim`,
      [inicio, fim, req.params.id, userId]
    );
    if (!r.rows.length) return res.status(404).json({ message: 'Par não encontrado' });
    return res.json(r.rows[0]);
  });

  // POST /:id/banido — marca UM lado do par como banido/caído (botão "O número caiu ou baniu?")
  // [AUDITORIA] LÓGICA (item 2, ponte com item 1): alimenta o score REAL, não fica isolado —
  // força o score da instância marcada pra um valor crítico na hora (não espera o cron de
  // 15min), e desativa o par automaticamente (não faz sentido continuar mandando mensagem pra um
  // número que caiu).
  router.post('/:id/banido', async (req: AuthRequest, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: 'Usuário não autenticado' });
    const { agente_id } = req.body;
    if (!agente_id) return res.status(400).json({ message: 'agente_id é obrigatório (qual lado do par caiu/baniu)' });

    const par = await pool.query(
      `SELECT * FROM maturador_pares WHERE id = $1 AND user_id = $2 AND NOT global`,
      [req.params.id, userId]
    );
    if (!par.rows.length) return res.status(404).json({ message: 'Par não encontrado' });
    if (![par.rows[0].agente_a_id, par.rows[0].agente_b_id].includes(agente_id)) {
      return res.status(400).json({ message: 'agente_id não pertence a este par' });
    }

    await pool.query(
      `UPDATE maturador_pares SET ativo = false, banido_em = NOW(), banido_agente_id = $1, updated_at = NOW() WHERE id = $2`,
      [agente_id, req.params.id]
    );
    // [AUDITORIA] LÓGICA (Etapa A, 2026-10-05): a marcação manual entra no histórico REAL do número
    // (antes só forçava score 0 no formato antigo) — evento `ban_suspeito` + quarentena; se o número
    // não reconectar em 24h, `avaliarFases` confirma o ban (bans_total+1). Score recalculado na hora.
    const ag = await pool.query(
      `SELECT evolution_instancia, numero_conectado FROM agentes WHERE id = $1 AND user_id = $2`,
      [agente_id, userId]
    );
    const numero = normalizarNumeroSaude(ag.rows[0]?.numero_conectado);
    if (numero) {
      await registrarEvento(pool, numero, ag.rows[0].evolution_instancia, 'ban_suspeito', null, { motivo: 'marcado manualmente no Maturador' });
      await mudarFase(pool, numero, 'quarentena', 'marcado como caído/banido pelo operador', ag.rows[0].evolution_instancia);
    }
    await recalcularScoreAgente(pool, agente_id, userId).catch(() => null);
    log.info('MATURADOR', 'Instância marcada como banida/caída pelo operador — quarentena aplicada', { agenteId: agente_id, numero });
    return res.json({ ok: true });
  });

  // POST /:id/reativar — limpa a marca de banido/caído e devolve o par pro estado normal
  // (ativo=false, mesma regra de "nasce sempre desligado" — o usuário liga de novo quando quiser).
  // [AUDITORIA] BUG CORRIGIDO (achado real do usuário, 2026-09-13: "não consigo usar o maturador"
  // — marcou uma instância como caída/banida pra testar, ou por engano, e ficou preso: a única
  // ação disponível pra um par banido era excluir e recriar, perdendo `data_inicio` (reseta a
  // progressão de dias 20→50→100/dia) e o histórico. Reativar é o caminho reverso simétrico do
  // POST /:id/banido — não mexe em `data_inicio`/`contador_dia`/`linha_atual` de propósito
  // (a maturação estava rodando normalmente até a instância "cair"; não faz sentido perder esse
  // progresso só porque foi marcada e depois desmarcada). Não reverte o score forçado a 0 do
  // agente (POST /:id/banido) — se a instância realmente ficou saudável de novo, o cron de score
  // (ver ScoreInstancia.tsx/backend) recalcula sozinho no próximo ciclo a partir de dado real.
  router.post('/:id/reativar', async (req: AuthRequest, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: 'Usuário não autenticado' });

    const r = await pool.query(
      `UPDATE maturador_pares
       SET banido_em = NULL, banido_agente_id = NULL, updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND NOT global
       RETURNING *`,
      [req.params.id, userId]
    );
    if (!r.rows.length) return res.status(404).json({ message: 'Par não encontrado' });
    log.info('MATURADOR', 'Par reativado pelo operador — marca de banido/caído removida', { parId: req.params.id });
    return res.json(r.rows[0]);
  });

  // DELETE /:id — remove o par (não afeta as instâncias em si, só o pareamento)
  router.delete('/:id', async (req: AuthRequest, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: 'Usuário não autenticado' });
    await pool.query(`DELETE FROM maturador_pares WHERE id = $1 AND user_id = $2 AND NOT global`, [req.params.id, userId]);
    invalidarNumerosMaturador(userId);
    return res.status(204).send();
  });

  return router;
}
