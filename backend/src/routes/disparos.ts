import { Router, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import { makeCrud } from '../crud';
import { AuthRequest, adminMiddleware } from '../middleware';
import { log } from '../logger';
import { evolutionFetch } from '../utils/resilientFetch';
import { criarProvider, OpenAIProvider } from '../services/providers';
import { resolverOwnerId } from '../services/subscription';
import { resolverTetoDiarioDisparo } from '../services/disparoProcessor';

// ── Rate limiting persistente via banco ──────────────────────────────────────
async function checkRateLimit(pool: Pool, userId: string): Promise<boolean> {
  const r = await pool.query(`
    SELECT last_disparo_at FROM disparo_rate_limit
    WHERE user_id = $1
    FOR UPDATE SKIP LOCKED
  `, [userId]).catch(() => ({ rows: [] as any[] }));

  const now = Date.now();
  const lastAt = r.rows[0]?.last_disparo_at
    ? new Date(r.rows[0].last_disparo_at).getTime()
    : 0;

  if (now - lastAt < 1000) return false; // bloqueado

  await pool.query(`
    INSERT INTO disparo_rate_limit (user_id, last_disparo_at)
    VALUES ($1, NOW())
    ON CONFLICT (user_id) DO UPDATE SET last_disparo_at = NOW()
  `, [userId]).catch(() => {});

  return true;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizarTelefone(raw: string): string | null {
  // Aceita dígitos, +, espaço e hífen — qualquer outro char invalida
  if (/[^\d+\s\-]/.test(raw)) return null;
  const digits = raw.replace(/[+\s\-]/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  return digits;
}

// [AUDITORIA] LÓGICA (Sprint Limite Diário Seguro, 2026-09-11 — pedido explícito do usuário:
// "limite os usuarios a disparar menos de 50 por dia para não travar ou banir a conta deles"):
// nasceu como teto ABSOLUTO fixo de 50 msgs/dia por instância. [AUDITORIA] FIX APLICADO
// (2026-09-18 — pedido do usuário: "pode tirar essa trava, deixe como opcional na configuração
// do sistema"): virou configurável POR TENANT (`users.limite_diario_disparos_max`, ver
// migrations.ts) — `resolverTetoDiarioDisparo` mora em `services/disparoProcessor.ts` (quem
// aplica o teto de verdade no envio) e é reaproveitada aqui, evitando duas fontes de verdade.
function makeClamparLimiteDiario(pool: Pool) {
  return async function clamparLimiteDiario(req: AuthRequest, _res: Response, next: NextFunction) {
    if (req.body && req.body.limite_diario_mensagens != null) {
      const v = Number(req.body.limite_diario_mensagens);
      if (Number.isFinite(v) && req.userId) {
        const teto = await resolverTetoDiarioDisparo(pool, req.userId);
        req.body.limite_diario_mensagens = Math.max(1, Math.min(teto, Math.trunc(v)));
      }
    }
    next();
  };
}

function dentroDaJanela(): boolean {
  // Horário de Brasília (America/Sao_Paulo). Permite 08:00–21:00.
  const sp = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const h = sp.getHours();
  const m = sp.getMinutes();
  if (h < 8) return false;
  if (h > 21) return false;
  if (h === 21 && m > 0) return false; // 21:01+ bloqueado
  return true;
}

export default function disparos(pool: Pool): Router {
  const base = makeCrud(pool, 'disparos');
  const router = Router();

  // ── POST /disparos/opt-out ─────────────────────────────────────────────────
  router.post('/opt-out', async (req: AuthRequest, res: Response) => {
    const { telefone } = req.body;
    if (!telefone) return res.status(400).json({ message: 'telefone é obrigatório' });

    const digits = normalizarTelefone(String(telefone));
    const suffix = (digits ?? String(telefone).replace(/\D/g, '')).slice(-11);

    await pool.query(
      `UPDATE contatos SET opt_out = true, updated_at = NOW()
       WHERE user_id = $1 AND telefone ILIKE $2`,
      [req.userId, `%${suffix}`]
    ).catch(() => {});

    await pool.query(
      `INSERT INTO disparo_optouts (user_id, telefone, motivo) VALUES ($1, $2, 'usuario_solicitou')`,
      [req.userId, digits ?? telefone]
    ).catch(() => {});

    return res.json({ ok: true });
  });

  // ── POST /disparos/enviar ──────────────────────────────────────────────────
  router.post('/enviar', async (req: AuthRequest, res: Response) => {
    const { telefone, texto, disparo_log_id, disparo_id } = req.body;

    // 1. Campos obrigatórios
    if (!telefone || !texto || !disparo_log_id || !disparo_id) {
      return res.status(400).json({
        message: 'telefone, texto, disparo_log_id e disparo_id são obrigatórios',
      });
    }

    // 2. Normalizar e validar telefone (dígitos, +, espaço, hífen — 10-15 dígitos)
    const telefoneNorm = normalizarTelefone(String(telefone));
    if (!telefoneNorm) {
      return res.status(400).json({
        message: 'telefone com formato inválido — aceitos: dígitos, +, espaço e hífen (10-15 dígitos)',
      });
    }

    // 3. Texto não pode ser vazio ou só espaços
    if (!String(texto).trim()) {
      return res.status(400).json({
        message: 'texto não pode ser vazio ou conter apenas espaços em branco',
      });
    }

    // 4. Limite Meta: 4096 caracteres
    if (String(texto).length > 4096) {
      return res.status(400).json({
        message: 'texto excede o limite de 4096 caracteres permitido pela Meta',
      });
    }

    // 5. Janela de envio: 08:00–21:00 (horário de Brasília)
    if (!dentroDaJanela()) {
      await pool.query(
        `UPDATE disparo_logs SET status = 'scheduled', erro = $1
         WHERE id = $2 AND user_id = $3`,
        ['Fora da janela de envio permitida (08h–21h, horário de Brasília)', disparo_log_id, req.userId]
      ).catch(() => {});
      return res.status(400).json({
        message: 'Fora da janela de envio permitida (08h–21h, horário de Brasília)',
      });
    }

    // 6. Opt-out: verificar contatos.opt_out ANTES do rate limit (resposta rápida)
    const optOutCheck = await pool.query(
      `SELECT opt_out FROM contatos WHERE user_id = $1 AND telefone ILIKE $2 LIMIT 1`,
      [req.userId, `%${telefoneNorm.slice(-11)}`]
    ).catch(() => ({ rows: [] as any[] }));

    if (optOutCheck.rows[0]?.opt_out === true) {
      await pool.query(
        `UPDATE disparo_logs SET status = 'optout',
         erro = 'Contato optou por não receber mensagens'
         WHERE id = $1 AND user_id = $2`,
        [disparo_log_id, req.userId]
      ).catch(() => {});
      return res.status(403).json({ message: 'Contato optou por não receber mensagens' });
    }

    // 7. Rate limiting: máx 1 msg/s por user_id (via banco)
    const userId = req.userId!;

    // 7.1 Verificar que disparo_log e disparo pertencem ao mesmo user e são relacionados
    const logCheck = await pool.query(
      `SELECT id FROM disparo_logs
       WHERE id = $1 AND disparo_id = $2 AND user_id = $3`,
      [disparo_log_id, disparo_id, userId]
    ).catch(() => ({ rows: [] as any[] }));

    if (!logCheck.rows.length) {
      return res.status(403).json({ message: 'disparo_log_id inválido para este disparo' });
    }

    const allowed = await checkRateLimit(pool, userId);
    if (!allowed) {
      res.set('Retry-After', '1');
      return res.status(429).json({
        message: 'Limite de 1 mensagem por segundo atingido — tente novamente em instantes',
      });
    }

    // Marca como enviando + incremento atômico de tentativas
    await pool.query(
      `UPDATE disparo_logs SET status = 'sending', tentativas = tentativas + 1
       WHERE id = $1 AND user_id = $2`,
      [disparo_log_id, userId]
    ).catch(() => {});

    try {
      const evoRes = await pool.query(
        `SELECT url, api_key, instancia FROM integracoes_config
         WHERE user_id = $1 AND tipo = 'evolution' AND status IN ('ativo','conectado')
         LIMIT 1`,
        [userId]
      );
      if (!evoRes.rows.length) {
        await pool.query(
          `UPDATE disparo_logs SET status = 'failed', erro = $1
           WHERE id = $2 AND user_id = $3`,
          ['Evolution API não configurada', disparo_log_id, userId]
        );
        await pool.query(
          `UPDATE disparos SET falhas = falhas + 1 WHERE id = $1 AND user_id = $2`,
          [disparo_id, userId]
        );
        return res.status(400).json({ message: 'Evolution API não configurada ou desconectada' });
      }

      const { url, api_key, instancia } = evoRes.rows[0];
      const baseUrl = url.replace(/\/$/, '');

      // 8. Personalização: substituir {{nome}} e {{telefone}} no texto
      const contatoRes = await pool.query(
        `SELECT nome FROM contatos WHERE user_id = $1 AND telefone ILIKE $2 LIMIT 1`,
        [userId, `%${telefoneNorm.slice(-11)}`]
      ).catch(() => ({ rows: [] as any[] }));
      const primeiroNome = (contatoRes.rows[0]?.nome ?? 'você').split(' ')[0];
      const textoFinal = String(texto)
        .replace(/\{\{nome\}\}/gi, primeiroNome)
        .replace(/\{\{telefone\}\}/gi, telefoneNorm);

      // 9. Delay variado anti-spam (simula digitação humana sem padrão fixo)
      const minDelay = Math.max(1000, textoFinal.length * 30);
      const maxDelay = Math.floor(minDelay * 1.8);
      const typingDelay = Math.floor(Math.random() * (maxDelay - minDelay) + minDelay);

      // O rate limit já foi registrado no checkRateLimit acima


      const resp = await evolutionFetch(`${baseUrl}/message/sendText/${instancia}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: api_key },
        body: JSON.stringify({ number: telefoneNorm, text: textoFinal, delay: typingDelay }),
      });

      if (!resp.ok) {
        const errBody = await resp.text().catch(() => '');
        const errMsg = `Evolution API ${resp.status}: ${errBody}`;
        await pool.query(
          `UPDATE disparo_logs SET status = 'failed', erro = $1 WHERE id = $2 AND user_id = $3`,
          [errMsg, disparo_log_id, userId]
        );
        await pool.query(
          `UPDATE disparos SET falhas = falhas + 1 WHERE id = $1 AND user_id = $2`,
          [disparo_id, userId]
        );
        return res.status(resp.status).json({ message: errMsg });
      }

      await pool.query(
        `UPDATE disparo_logs SET status = 'sent', enviado_at = NOW()
         WHERE id = $1 AND user_id = $2`,
        [disparo_log_id, userId]
      );
      await pool.query(
        `UPDATE disparos SET enviados = enviados + 1 WHERE id = $1 AND user_id = $2`,
        [disparo_id, userId]
      );

      return res.json({ ok: true });
    } catch (err: any) {
      log.error('DISPARO/ENVIAR', 'Erro', { err: err?.message, stack: err?.stack });
      await pool.query(
        `UPDATE disparo_logs SET status = 'failed', erro = $1 WHERE id = $2 AND user_id = $3`,
        [err.message, disparo_log_id, userId]
      ).catch(() => {});
      await pool.query(
        `UPDATE disparos SET falhas = falhas + 1 WHERE id = $1 AND user_id = $2`,
        [disparo_id, userId]
      ).catch(() => {});
      return res.status(500).json({ message: err.message });
    }
  });

  // ── POST /disparos/gerar-variacoes ──────────────────────────────────────────
  // [AUDITORIA] LÓGICA (Sprint Motor Nativo de Disparo, bloco 2 — item 4, 2026-08-07): autoria
  // assistida por IA UMA VEZ POR CAMPANHA, nunca por contato — diferente de `humanizar_ia`
  // (`humanizationService.ts`), que chama IA a cada envio. Chamada aqui acontece só quando o
  // operador clica o botão em StepMessage, ao MONTAR a campanha — resultado vira texto estático
  // em `mensagens_variantes` (item 2), zero chamada de IA depois disso, pros 1, 10 ou 10.000
  // contatos que a campanha tiver. Reaproveita `criarProvider()` (mesmo helper de
  // `agentEngine.ts`) — provider/modelo já configurado pra conta, não hardcoded pra OpenAI;
  // fallback pro OPENAI_API_KEY do .env quando a conta não tem `ai_providers` próprio (mesmo
  // padrão de `agentEngine.ts`).
  router.post('/gerar-variacoes', async (req: AuthRequest, res: Response) => {
    const userId = req.userId!;
    const mensagem = String(req.body?.mensagem ?? '').trim();
    const quantidade = Math.min(Math.max(Number(req.body?.quantidade) || 3, 2), 5);

    if (!mensagem) {
      return res.status(400).json({ message: 'Campo "mensagem" é obrigatório — escreva um rascunho antes de gerar variações.' });
    }
    if (mensagem.length > 2000) {
      return res.status(400).json({ message: 'Mensagem-base muito longa (máx. 2000 caracteres) para gerar variações.' });
    }

    try {
      const providerInfo = await criarProvider(pool, userId, null);
      const envKey = process.env.OPENAI_API_KEY || '';
      if (!providerInfo && !envKey) {
        return res.status(503).json({ message: 'Nenhum provider de IA configurado (Integrações > Configuração de IA) e OPENAI_API_KEY não definida no servidor.' });
      }
      const provider = providerInfo?.provider ?? new OpenAIProvider(envKey);
      const modelo = providerInfo?.modelo || 'gpt-4o-mini';

      const systemPrompt = `Você reescreve mensagens de WhatsApp de vendas/atendimento em variações diferentes, mantendo o mesmo sentido e tom da original.
REGRAS ESTRITAS:
- Preserve EXATAMENTE qualquer trecho entre chaves duplas, como {{nome}}, {{primeiro_nome}}, {{telefone}}, {{data}}, {{empresa}} — nunca traduza, remova ou altere esses tokens.
- Cada variação deve ser uma mensagem COMPLETA e pronta pra enviar, não um resumo nem uma lista de sugestões.
- Varie a estrutura da frase de verdade (não só trocar 1-2 palavras) — objetivo é reduzir padrão repetitivo em envio em massa.
- Responda APENAS com um JSON array de strings, sem markdown, sem texto antes ou depois. Exemplo: ["variação 1", "variação 2"]`;

      // [AUDITORIA] LÓGICA: UMA chamada só (sem loop, sem tool, `tools: []`) — a garantia de "1
      // chamada por clique" pedida no ticket vem exatamente daqui: nada neste handler itera sobre
      // contatos nem chama `provider.complete()` mais de uma vez.
      const resp = await provider.complete(
        [{ role: 'user', content: `Mensagem original:\n${mensagem}\n\nGere ${quantidade} variações completas em JSON array, seguindo as regras.` }],
        systemPrompt,
        [],
        { model: modelo, temperature: 0.9, maxTokens: 800 },
      );

      if (!resp.text) {
        return res.status(502).json({ message: 'Provider de IA não retornou texto — tente novamente.' });
      }

      let variantes: string[];
      try {
        const limpo = resp.text.trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
        const parsed = JSON.parse(limpo);
        if (!Array.isArray(parsed) || !parsed.every(v => typeof v === 'string')) throw new Error('formato inesperado');
        variantes = parsed.filter(v => v.trim()).slice(0, quantidade);
      } catch (parseErr: any) {
        log.warn('DISPARO/GERAR_VARIACOES', 'Falha ao parsear JSON do provider', { texto: resp.text.slice(0, 300), err: parseErr?.message });
        return res.status(502).json({ message: 'IA retornou um formato inesperado — tente novamente.' });
      }

      if (!variantes.length) {
        return res.status(502).json({ message: 'Nenhuma variação válida retornada — tente novamente.' });
      }

      log.info('DISPARO/GERAR_VARIACOES', '1 chamada de IA — variações geradas', {
        userId, quantidadePedida: quantidade, quantidadeRetornada: variantes.length,
        tokensIn: resp.inputTokens, tokensOut: resp.outputTokens, modelo,
      });

      return res.json({ variantes, tokensIn: resp.inputTokens, tokensOut: resp.outputTokens });
    } catch (err: any) {
      log.error('DISPARO/GERAR_VARIACOES', 'Erro', { err: err?.message, stack: err?.stack });
      return res.status(500).json({ message: err.message || 'Erro ao gerar variações' });
    }
  });

  // ── GET /disparos/:id/logs ─────────────────────────────────────────────────
  router.get('/:id/logs', async (req: AuthRequest, res: Response) => {
    try {
      const r = await pool.query(
        `SELECT * FROM disparo_logs WHERE disparo_id = $1 AND user_id = $2 ORDER BY created_at ASC`,
        [req.params.id, req.userId]
      );
      return res.json(r.rows);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // [AUDITORIA] BUG (achado real, Sprint Continuidade — Vistoria de Problemas, 2026-08-25 —
  // investigando `SPRINT_DISPARO_TRAVANDO_FILA_GLOBAL_SERIAL.md`): `get_next_disparo_batch()`
  // marca linhas como `sending` ao dequeueá-las (`migrations.ts`); se o motor processa a
  // mensagem com sucesso, vira `sent`; se falha, vira `failed`. Mas se a CAMPANHA for
  // pausada/cancelada enquanto uma linha está no meio desse processamento (pelo operador na UI,
  // ou por uma intervenção direta como a desta mesma sessão em 10/08 — 3 campanhas pausadas
  // direto no banco por um achado urgente), essa linha específica fica presa em `sending` **pra
  // sempre**: `get_next_disparo_batch()` só busca `pending`, e nada mais nunca toca `sending`.
  // Confirmado com dado real de produção: 25 linhas de 2 campanhas já pausada/cancelada,
  // travadas em `sending` desde 07/08 (18 dias), miscontando o progresso real da campanha
  // (`enviados`/`falhas` nunca bateram com `total_leads`).
  // [AUDITORIA] FIX APLICADO: ao transicionar pra `pausado`/`cancelado` (via este mesmo PUT
  // genérico que a UI já usa, `MonitoringDashboard.tsx` → `handleStatusChange`), reseta
  // qualquer `disparo_logs.status='sending'` daquela campanha de volta pra `pending` — 100%
  // seguro contra reenvio duplicado porque `get_next_disparo_batch()` só enfileira linhas de
  // campanhas com `disparos.status='em_andamento'` (confirmado lendo a função SQL,
  // `migrations.ts`): campanha cancelada nunca mais processa essas linhas (inertes, mas agora
  // contabilizadas corretamente como "não enviadas" em vez de presas num limbo); campanha
  // pausada e depois retomada as reprocessa do zero — mesmo comportamento já usado e testado
  // pra `requeuePendentes()` (`disparoProcessor.ts`) no caso irmão (motor aborta o lote antes
  // de processar todas as linhas já dequeueadas).
  // Cria campanha (POST '/') cai direto no CRUD genérico (`base`, abaixo) — intercepta só pra
  // aplicar o teto diário (configurável por tenant) antes do INSERT.
  const clamparLimiteDiario = makeClamparLimiteDiario(pool);
  router.post('/', clamparLimiteDiario);

  router.put('/:id', clamparLimiteDiario, async (req: AuthRequest, res: Response, next: NextFunction) => {
    const novoStatus = req.body?.status;
    if (novoStatus === 'pausado' || novoStatus === 'cancelado') {
      // [AUDITORIA] BUG DE SEGURANÇA CORRIGIDO (achado 2026-09-04, revisão pós-Sprint Grupos/
      // Template): este UPDATE rodava só com `req.params.id`, sem checar dono nenhum — qualquer
      // usuário autenticado mandando PUT /api/disparos/<id de OUTRO tenant> com
      // {status:'cancelado'} já resetava as linhas `sending` daquele disparo alheio pra `pending`
      // ANTES do `next()` chegar no PUT genérico (`base`, logo abaixo) que aí sim rejeita a
      // mudança de status de verdade por dono (`WHERE id=$1 AND user_id=$2` em `crud.ts`). O
      // dano não é leitura de dado (nada vaza), é escrita: linha marcada `sending` costuma
      // significar requisição já em voo pra Evolution — resetá-la pra `pending` sem autorização
      // arrisca reenvio duplicado real pro contato quando o motor do dono de verdade retomar
      // aquele lote (mesmo mecanismo que este bloco existe pra corrigir, só que virado arma
      // contra outro tenant). [AUDITORIA] FIX APLICADO: mesmo padrão de escopo por dono que
      // `crud.ts`/o resto deste router já usa (`user_id = req.userId`, sem admin bypass — nenhuma
      // tabela deste projeto usa bypass hoje) — `EXISTS` confirma que o disparo_id pedido
      // realmente pertence ao caller antes de tocar em `disparo_logs`.
      await pool.query(
        `UPDATE disparo_logs SET status = 'pending'
         WHERE disparo_id = $1 AND status = 'sending'
           AND EXISTS (SELECT 1 FROM disparos d WHERE d.id = $1 AND d.user_id = $2)`,
        [req.params.id, req.userId]
      ).catch(err => log.warn('DISPARO', 'Falha ao resetar disparo_logs travados em sending', { disparoId: req.params.id, err: err?.message }));
    }
    next();
  });

  // [AUDITORIA] LÓGICA (2026-09-18 — pedido do usuário: "pode tirar essa trava, deixe como
  // opcional na configuração do sistema"): teto diário de disparo por instância vira uma
  // configuração DA CONTA (não mais um valor fixo de 50 no código) — cada tenant decide seu
  // próprio limite de risco. GET qualquer membro do time pode ver; PATCH só admin (é uma decisão
  // de risco pro número inteiro do time, não uma preferência pessoal). Registradas ANTES de
  // `router.use('/', base)` — senão o CRUD genérico tentaria tratar "config-limite" como um
  // `:id` de campanha.
  router.get('/config-limite', async (req: AuthRequest, res: Response) => {
    try {
      const teto = await resolverTetoDiarioDisparo(pool, req.userId!);
      return res.json({ limite_diario_disparos_max: teto });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  router.patch('/config-limite', adminMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const v = Math.trunc(Number(req.body?.limite_diario_disparos_max));
      // Sem teto máximo de propósito (pedido do usuário) — só um piso sensato (1) e um limite
      // superior generoso (1000) contra erro de digitação virando um valor absurdo sem querer.
      if (!Number.isFinite(v) || v < 1 || v > 1000) {
        return res.status(400).json({ message: 'Informe um número entre 1 e 1000.' });
      }
      const ownerId = await resolverOwnerId(pool, req.userId!);
      await pool.query(`UPDATE users SET limite_diario_disparos_max = $1 WHERE id = $2`, [v, ownerId]);
      return res.json({ limite_diario_disparos_max: v });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  router.use('/', base);
  return router;
}
