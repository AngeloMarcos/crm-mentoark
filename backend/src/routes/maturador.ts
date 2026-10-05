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
import { registrarEvento, mudarFase, normalizar as normalizarNumeroSaude } from '../services/saudeNumero';
import { recalcularScoreAgente } from '../services/instanceScore';

export default function maturadorRouter(pool: Pool): Router {
  const router = Router();

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
       WHERE mp.user_id = $1
       ORDER BY mp.created_at DESC`,
      [userId]
    );
    return res.json(r.rows);
  });

  // Pré-requisito pra ligar um par: as 2 pontas conectadas e com número identificado (o filtro
  // do webhook depende do número pra reconhecer o tráfego do maturador). Devolve o motivo da
  // recusa, ou null se estiver tudo certo.
  async function motivoParaNaoAtivar(parId: string, userId: string): Promise<string | null> {
    const r = await pool.query(`${SELECT_PARES_COM_CREDENCIAIS} WHERE mp.id = $1 AND mp.user_id = $2`, [parId, userId]);
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

    // Ligar zera o estado de falha/pausa automática e libera a 1ª troca na hora.
    const r = await pool.query(
      `UPDATE maturador_pares
       SET ativo = $1, updated_at = NOW(),
           falhas_consecutivas = CASE WHEN $1 THEN 0 ELSE falhas_consecutivas END,
           pausado_motivo      = CASE WHEN $1 THEN NULL ELSE pausado_motivo END,
           proxima_mensagem_em = CASE WHEN $1 THEN NOW() ELSE proxima_mensagem_em END,
           msgs_restantes_sessao = CASE WHEN $1 THEN 0 ELSE msgs_restantes_sessao END
       WHERE id = $2 AND user_id = $3 RETURNING id, ativo`,
      [ativo, req.params.id, userId]
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
       WHERE id = $3 AND user_id = $4 RETURNING id, hora_inicio, hora_fim`,
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
      `SELECT * FROM maturador_pares WHERE id = $1 AND user_id = $2`,
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
       WHERE id = $1 AND user_id = $2
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
    await pool.query(`DELETE FROM maturador_pares WHERE id = $1 AND user_id = $2`, [req.params.id, userId]);
    invalidarNumerosMaturador(userId);
    return res.status(204).send();
  });

  return router;
}
