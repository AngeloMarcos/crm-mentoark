/**
 * routes/maturador.ts — CRUD do Maturador de Números (Sprint Score Real + Maturador, 2026-08-09,
 * item 2): listar pares, criar par, ativar/desativar, marcar como banido, excluir.
 *
 * [AUDITORIA] BUG EVITADO (achado por leitura de `agentEngine.ts` ANTES de implementar, não
 * assumido): `processarMensagem()` resolve o agente pela instância que recebeu a mensagem
 * (`WHERE evolution_instancia=X AND user_id=Y AND ativo=true`) mas, se essa busca não achar NADA
 * (instância sem `agentes.ativo=true` PRÓPRIO — ativo=false, ou linha inexistente), cai num
 * FALLBACK que pega QUALQUER agente `ativo=true` DA MESMA CONTA (`WHERE user_id=$1 AND ativo=true
 * ORDER BY updated_at DESC LIMIT 1`). Ou seja: checar só se as DUAS instâncias do par têm
 * `ativo=false` não é suficiente — se NENHUMA das duas tiver sua PRÓPRIA linha `ativo=true`, o
 * fallback pode pegar a mensagem do maturador e entregar pra QUALQUER OUTRA instância com IA
 * ativa da conta, gerando uma chamada real de IA (custo de token real, quebrando a promessa de
 * "zero IA" desta feature).
 *
 * [AUDITORIA] BUG CORRIGIDO (achado real do usuário, 2026-09-13 — "não é verdade" que a conta tem
 * IA ativa): a 1ª versão deste guard-rail (visão de conta inteira) tinha 2 imprecisões, achadas ao
 * ler `agentEngine.ts` de novo em detalhe: (1) `ativo=true` sozinho não basta nem quando o agente
 * É o resolvido diretamente — `agentEngine.ts` (linha ~752) se recusa a responder sem
 * `prompt_sistema` PRÓPRIO ou `agent_prompts` (legado, por CONTA) reais, nem cai numa persona
 * genérica. (2) o fallback pra "qualquer outro agente ativo da conta" só é alcançado quando a
 * busca pela instância específica (`evolution_instancia=X AND ativo=true`) não encontra NADA —
 * se a própria instância JÁ tem uma linha `ativo=true` (mesmo sem prompt), `agentEngine.ts` para
 * ali, nunca chega no fallback de conta. Confirmado no banco: a conta do usuário tinha as 2
 * instâncias do par (Comercial/Pessoal) com `ativo=true` mas SEM prompt — cada uma resolve
 * direto pra si mesma e desiste por falta de prompt, nunca alcançando um 3º agente ("Stella") que
 * tinha prompt real mas nenhuma relação com este par. A versão anterior deste guard-rail
 * (checagem de conta inteira) via "Stella" e recusava ativar um par que, na prática, corria risco
 * ZERO — falso positivo puro.
 * [AUDITORIA] FIX APLICADO: `parTemRiscoDeIaResponder` reproduz a mesma árvore de decisão de
 * `agentEngine.ts` pras 2 instâncias do par especificamente — só bloqueia quando (a) uma das 2
 * tem `ativo=true` E prompt efetivo (próprio ou legado da conta) real, ou (b) NENHUMA das 2 tem
 * sua própria linha `ativo=true` (o que abre o fallback de conta) E existe outro agente
 * `ativo=true`+prompt efetivo em algum lugar da conta.
 */
import { Router, Response } from 'express';
import { Pool } from 'pg';
import { AuthRequest } from '../middleware';
import { log } from '../logger';

export default function maturadorRouter(pool: Pool): Router {
  const router = Router();

  // GET / — lista pares do usuário, com nome/instância das 2 pontas já resolvidos (evita N+1 no frontend)
  router.get('/', async (req: AuthRequest, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: 'Usuário não autenticado' });
    const r = await pool.query(
      `SELECT mp.*, a.nome AS agente_a_nome, a.evolution_instancia AS agente_a_instancia,
              b.nome AS agente_b_nome, b.evolution_instancia AS agente_b_instancia
       FROM maturador_pares mp
       JOIN agentes a ON a.id = mp.agente_a_id
       JOIN agentes b ON b.id = mp.agente_b_id
       WHERE mp.user_id = $1
       ORDER BY mp.created_at DESC`,
      [userId]
    );
    return res.json(r.rows);
  });

  // [AUDITORIA] LÓGICA: checagem compartilhada por criação E ativação — a conta pode ligar um
  // agente de IA DEPOIS de já ter criado/ativado um par, então a validação tem que rodar de novo
  // em toda ativação, não só na criação. Ver nota grande no topo do arquivo pra árvore de decisão
  // completa (mesma de `agentEngine.ts`) e o achado real que motivou reescrever isto 2x.
  async function parTemRiscoDeIaResponder(userId: string, agenteAId: string, agenteBId: string): Promise<boolean> {
    // "Prompt efetivo da conta" — mesmo fallback legado que agentEngine.ts consulta quando
    // `agente.prompt_sistema` do agente resolvido vier vazio (linha ~746, `agent_prompts`).
    const legadoRes = await pool.query(
      `SELECT 1 FROM agent_prompts WHERE user_id = $1 AND ativo = true
         AND conteudo IS NOT NULL AND trim(conteudo) <> '' LIMIT 1`,
      [userId]
    );
    const temPromptLegado = legadoRes.rows.length > 0;

    const parRes = await pool.query(
      `SELECT id, ativo, (prompt_sistema IS NOT NULL AND trim(prompt_sistema) <> '') AS tem_prompt_proprio
       FROM agentes WHERE id = ANY($1::uuid[]) AND user_id = $2`,
      [[agenteAId, agenteBId], userId]
    );

    // (a) Risco direto: uma das 2 instâncias do par tem `ativo=true` E vai encontrar um prompt de
    // verdade quando `agentEngine.ts` resolvê-la (própria, ou o legado da conta como fallback) —
    // ela mesma responde, sem precisar de fallback de conta nenhum.
    const riscoDireto = parRes.rows.some(r => r.ativo && (r.tem_prompt_proprio || temPromptLegado));
    if (riscoDireto) return true;

    // (b) Risco por fallback de conta: só existe se NENHUMA das 2 instâncias tiver sua própria
    // linha `ativo=true` — só nesse caso a busca por instância de `agentEngine.ts` vem vazia e
    // cai no fallback "qualquer agente ativo=true da conta". Se QUALQUER uma das 2 já tem
    // `ativo=true` (mesmo sem prompt), `agentEngine.ts` para nela e desiste ali — nunca alcança
    // um 3º agente não relacionado a este par, então o fallback de conta é irrelevante aqui.
    const nenhumaTemAtivoProprio = parRes.rows.length < 2 || parRes.rows.every(r => !r.ativo);
    if (!nenhumaTemAtivoProprio) return false;

    const outroRes = await pool.query(
      `SELECT 1 FROM agentes
       WHERE user_id = $1 AND ativo = true
         AND (prompt_sistema IS NOT NULL AND trim(prompt_sistema) <> '' OR $2)
       LIMIT 1`,
      [userId, temPromptLegado]
    );
    return outroRes.rows.length > 0;
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
      return res.status(201).json(r.rows[0]);
    } catch (err: any) {
      if (err?.code === '23505') { // unique violation — par já existe
        return res.status(409).json({ message: 'Já existe um par cadastrado com essas 2 instâncias' });
      }
      log.error('MATURADOR', 'Falha ao criar par', { err: err?.message });
      return res.status(500).json({ message: err?.message || 'Falha ao criar par' });
    }
  });

  // PATCH /:id/ativo — liga/desliga um par (guard-rail de IA checado aqui, não só na criação)
  router.patch('/:id/ativo', async (req: AuthRequest, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: 'Usuário não autenticado' });
    const { ativo } = req.body;
    if (typeof ativo !== 'boolean') return res.status(400).json({ message: '"ativo" precisa ser true/false' });

    if (ativo) {
      const par = await pool.query(
        `SELECT agente_a_id, agente_b_id FROM maturador_pares WHERE id = $1 AND user_id = $2`,
        [req.params.id, userId]
      );
      if (!par.rows.length) return res.status(404).json({ message: 'Par não encontrado' });
      if (await parTemRiscoDeIaResponder(userId, par.rows[0].agente_a_id, par.rows[0].agente_b_id)) {
        return res.status(409).json({
          message: 'Uma das instâncias deste par (ou o fallback de IA da conta) tem um agente com prompt configurado. Ativar o Maturador arrisca a mensagem cair na IA de verdade (custo real de token) — desative esse agente antes de ligar o Maturador.',
        });
      }
    }

    const r = await pool.query(
      `UPDATE maturador_pares SET ativo = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3 RETURNING *`,
      [ativo, req.params.id, userId]
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
    // Força o score da instância marcada pra refletir o achado real AGORA, sem esperar o cron.
    await pool.query(
      `UPDATE agentes SET whatsapp_score = 0,
              score_fatores = '{"volume_diario":0,"taxa_resposta":0,"reclamacoes":0,"tempo_conta":0}'::jsonb,
              score_updated_at = NOW()
       WHERE id = $1 AND user_id = $2`,
      [agente_id, userId]
    );
    log.info('MATURADOR', 'Instância marcada como banida/caída pelo operador — score forçado a 0', { agenteId: agente_id });
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
    return res.status(204).send();
  });

  return router;
}
