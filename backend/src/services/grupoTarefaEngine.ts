/**
 * grupoTarefaEngine.ts — Exceção controlada ao bloqueio de grupo do webhook: cria uma tarefa no
 * CRM (atribuída por rodízio a alguém do time) quando a IA identifica uma demanda real numa
 * mensagem de um grupo de WhatsApp EXPLICITAMENTE autorizado (`grupos_ia_permitidos`).
 *
 * Deliberadamente ISOLADO de agentEngine.ts — não reaproveita a engine de atendimento 1:1
 * (histórico, debounce, humanização, prompt/persona do agente, MCP_TOOLS completo). É chamado
 * só a partir de webhook.ts, e só para o JID exato que tiver uma linha `ativo=true` aqui —
 * qualquer outro grupo continua caindo no `if (isGroup) return;` de sempre, sem exceção.
 */
import { Pool, PoolClient } from 'pg';
import { criarProvider, OpenAIProvider, AIMessage } from './providers/index';
import type { MCPTool } from './mcp/tools';
import { evolutionFetch, sanitizeEvolutionUrl } from '../utils/resilientFetch';
import { log } from '../logger';

const COOLDOWN_MS = 2 * 60 * 1000;

// [AUDITORIA] LÓGICA: única ferramenta oferecida à IA neste fluxo — nunca MCP_TOOLS completo
// (a IA de grupo não deve ter acesso a registrar_pausa/criar_corrida/etc.). Não é exportada em
// MCP_TOOLS (mcp/tools.ts) de propósito, pra não vazar pro loop agêntico normal (processarMensagem).
const CRIAR_TAREFA_GRUPO_TOOL: MCPTool = {
  name: 'criar_tarefa_grupo',
  description:
    'Registra uma demanda de trabalho de um grupo de WhatsApp como tarefa no CRM, atribuída por rodízio a alguém do time. Use SOMENTE quando a mensagem for claramente uma demanda real (pedido, problema a resolver, solicitação de ação) — NUNCA para bate-papo, elogio, brincadeira ou mensagem social.',
  input_schema: {
    type: 'object',
    properties: {
      resumo: { type: 'string', description: 'Resumo objetivo da demanda, em uma frase, para quem for atender.' },
    },
    required: ['resumo'],
  },
};

const SYSTEM_PROMPT = `Você é um classificador. Analise a última mensagem de um grupo de WhatsApp e decida se ela é uma demanda de trabalho real (pedido, problema, solicitação clara de ação) que deveria virar uma tarefa para a equipe.

Se for uma demanda real: chame a ferramenta criar_tarefa_grupo com um resumo objetivo, em uma frase.
Se NÃO for (bate-papo, brincadeira, elogio, mensagem social, dúvida vaga sem pedido de ação claro): não chame nenhuma ferramenta e não escreva nenhum texto.

Nunca responda com texto livre — só decida entre chamar a ferramenta ou não fazer nada.`;

export interface ParamsGrupoAutorizado {
  userId: string;
  instancia: string;
  remoteJid: string;
  texto: string;
  contatoNome?: string | null;
  contatoTelefone?: string | null;
}

type ResultadoCriacao = 'ok' | 'cooldown' | 'sem_participantes' | 'nao_encontrado';

export async function processarMensagemGrupoAutorizado(pool: Pool, p: ParamsGrupoAutorizado): Promise<void> {
  const texto = (p.texto || '').trim();
  if (!texto) return;

  try {
    // Re-checagem defensiva — o gate em webhook.ts já confirmou `ativo=true` antes de chamar
    // esta função, mas entre esse SELECT e a execução real (chamada de LLM pode levar segundos)
    // o usuário pode ter desativado o grupo; não vale a pena classificar/criar tarefa nesse caso.
    const permissaoRes = await pool.query(
      `SELECT id FROM grupos_ia_permitidos WHERE user_id = $1 AND group_jid = $2 AND ativo = true LIMIT 1`,
      [p.userId, p.remoteJid]
    );
    if (!permissaoRes.rows.length) return;
    const permissaoId = permissaoRes.rows[0].id;

    const providerInfo = await criarProvider(pool, p.userId, null);
    const envKey = process.env.OPENAI_API_KEY || '';
    const provider = providerInfo?.provider ?? new OpenAIProvider(envKey);
    const modelo = providerInfo?.modelo || 'gpt-4o-mini';

    const mensagens: AIMessage[] = [{ role: 'user', content: texto }];
    const resp = await provider.complete(mensagens, SYSTEM_PROMPT, [CRIAR_TAREFA_GRUPO_TOOL], {
      model: modelo,
      temperature: 0.2,
      maxTokens: 300,
    });

    // [AUDITORIA] LÓGICA: log da decisão em todo caso (não só quando cria tarefa) — sem isso,
    // "IA decidiu que não é demanda" e "a chamada de LLM falhou antes de completar" seriam
    // indistinguíveis nos logs (os dois resultam em silêncio). Ajuda a diferenciar falso
    // negativo de classificação de um problema de infraestrutura.
    const chamada = resp.toolCalls.find(tc => tc.name === 'criar_tarefa_grupo');
    log.info('GRUPO_TAREFA', 'Classificação da IA concluída', {
      userId: p.userId, remoteJid: p.remoteJid, chamouTool: !!chamada,
      textoResposta: (resp.text || '').slice(0, 200), modelo,
    });
    if (!chamada) return; // IA decidiu que não é demanda — silêncio total, nenhuma resposta no grupo

    const resumo = String(chamada.input?.resumo || '').trim();
    if (!resumo) return;

    const resultado = await criarTarefaComRodizio(pool, permissaoId, {
      userId: p.userId,
      remoteJid: p.remoteJid,
      resumo,
      contatoNome: p.contatoNome || null,
      contatoTelefone: p.contatoTelefone || null,
    });

    if (resultado === 'cooldown') {
      log.info('GRUPO_TAREFA', 'Bloqueado por cooldown de 2min — nenhuma tarefa criada', { userId: p.userId, remoteJid: p.remoteJid });
      return;
    }
    if (resultado === 'sem_participantes') {
      log.warn('GRUPO_TAREFA', 'grupos_ia_permitidos sem participantes cadastrados — tarefa não criada', { userId: p.userId, remoteJid: p.remoteJid });
      return;
    }
    if (resultado !== 'ok') return;

    await enviarConfirmacaoGrupo(pool, p.userId, p.instancia, p.remoteJid);
  } catch (err: any) {
    log.error('GRUPO_TAREFA', 'Erro ao processar mensagem de grupo autorizado', { err: err?.message, stack: err?.stack });
  }
}

// [AUDITORIA] LÓGICA: transação com FOR UPDATE — mesmo idioma já usado em get_next_disparo_batch
// (migrations.ts) pra fila concorrente — garante que duas mensagens quase simultâneas no mesmo
// grupo nunca escolham a mesma pessoa nem burlem o cooldown numa corrida.
async function criarTarefaComRodizio(
  pool: Pool,
  permissaoId: string,
  dados: { userId: string; remoteJid: string; resumo: string; contatoNome: string | null; contatoTelefone: string | null },
): Promise<ResultadoCriacao> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    const permRes = await client.query(
      `SELECT participantes_ids, proximo_indice, ultima_tarefa_em
       FROM grupos_ia_permitidos WHERE id = $1 FOR UPDATE`,
      [permissaoId]
    );
    if (!permRes.rows.length) {
      await client.query('ROLLBACK');
      return 'nao_encontrado';
    }
    const { participantes_ids: participantes, proximo_indice: indiceAtual, ultima_tarefa_em: ultimaTarefaEm } = permRes.rows[0];

    if (ultimaTarefaEm && Date.now() - new Date(ultimaTarefaEm).getTime() < COOLDOWN_MS) {
      await client.query('ROLLBACK');
      return 'cooldown';
    }

    // [AUDITORIA] LÓGICA: `participantes_ids='{}'` é o estado padrão (nenhum time cadastrado
    // ainda) — feature fica inofensiva: não cria tarefa nenhuma, só loga aviso, nunca quebra.
    if (!participantes || !participantes.length) {
      await client.query('ROLLBACK');
      return 'sem_participantes';
    }

    const total = participantes.length;
    const indiceEscolhido = ((indiceAtual % total) + total) % total; // defensivo contra índice negativo/fora de faixa (edição manual da linha)
    const atribuidoA = participantes[indiceEscolhido];

    await client.query(
      `UPDATE grupos_ia_permitidos SET proximo_indice = $2, ultima_tarefa_em = NOW(), updated_at = NOW() WHERE id = $1`,
      [permissaoId, (indiceEscolhido + 1) % total]
    );

    const titulo = dados.resumo.split(/\s+/).slice(0, 8).join(' ');
    await client.query(
      `INSERT INTO tarefas (user_id, atribuido_a, origem, resumo_ia, remote_jid, contato_nome, contato_telefone, titulo, status)
       VALUES ($1, $2, 'grupo_whatsapp', $3, $4, $5, $6, $7, 'pendente')`,
      [dados.userId, atribuidoA, dados.resumo, dados.remoteJid, dados.contatoNome, dados.contatoTelefone, titulo]
    );

    await client.query('COMMIT');
    return 'ok';
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// [AUDITORIA] LÓGICA: confirmação curta e fixa, sem detalhe interno (sem nome de quem foi
// atribuído, sem resumo) — pedido explícito do usuário de não expor informação interna no
// grupo. `number` é o JID completo com `@g.us` (diferente do envio pra contato individual, que
// manda só dígitos e deixa a Evolution completar `@s.whatsapp.net`) — grupo precisa do sufixo
// explícito.
async function enviarConfirmacaoGrupo(pool: Pool, userId: string, instancia: string, remoteJid: string): Promise<void> {
  try {
    // [AUDITORIA] LÓGICA (Sprint 1 unificação, 2026-08-07): tentativa por evolution_instancia
    // exata primeiro (mais específica pra tenant com múltiplas instâncias); fallback pra
    // qualquer linha ativa do usuário com credenciais preenchidas.
    const agtRes = await pool.query(
      `SELECT evolution_server_url AS url, evolution_api_key AS api_key
       FROM agentes WHERE user_id = $1 AND LOWER(evolution_instancia) = LOWER($2) AND ativo = true LIMIT 1`,
      [userId, instancia]
    );
    let cfg = agtRes.rows[0];
    if (!cfg?.url || !cfg?.api_key) {
      const agtFallbackRes = await pool.query(
        `SELECT evolution_server_url AS url, evolution_api_key AS api_key
         FROM agentes WHERE user_id = $1 AND ativo = true
           AND evolution_server_url IS NOT NULL AND evolution_api_key IS NOT NULL
         ORDER BY updated_at DESC LIMIT 1`,
        [userId]
      );
      cfg = agtFallbackRes.rows[0];
    }
    if (!cfg?.url || !cfg?.api_key) {
      log.warn('GRUPO_TAREFA', 'Sem config de Evolution para confirmar no grupo — tarefa já criada, confirmação não enviada', { userId, remoteJid });
      return;
    }

    const base = sanitizeEvolutionUrl(cfg.url);
    const r = await evolutionFetch(`${base}/message/sendText/${instancia}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.api_key },
      body: JSON.stringify({ number: remoteJid, text: 'Anotado! Já registrei essa demanda para a equipe. ✅', delay: 800 }),
    });
    if (!r.ok) {
      log.warn('GRUPO_TAREFA', 'Falha ao enviar confirmação no grupo', { status: r.status, remoteJid });
    }
  } catch (err: any) {
    log.warn('GRUPO_TAREFA', 'Erro ao enviar confirmação no grupo', { err: err?.message, remoteJid });
  }
}
